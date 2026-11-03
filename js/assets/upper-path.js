/**
 * 上段参道（PATH_SYSTEM.upperPath）
 *
 * z < -4.40 之后不再做规整台阶，而是**石板铺装的坡道残段**：不规则方石顺着
 * 0.29 的坡面逐排向上，在 z ≈ -7 处被两侧树木围合遮蔽（"隐没于深林"）。
 *
 * 每块方石独立建模：轮廓是切过角的凸四边形（slabGeometry），绕 X 预旋
 * atan(grade) 使顶面与坡面平行 ⇒ 前后缘同时与地形齐平，不会出现悬空或整块被埋。
 * 接缝逐排错开（错缝砌法），偶发缺石露出泥土、偶发侧石卡缝，做出年久失修感。
 */
import { PATH, pathRampY } from '../layout.js';
import { group, mesh, place, rng, slabGeometry, triplanarUv } from '../primitives.js';

const UV_TILE = 1.15;
const ROW_DEPTH = [0.42, 0.68];
const JOINT_GAP = [0.02, 0.05];
const CHAMFER = [0.03, 0.1];
const TILT_JITTER = 0.012;
const JITTER_UP = 0.012;
const WET_ODDS = 0.18;
const MISSING_ODDS = 0.1;
const KERB_ODDS = 0.34;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const SLOPE_TILT = Math.atan(PATH.grade);

/** 切角凸四边形轮廓（局部坐标，中心在原点） */
function flagRing(halfX, halfZ, rand) {
  const c = [[-halfX, halfZ], [halfX, halfZ], [halfX, -halfZ], [-halfX, -halfZ]];
  const ring = [];
  for (let i = 0; i < 4; i++) {
    const p = c[i];
    const prev = c[(i + 3) % 4];
    const next = c[(i + 1) % 4];
    if (rand() > 0.66) {
      ring.push(p);
      continue;
    }
    const base = lerp(CHAMFER[0], CHAMFER[1], rand());
    const lp = Math.hypot(prev[0] - p[0], prev[1] - p[1]);
    const ln = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const dp = clamp(base * lerp(0.5, 1.2, rand()), 0.02, 0.38 * lp);
    const dn = clamp(base * lerp(0.5, 1.2, rand()), 0.02, 0.38 * ln);
    ring.push([p[0] + ((prev[0] - p[0]) * dp) / lp, p[1] + ((prev[1] - p[1]) * dp) / lp]);
    ring.push([p[0] + ((next[0] - p[0]) * dn) / ln, p[1] + ((next[1] - p[1]) * dn) / ln]);
  }
  return ring;
}

/** 一排方石沿 X 的切分（错缝：权重随机，接缝 2–5 cm） */
function rowSplits(rand, count) {
  const gaps = [];
  for (let i = 0; i < count - 1; i++) gaps.push(lerp(JOINT_GAP[0], JOINT_GAP[1], rand()));
  const usable = PATH.x1 - PATH.x0 - gaps.reduce((a, b) => a + b, 0);
  const weights = [];
  for (let i = 0; i < count; i++) weights.push(0.7 + rand() * 0.7);
  const sum = weights.reduce((a, b) => a + b, 0);
  const spans = [];
  let cursor = PATH.x0;
  for (let i = 0; i < count; i++) {
    const width = (usable * weights[i]) / sum;
    spans.push([cursor, cursor + width]);
    cursor += width + (i < count - 1 ? gaps[i] : 0);
  }
  return spans;
}

export function createUpperPath(M, options = {}) {
  const root = group('upperPath');
  root.userData.assetName = 'upperPath';
  const zStart = options.zStart ?? PATH.zTop;
  const zEnd = options.zEnd ?? PATH.zUpper;
  const samples = [];
  let flagCount = 0;
  let row = 0;
  let zFront = zStart;

  while (zFront > zEnd) {
    const rand = rng(row * 1301 + 71);
    const depth = Math.min(lerp(ROW_DEPTH[0], ROW_DEPTH[1], rand()), zFront - zEnd);
    if (depth < 0.2) break;
    const zBack = zFront - depth;
    const zCentre = (zFront + zBack) / 2;
    const count = rand() < 0.4 ? 3 : 2;
    const spans = rowSplits(rand, count);

    for (let j = 0; j < spans.length; j++) {
      // 偶发缺石：年久失修，接缝处塌出一块泥地
      if (rand() < MISSING_ODDS && count > 2) continue;
      const [xa, xb] = spans[j];
      const cx = (xa + xb) / 2;
      const halfX = (xb - xa) / 2;
      const thickness = 0.16 + rand() * 0.05;
      const geo = triplanarUv(
        slabGeometry(flagRing(halfX, depth / 2, rand), thickness),
        UV_TILE,
        [cx, pathRampY(zCentre), zCentre]
      );
      const flag = mesh(geo, rand() < WET_ODDS ? M.stoneStepWet : M.stoneSlab, `upperFlag-${row}-${j}`);
      place(flag, { x: cx, y: pathRampY(zCentre) + rand() * JITTER_UP, z: zCentre });
      flag.rotation.x = SLOPE_TILT + lerp(-TILT_JITTER, TILT_JITTER, rand());
      flag.castShadow = true;
      flag.receiveShadow = true;
      root.add(flag);
      samples.push({ x: cx, y: pathRampY(zCentre), z: zCentre });
      flagCount++;
    }

    // 侧石卡缝：坡面把方石顶起来一点，两侧常有独立的楔石
    if (rand() < KERB_ODDS) {
      const side = rand() < 0.5 ? PATH.x0 - 0.16 : PATH.x1 + 0.16;
      const halfX = 0.1 + rand() * 0.09;
      const thickness = 0.12 + rand() * 0.06;
      const geo = triplanarUv(slabGeometry(flagRing(halfX, depth * 0.42, rand), thickness), 0.6, [side, pathRampY(zCentre), zCentre]);
      const kerb = mesh(geo, M.stoneRock, `upperKerb-${row}`);
      place(kerb, { x: side, y: pathRampY(zCentre) + 0.015, z: zCentre, ry: lerp(-0.25, 0.25, rand()) });
      kerb.rotation.x = SLOPE_TILT;
      kerb.castShadow = true;
      kerb.receiveShadow = true;
      root.add(kerb);
    }

    zFront = zBack;
    row++;
  }

  root.userData.samples = samples;
  root.userData.flagCount = flagCount;
  root.userData.rowCount = row;
  root.userData.meshCount = root.children.length;
  root.updateMatrixWorld(true);
  return root;
}
