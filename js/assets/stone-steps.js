/**
 * 弯曲参道石阶（PATH_SYSTEM.stoneSteps）
 *
 * 32 级台阶，顺着 layout.pathCenterX(z) 的山坡小弧线蜿蜒拾级而上：
 * - 底端从画面右下方坡脚起阶，中段沿山坡微向左抱弯，再自然回摆抵达双鸟居，过鸟居后曲率增大衔接上段山路；
 * - 每级沿 X 切成 2–3 块独立石板（独立 Mesh、独立拓扑，不合并、不实例化）；
 * - 磕碰缺角、表面磨损、青苔与积水洼随弯曲台阶同步偏移。
 */
import { PATH, frontZ, pathBoundsAt, pathShiftX, pathYaw, stepTopY } from '../layout.js';
import { group, mesh, place, rng, slabGeometry, triplanarUv } from '../primitives.js';

const UV_TILE = 1.2;
const BURIAL = 0.06;
const JOINT_GAP = [0.022, 0.042];
const CHAMFER_MIN = 0.035;
const CHAMFER_MAX = 0.115;
const CHAMFER_EDGE_CAP = 0.4;
const CHAMFER_ODDS = 0.62;
const FRONT_CHAMFER_BIAS = 1.35;
const YAW_MAX = 0.004;
const JITTER_UP = 0.005;
const MIN_SLAB_WIDTH = 0.62;
const WET_ODDS = 0.22;

const lerp = (a, b, t) => a + (b - a) * t;

function zoneMaterial(M, k) {
  if (k <= 10) return M.stoneStepLower;
  if (k <= 22) return M.stoneStepMid;
  return M.stoneStepUpper;
}

function chamferedRing(xa, xb, zFront, zBack, rand, { allowChamfer = true } = {}) {
  const corners = [[xa, zFront], [xb, zFront], [xb, zBack], [xa, zBack]];
  const ring = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const c = corners[i];
    const prev = corners[(i + n - 1) % n];
    const next = corners[(i + 1) % n];
    const isFront = c[1] === zFront;
    if (!allowChamfer || rand() > CHAMFER_ODDS) {
      ring.push(c);
      continue;
    }
    const base = lerp(CHAMFER_MIN, CHAMFER_MAX, rand()) * (isFront ? FRONT_CHAMFER_BIAS : 1);
    const dPrev = Math.min(base * lerp(0.55, 1.15, rand()), CHAMFER_EDGE_CAP * Math.hypot(c[0] - prev[0], c[1] - prev[1]));
    const dNext = Math.min(base * lerp(0.55, 1.15, rand()), CHAMFER_EDGE_CAP * Math.hypot(next[0] - c[0], next[1] - c[1]));
    if (dPrev < 0.02 || dNext < 0.02) {
      ring.push(c);
      continue;
    }
    ring.push([c[0] + (prev[0] - c[0]) * (dPrev / Math.hypot(prev[0] - c[0], prev[1] - c[1])),
      c[1] + (prev[1] - c[1]) * (dPrev / Math.hypot(prev[0] - c[0], prev[1] - c[1]))]);
    ring.push([c[0] + (next[0] - c[0]) * (dNext / Math.hypot(next[0] - c[0], next[1] - c[1])),
      c[1] + (next[1] - c[1]) * (dNext / Math.hypot(next[0] - c[0], next[1] - c[1]))]);
  }
  return ring;
}

/** 一级沿 X 的切分（随弯曲参道中心线偏移 shiftX） */
function slabSplits(rand, count, shiftX = 0) {
  const x0 = PATH.x0 + shiftX;
  const x1 = PATH.x1 + shiftX;
  const gaps = [];
  for (let i = 0; i < count - 1; i++) gaps.push(lerp(JOINT_GAP[0], JOINT_GAP[1], rand()));
  const totalGap = gaps.reduce((a, b) => a + b, 0);
  const usable = x1 - x0 - totalGap;
  const weights = [];
  for (let i = 0; i < count; i++) weights.push(0.72 + rand() * 0.62);
  const sum = weights.reduce((a, b) => a + b, 0);
  const spans = [];
  let cursor = x0;
  for (let i = 0; i < count; i++) {
    const width = Math.max(MIN_SLAB_WIDTH, (usable * weights[i]) / sum);
    spans.push([cursor, cursor + width]);
    cursor += width + (i < count - 1 ? gaps[i] : 0);
  }
  const last = spans[count - 1];
  if (last[1] > x1) {
    last[1] = x1;
    if (last[1] - last[0] < 0.2) spans.pop();
  }
  return spans;
}

/** 复现第 k 级弯曲石板沿 X 的切分区间（供 puddle.js 精确裁切水面） */
export function stepSlabSpans(k) {
  const rand = rng(k * 977 + 13);
  const count = rand() < 0.34 ? 3 : 2;
  const cz = frontZ(k) - PATH.tread * 0.5;
  return slabSplits(rand, count, pathShiftX(cz));
}

function addChips(root, M, k, zFront, top, rand) {
  const roll = rand();
  const count = roll < 0.2 ? 0 : roll < 0.72 ? 1 : 2;
  const czStep = zFront - PATH.tread * 0.5;
  const { x0, x1 } = pathBoundsAt(czStep);
  for (let i = 0; i < count; i++) {
    const w = lerp(0.07, 0.19, rand());
    const d = lerp(0.05, 0.13, rand());
    const cx = lerp(x0 + 0.18, x1 - 0.18, rand());
    const cz = zFront - lerp(0.06, 0.44, rand());
    const thickness = lerp(0.022, 0.05, rand());
    const geo = triplanarUv(
      slabGeometry(chamferedRing(-w / 2, w / 2, d / 2, -d / 2, rand, { allowChamfer: false }), thickness),
      0.35,
      [cx, top, cz]
    );
    const chip = mesh(geo, M.stonePebble, `stepChip-${k}-${i}`);
    place(chip, {
      x: cx,
      y: top + lerp(0.004, 0.016, rand()),
      z: cz - d / 2,
      ry: lerp(-0.35, 0.35, rand())
    });
    chip.castShadow = true;
    chip.receiveShadow = true;
    chip.userData.noOutline = true;
    root.add(chip);
  }
}

export function createStoneSteps(M, options = {}) {
  const root = group('stoneSteps');
  root.userData.assetName = 'stoneSteps';
  const steps = options.steps ?? PATH.steps;
  const samples = [];
  let slabCount = 0;

  for (let k = 0; k < steps; k++) {
    const rand = rng(k * 977 + 13);
    const zFront = frontZ(k);
    const top = stepTopY(k);
    const zBack = zFront - PATH.tread;
    const cz = (zFront + zBack) / 2;
    const count = rand() < 0.34 ? 3 : 2;
    const zoneMat = zoneMaterial(M, k);
    const spans = slabSplits(rand, count, pathShiftX(cz));
    const curveYaw = pathYaw(cz) * 0.28;

    for (let j = 0; j < spans.length; j++) {
      const [xa, xb] = spans[j];
      const cx = (xa + xb) / 2;
      const thickness = PATH.rise + BURIAL + rand() * 0.028;
      const ring = chamferedRing(xa - cx, xb - cx, PATH.tread / 2, -PATH.tread / 2, rand);
      const geo = triplanarUv(slabGeometry(ring, thickness), UV_TILE, [cx, top, zFront]);
      const slab = mesh(geo, rand() < WET_ODDS ? M.stoneStepWet : zoneMat, `stoneStep-${k}-${j}`);
      place(slab, {
        x: cx,
        y: top + rand() * JITTER_UP,
        z: cz,
        ry: curveYaw + lerp(-YAW_MAX, YAW_MAX, rand())
      });
      slab.castShadow = true;
      slab.receiveShadow = true;
      root.add(slab);
      samples.push({ x: cx, y: top, z: cz });
      slabCount++;
    }

    addChips(root, M, k, zFront, top, rand);
  }

  root.userData.samples = samples;
  root.userData.slabCount = slabCount;
  root.userData.meshCount = root.children.length;
  root.updateMatrixWorld(true);
  return root;
}
