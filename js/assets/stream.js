// 山涧溪流：水面（streamWater）与溪床（streamBed）—— 两个独立资产根。
//
// 为什么水面宽度要「求」出来，而不是直接取 STREAM.width / 2：
//   layout.js 的溪床下切是梯形（streamMask），并且只在 d = half 处让「地面正好等于水面」。
//   但 microRelief 的噪声会把这条等值线推来推去（±2 cm），直接按 half 铺水面会在某些
//   站点漫上护岸、在另一些站点留出缝隙。所以逐站点沿 ±x 做「湿/干」二分求水线：
//   从中心外推直到 terrainHeight >= waterY，再在最后一次湿润与第一次干燥之间二分 24 次。
//   这样水面边缘永远贴在真实地面上，波纹的岸列权重又固定为 0（见下），边缘不会翘起。
//
// 上游端自动收口：折线终点在 z = -14.5，再往上游 streamTAt 被夹住、垂距增大 ⇒
//   streamMask → 0 ⇒ 地面高于水面 ⇒ 站点被丢弃 ⇒ 水面自己 pinch 到 z ≈ -15.2 结束。
// 下游端：valleyLevel 在 z > 11.6 封顶（见 layout.js），溪谷保持潮湿 ⇒ 水一直流到
//   底座前缘 CONTENT_HALF，即文档里的「溪流自 +Z 前缘出画（x ≈ -5.2）」。
//
// 溪床衬砌为什么按「水深」抬升，而不是按横向列比羽化：
//   水线处 terrainHeight == waterY，任何固定正抬升都会在那里顶穿水面。
//   改用 lift = min(0.018, 0.5 · depth)，depth = waterY − terrainHeight：
//     · 衬砌顶恒在水面之下（lift < depth）
//     · 衬砌顶恒在地面之上 ≥ 6 mm（衬砌范围内 depth ≥ 0.012）⇒ 不与地形 z-fighting
//   衬砌边界另按 depth ≥ DEPTH_MIN 二分，比水线再内缩一点，露出地形自己的护岸坡。
//
// 逐站点 × 7 列、站点为主序（station-major）是 stream-flow.js 的硬要求：
//   它用 station = floor(index / columns) 求站点间距，用 ratios[i % columns] 取横向权重。
//   列比 [1, .667, .333, 0, −.333, −.667, −1] ⇒ 权重 1−ratio² 在岸列为 0，
//   水面边缘永远不动；只有内部列起伏。没有内部列的整片水面会一动不动。
import * as THREE from 'three';
import { group, mesh, rng, rockGeometry, triplanarUv } from '../primitives.js';
import {
  CONTENT_HALF,
  lerp,
  streamBankHalf,
  streamCenterX,
  terrainHeight,
  waterY
} from '../layout.js';

/* ------------------------------------------------------------------ 采样 */

const Z_START = -CONTENT_HALF;
const Z_END = CONTENT_HALF;
/** 站点间距：0.7 m 是最短波长，至少 4 个站点才撑得住一条波 */
const SAMPLE_PITCH = 0.175;
const SEARCH_STEP = 0.05;
const SEARCH_OUTER = 2.2;
const BISECT_ITER = 24;
/** 水线总宽小于此值的站点丢弃：只剩一条缝的水没有意义，只会在岸边留下毛刺 */
const MIN_WATER_WIDTH = 0.12;
/** 相邻站点 z 落差超过此值即断流，另起一段（每段一个 Mesh，不合并） */
const RUN_GAP = 0.6;

/* ------------------------------------------------------------------ 水面 */

const WATER_COLS = 7;
const WATER_RATIOS = [];
for (let c = 0; c < WATER_COLS; c++) WATER_RATIOS.push(1 - (2 * c) / (WATER_COLS - 1));
/** 水面 roughnessMap（水波细节贴图）的平铺尺寸：2.5 m 一格，比溪宽略大 */
const WATER_UV_TILE = 2.5;

/* ------------------------------------------------------------------ 溪床 */

/** 衬砌存在的最小水深（米）：小于此值的水膜不值得铺衬砌 */
const DEPTH_MIN = 0.012;
/** 衬砌相对地面的最大抬升（米） */
const LIFT_FULL = 0.018;
const MIN_LIFT = 0.006;
const MIN_BED_WIDTH = 0.15;
/** 与 terrain.js 的 SOIL_UV_TILE.soilStreamBed 必须一致，否则同一张砂底贴图会错位 */
const BED_UV_TILE = 4;

const PEBBLE_COUNT = 90;
const PEBBLE_TILE = 0.16;
const BAR_COUNT = 8;

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

/**
 * 沿 dir 方向求「地面升到水面」的位置（返回最后一个仍在水面之下的偏移量）。
 * 找不到穿越点时退回名义半宽 —— 只可能发生在整段都不出露的异常地形上。
 */
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

/** 沿 dir 方向求「水深小于 DEPTH_MIN」的位置（衬砌外沿，比水线更靠内） */
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

/** 衬砌顶面高度：永远严格低于水面、严格高于地面 */
function liningY(x, z, wy) {
  const ground = terrainHeight(x, z);
  const depth = wy - ground;
  const lift = Math.min(LIFT_FULL, Math.max(MIN_LIFT, 0.5 * depth));
  return Math.min(ground + lift, wy - 0.004);
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

/** 站点为主序的横断面网格：列沿 +x 推进、站点沿 +z 推进 ⇒ 法线朝 +Y */
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

/** 平铺 uv：世界米 / 平铺尺寸，与 terrain.js 的 addPlanarUv 完全同一约定 */
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

/* ------------------------------------------------------------------ 水面 */

/** 溪口断面：把最后一段水面的末端封住，否则从 +Z 方向看进去是一张空壳 */
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
 * 山涧水面。
 * @param {object} M 材质库
 * @returns {THREE.Group} 根名 streamWater
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
    // 顶点局部坐标即世界坐标：stream-flow.js 直接按局部坐标施加波位移
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

  root.userData.samples = samples;
  root.userData.runCount = runs.length;
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}

/* ------------------------------------------------------------------ 溪床 */

function gravelBarGeometry(radius, seed) {
  return rockGeometry(radius, seed, {
    widthSegments: 12,
    heightSegments: 8,
    wobble: 0.12,
    flatten: 0.12
  });
}

function pebbleGeometry(radius, seed) {
  return rockGeometry(radius, seed, {
    widthSegments: 14,
    heightSegments: 9,
    wobble: 0.28,
    flatten: 0.62
  });
}

/**
 * 山涧溪床：砂质衬砌 + 冲刷砾石条 + 溪底卵石。
 * 每一块卵石 / 每一条砾石条都是独立 Mesh（不合并、不实例化），
 * 因为它们的材质、贴图平铺尺寸与埋入深度各不相同。
 * @param {object} M 材质库
 * @returns {THREE.Group} 根名 streamBed
 */
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

  // 卵石与砾石条沿整条溪按站点均匀撒，避免只在某一段堆一堆
  const all = runs.flat();
  const rand = rng(4127);

  const barsPerRun = runs.map((run) => Math.max(1, Math.round((BAR_COUNT * run.length) / all.length)));
  let barIndex = 0;
  runs.forEach((run, runIndex) => {
    const count = barsPerRun[runIndex];
    for (let i = 0; i < count; i++) {
      const st = run[Math.floor(((i + 0.5) / count) * run.length)];
      const radius = 0.28 + rand() * 0.12;
      const x = st.cx + lerp(-st.bedLeft, st.bedRight, 0.2 + rand() * 0.6);
      const ground = liningY(x, st.z, st.wy);
      const topAboveGround = radius * 0.12 * 1.35;
      // 砾石条顶面必须留在水面之下，否则「冲刷痕迹」会变成露出水面的沙堆
      const y = Math.min(ground + 0.015, st.wy - 0.025 - topAboveGround);
      const geo = triplanarUv(gravelBarGeometry(radius, 7100 + barIndex * 37), BED_UV_TILE);
      const bar = mesh(geo, M.soilStreamBed, `streamBed-bar-${barIndex}`);
      bar.position.set(x, y, st.z);
      bar.rotation.y = rand() * Math.PI;
      bar.castShadow = false;
      bar.receiveShadow = true;
      bar.userData.noCast = true;
      // 水下的描边壳只会糊成一团黑影，边缘由水面自己提供
      bar.userData.noOutline = true;
      root.add(bar);
      samples.push({ x, y, z: st.z });
      meshCount += 1;
      barIndex += 1;
    }
  });

  const pebblesPerRun = runs.map((run) => Math.max(1, Math.round((PEBBLE_COUNT * run.length) / all.length)));
  let pebbleIndex = 0;
  runs.forEach((run, runIndex) => {
    const count = pebblesPerRun[runIndex];
    for (let i = 0; i < count; i++) {
      const st = run[Math.floor(rand() * run.length)];
      const radius = 0.04 + rand() * 0.06;
      const x = st.cx + lerp(-st.bedLeft, st.bedRight, 0.1 + rand() * 0.8);
      const ground = liningY(x, st.z, st.wy);
      // rockGeometry 的底在 origin 下方 0.65·flatten·r ⇒ 抬 0.25r 正好埋进溪底约 0.15r
      const y = ground + 0.25 * radius;
      const geo = triplanarUv(pebbleGeometry(radius, 9100 + pebbleIndex * 53), PEBBLE_TILE);
      const useStreamStone = rand() < 0.45;
      const pebble = mesh(
        geo,
        useStreamStone ? M.stoneStream : M.stonePebble,
        `streamBed-gravel-${pebbleIndex}`
      );
      pebble.position.set(x, y, st.z);
      pebble.rotation.y = rand() * Math.PI * 2;
      pebble.castShadow = false;
      pebble.receiveShadow = true;
      pebble.userData.noCast = true;
      pebble.userData.noOutline = true;
      root.add(pebble);
      samples.push({ x, y, z: st.z });
      meshCount += 1;
      pebbleIndex += 1;
    }
  });

  root.userData.samples = samples;
  root.userData.runCount = runs.length;
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}
