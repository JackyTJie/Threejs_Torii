// 山涧蜿蜒叠瀑溪流（二维浅水方程 SWE + 三维粒子化瀑布水帘/飞溅水珠/翻滚气泡白沫系统 + 斯涅尔折射透底 + 实时光追倒影 + 随波起伏漂浮落叶）：
// 1) 三维粒子化水流系统（buildStreamParticleSystems，共 2,160 颗动态流体粒子 InstancedMesh）：
//    - 瀑布抛物线水帘丝缕与水珠粒子（streamWater-jetParticles，720 颗）：沿 6 级叠瀑石堰豁口呈抛物线飞流直下，复现参考图 1 的分股水帘与飞珠；
//    - 落水潭翻涌白沫气泡团与飞溅水滴（streamWater-splashParticles，900 颗）：在每级瀑布落水潭与溪石迎水面翻滚扩散、弹跳飞溅，复现参考图 1/3/4/5 的粒子化白水；
//    - 乱石急流流线水珠链（streamWater-rapidParticles，540 颗）：顺着蜿蜒急流槽与八字绕石流线高速穿行；
// 2) 高密度三维动态起伏水面网格（WATER_COLS = 33, SAMPLE_PITCH = 0.065）与 42 片随波起伏漂浮落叶；
// 3) 溪床多材质层次（streamBed）：金褐砂砾河床 + 54 块交错叠石堰 + 320 颗多色阶棱角河石/卵石 + 12 处冲刷砂洲 + 48 片水底沉叶。
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
const SAMPLE_PITCH = 0.065;
const SEARCH_STEP = 0.04;
const SEARCH_OUTER = 2.4;
const BISECT_ITER = 24;
const MIN_WATER_WIDTH = 0.12;
const RUN_GAP = 0.6;

const WATER_COLS = 33;
const WATER_RATIOS = [];
for (let c = 0; c < WATER_COLS; c++) WATER_RATIOS.push(1 - (2 * c) / (WATER_COLS - 1));
const WATER_UV_TILE = 2.2;

const DEPTH_MIN = 0.012;
const LIFT_FULL = 0.016;
const MIN_LIFT = 0.005;
const MIN_BED_WIDTH = 0.15;
const BED_UV_TILE = 4;

const PEBBLE_COUNT = 320;
const PEBBLE_TILE = 0.16;
const BAR_COUNT = 12;
const SUNKEN_LEAF_COUNT = 48;
const FLOATING_DRIFT_LEAVES = 24;
const FLOATING_EDDY_LEAVES = 18;

const JET_PARTICLE_COUNT = 720;
const SPLASH_PARTICLE_COUNT = 900;
const RAPID_PARTICLE_COUNT = 540;

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
      bedLeft: Math.min(left * 0.70, bedlineEdge(cx, z, wy, half, -1)),
      bedRight: Math.min(right * 0.70, bedlineEdge(cx, z, wy, half, 1))
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
        const ribs = (0.5 + 0.5 * Math.sin(vn * Math.PI * 7 + cIdx * 1.3)) * 0.018 * edgeTaper;
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
    curtain.receiveShadow = true;
    curtain.renderOrder = 11;
    curtain.userData.noCast = true;
    curtain.userData.noReceive = false;
    curtain.userData.noOutline = true;
    curtain.userData.cascadeCurtain = { phase: cIdx * 1.7 };
    root.add(curtain);
    count += 1;
  });

  return count;
}

/* ------------------------------------------------------------------ 三维粒子化水流、瀑布飞珠与落水潭白沫系统（复现参考图 1/3/4/5） */

function buildStreamParticleSystems(root, M) {
  const rand = rng(9413);
  const sprayMat = M.waterSprayParticle || M.waterfallFoam || M.waterSurface;
  const foamMat = M.waterFoamCluster || M.waterfallFoam || M.waterSurface;
  const dummy = new THREE.Object3D();

  // 1) 瀑布分股抛物线水帘丝缕与飞落水珠粒子（720 颗，分布在 6 级叠瀑石堰的多股水舌上，复现参考图 1）
  const jetGeo = new THREE.SphereGeometry(0.016, 6, 5);
  const jetInst = new THREE.InstancedMesh(jetGeo, sprayMat, JET_PARTICLE_COUNT);
  jetInst.name = 'streamWater-jetParticles';
  jetInst.castShadow = false;
  jetInst.receiveShadow = true;
  jetInst.renderOrder = 12;
  jetInst.userData.noCast = true;
  jetInst.userData.noOutline = true;

  const jetSpecs = [];
  const jetsPerCas = Math.floor(JET_PARTICLE_COUNT / STREAM_CASCADES.length);
  for (let i = 0; i < JET_PARTICLE_COUNT; i++) {
    const cIdx = Math.min(STREAM_CASCADES.length - 1, Math.floor(i / jetsPerCas));
    const cas = STREAM_CASCADES[cIdx];
    const zTop = cas.z - cas.halfSpan * 0.65;
    const zBot = cas.z + cas.halfSpan * 0.72;
    const yTop = waterY(zTop) + 0.012;
    const yBot = waterY(zBot) + 0.008;
    const cxTop = streamCenterX(zTop);
    const cxBot = streamCenterX(zBot);
    const halfW = streamBankHalf(cas.z) * 0.62;

    // 分为 11 股穿过岩石缝隙的独立水帘束（模拟图 1 中分股垂落的水柱丝缕）
    const strandIdx = i % 11;
    const strandU = (strandIdx / 10) * 2 - 1;
    const lateralOffset = strandU * halfW * 0.88 + (rand() - 0.5) * 0.055;
    const spreadOut = strandU * 0.045 + (rand() - 0.5) * 0.035;
    const phase = rand();
    const speed = 1.65 + rand() * 0.95;
    const radiusScale = 0.68 + rand() * 0.68;
    const isStreak = rand() < 0.62;

    jetSpecs.push({
      cIdx, zTop, zBot, yTop, yBot, cxTop, cxBot,
      lateralOffset, spreadOut, phase, speed, radiusScale, isStreak
    });

    const u = phase;
    const x = lerp(cxTop, cxBot, u) + lateralOffset + spreadOut * u;
    const z = lerp(zTop, zBot, u);
    const y = lerp(yTop, yBot, u * u) + Math.sin(u * Math.PI) * 0.028;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0.55 + u * 0.65, 0, (rand() - 0.5) * 0.25);
    const sy = isStreak ? radiusScale * (2.2 + 2.4 * u) : radiusScale * 1.15;
    dummy.scale.set(radiusScale * 0.78, sy, radiusScale * 0.85);
    dummy.updateMatrix();
    jetInst.setMatrixAt(i, dummy.matrix);
  }
  jetInst.instanceMatrix.needsUpdate = true;
  jetInst.userData.streamParticles = { kind: 'jets', specs: jetSpecs };
  root.add(jetInst);

  // 2) 落水潭翻滚白沫气泡团与飞溅水滴粒子（900 颗：分布在 6 级瀑布落水潭 + 8 处溪心乱石激流区，复现参考图 1/3/4/5）
  const splashGeo = new THREE.IcosahedronGeometry(0.022, 1);
  const splashInst = new THREE.InstancedMesh(splashGeo, foamMat, SPLASH_PARTICLE_COUNT);
  splashInst.name = 'streamWater-splashParticles';
  splashInst.castShadow = false;
  splashInst.receiveShadow = true;
  splashInst.renderOrder = 12;
  splashInst.userData.noCast = true;
  splashInst.userData.noOutline = true;

  const splashSpecs = [];
  for (let i = 0; i < SPLASH_PARTICLE_COUNT; i++) {
    const isCascadePlunge = i < 620;
    let anchorX, anchorZ, anchorY, spanX, spanZ;
    if (isCascadePlunge) {
      const cas = STREAM_CASCADES[i % STREAM_CASCADES.length];
      const zPlunge = cas.z + cas.halfSpan * 0.55;
      anchorX = streamCenterX(zPlunge);
      anchorZ = zPlunge;
      anchorY = waterY(zPlunge);
      spanX = streamBankHalf(cas.z) * 0.64;
      spanZ = 0.42;
    } else {
      const st = STREAM_STONES[i % STREAM_STONES.length];
      anchorX = st.x;
      anchorZ = st.z - st.r * 0.25;
      anchorY = waterY(st.z);
      spanX = st.r * 1.35;
      spanZ = st.r * 1.45;
    }

    const isAirborneDrop = rand() < 0.42;
    const lat = (rand() - 0.5) * 2 * spanX;
    const driftZ = rand() * spanZ;
    const phase = rand();
    const speed = isAirborneDrop ? (2.1 + rand() * 1.2) : (0.95 + rand() * 0.75);
    const leapH = isAirborneDrop ? (0.045 + rand() * 0.11) : (0.008 + rand() * 0.016);
    const size = isAirborneDrop ? (0.42 + rand() * 0.45) : (0.75 + rand() * 1.15);

    splashSpecs.push({
      anchorX, anchorY, anchorZ, lat, spanX, spanZ, driftZ,
      phase, speed, leapH, size, isAirborneDrop
    });

    const u = phase;
    const x = anchorX + lat * (0.75 + 0.35 * u);
    const z = anchorZ + (u - 0.25) * spanZ;
    const wy = waterY(z);
    const y = wy + 4 * u * (1 - u) * leapH + 0.006;
    dummy.position.set(x, y, z);
    dummy.rotation.set(rand() * 3.14, rand() * 3.14, rand() * 3.14);
    const env = Math.sin(u * Math.PI);
    if (isAirborneDrop) {
      dummy.scale.setScalar(size * (0.45 + 0.65 * env));
    } else {
      const sHoriz = size * (0.65 + 0.85 * Math.sin(u * Math.PI * 0.85));
      dummy.scale.set(sHoriz, size * 0.32 * env, sHoriz * 1.15);
    }
    dummy.updateMatrix();
    splashInst.setMatrixAt(i, dummy.matrix);
  }
  splashInst.instanceMatrix.needsUpdate = true;
  splashInst.userData.streamParticles = { kind: 'splashes', specs: splashSpecs };
  root.add(splashInst);

  // 3) 乱石急流槽流线水珠链粒子（540 颗：沿着蜿蜒溪道急流线与岩石分流槽高速穿行，增强流体粒子动态感）
  const rapidGeo = new THREE.SphereGeometry(0.015, 5, 4);
  const rapidInst = new THREE.InstancedMesh(rapidGeo, sprayMat, RAPID_PARTICLE_COUNT);
  rapidInst.name = 'streamWater-rapidParticles';
  rapidInst.castShadow = false;
  rapidInst.receiveShadow = true;
  rapidInst.renderOrder = 11;
  rapidInst.userData.noCast = true;
  rapidInst.userData.noOutline = true;

  const curve = getStreamSplineCurve();
  const obstacles = getStreamObstacles();
  const rapidSpecs = [];
  for (let i = 0; i < RAPID_PARTICLE_COUNT; i++) {
    const u = rand();
    const pt = curve.getPointAt(u);
    const half = streamBankHalf(pt.z) * 0.62;
    const latRatio = (rand() - 0.5) * 1.85;
    const lat = latRatio * half;
    const speed = 0.065 + rand() * 0.055;
    const size = 0.55 + rand() * 0.65;
    const phase = rand() * Math.PI * 2;
    rapidSpecs.push({ u, latRatio, speed, size, phase });

    let x = pt.x + lat;
    const z = pt.z;
    for (const ob of obstacles) {
      const d = Math.hypot(x - ob.x, z - ob.z);
      if (d < ob.r + 0.06) {
        x = ob.x + (x >= ob.x ? 1 : -1) * (ob.r + 0.08);
      }
    }
    const y = waterY(z) + 0.008;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(size * 0.72, size * 0.42, size * 2.1);
    dummy.updateMatrix();
    rapidInst.setMatrixAt(i, dummy.matrix);
  }
  rapidInst.instanceMatrix.needsUpdate = true;
  rapidInst.userData.streamParticles = { kind: 'rapids', specs: rapidSpecs };
  root.add(rapidInst);

  return 3;
}

/* ------------------------------------------------------------------ 溪面随波起伏与漂流落叶系统 */

function buildFloatingStreamLeaves(root, M) {
  const rand = rng(8629);
  const curve = getStreamSplineCurve();
  const obstacles = getStreamObstacles();

  const mapleGeo = leafSheetGeometry({ kind: 'maple', size: 0.088, thickness: 0.0035, curl: 0.24, steps: 14 });
  mapleGeo.rotateX(-Math.PI / 2);
  const smallGeo = leafSheetGeometry({ kind: 'maple', size: 0.068, thickness: 0.003, curl: 0.20, steps: 12 });
  smallGeo.rotateX(-Math.PI / 2);

  const leafMats = [
    M.leafSheetFloatingGold || M.leafSheetGroundLight,
    M.leafSheetFloatingAmber || M.leafSheetGroundRust,
    M.leafSheetFloatingCrimson || M.leafSheetGroundRust,
    M.leafSheetFloatingGold || M.leafSheetGroundLight
  ];

  let count = 0;

  for (let i = 0; i < FLOATING_DRIFT_LEAVES; i++) {
    const u = (i + rand() * 0.85) / FLOATING_DRIFT_LEAVES;
    const pt = curve.getPointAt(u);
    const half = Math.max(0.18, streamBankHalf(pt.z) * 0.58);
    let lat = (rand() - 0.5) * 2 * half;
    let x = pt.x + lat;
    const z = pt.z;

    for (const ob of obstacles) {
      const d = Math.hypot(x - ob.x, z - ob.z);
      if (d < ob.r + 0.08) {
        const dir = x >= ob.x ? 1 : -1;
        x = ob.x + dir * (ob.r + 0.1);
        lat = x - pt.x;
      }
    }

    const y = waterY(z) + 0.008;
    const geo = i % 3 === 0 ? smallGeo : mapleGeo;
    const mat = leafMats[i % leafMats.length];
    const leaf = mesh(geo, mat, `streamWater-floatingLeaf-drift-${i}`);
    const yaw = rand() * Math.PI * 2;
    const scale = 0.82 + rand() * 0.42;
    place(leaf, { x, y, z, ry: yaw, sx: scale, sy: 1, sz: scale });
    leaf.castShadow = false;
    leaf.receiveShadow = true;
    leaf.renderOrder = 12;
    leaf.userData.noCast = true;
    leaf.userData.noOutline = true;
    leaf.userData.floatingLeaf = {
      mode: 'drift',
      u,
      lat,
      vx: 0,
      speed: 0.014 + rand() * 0.010,
      yaw,
      yawSpeed: (rand() - 0.5) * 0.85,
      phase: rand() * Math.PI * 2
    };
    root.add(leaf);
    count += 1;
  }

  for (let i = 0; i < FLOATING_EDDY_LEAVES; i++) {
    const st = STREAM_STONES[i % STREAM_STONES.length];
    const ang = rand() * Math.PI * 2;
    const dist = st.r * (0.86 + rand() * 0.48);
    const cx = streamCenterX(st.z);
    const half = streamBankHalf(st.z) * 0.72;
    const x = THREE.MathUtils.clamp(st.x + Math.cos(ang) * dist, cx - half, cx + half);
    const z = THREE.MathUtils.clamp(st.z + Math.sin(ang) * dist, Z_START + 0.5, Z_END - 0.5);
    const y = waterY(z) + 0.008;
    const geo = i % 2 === 0 ? mapleGeo : smallGeo;
    const mat = leafMats[(i + 1) % leafMats.length];
    const leaf = mesh(geo, mat, `streamWater-floatingLeaf-eddy-${i}`);
    const yaw = rand() * Math.PI * 2;
    const scale = 0.78 + rand() * 0.38;
    place(leaf, { x, y, z, ry: yaw, sx: scale, sy: 1, sz: scale });
    leaf.castShadow = false;
    leaf.receiveShadow = true;
    leaf.renderOrder = 12;
    leaf.userData.noCast = true;
    leaf.userData.noOutline = true;
    leaf.userData.floatingLeaf = {
      mode: 'eddy',
      anchorX: x,
      anchorZ: z,
      orbitR: 0.018 + rand() * 0.025,
      orbitSpeed: (rand() < 0.5 ? 1 : -1) * (0.9 + rand() * 0.8),
      yaw,
      yawSpeed: (rand() - 0.5) * 0.55,
      phase: rand() * Math.PI * 2
    };
    root.add(leaf);
    count += 1;
  }

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
 * 山涧水面（高密度三维起伏网格 + 2,160 颗动态瀑布飞沫水珠粒子系统 + 斯涅尔折射透底 + 鸟居/树冠光追倒影 + 42 片随水起伏浮叶）。
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
    sheet.receiveShadow = true;
    sheet.renderOrder = 10;
    sheet.userData.noCast = true;
    sheet.userData.noReceive = false;
    sheet.userData.noOutline = true;
    sheet.userData.waterSurface = true;
    sheet.userData.waterColumns = WATER_COLS;
    sheet.userData.waterColumnRatios = WATER_RATIOS;
    root.add(sheet);
    meshCount += 1;

    for (let i = 0; i < run.length; i += 10) {
      samples.push({ x: run[i].cx, y: run[i].wy, z: run[i].z });
    }

    const last = run[run.length - 1];
    if (last.z >= Z_END - 1e-6) {
      const cap = mesh(mouthGeometry(last), M.waterSurface, 'streamWater-mouth');
      cap.castShadow = false;
      cap.receiveShadow = true;
      cap.renderOrder = 10;
      cap.userData.noCast = true;
      cap.userData.noReceive = false;
      cap.userData.noOutline = true;
      root.add(cap);
      meshCount += 1;
    }
  });

  meshCount += buildFeatheredCascadeSheets(root, M);
  meshCount += buildStreamParticleSystems(root, M);
  meshCount += buildFloatingStreamLeaves(root, M);

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
      const edgeTuck = Math.sin(t * Math.PI);
      const baseLining = liningY(x, st.z, st.wy);
      const y = baseLining - (1 - edgeTuck) * 0.018;
      return [x, y, st.z];
    });
    addPlanarUv(geo, BED_UV_TILE);

    const lining = mesh(geo, M.riverbedSand || M.soilStreamBed, `streamBed-lining-${runIndex}`);
    lining.castShadow = false;
    lining.receiveShadow = true;
    lining.userData.noCast = true;
    lining.userData.noOutline = true;
    root.add(lining);
    meshCount += 1;
  });

  const all = runs.flat();
  const rand = rng(4127);
  const stratMat = M.stoneRockStratified || M.stoneRock;
  const mossyMat = M.stoneRockMossy || M.stoneRockWet;
  const chipMat = M.stoneChip || M.stonePebble;

  STREAM_CASCADES.forEach((cas, cIdx) => {
    const cx = streamCenterX(cas.z);
    const half = streamBankHalf(cas.z);
    const wy = waterY(cas.z);

    const weirSlots = [
      { dx: -half * 0.82, dz: -0.10, r: 0.35, flat: 0.58, mat: cIdx % 2 === 0 ? mossyMat : M.stoneRockWet },
      { dx: -half * 0.54, dz: 0.08, r: 0.27, flat: 0.52, mat: stratMat },
      { dx: -half * 0.24, dz: -0.05, r: 0.23, flat: 0.46, mat: M.stoneStream },
      { dx: half * 0.22, dz: 0.04, r: 0.22, flat: 0.46, mat: M.stoneStream },
      { dx: half * 0.52, dz: -0.06, r: 0.27, flat: 0.52, mat: M.stoneRock },
      { dx: half * 0.82, dz: 0.09, r: 0.36, flat: 0.58, mat: cIdx % 2 === 1 ? mossyMat : stratMat }
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
      lipSlab.userData.noOutline = true;
      root.add(lipSlab);
      meshCount += 1;
    });
  });

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
      const y = Math.min(ground + 0.012, st.wy - 0.024 - topAboveGround);
      const geo = triplanarUv(gravelBarGeometry(radius, 7100 + barIndex * 37), BED_UV_TILE);
      const bar = mesh(geo, M.stonePebble, `streamBed-bar-${barIndex}`);
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

  const pebblesPerRun = runs.map((run) => Math.max(1, Math.round((PEBBLE_COUNT * run.length) / all.length)));
  let pebbleIndex = 0;
  runs.forEach((run, runIndex) => {
    const count = pebblesPerRun[runIndex];
    for (let i = 0; i < count; i++) {
      const st = run[Math.floor(rand() * run.length)];
      const radius = 0.042 + rand() * 0.088;
      const flatten = 0.38 + rand() * 0.28;
      const x = st.cx + lerp(-st.bedLeft, st.bedRight, 0.06 + rand() * 0.88);
      const ground = liningY(x, st.z, st.wy);
      const y = ground + 0.24 * radius;
      const geo = triplanarUv(pebbleGeometry(radius, 9100 + pebbleIndex * 53, flatten), PEBBLE_TILE, [x, 0, st.z]);
      const pick = rand();
      const mat = pick < 0.30
        ? M.stoneStream
        : pick < 0.60
          ? M.stonePebble
          : pick < 0.82
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
      pebble.userData.noOutline = true;
      root.add(pebble);
      samples.push({ x, y, z: st.z });
      meshCount += 1;
      pebbleIndex += 1;
    }
  });

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
