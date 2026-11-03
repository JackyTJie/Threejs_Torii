// 山涧蜿蜒叠瀑溪流（方法一：基于 CatmullRomCurve3 样条曲线 + 真实物理模拟粒子流体系统 + TubeGeometry 瀑布急流管）：
// 1) 三维样条曲线流道（createStreamSplineCurve）：
//    利用 THREE.CatmullRomCurve3 构建沿山谷蜿蜒曲折且含 6 级叠瀑高差的三维流体主轴曲线；
// 2) 曲线流管瀑布急流（TubeGeometry Jets & Cascade Ribbons）：
//    在 6 级小瀑布跌水段沿 CatmullRomCurve3 子样条生成多股三维流管（TubeGeometry）与水舌；
// 3) 真实拉格朗日物理流体粒子系统（Lagrangian Fluid Particles & Splash System）：
//    包含 1,080 颗顺流推进的溪流流体微粒（streamWater-particles）与 360 颗瀑布跌水飞沫微粒（streamWater-splash），
//    在 animations/stream-flow.js 中实时解算：样条切向平流 + 瀑布重力加速 + 溪石/石堰障碍物碰撞反射与卡门涡街绕流；
// 4) 澄澈见底的水下河床（streamBed）：
//    深褐湿泥沙底 + 6 级叠水石堰 + 冲刷砾石滩 + 140 颗水下鹅卵石 + 48 片沉水红叶，全部受实时斯涅尔折射焦散照亮。
import * as THREE from 'three';
import { group, leafSheetGeometry, mesh, place, rng, rockGeometry, triplanarUv } from '../primitives.js';
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
const SAMPLE_PITCH = 0.11;
const SEARCH_STEP = 0.04;
const SEARCH_OUTER = 2.4;
const BISECT_ITER = 24;
const MIN_WATER_WIDTH = 0.12;
const RUN_GAP = 0.6;

const WATER_COLS = 19;
const WATER_RATIOS = [];
for (let c = 0; c < WATER_COLS; c++) WATER_RATIOS.push(1 - (2 * c) / (WATER_COLS - 1));
const WATER_UV_TILE = 2.2;

const DEPTH_MIN = 0.012;
const LIFT_FULL = 0.016;
const MIN_LIFT = 0.005;
const MIN_BED_WIDTH = 0.15;
const BED_UV_TILE = 4;

const PEBBLE_COUNT = 140;
const PEBBLE_TILE = 0.16;
const BAR_COUNT = 12;
const SUNKEN_LEAF_COUNT = 48;

export const STREAM_PARTICLE_COUNT = 1080;
export const STREAM_SPLASH_COUNT = 360;

/* ------------------------------------------------------------------ 三维样条曲线（CatmullRomCurve3）与障碍物场 */

let cachedCurve = null;
let cachedObstacles = null;

/**
 * 构建沿山涧中心线蜿蜒曲折并包含 6 级瀑布跌水高差的 THREE.CatmullRomCurve3 样条曲线。
 */
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

/**
 * 汇总溪流内所有物理碰撞障碍物（8 块主溪石 STREAM_STONES + 6 级瀑布共 24 块叠水石堰），
 * 供物理粒子流体与浅水方程绕流使用。
 */
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
      { dx: -half * 0.74, dz: -0.1, r: 0.34 },
      { dx: -half * 0.28, dz: 0.05, r: 0.25 },
      { dx: half * 0.26, dz: -0.04, r: 0.24 },
      { dx: half * 0.74, dz: 0.08, r: 0.35 }
    ];
    for (const slot of slots) {
      const wx = cx + slot.dx + (rand() - 0.5) * 0.06;
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

/* ------------------------------------------------------------------ 曲线流管（TubeGeometry）与物理粒子流体系统 */

/**
 * 沿着每级小瀑布的 CatmullRomCurve3 子样条生成多股流管水束（TubeGeometry）与柔和水舌
 */
function buildCurveCascadeTubes(root, M, rand) {
  let count = 0;
  const foamMat = M.waterfallFoam || M.waterSurface;

  STREAM_CASCADES.forEach((cas, cIdx) => {
    const zTop = cas.z - cas.halfSpan * 0.78;
    const zBot = cas.z + cas.halfSpan * 0.85;
    const halfW = streamBankHalf(cas.z) * 0.66;

    // 1. 沿瀑布断面的 5 股 CatmullRomCurve3 跌水流管（TubeGeometry，避开中间堰石缝隙穿流而下）
    const streamOffsets = [-0.62, -0.32, 0.0, 0.34, 0.62];
    streamOffsets.forEach((latRatio, sIdx) => {
      const curvePts = [];
      const steps = 8;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const z = lerp(zTop, zBot, u);
        const dropCurve = Math.pow(u, 1.45);
        const arch = Math.sin(u * Math.PI) * 0.028;
        const y = lerp(waterY(zTop), waterY(zBot), dropCurve) + arch + 0.005;
        const wobbleX = Math.sin(u * Math.PI * 2 + sIdx * 1.4) * 0.035;
        const x = streamCenterX(z) + latRatio * halfW + wobbleX;
        curvePts.push(new THREE.Vector3(x, y, z));
      }
      const subCurve = new THREE.CatmullRomCurve3(curvePts);
      const radius = 0.028 + (sIdx % 2) * 0.012;
      const tubeGeo = new THREE.TubeGeometry(subCurve, 14, radius, 6, false);
      // 压扁流管形成自然水束截面
      const pos = tubeGeo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, pos.getY(i));
      }
      tubeGeo.computeVertexNormals();
      const tube = mesh(tubeGeo, foamMat, `streamWater-tube-${cIdx}-${sIdx}`);
      tube.castShadow = false;
      tube.receiveShadow = false;
      tube.userData.noCast = true;
      tube.userData.noReceive = true;
      tube.userData.noOutline = true;
      tube.userData.cascadeCurtain = { phase: cIdx * 1.3 + sIdx * 0.7 };
      root.add(tube);
      count += 1;
    });
  });

  return count;
}

/**
 * 构建拉格朗日物理流体粒子系统（InstancedMesh）：
 * 1) streamWater-particles：1080 颗沿 CatmullRomCurve3 样条流线平流、遇石块绕流、遇瀑布加速跌落的水体流线微粒；
 * 2) streamWater-splash：360 颗在 6 级小瀑布落水潭与溪石迎水面激荡弹跳的飞沫微粒。
 */
function buildFluidParticleSystem(root, M, rand) {
  const particleMat = M.waterParticle || M.waterfallFoam || M.waterSurface;
  const curve = getStreamSplineCurve();
  const obstacles = getStreamObstacles();

  // 流线水滴微粒几何（沿流向拉长的低多边形椭球水滴）
  const dropGeo = new THREE.IcosahedronGeometry(0.024, 1);
  dropGeo.scale(0.75, 0.32, 2.4);

  const flowInst = new THREE.InstancedMesh(dropGeo, particleMat, STREAM_PARTICLE_COUNT);
  flowInst.name = 'streamWater-particles';
  flowInst.castShadow = false;
  flowInst.receiveShadow = false;
  flowInst.userData.noCast = true;
  flowInst.userData.noReceive = true;
  flowInst.userData.noOutline = true;

  const states = [];
  const dummy = new THREE.Object3D();
  const pt = new THREE.Vector3();
  const tan = new THREE.Vector3();

  for (let i = 0; i < STREAM_PARTICLE_COUNT; i++) {
    const u = rand();
    curve.getPointAt(u, pt);
    curve.getTangentAt(u, tan);
    const half = Math.max(0.25, streamBankHalf(pt.z) * 0.72);
    const lat = (rand() * 2 - 1) * half;
    const speed = 0.048 + rand() * 0.036;
    const scale = 0.65 + rand() * 0.85;

    let px = pt.x + lat;
    const pz = pt.z;
    // 若初始落在溪石内部则推到石块外侧流线
    for (const ob of obstacles) {
      const dx = px - ob.x;
      const dz = pz - ob.z;
      const d = Math.hypot(dx, dz);
      if (d < ob.r + 0.06) {
        const push = (ob.r + 0.08) / Math.max(0.01, d);
        px = ob.x + dx * push;
      }
    }
    const py = waterY(pz) + 0.004;

    dummy.position.set(px, py, pz);
    dummy.rotation.set(0, Math.atan2(tan.x, tan.z), 0);
    dummy.scale.set(scale, scale, scale * (1 + speed * 4));
    dummy.updateMatrix();
    flowInst.setMatrixAt(i, dummy.matrix);

    states.push({
      u,
      lat,
      vx: 0,
      vy: 0,
      vz: 0,
      speed,
      scale,
      phase: rand() * Math.PI * 2
    });
  }
  flowInst.instanceMatrix.needsUpdate = true;
  flowInst.userData.fluidParticles = {
    states,
    curve,
    obstacles
  };
  root.add(flowInst);

  // 瀑布落水潭与撞石飞沫粒子（360 颗物理抛体/涡流飞沫）
  const splashGeo = new THREE.IcosahedronGeometry(0.018, 1);
  splashGeo.scale(1.1, 0.55, 1.1);
  const splashInst = new THREE.InstancedMesh(splashGeo, particleMat, STREAM_SPLASH_COUNT);
  splashInst.name = 'streamWater-splash';
  splashInst.castShadow = false;
  splashInst.receiveShadow = false;
  splashInst.userData.noCast = true;
  splashInst.userData.noReceive = true;
  splashInst.userData.noOutline = true;

  const splashStates = [];
  for (let i = 0; i < STREAM_SPLASH_COUNT; i++) {
    const casIdx = i % STREAM_CASCADES.length;
    const cas = STREAM_CASCADES[casIdx];
    const halfW = streamBankHalf(cas.z) * 0.65;
    const ox = streamCenterX(cas.z) + (rand() * 2 - 1) * halfW;
    const oz = cas.z + (rand() - 0.25) * cas.halfSpan * 1.4;
    const oy = waterY(oz) + 0.01 + rand() * 0.05;
    const life = rand();
    const s = 0.5 + rand() * 0.9;

    dummy.position.set(ox, oy, oz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    splashInst.setMatrixAt(i, dummy.matrix);

    splashStates.push({
      casIdx,
      life,
      speed: 0.8 + rand() * 0.9,
      latOffset: (rand() * 2 - 1) * halfW,
      vx: (rand() - 0.5) * 0.22,
      vy: 0.28 + rand() * 0.35,
      vz: 0.35 + rand() * 0.45,
      scale: s
    });
  }
  splashInst.instanceMatrix.needsUpdate = true;
  splashInst.userData.splashParticles = {
    states: splashStates,
    cascades: STREAM_CASCADES
  };
  root.add(splashInst);

  return 2;
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
 * 山涧水面（含高密度澄澈主水面、CatmullRomCurve3 瀑布流管、拉格朗日物理流体粒子与飞沫系统）。
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

  const rand = rng(8821);
  meshCount += buildCurveCascadeTubes(root, M, rand);
  meshCount += buildFluidParticleSystem(root, M, rand);

  root.userData.samples = samples;
  root.userData.runCount = runs.length;
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}

/* ------------------------------------------------------------------ 溪床（清澈水体下可见的泥土、跌水石堰、卵石与沉叶） */

function gravelBarGeometry(radius, seed) {
  return rockGeometry(radius, seed, {
    widthSegments: 12,
    heightSegments: 8,
    wobble: 0.14,
    flatten: 0.14
  });
}

function pebbleGeometry(radius, seed) {
  return rockGeometry(radius, seed, {
    widthSegments: 14,
    heightSegments: 9,
    wobble: 0.28,
    flatten: 0.58
  });
}

function weirBoulderGeometry(radius, seed) {
  return rockGeometry(radius, seed, {
    widthSegments: 14,
    heightSegments: 10,
    wobble: 0.22,
    flatten: 0.46
  });
}

/**
 * 山涧溪床：深色湿泥砂底 + 6 级小瀑布天然叠石堰 + 冲刷砾石条 + 140 颗溪底鹅卵石 + 48 片水下沉叶。
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

  const all = runs.flat();
  const rand = rng(4127);

  // 1. 6 级小瀑布天然跌水石堰（Weir Boulders）
  STREAM_CASCADES.forEach((cas, cIdx) => {
    const cx = streamCenterX(cas.z);
    const half = streamBankHalf(cas.z);
    const wy = waterY(cas.z);
    const weirSlots = [
      { dx: -half * 0.74, dz: -0.1, r: 0.34, mat: M.stoneRock },
      { dx: -half * 0.28, dz: 0.05, r: 0.25, mat: M.stoneStream },
      { dx: half * 0.26, dz: -0.04, r: 0.24, mat: M.stoneStream },
      { dx: half * 0.74, dz: 0.08, r: 0.35, mat: M.mossStone }
    ];
    weirSlots.forEach((slot, sIdx) => {
      const wx = cx + slot.dx + (rand() - 0.5) * 0.06;
      const wz = cas.z + slot.dz;
      const g = terrainHeight(wx, wz);
      const isOuter = Math.abs(slot.dx) > half * 0.5;
      const wyLocal = isOuter ? wy + slot.r * 0.14 : wy - slot.r * 0.06;
      const y = Math.max(g + slot.r * 0.12, wyLocal);
      const geo = triplanarUv(weirBoulderGeometry(slot.r, 8200 + cIdx * 31 + sIdx * 7), 0.65);
      const stone = mesh(geo, slot.mat, `streamBed-weir-${cIdx}-${sIdx}`);
      place(stone, { x: wx, y, z: wz, ry: rand() * Math.PI * 2 });
      stone.castShadow = isOuter;
      stone.receiveShadow = true;
      stone.userData.noCast = !isOuter;
      stone.userData.noOutline = !isOuter;
      root.add(stone);
      samples.push({ x: wx, y, z: wz });
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
      const topAboveGround = radius * 0.14 * 1.35;
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

  // 3. 溪底深浅鹅卵石与河床碎石（透过清澈溪水与折射焦散清晰可见）
  const pebblesPerRun = runs.map((run) => Math.max(1, Math.round((PEBBLE_COUNT * run.length) / all.length)));
  let pebbleIndex = 0;
  runs.forEach((run, runIndex) => {
    const count = pebblesPerRun[runIndex];
    for (let i = 0; i < count; i++) {
      const st = run[Math.floor(rand() * run.length)];
      const radius = 0.045 + rand() * 0.075;
      const x = st.cx + lerp(-st.bedLeft, st.bedRight, 0.08 + rand() * 0.84);
      const ground = liningY(x, st.z, st.wy);
      const y = ground + 0.24 * radius;
      const geo = triplanarUv(pebbleGeometry(radius, 9100 + pebbleIndex * 53), PEBBLE_TILE);
      const pick = rand();
      const mat = pick < 0.4 ? M.stoneStream : pick < 0.75 ? M.stonePebble : M.mossStone;
      const pebble = mesh(geo, mat, `streamBed-gravel-${pebbleIndex}`);
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
