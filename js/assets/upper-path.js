/**
 * 上段弯曲参道（PATH_SYSTEM.upperPath）
 *
 * z < -4.40 之后承接鸟居后方曲率增大的山路（layout.pathCenterX），
 * 顺着右侧山坡大弧度向右后方蜿蜒爬升，在 z ≈ -9.2（x ≈ +5.5）处自然绕到右侧密林山坡背后隐没。
 */
import { PATH, clamp, lerp, pathBoundsAt, pathRampY, pathYaw, terrainHeight } from '../layout.js';
import { group, mesh, place, rng, slabGeometry, triplanarUv } from '../primitives.js';

const UV_TILE = 1.15;
const ROW_DEPTH = [0.42, 0.58];
const JOINT_GAP = [0.02, 0.05];
const CHAMFER = [0.03, 0.09];
const TILT_JITTER = 0.012;
const JITTER_UP = 0.014;
const WET_ODDS = 0.36;
const MISSING_ODDS = 0.08;
const KERB_ODDS = 0.48;

const SLOPE_TILT = Math.atan(PATH.grade);

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

function rowSplits(rand, count, zCentre, narrowFactor) {
  const gaps = [];
  for (let i = 0; i < count - 1; i++) gaps.push(lerp(JOINT_GAP[0], JOINT_GAP[1], rand()));
  const { cx } = pathBoundsAt(zCentre);
  const halfW = PATH.halfWidth * narrowFactor;
  const x0 = cx - halfW;
  const x1 = cx + halfW;
  const usable = x1 - x0 - gaps.reduce((a, b) => a + b, 0);
  const weights = [];
  for (let i = 0; i < count; i++) weights.push(0.7 + rand() * 0.7);
  const sum = weights.reduce((a, b) => a + b, 0);
  const spans = [];
  let cursor = x0;
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
    const progress = clamp((zStart - zCentre) / Math.max(0.1, zStart - zEnd), 0, 1);
    // 越往山后绕行，石板路略微收窄并自然隐入密林
    const narrowFactor = lerp(1.0, 0.78, progress);
    const yaw = pathYaw(zCentre) * 0.55;
    const count = rand() < 0.45 ? 3 : 2;
    const spans = rowSplits(rand, count, zCentre, narrowFactor);

    for (let j = 0; j < spans.length; j++) {
      if (rand() < MISSING_ODDS && count > 2) continue;
      const [xa, xb] = spans[j];
      const cx = (xa + xb) / 2;
      const halfX = (xb - xa) / 2;
      const thickness = 0.16 + rand() * 0.05;
      const topY = Math.max(pathRampY(zCentre), terrainHeight(cx, zCentre)) + 0.025 + rand() * JITTER_UP;
      const geo = triplanarUv(
        slabGeometry(flagRing(halfX, depth / 2, rand), thickness),
        UV_TILE,
        [cx, topY, zCentre]
      );
      const flag = mesh(geo, rand() < WET_ODDS ? M.stoneStepWet : M.stoneSlab, `upperFlag-${row}-${j}`);
      place(flag, { x: cx, y: topY, z: zCentre, ry: yaw });
      flag.rotation.x = SLOPE_TILT + lerp(-TILT_JITTER, TILT_JITTER, rand());
      flag.castShadow = true;
      flag.receiveShadow = true;
      root.add(flag);
      samples.push({ x: cx, y: topY, z: zCentre });
      flagCount++;
    }

    if (rand() < KERB_ODDS) {
      const { cx } = pathBoundsAt(zCentre);
      const halfW = PATH.halfWidth * narrowFactor;
      const side = rand() < 0.55 ? cx - halfW - 0.12 : cx + halfW + 0.12;
      const halfX = 0.1 + rand() * 0.08;
      const thickness = 0.12 + rand() * 0.06;
      const kerbY = Math.max(pathRampY(zCentre), terrainHeight(side, zCentre)) + 0.035;
      const geo = triplanarUv(slabGeometry(flagRing(halfX, depth * 0.42, rand), thickness), 0.6, [side, kerbY, zCentre]);
      const kerb = mesh(geo, M.mossStone, `upperKerb-${row}`);
      place(kerb, { x: side, y: kerbY, z: zCentre, ry: yaw + lerp(-0.18, 0.18, rand()) });
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
