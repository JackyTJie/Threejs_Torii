/**
 * 参道石阶（PATH_SYSTEM.stoneSteps）
 *
 * 32 级台阶，每级沿 X 切成 2–3 块**独立石板**（独立 Mesh、独立拓扑，不合并、不实例化）。
 * 几何用 primitives.slabGeometry：顶面 y = 0 的凸多边形棱柱，逐面复制顶点 ⇒
 * 面法线各自独立 ⇒ 90° 棱边不会被平滑掉（mock 的 ExtrudeGeometry 共享帽/侧顶点，
 * 会把石板边缘糊成圆角，所以这里不用它）。
 *
 * 与地形的衔接：地形参道带标高 = pathRampY(z)。在第 k 级
 *   前缘 z = frontZ(k)      坡面 = stepTopY(k) - rise   （正好是立面底）
 *   后缘 z = frontZ(k)-tread 坡面 = stepTopY(k)         （正好是踏面）
 * 所以石板只需向后埋进坡面：厚度取 rise + 埋入余量，且**只做向上抖动**——
 * 向下抖动会在上一级的立面处开出一条缝。
 *
 * 磕碰缺角 = 只在 2D 轮廓上切角（凸多边形切角仍是凸多边形，
 * slabGeometry 的质心扇形三角化因此不会翻面）；碎裂石片是独立的小石板。
 */
import { PATH, frontZ, stepTopY } from '../layout.js';
import { group, mesh, place, rng, slabGeometry, triplanarUv } from '../primitives.js';

const UV_TILE = 1.2;
const BURIAL = 0.06;
const JOINT_GAP = [0.022, 0.042];
const CHAMFER_MIN = 0.035;
const CHAMFER_MAX = 0.115;
const CHAMFER_EDGE_CAP = 0.4;
const CHAMFER_ODDS = 0.62;
const FRONT_CHAMFER_BIAS = 1.35;
const YAW_MAX = 0.003;
const JITTER_UP = 0.005;
const MIN_SLAB_WIDTH = 0.62;
const WET_ODDS = 0.22;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** 按级数选分区石材：磨损/青苔的起始高度写在材质里（绝对世界 Y） */
function zoneMaterial(M, k) {
  if (k <= 10) return M.stoneStepLower;
  if (k <= 22) return M.stoneStepMid;
  return M.stoneStepUpper;
}

/**
 * 把矩形轮廓的角切成斜角。切角量沿两条邻边分别取值，并被限制在边长的
 * CHAMFER_EDGE_CAP 以内 —— 既保证轮廓严格凸，也保证不会产生近乎共线的
 * 退化三角（asset-check 对退化三角直接 FAIL）。
 */
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

/** 一级沿 X 的切分：随机权重分配宽度，接缝留出 2–4 cm 的错缝 */
function slabSplits(rand, count) {
  const gaps = [];
  for (let i = 0; i < count - 1; i++) gaps.push(lerp(JOINT_GAP[0], JOINT_GAP[1], rand()));
  const totalGap = gaps.reduce((a, b) => a + b, 0);
  const usable = PATH.x1 - PATH.x0 - totalGap;
  const weights = [];
  for (let i = 0; i < count; i++) weights.push(0.72 + rand() * 0.62);
  const sum = weights.reduce((a, b) => a + b, 0);
  const spans = [];
  let cursor = PATH.x0;
  for (let i = 0; i < count; i++) {
    const width = Math.max(MIN_SLAB_WIDTH, (usable * weights[i]) / sum);
    spans.push([cursor, cursor + width]);
    cursor += width + (i < count - 1 ? gaps[i] : 0);
  }
  // 权重被下限抬高时可能溢出右边界：把最后一块收回来
  const last = spans[count - 1];
  if (last[1] > PATH.x1) {
    last[1] = PATH.x1;
    if (last[1] - last[0] < 0.2) spans.pop();
  }
  return spans;
}

/**
 * 复现第 k 级石板沿 X 的切分区间。
 * createStoneSteps 里每级的抽样顺序是 rng(k*977+13) → count → slabSplits，
 * 因此这里用同一种子、同样两次抽样即可得到与实体石板**完全一致**的区间。
 * 积水洼必须把水面裁进承载它的那一块石板内：跨在 2–4 cm 错缝上的水面会悬空（穿模）。
 */
export function stepSlabSpans(k) {
  const rand = rng(k * 977 + 13);
  const count = rand() < 0.34 ? 3 : 2;
  return slabSplits(rand, count);
}

/** 踏面上的碎裂石片：独立小石板，贴着踏面顶面摆放 */
function addChips(root, M, k, zFront, top, rand) {
  const roll = rand();
  const count = roll < 0.2 ? 0 : roll < 0.72 ? 1 : 2;
  for (let i = 0; i < count; i++) {
    const w = lerp(0.07, 0.19, rand());
    const d = lerp(0.05, 0.13, rand());
    const cx = lerp(PATH.x0 + 0.18, PATH.x1 - 0.18, rand());
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
    const count = rand() < 0.34 ? 3 : 2;
    const zoneMat = zoneMaterial(M, k);
    const spans = slabSplits(rand, count);

    for (let j = 0; j < spans.length; j++) {
      const [xa, xb] = spans[j];
      const cx = (xa + xb) / 2;
      const cz = (zFront + zBack) / 2;
      const thickness = PATH.rise + BURIAL + rand() * 0.028;
      const ring = chamferedRing(xa - cx, xb - cx, PATH.tread / 2, -PATH.tread / 2, rand);
      const geo = triplanarUv(slabGeometry(ring, thickness), UV_TILE, [cx, top, zFront]);
      const slab = mesh(geo, rand() < WET_ODDS ? M.stoneStepWet : zoneMat, `stoneStep-${k}-${j}`);
      // 只做向上抖动：向下会在上一级立面处开缝
      place(slab, {
        x: cx,
        y: top + rand() * JITTER_UP,
        z: cz,
        ry: lerp(-YAW_MAX, YAW_MAX, rand())
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
