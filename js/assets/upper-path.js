/**
 * 上段弯曲参道（PATH_SYSTEM.upperPath）
 *
 * z < -4.40 之后承接鸟居后方曲率增大的山路（layout.pathCenterX），
 * 顺着右侧山坡大弧度向右后方蜿蜒爬升，在 z ≈ -9.2（x ≈ +5.5）处自然绕到右侧密林山坡背后隐没。
 */
import { PATH, clamp, lerp, pathBoundsAt, pathRampY, pathYaw, terrainHeight } from '../layout.js';
import { group, mesh, place, rng, rockGeometry, triplanarUv } from '../primitives.js';

const UV_TILE = 1.15;
const ROW_DEPTH = [0.42, 0.58];
const JOINT_GAP = [0.03, 0.065];
const TILT_JITTER = 0.016;
const JITTER_UP = 0.014;
const WET_ODDS = 0.36;
const MISSING_ODDS = 0.08;
const KERB_ODDS = 0.48;

const SLOPE_TILT = Math.atan(PATH.grade);

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
    const count = rand() < 0.55 ? 3 : 2;
    const spans = rowSplits(rand, count, zCentre, narrowFactor);

    for (let j = 0; j < spans.length; j++) {
      if (rand() < MISSING_ODDS && count > 2) continue;
      const [xa, xb] = spans[j];
      const cx = (xa + xb) / 2;
      const halfX = (xb - xa) / 2;
      const topY = Math.max(pathRampY(zCentre), terrainHeight(cx, zCentre)) + 0.02 + rand() * JITTER_UP;
      // 采用圆润风化的千年不规则山石板代替机械棱角方板
      const baseR = Math.max(0.18, Math.min(halfX, depth * 0.5));
      const geo = triplanarUv(
        rockGeometry(baseR, 7100 + row * 41 + j * 13, {
          widthSegments: 14,
          heightSegments: 9,
          wobble: 0.22,
          flatten: 0.32
        }),
        UV_TILE,
        [cx, topY, zCentre]
      );
      const flag = mesh(geo, rand() < WET_ODDS ? M.stoneStepWet : M.stoneSlab, `upperFlag-${row}-${j}`);
      place(flag, {
        x: cx,
        y: topY - baseR * 0.24,
        z: zCentre,
        ry: yaw + lerp(-0.08, 0.08, rand()),
        sx: halfX / baseR,
        sy: 0.42,
        sz: (depth * 0.48) / baseR
      });
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
      const side = rand() < 0.55 ? cx - halfW - 0.14 : cx + halfW + 0.14;
      const rKerb = 0.14 + rand() * 0.06;
      const kerbY = Math.max(pathRampY(zCentre), terrainHeight(side, zCentre)) + 0.01;
      const geo = triplanarUv(
        rockGeometry(rKerb, 7600 + row * 53, {
          widthSegments: 12,
          heightSegments: 8,
          wobble: 0.26,
          flatten: 0.52
        }),
        0.6,
        [side, kerbY, zCentre]
      );
      const kerb = mesh(geo, M.stoneRockMossy || M.stoneStepUpper, `upperKerb-${row}`);
      place(kerb, {
        x: side,
        y: kerbY,
        z: zCentre,
        ry: yaw + lerp(-0.24, 0.24, rand()),
        sx: 0.85 + rand() * 0.25,
        sy: 0.65,
        sz: 1.15 + rand() * 0.30
      });
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
