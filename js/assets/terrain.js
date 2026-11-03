// 地形基底：七条主带（左脊林 / 左陡坡 / 溪谷 / 左坡脚 / 参道 / 右路肩 / 右坡林地）
// 与溪床切口合成一张连续高度场，按 z 每 4 m 一条分块，块内再按带边界 + 溪岸摆动
// 切成独立地块 —— 每块一个 Mesh、一套材质，不合并网格。
// 外沿补一圈「剖切裙壁」把高度场落到底座顶面，避免 ±CONTENT_HALF 处出现悬空断崖。
//
// terrainPatchGeometry 不产生 uv，而 soil* 材质都带 map 且 toTexture 固定 repeat(1,1)，
// 所以这里按「世界米 / 平铺尺寸」自己铺 uv。
import * as THREE from 'three';
import { group, mesh, terrainPatchGeometry } from '../primitives.js';
import {
  CONTENT_HALF,
  bandEdges,
  bandOf,
  streamBankHalf,
  streamCenterX,
  streamMask,
  terrainHeight
} from '../layout.js';

const Z_TILES = 8;
const PATCH_RESOLUTION = 0.4;
/** 过窄的地块会被合并进邻块：窄条既没有细节也没有意义，只会多出无用的接缝 */
const MIN_SEGMENT_WIDTH = 0.6;
/** 溪岸内缩：地块切线放在水面之外一点，溪底地块才能完整盖住被 streamMask 切出的凹槽 */
const BED_EDGE_MARGIN = 0.15;
const BED_MASK = 0.5;
const SKIRT_BOTTOM = -0.05;
const SKIRT_CORNER_OVERLAP = 0.05;

/** 材质 -> 贴图平铺尺寸（米） */
const SOIL_UV_TILE = {
  soilTerrain: 8,
  soilTerrainShade: 8,
  soilBank: 5,
  soilPath: 5,
  soilPathWet: 5,
  soilCut: 5,
  soilStreamBed: 4
};

const BAND_MATERIAL = {
  leftRidge: 'soilTerrain',
  leftSlope: 'soilTerrainShade',
  valley: 'soilBank',
  leftFoot: 'soilBank',
  path: 'soilCut',
  shoulder: 'soilPath',
  rightHill: 'soilTerrain'
};

/** 只有山体侧的地块投影；参道 / 路肩 / 溪底由石阶与水体自己造形，不再自投影 */
const CASTING_BANDS = new Set(['leftRidge', 'leftSlope', 'valley', 'leftFoot', 'rightHill']);

function clip(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function uniqueSorted(values, eps = 1e-4) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];
  for (const value of sorted) {
    if (!out.length || Math.abs(value - out[out.length - 1]) > eps) out.push(value);
  }
  return out;
}

function tileBounds() {
  const step = (CONTENT_HALF * 2) / Z_TILES;
  const tiles = [];
  for (let i = 0; i < Z_TILES; i++) {
    const z0 = -CONTENT_HALF + i * step;
    tiles.push({ z0, z1: i === Z_TILES - 1 ? CONTENT_HALF : z0 + step });
  }
  return tiles;
}

/**
 * 一个 z 块内的 x 断点：带边界（按块中心 z 求）+ 溪岸（按块两端 z 求并取包络，
 * 因为带边界只随溪中心线摆动，只按中心取样会在块的两端漏出未覆盖的溪底）。
 */
function segmentEdges(z0, z1) {
  const zc = (z0 + z1) / 2;
  const raw = [-CONTENT_HALF, CONTENT_HALF];
  for (const edge of bandEdges(zc)) raw.push(edge.x0, edge.x1);
  for (const z of [z0, z1]) {
    const center = streamCenterX(z);
    const half = streamBankHalf(z);
    raw.push(center - half - BED_EDGE_MARGIN, center + half + BED_EDGE_MARGIN);
  }
  const edges = uniqueSorted(raw.map((v) => clip(v, -CONTENT_HALF, CONTENT_HALF)));
  while (edges.length > 2) {
    let narrowest = 0;
    let width = Infinity;
    for (let i = 0; i + 1 < edges.length; i++) {
      const w = edges[i + 1] - edges[i];
      if (w < width) {
        width = w;
        narrowest = i;
      }
    }
    if (width >= MIN_SEGMENT_WIDTH) break;
    edges.splice(narrowest + 1, 1);
  }
  return edges;
}

/** 平面铺 uv：uv = 世界坐标 / 平铺尺寸 */
function addPlanarUv(geo, tileMeters) {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / tileMeters;
    uv[i * 2 + 1] = pos.getZ(i) / tileMeters;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** 按外法线定向铺一个三角 */
function pushTri(out, a, b, c, outward) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const flip = nx * outward[0] + ny * outward[1] + nz * outward[2] < 0;
  if (flip) out.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
  else out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

/**
 * 剖切裙壁：沿一条外沿把地形边缘标高垂直落到底座顶面之下。
 * 取样点直接复用地块断点，所以壁顶与地块边缘逐点重合、不会错缝。
 */
function skirtWallGeometry({ axis, sign, samples }) {
  const edge = CONTENT_HALF * sign;
  const outward = axis === 'z' ? [0, 0, sign] : [sign, 0, 0];
  const at = (t, y) => (axis === 'z' ? [edge, y, t] : [t, y, edge]);
  const heightAt = (t) => terrainHeight(axis === 'z' ? t : edge, axis === 'z' ? edge : t);
  const ts = uniqueSorted([
    ...samples,
    -(CONTENT_HALF + SKIRT_CORNER_OVERLAP),
    CONTENT_HALF + SKIRT_CORNER_OVERLAP
  ]);
  const pos = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i];
    const t1 = ts[i + 1];
    const a0 = at(t0, heightAt(t0));
    const a1 = at(t1, heightAt(t1));
    const b0 = at(t0, SKIRT_BOTTOM);
    const b1 = at(t1, SKIRT_BOTTOM);
    pushTri(pos, a0, b0, a1, outward);
    pushTri(pos, a1, b0, b1, outward);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  addPlanarUv(geo, SOIL_UV_TILE.soilCut);
  return geo;
}

export function createTerrain(M, options = {}) {
  const root = group('terrain');
  root.userData.assetName = 'terrain';

  const tiles = options.tiles ?? tileBounds();
  const rows = Math.max(2, Math.round((tiles[0].z1 - tiles[0].z0) / PATCH_RESOLUTION));
  const xSamples = [];
  const zSamples = [];
  let index = 0;

  for (const tile of tiles) {
    const zc = (tile.z0 + tile.z1) / 2;
    for (let i = 0; i <= rows; i++) zSamples.push(tile.z0 + (tile.z1 - tile.z0) * (i / rows));

    const edges = segmentEdges(tile.z0, tile.z1);
    for (let s = 0; s + 1 < edges.length; s++) {
      const x0 = edges[s];
      const x1 = edges[s + 1];
      xSamples.push(x0, x1);
      if (x1 - x0 < 1e-3) continue;

      const cx = (x0 + x1) / 2;
      const band = bandOf(cx, zc);
      const isBed = streamMask(cx, zc) >= BED_MASK;
      const materialName = isBed ? 'soilStreamBed' : (BAND_MATERIAL[band] ?? 'soilTerrain');
      const material = M[materialName];
      if (!material) throw new Error(`terrain: 缺少材质 ${materialName}`);

      const geo = terrainPatchGeometry({
        x0,
        x1,
        z0: tile.z0,
        z1: tile.z1,
        cols: Math.max(1, Math.round((x1 - x0) / PATCH_RESOLUTION)),
        rows,
        heightFn: terrainHeight
      });
      addPlanarUv(geo, SOIL_UV_TILE[materialName] ?? 6);

      const piece = mesh(geo, material, `terrain-${band}-${index}`);
      piece.castShadow = CASTING_BANDS.has(band) && !isBed;
      piece.receiveShadow = true;
      root.add(piece);
      index += 1;
    }
  }

  const skirtSpecs = [
    { axis: 'z', sign: 1, samples: xSamples },
    { axis: 'z', sign: -1, samples: xSamples },
    { axis: 'x', sign: 1, samples: zSamples },
    { axis: 'x', sign: -1, samples: zSamples }
  ];
  for (const spec of skirtSpecs) {
    const geo = skirtWallGeometry(spec);
    const piece = mesh(geo, M.soilCut, `terrain-skirt-${spec.axis}${spec.sign > 0 ? 'pos' : 'neg'}`);
    piece.castShadow = false;
    piece.receiveShadow = true;
    root.add(piece);
  }

  root.userData.meshCount = index + skirtSpecs.length;
  root.updateMatrixWorld(true);
  return root;
}
