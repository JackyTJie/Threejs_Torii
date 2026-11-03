// 山涧蜿蜒叠瀑溪流（二维浅水方程 SWE 高密度位移网格 + 深度折射透底 + 实时水底焦散 + 多层次咬合叠石堰）：
// 1) 高密度浅水方程水面网格（WATER_COLS = 25, SAMPLE_PITCH = 0.09）：
//    在顶点着色器采样 SWE 模拟纹理（uSweTex.r）做真实 Y 轴波浪位移，并由中心差分实时计算法线；
// 2) 移除漂浮的白色椭球粒子（彻底消除怪异的白点反光），仅保留柔化羽化的 6 级小瀑布水帘与 SWE 实时浅水波纹；
// 3) 全面升级溪床叠石堰与河床乱石（streamBed）：
//    - 6 级小瀑布天然叠石堰升级为每级 9 块独立咬合岩石（两侧护岸劈理巨石 + 中间扁平锐棱堰唇石板 slabGeometry + 楔石，共 54 块堰石）；
//    - 200 颗多面体棱角溪底卵石与扁平河砾 + 12 处冲刷砂砾滩 + 48 片沉水红叶。
import * as THREE from 'three';
import { group, leafSheetGeometry, mesh, place, rng, rockGeometry, slabGeometry, triplanarUv } from '../primitives.js';
import {
  CONTENT_HALF,
  STREAM_CASCADES,
  STREAM_PATH,
  STREAM_STONES,
  lerp,
  streamBankHalf,
  streamCenterX,
  terrainHeight,
  waterY
} from '../layout.js';

/* ------------------------------------------------------------------ 采样与高密度网格参数 */

const Z_START = -CONTENT_HALF;
const Z_END = CONTENT_HALF;
const SAMPLE_PITCH = 0.09;
const SEARCH_STEP = 0.04;
const SEARCH_OUTER = 2.4;
const BISECT_ITER = 24;
const MIN_WATER_WIDTH = 0.12;
const RUN_GAP = 0.6;

const WATER_COLS = 25;
const WATER_RATIOS = [];
for (let c = 0; c < WATER_COLS; c++) WATER_RATIOS.push(1 - (2 * c) / (WATER_COLS - 1));
const WATER_UV_TILE = 2.2;

const DEPTH_MIN = 0.012;
const LIFT_FULL = 0.016;
const MIN_LIFT = 0.005;
const MIN_BED_WIDTH = 0.15;
const BED_UV_TILE = 4;

const PEBBLE_COUNT = 200;
const PEBBLE_TILE = 0.16;
const BAR_COUNT = 12;
const SUNKEN_LEAF_COUNT = 48;

/* ------------------------------------------------------------------ 三维样条曲线与障碍物场 */

let cachedCurve = null;
let cachedObstacles = null;

export function getStreamSplineCurve() {
  if (cachedCurve) return cachedCurve;
  const pts = [];
  const zMin = STREAM_PATH[0].z;
  const zMax = STREAM_PATH[STREAM_PATH.length - 1].z;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const z = lerp(zMin, zMax, u);
    const x = streamCenterX(z);
    const y = waterY(z);
    pts.push(new THREE.Vector3(x, y, z));
  }
  cachedCurve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.45);
  return cachedCurve;
}

export function getStreamObstacles() {
  if (cachedObstacles) return cachedObstacles;
  const list = [];
  for (const st of STREAM_STONES) {
    list.push({ x: st.x, z: st.z, r: st.r * 1.08, isWeir: false });
  }
  const rand = rng(4127);
  STREAM_CASCADES.forEach((cas) => {
    const cx = streamCenterX(cas.z);
    const half = streamBankHalf(cas.z);
    const slots = [
      { dx: -half * 0.76, dz: -0.08, r: 0.34 },
      { dx: -half * 0.46, dz: 0.06, r: 0.26 },
      { dx: -half * 0.18, dz: -0.04, r: 0.22 },
      { dx: half * 0.18, dz: 0.04, r: 0.22 },
      { dx: half * 0.46, dz: -0.05, r: 0.26 },
      { dx: half * 0.76, dz: 0.08, r: 0.35 }
    ];
    for (const slot of slots) {
      const wx = cx + slot.dx + (rand() - 0.5) * 0.05;
      const wz = cas.z + slot.dz;
      list.push({ x: wx, z: wz, r: slot.r * 0.92, isWeir: true });
    }
  });
  cachedObstacles = list;
  return cachedObstacles;
}

/* ------------------------------------------------------------------ 站点测量 */

function stationZs() {
  const out = [];
  const n = Math.ceil((Z_END - Z_START) / SAMPLE_PITCH);
  for (let i = 0; i <= n; i++) {
    const z = Math.min(Z_END, Z_START + i * SAMPLE_PITCH);
    if (out.length > 0 && z - out[out.length - 1] < 1e-6) continue;
    out.push(z);
  }
  return out;
}

function waterlineEdge(cx, z, wy, half, dir) {
  if (terrainHeight(cx, z) >= wy) return 0;
  let prev = 0;
  const maxS = half + SEARCH_OUTER;
  for (let s = SEARCH_STEP; s <= maxS; s += SEARCH_STEP) {
    if (terrainHeight(cx + dir * s, z) >= wy) {
      let lo = prev;
      let hi = s;
      for (let k = 0; k < BISECT_ITER; k++) {
        const mid = (lo + hi) * 0.5;
        if (terrainHeight(cx + dir * mid, z) >= wy) hi = mid;
        else lo = mid;
      }
      return lo;
    }
    prev = s;
  }
  return half;
}

function bedlineEdge(cx, z, wy, half, dir) {
  if (wy - terrainHeight(cx, z) < DEPTH_MIN) return 0;
  let prev = 0;
  const maxS = half + SEARCH_OUTER;
  for (let s = SEARCH_STEP; s <= maxS; s += SEARCH_STEP) {
    if (wy - terrainHeight(cx + dir * s, z) < DEPTH_MIN) {
      let lo = prev;
      let hi = s;
      for (let k = 0; k < BISECT_ITER; k++) {
        const mid = (lo + hi) * 0.5;
        if (wy - terrainHeight(cx + dir * mid, z) < DEPTH_MIN) hi = mid;
        else lo = mid;
      }
      return lo;
    }
    prev = s;
  }
  return 0;
}

function liningY(x, z, wy) {
  const ground = terrainHeight(x, z);
  const depth = wy - ground;
  const lift = Math.min(LIFT_FULL, Math.max(MIN_LIFT, 0.45 * depth));
  return Math.min(ground + lift, wy - 0.006);
}

let measured = null;

function measureStations() {
  if (measured) return measured;
  const out = [];
  for (const z of stationZs()) {
    const cx = streamCenterX(z);
    const half = streamBankHalf(z);
    const wy = waterY(z);
    if (terrainHeight(cx, z) >= wy) continue;
    const left = waterlineEdge(cx, z, wy, half, -1);
    const right = waterlineEdge(cx, z, wy, half, 1);
    if (left + right < MIN_WATER_WIDTH) continue;
    out.push({
      z,
      cx,
      half,
      wy,
      left,
      right,
      bedLeft: bedlineEdge(cx, z, wy, half, -1),
      bedRight: bedlineEdge(cx, z, wy, half, 1)
    });
  }
  measured = out;
  return out;
}

function splitRuns(stations, pick) {
  const runs = [];
  let current = [];
  for (const st of stations) {
    if (pick && !pick(st)) continue;
    if (current.length > 0 && st.z - current[current.length - 1].z > RUN_GAP) {
      runs.push(current);
      current = [];
    }
    current.push(st);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function sheetGeometry(run, columns, vertexFn) {
  const position = [];
  const index = [];
  for (const st of run) {
    for (let c = 0; c < columns; c++) {
      const t = c / (columns - 1);
      position.push(...vertexFn(st, t));
    }
  }
  for (let i = 0; i + 1 < run.length; i++) {
    for (let c = 0; c + 1 < columns; c++) {
      const a = i * columns + c;
      const b = a + 1;
      const d = (i + 1) * columns + c;
      const e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function addPlanarUv(geo, tileMeters) {
  const position = geo.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / tileMeters;
    uv[i * 2 + 1] = position.getZ(i) / tileMeters;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/* ------------------------------------------------------------------ 柔化羽化的 6 级小瀑布水舌 */

function buildFeatheredCascadeSheets(root, M) {
  let count = 0;
  const foamMat = M.waterfallFoam || M.waterSurface;

  STREAM_CASCADES.forEach((cas, cIdx) => {
    const zTop = cas.z - cas.halfSpan * 0.72;
    const zBot = cas.z + cas.halfSpan * 0.78;
    const yTop = waterY(zTop) + 0.003;
    const yBot = waterY(zBot) + 0.004;
    const cxTop = streamCenterX(zTop);
    const cxBot = streamCenterX(zBot);
    const halfW = streamBankHalf(cas.z) * 0.66;

    const cols = 16;
    const rows = 10;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let r = 0; r <= rows; r++) {
      const u = r / rows;
      const z = lerp(zTop, zBot, u);
      const dropCurve = Math.pow(u, 1.46);
      const arch = Math.sin(u * Math.PI) * 0.022;
      const yBase = lerp(yTop, yBot, dropCurve) + arch;
      const cx = lerp(cxTop, cxBot, u);
      const w = halfW * 2 * (0.9 + 0.14 * Math.sin(u * Math.PI));

      for (let c = 0; c <= cols; c++) {
        const vn = c / cols;
        const v = vn - 0.5;
        const edgeTaper = Math.sin(vn * Math.PI);
        const ribs = (0.5 + 0.5 * Math.sin(vn * Math.PI * 5 + cIdx * 1.3)) * 0.016 * edgeTaper;
        const x = cx + v * w;
        const dz = Math.sin(vn * Math.PI * 3 + u * 2.2) * 0.028 * edgeTaper;
        pos.push(x, yBase + ribs, z + dz);
        uv.push(vn, u);
      }
    }
    const stride = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * stride + c;
        const b = a + 1;
        const d = (r + 1) * stride + c;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const curtain = mesh(geo, foamMat, `streamWater-cascade-${cIdx}`);
    curtain.castShadow = false;
    curtain.receiveShadow = false;
    curtain.userData.noCast = true;
    curtain.userData.noReceive = true;
    curtain.userData.noOutline = true;
    curtain.userData.cascadeCurtain = { phase: cIdx * 1.7 };
    root.add(curtain);
    count += 1;
  });

  return count;
}

function mouthGeometry(st) {
  const position = [];
  const index = [];
  for (let c = 0; c < WATER_COLS; c++) {
    const t = c / (WATER_COLS - 1);
    const x = st.cx + lerp(-st.left, st.right, t);
    position.push(x, liningY(x, st.z, st.wy), st.z);
    position.push(x, st.wy, st.z);
  }
  for (let c = 0; c + 1 < WATER_COLS; c++) {
    const a = c * 2;
    const b = a + 1;
    const d = a + 2;
    const e = a + 3;
    index.push(a, d, b, b, d, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return triplanarUv(geo, WATER_UV_TILE);
}

/**
 * 山涧水面（高密度 SWE 浅水方程位移网格 + 柔化羽化瀑布水舌，无怪异漂浮白点粒子）。
 */
export function createStreamWater(M) {
  const root = group('streamWater');
  root.userData.assetName = 'streamWater';

  const runs = splitRuns(measureStations(), null);
  const samples = [];
  let meshCount = 0;

  runs.forEach((run, runIndex) => {
    const geo = sheetGeometry(run, WATER_COLS, (st, t) => [
      st.cx + lerp(-st.left, st.right, t),
      st.wy,
      st.z
    ]);
    addPlanarUv(geo, WATER_UV_TILE);

    const sheet = mesh(geo, M.waterSurface, `streamWater-surface-${runIndex}`);
    sheet.castShadow = false;
    sheet.receiveShadow = false;
    sheet.userData.noCast = true;
    sheet.userData.noReceive = true;
    sheet.userData.noOutline = true;
    sheet.userData.waterSurface = true;
    sheet.userData.waterColumns = WATER_COLS;
    sheet.userData.waterColumnRatios = WATER_RATIOS;
    root.add(sheet);
    meshCount += 1;

    for (let i = 0; i < run.length; i += 8) {
      samples.push({ x: run[i].cx, y: run[i].wy, z: run[i].z });
    }

    const last = run[run.length - 1];
    if (last.z >= Z_END - 1e-6) {
      const cap = mesh(mouthGeometry(last), M.waterSurface, 'streamWater-mouth');
      cap.castShadow = false;
      cap.receiveShadow = false;
      cap.userData.noCast = true;
      cap.userData.noReceive = true;
      cap.userData.noOutline = true;
      root.add(cap);
      meshCount += 1;
    }
  });

  meshCount += buildFeatheredCascadeSheets(root, M);

  root.userData.samples = samples;
  root.userData.runCount = runs.length;
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}

/* ------------------------------------------------------------------ 溪床（多层次咬合叠石堰、棱角河卵石与沉叶） */

function gravelBarGeometry(radius, seed) {
  return rockGeometry(radius, seed, {
    widthSegments: 14,
    heightSegments: 9,
    wobble: 0.18,
    flatten: 0.16
  });
}

function pebbleGeometry(radius, seed, flatten = 0.52) {
  return rockGeometry(radius, seed, {
    widthSegments: 14,
    heightSegments: 10,
    wobble: 0.30,
    flatten
  });
}

function weirBoulderGeometry(radius, seed, flatten = 0.52) {
  return rockGeometry(radius, seed, {
    widthSegments: 22,
    heightSegments: 15,
    wobble: 0.28,
    flatten
  });
}

function weirSlabRing(rx, rz, rand, sides = 7) {
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (rand() - 0.5) * 0.22;
    const k = 0.8 + rand() * 0.28;
    ring.push([Math.cos(a) * rx * k, Math.sin(a) * rz * k]);
  }
  return ring;
}

export function createStreamBed(M) {
  const root = group('streamBed');
  root.userData.assetName = 'streamBed';

  const runs = splitRuns(
    measureStations(),
    (st) => st.bedLeft + st.bedRight >= MIN_BED_WIDTH
  );
  const samples = [];
  let meshCount = 0;

  runs.forEach((run, runIndex) => {
    const geo = sheetGeometry(run, WATER_COLS, (st, t) => {
      const x = st.cx + lerp(-st.bedLeft, st.bedRight, t);
      return [x, liningY(x, st.z, st.wy), st.z];
    });
    addPlanarUv(geo, BED_UV_TILE);

    const lining = mesh(geo, M.soilStreamBed, `streamBed-lining-${runIndex}`);
    lining.castShadow = false;
    lining.receiveShadow = true;
    lining.userData.noCast = true;
    root.add(lining);
    meshCount += 1;
  });

  const all = runs.flat();
  const rand = rng(4127);
  const stratMat = M.stoneRockStratified || M.stoneRock;
  const chipMat = M.stoneChip || M.stonePebble;

  // 1. 6 级小瀑布多层次天然咬合叠石堰（每级 9 块独立岩石 Mesh = 两侧护堰劈理石 + 扁平堰唇石板 + 咬合楔石，共 54 块）
  STREAM_CASCADES.forEach((cas, cIdx) => {
    const cx = streamCenterX(cas.z);
    const half = streamBankHalf(cas.z);
    const wy = waterY(cas.z);

    // 1a. 6 块主次错落的劈理堰石（两侧露出岸线护坡，中段半浸托起水帘）
    const weirSlots = [
      { dx: -half * 0.82, dz: -0.10, r: 0.35, flat: 0.58, mat: M.stoneRockWet },
      { dx: -half * 0.54, dz: 0.08, r: 0.27, flat: 0.52, mat: stratMat },
      { dx: -half * 0.24, dz: -0.05, r: 0.23, flat: 0.46, mat: M.stoneStream },
      { dx: half * 0.22, dz: 0.04, r: 0.22, flat: 0.46, mat: M.stoneStream },
      { dx: half * 0.52, dz: -0.06, r: 0.27, flat: 0.52, mat: M.stoneRock },
      { dx: half * 0.82, dz: 0.09, r: 0.36, flat: 0.58, mat: stratMat }
    ];
    weirSlots.forEach((slot, sIdx) => {
      const wx = cx + slot.dx + (rand() - 0.5) * 0.05;
      const wz = cas.z + slot.dz;
      const g = terrainHeight(wx, wz);
      const isOuter = Math.abs(slot.dx) > half * 0.45;
      const wyLocal = isOuter ? wy + slot.r * 0.16 : wy - slot.r * 0.05;
      const y = Math.max(g + slot.r * 0.12, wyLocal);
      const geo = triplanarUv(
        weirBoulderGeometry(slot.r, 8200 + cIdx * 37 + sIdx * 11, slot.flat),
        0.55,
        [wx, 0, wz]
      );
      const stone = mesh(geo, slot.mat, `streamBed-weir-${cIdx}-${sIdx}`);
      place(stone, {
        x: wx,
        y,
        z: wz,
        ry: rand() * Math.PI * 2,
        sx: 1 + (rand() - 0.5) * 0.24,
        sy: 1,
        sz: 1 + (rand() - 0.5) * 0.24
      });
      stone.rotation.x = (rand() - 0.5) * 0.16;
      stone.rotation.z = (rand() - 0.5) * 0.16;
      stone.castShadow = isOuter;
      stone.receiveShadow = true;
      stone.userData.noCast = !isOuter;
      stone.userData.noOutline = !isOuter;
      root.add(stone);
      samples.push({ x: wx, y, z: wz });
      meshCount += 1;
    });

    // 1b. 3 块扁平锐棱跌水堰唇石板（slabGeometry，构成瀑布段落ち台阶层理）
    const lipOffsets = [-half * 0.36, 0.0, half * 0.36];
    lipOffsets.forEach((dx, lIdx) => {
      const lx = cx + dx + (rand() - 0.5) * 0.04;
      const lz = cas.z - 0.04 + (rand() - 0.5) * 0.06;
      const rx = 0.22 + rand() * 0.08;
      const rz = 0.16 + rand() * 0.06;
      const thick = 0.06 + rand() * 0.03;
      const sGeo = triplanarUv(slabGeometry(weirSlabRing(rx, rz, rand, 7), thick), 0.45, [lx, 0, lz]);
      const slabY = waterY(lz) - 0.008;
      const lipSlab = mesh(sGeo, lIdx % 2 === 0 ? stratMat : M.stoneStream, `streamBed-weirLip-${cIdx}-${lIdx}`);
      place(lipSlab, { x: lx, y: slabY, z: lz, ry: rand() * Math.PI * 2 });
      lipSlab.rotation.x = 0.08 + rand() * 0.08;
      lipSlab.castShadow = false;
      lipSlab.receiveShadow = true;
      lipSlab.userData.noCast = true;
      lipSlab.userData.noOutline = false;
      root.add(lipSlab);
      meshCount += 1;
    });
  });

  // 2. 水下泥沙冲刷砾石条
  const barsPerRun = runs.map((run) => Math.max(1, Math.round((BAR_COUNT * run.length) / all.length)));
  let barIndex = 0;
  runs.forEach((run, runIndex) => {
    const count = barsPerRun[runIndex];
    for (let i = 0; i < count; i++) {
      const st = run[Math.floor(((i + 0.5) / count) * run.length)];
      const radius = 0.28 + rand() * 0.14;
      const x = st.cx + lerp(-st.bedLeft, st.bedRight, 0.2 + rand() * 0.6);
      const ground = liningY(x, st.z, st.wy);
      const topAboveGround = radius * 0.16 * 1.35;
      const y = Math.min(ground + 0.015, st.wy - 0.022 - topAboveGround);
      const geo = triplanarUv(gravelBarGeometry(radius, 7100 + barIndex * 37), BED_UV_TILE);
      const bar = mesh(geo, M.soilBank, `streamBed-bar-${barIndex}`);
      bar.position.set(x, y, st.z);
      bar.rotation.y = rand() * Math.PI;
      bar.castShadow = false;
      bar.receiveShadow = true;
      bar.userData.noCast = true;
      bar.userData.noOutline = true;
      root.add(bar);
      samples.push({ x, y, z: st.z });
      meshCount += 1;
      barIndex += 1;
    }
  });

  // 3. 200 颗多面体棱角溪底河石与碎石片（大小、扁平度与冷暖灰调错落）
  const pebblesPerRun = runs.map((run) => Math.max(1, Math.round((PEBBLE_COUNT * run.length) / all.length)));
  let pebbleIndex = 0;
  runs.forEach((run, runIndex) => {
    const count = pebblesPerRun[runIndex];
    for (let i = 0; i < count; i++) {
      const st = run[Math.floor(rand() * run.length)];
      const radius = 0.038 + rand() * 0.082;
      const flatten = 0.38 + rand() * 0.28;
      const x = st.cx + lerp(-st.bedLeft, st.bedRight, 0.06 + rand() * 0.88);
      const ground = liningY(x, st.z, st.wy);
      const y = ground + 0.22 * radius;
      const geo = triplanarUv(pebbleGeometry(radius, 9100 + pebbleIndex * 53, flatten), PEBBLE_TILE, [x, 0, st.z]);
      const pick = rand();
      const mat = pick < 0.35
        ? M.stoneStream
        : pick < 0.65
          ? M.stonePebble
          : pick < 0.85
            ? stratMat
            : chipMat;
      const pebble = mesh(geo, mat, `streamBed-gravel-${pebbleIndex}`);
      place(pebble, {
        x,
        y,
        z: st.z,
        ry: rand() * Math.PI * 2,
        sx: 0.85 + rand() * 0.4,
        sy: 1,
        sz: 0.85 + rand() * 0.4
      });
      pebble.castShadow = false;
      pebble.receiveShadow = true;
      pebble.userData.noCast = true;
      pebble.userData.noOutline = radius < 0.085;
      root.add(pebble);
      samples.push({ x, y, z: st.z });
      meshCount += 1;
      pebbleIndex += 1;
    }
  });

  // 4. 溪底泥沙上的沉水红褐落叶
  const leafGeo = leafSheetGeometry({ kind: 'maple', size: 0.085, thickness: 0.003, curl: 0.18, steps: 14 });
  leafGeo.rotateX(-Math.PI / 2);
  const leafMats = [M.leafSheetGroundRust, M.leafSheetGroundLight, M.leafSheetGround];
  for (let i = 0; i < SUNKEN_LEAF_COUNT; i++) {
    const st = all[Math.floor(rand() * all.length)];
    if (!st) continue;
    const lx = st.cx + lerp(-st.bedLeft * 0.75, st.bedRight * 0.75, rand());
    const ly = liningY(lx, st.z, st.wy) + 0.008;
    const leaf = mesh(leafGeo, leafMats[i % leafMats.length], `streamBed-leaf-${i}`);
    place(leaf, { x: lx, y: ly, z: st.z, ry: rand() * Math.PI * 2 });
    leaf.castShadow = false;
    leaf.receiveShadow = true;
    leaf.userData.noCast = true;
    leaf.userData.noOutline = true;
    root.add(leaf);
    meshCount += 1;
  }

  root.userData.samples = samples;
  root.userData.runCount = runs.length;
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}
