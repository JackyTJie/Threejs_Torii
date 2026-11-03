/**
 * 参道侧边泥土地（PATH_SYSTEM.pathSoil）
 *
 * 石阶两侧各一条 0.35–0.90 m 宽的深色湿泥带。雨后参道的排水就落在台阶两侧的泥里，
 * 所以这条泥带必须**贴附地形**而不是自己造形：每段用 terrainPatchGeometry 直接采样
 * groundHeight(x,z) 再整体抬 1.4 cm —— 既不会与地形 z-fighting，也不会在地块接缝处
 * 出现悬空（抬升量远小于一个法线阴影像素，肉眼读作同一张地面）。
 *
 * 宽度沿 z 由 fbm 连续变化、分段长度随机 ⇒ 泥带边缘不是一条等宽的直线，
 * 而是随坡面起伏自然收放。
 *
 * 三段式材质分工：
 *   soilPath    干泥面（上段、右侧日照较好处）
 *   soilPathWet 湿泥面（下段汇水处 + 靠溪谷的左侧）
 *   soilCut     紧贴石阶立面的「泥唇」—— 那是泥土被台阶切断的剖面色
 * 碎石 / 土块 / 嵌埋落叶都是独立网格、独立几何，不合并、不实例化。
 *
 * 泥带内缘只铺到石板侧面（x0 / x1）之外 1.5 cm：再往里就会盖住铺装面。
 * terrainPatchGeometry 与 rockGeometry 都不产出 uv，而贴图一律 repeat(1,1)，
 * 所以平铺尺寸在这里按世界米自己算（泥面 5 m、土块 0.55 m、碎石 0.16 m）。
 */
import { PATH, groundHeight } from '../layout.js';
import {
  group,
  leafSheetGeometry,
  mesh,
  place,
  rng,
  rockGeometry,
  terrainPatchGeometry,
  triplanarUv,
  fbm3
} from '../primitives.js';

const Z_START = 12.05;
const Z_END = -7.95;
const PITCH = [0.86, 1.28];
const BAND_WIDTH = [0.35, 0.9];
const INNER_GAP = 0.015;
const MUD_LIFT = 0.014;
const LIP_LIFT = 0.03;
const LIP_WIDTH = [0.1, 0.19];

const SOIL_TILE = 5;
const CLOD_TILE = 0.55;
const PEBBLE_TILE = 0.16;

const PEBBLES_PER_SEG = [2, 4];
const CLODS_PER_SEG = [1, 3];
const LEAVES_PER_SEG = [1, 3];
const PEBBLE_R = [0.03, 0.09];
const CLOD_R = [0.05, 0.12];
const LEAF_SIZE = [0.06, 0.11];
const SINK = 0.4;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

const SIDES = [
  { key: 'left', dir: -1, inner: PATH.x0, wetBias: 0.3 },
  { key: 'right', dir: 1, inner: PATH.x1, wetBias: 0 }
];

/** 沿 z 的分段断点：每段长度随机，末段被 Z_END 截断 */
function segmentBreaks(seed) {
  const rand = rng(seed);
  const zs = [Z_START];
  let guard = 0;
  while (zs[zs.length - 1] > Z_END && guard++ < 200) {
    const next = zs[zs.length - 1] - lerp(PITCH[0], PITCH[1], rand());
    zs.push(Math.max(Z_END, next));
  }
  return zs;
}

/** 泥带外缘 x：宽度随 z 连续摆动 */
function bandOuterX(side, zCenter, seed) {
  const w = lerp(BAND_WIDTH[0], BAND_WIDTH[1], clamp(fbm3(zCenter * 0.42, seed, 0.7, 3), 0, 1));
  return side.inner + side.dir * (INNER_GAP + w);
}

/** 湿泥 / 干泥：下段汇水 + 靠溪一侧更湿 */
function bandMaterial(M, side, zCenter, seed) {
  const downT = clamp((zCenter - PATH.zUpper) / (PATH.zBottom - PATH.zUpper), 0, 1);
  const patch = (fbm3(zCenter * 0.66, seed + 4.1, 2.3, 3) - 0.5) * 0.34;
  const wetness = 0.62 * downT + side.wetBias + patch;
  return wetness > 0.52 ? M.soilPathWet : M.soilPath;
}

/** 贴地泥面 */
function soilSheet(xa, xb, zBack, zFront, seed) {
  const width = Math.abs(xb - xa);
  const depth = zFront - zBack;
  const cols = clamp(Math.round(width / 0.2), 3, 5);
  const rows = clamp(Math.round(depth / 0.24), 3, 6);
  const geo = terrainPatchGeometry({
    x0: Math.min(xa, xb),
    x1: Math.max(xa, xb),
    z0: zBack,
    z1: zFront,
    cols,
    rows,
    heightFn: (x, z) => groundHeight(x, z) + MUD_LIFT
  });
  triplanarUv(geo, SOIL_TILE);
  return geo;
}

export function createPathSoil(M, options = {}) {
  const root = group('pathSoil');
  root.userData.assetName = 'pathSoil';

  const samples = [];
  const zBreaks = segmentBreaks(options.seed ?? 4103);
  let minX = Infinity;
  let maxX = -Infinity;
  let minGround = Infinity;
  let maxGround = -Infinity;
  let meshCount = 0;

  const track = (x, z, ground) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minGround = Math.min(minGround, ground);
    maxGround = Math.max(maxGround, ground);
  };

  for (const side of SIDES) {
    for (let i = 0; i + 1 < zBreaks.length; i++) {
      const zFront = zBreaks[i];
      const zBack = zBreaks[i + 1];
      const zc = (zFront + zBack) / 2;
      const seed = 900 + i * 37 + (side.dir > 0 ? 511 : 0);
      const rand = rng(seed);

      const xIn = side.inner + side.dir * INNER_GAP;
      const xOut = bandOuterX(side, zc, seed);
      const groundIn = groundHeight(xIn, zc);
      const groundOut = groundHeight(xOut, zc);
      const groundMid = (groundIn + groundOut) / 2;
      track(xIn, zc, groundMid);
      track(xOut, zc, groundMid);

      const sheet = mesh(soilSheet(xIn, xOut, zBack, zFront, seed), bandMaterial(M, side, zc, seed), `pathSoil-${side.key}-${i}`);
      sheet.castShadow = false;
      sheet.receiveShadow = true;
      root.add(sheet);
      meshCount++;
      samples.push({ x: (xIn + xOut) / 2, y: groundMid + MUD_LIFT, z: zc });

      // 泥唇：贴着石阶立面的一条窄泥脊，用剖切面色，把「石阶嵌在土里」这件事说清楚
      const lipW = lerp(LIP_WIDTH[0], LIP_WIDTH[1], rand());
      const lipOut = side.inner + side.dir * (INNER_GAP + lipW);
      const lip = mesh(soilSheet(xIn, lipOut, zBack, zFront, seed + 13), M.soilCut, `pathSoilLip-${side.key}-${i}`);
      lip.position.y = LIP_LIFT - MUD_LIFT;
      lip.castShadow = false;
      lip.receiveShadow = true;
      root.add(lip);
      meshCount++;

      // 碎石：半埋进泥里，随机朝向
      const pebbleCount = Math.round(lerp(PEBBLES_PER_SEG[0], PEBBLES_PER_SEG[1], rand()));
      for (let p = 0; p < pebbleCount; p++) {
        const t = rand();
        const px = lerp(xIn, xOut, 0.12 + t * 0.8);
        const pz = lerp(zBack, zFront, 0.1 + rand() * 0.8);
        const r = lerp(PEBBLE_R[0], PEBBLE_R[1], rand());
        const g = groundHeight(px, pz);
        const geo = triplanarUv(
          rockGeometry(r, seed * 31 + p, { widthSegments: 10, heightSegments: 7, wobble: 0.34, flatten: 0.66 }),
          PEBBLE_TILE,
          [px, g, pz]
        );
        const pebble = mesh(geo, M.stonePebble, `pathSoilPebble-${side.key}-${i}-${p}`);
        place(pebble, { x: px, y: g - r * SINK, z: pz, ry: rand() * Math.PI * 2 });
        pebble.castShadow = true;
        pebble.receiveShadow = true;
        root.add(pebble);
        meshCount++;
        track(px, pz, g);
        samples.push({ x: px, y: g, z: pz });
      }

      // 土块：翻起的泥坨，集中在靠台阶一侧（被脚步踩出来的凹凸肌理）
      const clodCount = Math.round(lerp(CLODS_PER_SEG[0], CLODS_PER_SEG[1], rand()));
      for (let c = 0; c < clodCount; c++) {
        const px = lerp(xIn, xOut, 0.05 + rand() * 0.5);
        const pz = lerp(zBack, zFront, 0.08 + rand() * 0.84);
        const r = lerp(CLOD_R[0], CLOD_R[1], rand());
        const g = groundHeight(px, pz);
        const geo = triplanarUv(
          rockGeometry(r, seed * 17 + c, { widthSegments: 12, heightSegments: 8, wobble: 0.44, flatten: 0.5 }),
          CLOD_TILE,
          [px, g, pz]
        );
        const clod = mesh(geo, rand() < 0.45 ? M.soilPathWet : M.soilCut, `pathSoilClod-${side.key}-${i}-${c}`);
        place(clod, { x: px, y: g - r * 0.3, z: pz, ry: rand() * Math.PI * 2 });
        clod.castShadow = true;
        clod.receiveShadow = true;
        root.add(clod);
        meshCount++;
        track(px, pz, g);
        samples.push({ x: px, y: g, z: pz });
      }

      // 嵌埋落叶：贴在泥面上被踩进土里的叶子（不飘落、不堆成山，只是痕迹）
      const leafCount = Math.round(lerp(LEAVES_PER_SEG[0], LEAVES_PER_SEG[1], rand()));
      for (let l = 0; l < leafCount; l++) {
        const px = lerp(xIn, xOut, 0.1 + rand() * 0.85);
        const pz = lerp(zBack, zFront, 0.06 + rand() * 0.88);
        const size = lerp(LEAF_SIZE[0], LEAF_SIZE[1], rand());
        const kind = rand() < 0.45 ? 'maple' : rand() < 0.75 ? 'beech' : 'oval';
        const geo = leafSheetGeometry({ kind, size, thickness: 0.004, curl: 0.34, steps: 22 });
        const pick = rand();
        const mat = pick < 0.4 ? M.leafSheetGround : pick < 0.68 ? M.leafSheetGroundRust : M.leafSheetGroundWet;
        // 叶片的局部平面是 XY（法线 +Z）。Euler 'XYZ' 把 Rx 放在最外层，先转 X 再绕 Y
        // 会把叶子重新立起来 ⇒ 把「躺平」烘进几何，Mesh 只留绕 Y 的朝向。
        geo.rotateX(-Math.PI / 2);
        const leaf = mesh(geo, mat, `pathSoilLeaf-${side.key}-${i}-${l}`);
        const g = groundHeight(px, pz);
        place(leaf, { x: px, y: g + MUD_LIFT + 0.004, z: pz, ry: rand() * Math.PI * 2 });
        leaf.castShadow = false;
        leaf.receiveShadow = true;
        root.add(leaf);
        meshCount++;
        track(px, pz, g);
        samples.push({ x: px, y: g, z: pz });
      }
    }
  }

  root.userData.samples = samples;
  root.userData.support = {
    host: {
      x: [minX - 0.02, maxX + 0.02],
      y: [minGround - 0.15, maxGround + 0.12],
      z: [Z_END - 0.05, Z_START + 0.05]
    }
  };
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}
