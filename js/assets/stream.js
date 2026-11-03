// 山涧蜿蜒叠瀑溪流：水面（streamWater）与溪床（streamBed）—— 两个独立资产根。
//
// 结合第三张溪流参考图与雨后深林静谧氛围进行全方位升级：
// 1) 蜿蜒曲折 + 6 级叠瀑小滝（STREAM_CASCADES）：
//    不再是笔直单调的镜面斜坡，而是沿左谷 S 型蜿蜒曲折，每隔一段平缓清澈深潭即跌落一级小瀑布；
// 2) 清澈见底的丰富的水下河床（streamBed）：
//    深褐湿泥沙底衬砌 + 6 级天然叠水石堰卵石坝（weirStone）+ 冲刷砾石滩 + 溪底鹅卵石 + 沉水红褐落叶；
// 3) 多层次动态水体（streamWater）：
//    主清澈水面（11 列高密度横断面）+ 6 级小瀑布丝状跌水水帘（cascadeCurtain）+ 瀑下深潭旋转漩涡泡沫环（eddyRing）+ 溪石激流尾迹（wakeFoam）。
import * as THREE from 'three';
import { group, leafSheetGeometry, mesh, place, rng, rockGeometry, triplanarUv } from '../primitives.js';
import {
  CONTENT_HALF,
  STREAM_CASCADES,
  STREAM_STONES,
  lerp,
  streamBankHalf,
  streamCenterX,
  terrainHeight,
  waterY
} from '../layout.js';

/* ------------------------------------------------------------------ 采样 */

const Z_START = -CONTENT_HALF;
const Z_END = CONTENT_HALF;
const SAMPLE_PITCH = 0.16;
const SEARCH_STEP = 0.045;
const SEARCH_OUTER = 2.4;
const BISECT_ITER = 24;
const MIN_WATER_WIDTH = 0.12;
const RUN_GAP = 0.6;

/* ------------------------------------------------------------------ 水面 */

const WATER_COLS = 11;
const WATER_RATIOS = [];
for (let c = 0; c < WATER_COLS; c++) WATER_RATIOS.push(1 - (2 * c) / (WATER_COLS - 1));
const WATER_UV_TILE = 2.2;

/* ------------------------------------------------------------------ 溪床 */

const DEPTH_MIN = 0.012;
const LIFT_FULL = 0.016;
const MIN_LIFT = 0.005;
const MIN_BED_WIDTH = 0.15;
const BED_UV_TILE = 4;

const PEBBLE_COUNT = 120;
const PEBBLE_TILE = 0.16;
const BAR_COUNT = 10;
const SUNKEN_LEAF_COUNT = 48;

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

/* ------------------------------------------------------------------ 小瀑布水帘与漩涡回流几何 */

/**
 * 自然不规则泡沫盘几何体（避免规则圆环靶心感，还原真实瀑下漩涡与散碎水沫）
 */
function eddyFoamGeometry(radius, seed) {
  const segs = 22;
  const rings = 3;
  const pos = [0, 0, 0];
  const uv = [0.5, 0.5];
  const idx = [];
  for (let k = 1; k <= rings; k++) {
    const u = k / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const wobble = 1 + 0.16 * Math.sin(a * 3 + seed) + 0.1 * Math.cos(a * 5 - seed * 0.7);
      const rad = radius * u * wobble;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad * 0.84;
      pos.push(x, (1 - u) * 0.004, z);
      uv.push(0.5 + 0.5 * u * Math.cos(a), 0.5 + 0.5 * u * Math.sin(a));
    }
  }
  for (let s = 0; s < segs; s++) {
    const next = (s + 1) % segs;
    idx.push(0, 1 + next, 1 + s);
  }
  for (let k = 1; k < rings; k++) {
    const base0 = 1 + (k - 1) * segs;
    const base1 = 1 + k * segs;
    for (let s = 0; s < segs; s++) {
      const next = (s + 1) % segs;
      const a = base0 + s;
      const b = base0 + next;
      const d = base1 + s;
      const e = base1 + next;
      idx.push(a, b, e, a, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 构建一级小瀑布的自然宽幅多股跌水水帘与瀑下漩涡回流（仿照参考图3的叠石跌水层次）
 */
function buildCascadeCurtains(root, M, rand) {
  let count = 0;
  const foamMat = M.waterfallFoam || M.waterSurface;
  const eddyMat = M.waterEddy || M.waterSurface;

  STREAM_CASCADES.forEach((cas, cIdx) => {
    const zTop = cas.z - cas.halfSpan * 0.75;
    const zBot = cas.z + cas.halfSpan * 0.82;
    const yTop = waterY(zTop) + 0.004;
    const yBot = waterY(zBot) + 0.006;
    const cxTop = streamCenterX(zTop);
    const cxBot = streamCenterX(zBot);
    const halfW = streamBankHalf(cas.z) * 0.74;

    // 整幅连续但纵向起伏分股的自然瀑布水帘（带归一化 UV 供着色器边缘羽化）
    const cols = 16;
    const rows = 10;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let r = 0; r <= rows; r++) {
      const u = r / rows;
      const z = lerp(zTop, zBot, u);
      const dropCurve = Math.pow(u, 1.48);
      const arch = Math.sin(u * Math.PI) * 0.032;
      const yBase = lerp(yTop, yBot, dropCurve) + arch;
      const cx = lerp(cxTop, cxBot, u);
      const w = halfW * 2 * (0.92 + 0.14 * Math.sin(u * Math.PI));

      for (let c = 0; c <= cols; c++) {
        const vn = c / cols;
        const v = vn - 0.5;
        const edgeTaper = Math.sin(vn * Math.PI);
        // 多股水舌起伏肋条
        const ribs = (0.5 + 0.5 * Math.sin(vn * Math.PI * 5 + cIdx * 1.3)) * 0.022 * edgeTaper;
        const x = cx + v * w;
        const dz = Math.sin(vn * Math.PI * 3 + u * 2.2) * 0.035 * edgeTaper;
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

    // 瀑下深潭的不规则旋转漩涡水沫团
    const eddySpots = [
      { dx: -halfW * 0.22, dz: cas.halfSpan * 0.85, r: 0.34, speed: 0.75 },
      { dx: halfW * 0.26, dz: cas.halfSpan * 1.12, r: 0.28, speed: -0.85 }
    ];
    eddySpots.forEach((eSpec, eIdx) => {
      const ez = cas.z + eSpec.dz;
      const ex = streamCenterX(ez) + eSpec.dx;
      const ey = waterY(ez) + 0.005;
      const eGeo = eddyFoamGeometry(eSpec.r, 5100 + cIdx * 19 + eIdx * 7);
      const eddy = mesh(eGeo, eddyMat, `streamWater-eddy-${cIdx}-${eIdx}`);
      eddy.position.set(ex, ey, ez);
      eddy.castShadow = false;
      eddy.receiveShadow = false;
      eddy.userData.noCast = true;
      eddy.userData.noReceive = true;
      eddy.userData.noOutline = true;
      eddy.userData.eddySpin = { speed: eSpec.speed, phase: rand() * Math.PI * 2 };
      root.add(eddy);
      count += 1;
    });
  });

  // 溪内石块（STREAM_STONES）周围的不规则分水漩涡水沫
  STREAM_STONES.forEach((st, idx) => {
    const wy = waterY(st.z) + 0.005;
    const wGeo = eddyFoamGeometry(st.r * 1.32, 6200 + idx * 23);
    const wake = mesh(wGeo, eddyMat, `streamWater-stoneWake-${idx}`);
    wake.position.set(st.x, wy, st.z + 0.06);
    wake.castShadow = false;
    wake.receiveShadow = false;
    wake.userData.noCast = true;
    wake.userData.noReceive = true;
    wake.userData.noOutline = true;
    wake.userData.eddySpin = { speed: (idx % 2 === 0 ? 0.55 : -0.55), phase: idx * 1.3 };
    root.add(wake);
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
 * 山涧水面（含清澈主水面、6 级小瀑布水帘、深潭漩涡回流与溪石激流尾迹）。
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
  meshCount += buildCascadeCurtains(root, M, rand);

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
 * 山涧溪床：深色湿泥砂底 + 6 级小瀑布天然叠石堰（仿照参考图3）+ 冲刷砾石条 + 溪底鹅卵石 + 水下沉叶。
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

  // 1. 6 级小瀑布天然跌水石堰（Weir Boulders）：横亘在每级小瀑布两侧与堰口，形成多层次叠石跌水
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
      // 两侧护堰大石微露水面，中间堰石半浸水中让瀑流漫过
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

  // 3. 溪底深浅鹅卵石与河床碎石（透过清澈溪水清晰可见）
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

  // 4. 溪底泥沙上的沉水红褐落叶（增加「清澈见底」的视觉参照物）
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
