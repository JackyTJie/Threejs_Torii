/**
 * 千年沧桑弯曲参道石阶（PATH_SYSTEM.stoneSteps）
 *
 * 32 级古石阶，顺着 layout.pathCenterX(z) 的山坡小弧线蜿蜒拾级而上：
 * - 彻底告别棱角分明的机械直棱盒体：每块石板均采用高密度三维细分网格（ancientStepBlockGeometry），
 *   前缘（踏面鼻口）与侧棱经受千年风雨与脚步摩挲呈大弧度圆润磨损倒角，边缘不规则风化残缺；
 * - 踏面中央带常年香客踩踏形成的微凹弧形洼槽（dish wear），石面呈天然板岩层理起伏与细微沉降倾侧；
 * - 石缝与向溪/背阴角嵌入立体青苔垫、风化剥落碎石块与湿润落叶。
 */
import * as THREE from 'three';
import { PATH, frontZ, pathBoundsAt, pathShiftX, pathYaw, stepTopY } from '../layout.js';
import { fbm3, group, leafSheetGeometry, mesh, place, rng, rockGeometry, triplanarUv } from '../primitives.js';

const UV_TILE = 1.2;
const BURIAL = 0.072;
const JOINT_GAP = [0.042, 0.082];
const YAW_MAX = 0.048;
const JITTER_UP = 0.016;
const MIN_SLAB_WIDTH = 0.42;
const WET_ODDS = 0.28;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function zoneMaterial(M, k) {
  if (k <= 10) return M.stoneStepLower;
  if (k <= 22) return M.stoneStepMid;
  return M.stoneStepUpper;
}

/** 一级沿 X 的切分（随弯曲参道中心线偏移 shiftX，每级 3~4 块大小错落的古石块） */
function slabSplits(rand, count, shiftX = 0) {
  const x0 = PATH.x0 + shiftX;
  const x1 = PATH.x1 + shiftX;
  const gaps = [];
  for (let i = 0; i < count - 1; i++) gaps.push(lerp(JOINT_GAP[0], JOINT_GAP[1], rand()));
  const totalGap = gaps.reduce((a, b) => a + b, 0);
  const usable = x1 - x0 - totalGap;
  const weights = [];
  for (let i = 0; i < count; i++) weights.push(0.55 + rand() * 0.92);
  const sum = weights.reduce((a, b) => a + b, 0);
  const spans = [];
  let cursor = x0;
  for (let i = 0; i < count; i++) {
    const width = Math.max(MIN_SLAB_WIDTH, (usable * weights[i]) / sum);
    spans.push([cursor, cursor + width]);
    cursor += width + (i < count - 1 ? gaps[i] : 0);
  }
  const last = spans[spans.length - 1];
  if (last && last[1] > x1) {
    last[1] = x1;
    if (last[1] - last[0] < 0.25 && spans.length > 1) {
      spans.pop();
      spans[spans.length - 1][1] = x1;
    }
  }
  return spans;
}

/** 复现第 k 级弯曲石板沿 X 的切分区间（供 puddle.js 精确裁切水面） */
export function stepSlabSpans(k) {
  const rand = rng(k * 977 + 13);
  const count = rand() < 0.64 ? 3 : 4;
  const cz = frontZ(k) - PATH.tread * 0.5;
  return slabSplits(rand, count, pathShiftX(cz));
}

/**
 * 千年风化沧桑古石阶单块连续闭合三维雕塑网格（Superellipsoid Pillow Stone）：
 * - 基于完全焊接（无缝）的 `SphereGeometry(1, 18, 12)` 超椭球变形（|u|^0.58 软方枕映射），
 *   彻底杜绝 BoxGeometry 六面不共顶点导致的 90° 硬直折痕与机械平整感；
 * - 顶面踏鼻（面向下山 +Z 方向）呈浑圆饱满的风化鹅卵石弧度，法线在顶面、前鼻与侧面之间 100% 连续平滑过渡；
 * - 叠加三维岩石层理 FBM 凹凸、两侧不规则风化豁口与千年足迹踩踏微凹鞍面（Dish Wear）。
 */
function ancientStepBlockGeometry(width, thickness, depth, seed, rand) {
  const geo = new THREE.SphereGeometry(1, 18, 12);
  const pos = geo.getAttribute('position');
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const ht = thickness * 0.5;

  // 每块古石特有的不规则斜向劈裂锥度与两处风化缺角
  const skewX = (rand() - 0.5) * 0.08;
  const taperFront = (rand() - 0.5) * 0.10;
  const chipX = (rand() < 0.5 ? -1 : 1) * hw * (0.48 + rand() * 0.42);
  const chipZ = hd * (0.42 + rand() * 0.48);
  const chipR = 0.09 + rand() * 0.09;

  const sgnPow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i);
    const uy = pos.getY(i);
    const uz = pos.getZ(i);

    // 1. 超椭球软枕形映射（p ≈ 0.56~0.64：既有厚重石块体量，又具浑圆饱满的千年磨损圆弧边角）
    const sx = sgnPow(ux, 0.58);
    const sy = sgnPow(uy, 0.54);
    const sz = sgnPow(uz, 0.60);

    let x = sx * hw * (1 + uz * taperFront) + uz * skewX * hw;
    let y = (sy - 1.0) * ht; // 顶面位于 y ≈ 0，底面位于 y ≈ -thickness
    let z = sz * hd;

    // 2. 三维天然岩石层理噪声（使每块石头的边缘与表面呈手工凿制+千年风化的不规则起伏）
    const nMacro = fbm3(x * 3.6 + seed * 1.37, y * 4.5, z * 3.6 - seed * 0.83, 3);
    const nFine = fbm3(x * 8.8 - seed * 0.61, y * 9.2, z * 8.8 + seed * 1.73, 3);

    x += (nMacro - 0.5) * 0.052 + (nFine - 0.5) * 0.018;
    z += (nMacro - 0.5) * 0.046 + (nFine - 0.5) * 0.016;

    // 3. 前缘踏鼻圆弧下倾与局部沧桑缺角
    const dChip = Math.hypot(x - chipX, z - chipZ);
    if (dChip < chipR) {
      const k = 1 - dChip / chipR;
      const dent = k * k * 0.038;
      x -= Math.sign(x || 1) * dent * 0.8;
      z -= Math.sign(z || 1) * dent;
      if (uy > 0) y -= k * k * 0.026;
    }

    // 4. 踏面中央常年香客踩踏形成的微凹弧形洼槽（Tread Dish Wear）与层理起伏
    if (uy > 0.15) {
      const topMask = smoothstep(0.15, 0.85, uy);
      const centerDish = Math.max(0, 1 - (ux * ux * 0.85 + uz * uz * 0.75)) * 0.014;
      const frontWear = smoothstep(0.25, 0.95, uz) * 0.018;
      const rockWave = ((nMacro - 0.5) * 0.022 + (nFine - 0.5) * 0.008) * topMask;
      y += rockWave - (centerDish + frontWear) * topMask;
    }

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * 立体小松果几何体（由多层螺旋交错的鳞片构成的卵圆锥形松塔，用于百年参道散落物）
 */
function pineconeGeometry(radius = 0.026, height = 0.048, seed = 101) {
  const geo = new THREE.SphereGeometry(radius, 10, 9);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const v = (y / radius + 1) * 0.5;
    const theta = Math.atan2(z, x);
    const coneProfile = 0.55 + 0.65 * Math.sin(v * Math.PI * 0.85);
    const scaleTier = Math.abs(Math.sin(v * Math.PI * 7.0 + theta * 2.0));
    const scaleOut = coneProfile * (0.82 + 0.34 * scaleTier);
    const n = fbm3(x * 40 + seed, y * 40, z * 40, 2);
    pos.setXYZ(
      i,
      x * scaleOut * (0.92 + 0.16 * n),
      (v - 0.35) * height,
      z * scaleOut * (0.92 + 0.16 * n)
    );
  }
  geo.computeVertexNormals();
  return geo;
}

function addWeatheredSpallsAndMoss(root, M, k, zFront, top, rand, pineconeGeo) {
  const czStep = zFront - PATH.tread * 0.5;
  const { x0, x1 } = pathBoundsAt(czStep);
  const pathCx = (x0 + x1) * 0.5;

  // 1) 圆润风化的石阶边角碎石子（散落在台阶两侧与石缝处，避开正中光滑踩踏带）
  const chipCount = rand() < 0.35 ? 2 : 3;
  for (let i = 0; i < chipCount; i++) {
    const r = lerp(0.032, 0.078, rand());
    const sideSign = rand() < 0.62 ? -1 : 1;
    const cx = clamp(pathCx + sideSign * lerp(0.38, 1.08, rand()), x0 + 0.10, x1 - 0.10);
    const cz = zFront - lerp(0.06, 0.44, rand());
    const geo = triplanarUv(
      rockGeometry(r, 6400 + k * 31 + i * 7, {
        widthSegments: 10,
        heightSegments: 7,
        wobble: 0.28,
        flatten: 0.38
      }),
      0.35,
      [cx, top, cz]
    );
    const chip = mesh(geo, i % 2 === 0 ? M.stonePebble : M.stoneRockWet, `stepChip-${k}-${i}`);
    place(chip, {
      x: cx,
      y: top - 0.005 + rand() * 0.008,
      z: cz,
      ry: rand() * Math.PI * 2,
      sx: 1.12 + rand() * 0.32,
      sy: 0.58,
      sz: 0.92 + rand() * 0.32
    });
    chip.castShadow = true;
    chip.receiveShadow = true;
    chip.userData.noOutline = true;
    root.add(chip);
  }

  // 2) 自然散落的小松果（随机分布在石阶背阴角、侧边与落叶丛旁）
  if (pineconeGeo && rand() < 0.68) {
    const coneCount = rand() < 0.38 ? 2 : 1;
    for (let p = 0; p < coneCount; p++) {
      const sideBias = rand() < 0.58 ? -1 : 1;
      const px = clamp(pathCx + sideBias * lerp(0.32, 1.05, rand()), x0 + 0.14, x1 - 0.14);
      const pz = zFront - lerp(0.10, PATH.tread - 0.08, rand());
      const coneMat = (k + p) % 2 === 0 ? (M.barkKaede || M.woodWeathered) : M.woodWeathered;
      const cone = mesh(pineconeGeo, coneMat, `stepPinecone-${k}-${p}`);
      place(cone, {
        x: px,
        y: top + 0.014,
        z: pz,
        ry: rand() * Math.PI * 2,
        sx: 0.85 + rand() * 0.35,
        sy: 0.85 + rand() * 0.35,
        sz: 0.85 + rand() * 0.35
      });
      cone.rotation.x = Math.PI * 0.38 + (rand() - 0.5) * 0.25;
      cone.rotation.z = (rand() - 0.5) * 0.35;
      cone.castShadow = true;
      cone.receiveShadow = true;
      cone.userData.noOutline = true;
      root.add(cone);
    }
  }

  // 3) 石阶靠溪侧（左侧 x0 边缘）与靠右路边（右侧 x1 边缘）的连片状青苔毯（避开台阶正中间踩踏区，告别孤立小圆点）
  const leftSheetX = lerp(x0 + 0.14, x0 + 0.56, rand());
  const leftSheetZ = zFront - PATH.tread * lerp(0.28, 0.82, rand());
  const leftSheetR = lerp(0.14, 0.22, rand());
  const leftMossGeo = triplanarUv(
    rockGeometry(leftSheetR, 7300 + k * 41, {
      widthSegments: 12,
      heightSegments: 7,
      wobble: 0.36,
      flatten: 0.10
    }),
    0.26,
    [leftSheetX, top, leftSheetZ]
  );
  const leftMossSheet = mesh(leftMossGeo, k % 2 === 0 ? M.mossWet : M.mossPatch, `stepMoss-${k}-0`);
  leftMossSheet.position.set(leftSheetX, top - 0.006, leftSheetZ);
  leftMossSheet.rotation.y = rand() * 0.45 - 0.22;
  leftMossSheet.scale.set(1.85 + rand() * 0.45, 0.09, 1.35 + rand() * 0.35);
  leftMossSheet.castShadow = false;
  leftMossSheet.receiveShadow = true;
  leftMossSheet.userData.noCast = true;
  leftMossSheet.userData.noOutline = true;
  root.add(leftMossSheet);

  if (rand() < 0.72) {
    const rightSheetX = lerp(x1 - 0.52, x1 - 0.14, rand());
    const rightSheetZ = zFront - PATH.tread * lerp(0.32, 0.84, rand());
    const rightSheetR = lerp(0.12, 0.18, rand());
    const rightMossGeo = triplanarUv(
      rockGeometry(rightSheetR, 7300 + k * 41 + 13, {
        widthSegments: 12,
        heightSegments: 7,
        wobble: 0.34,
        flatten: 0.10
      }),
      0.26,
      [rightSheetX, top, rightSheetZ]
    );
    const rightMossSheet = mesh(rightMossGeo, M.mossPatch, `stepMoss-${k}-1`);
    rightMossSheet.position.set(rightSheetX, top - 0.006, rightSheetZ);
    rightMossSheet.rotation.y = rand() * 0.45 - 0.22;
    rightMossSheet.scale.set(1.65 + rand() * 0.35, 0.09, 1.25 + rand() * 0.30);
    rightMossSheet.castShadow = false;
    rightMossSheet.receiveShadow = true;
    rightMossSheet.userData.noCast = true;
    rightMossSheet.userData.noOutline = true;
    root.add(rightMossSheet);
  }
}

/** 石阶踏面与石缝处点缀零散湿润落叶，靠近溪流一侧与阶根背阴角略多 */
function addStepLeaves(root, M, k, zFront, top, leafGeos, leafMats) {
  const lRand = rng(k * 1319 + 79);
  const count = lRand() < 0.32 ? 1 : lRand() < 0.82 ? 2 : 3;
  const czStep = zFront - PATH.tread * 0.5;
  const { x0, x1 } = pathBoundsAt(czStep);
  for (let i = 0; i < count; i++) {
    const u = Math.pow(lRand(), 1.35);
    const lx = lerp(x0 + 0.14, x1 - 0.14, u);
    const lz = zFront - lerp(0.08, PATH.tread - 0.07, lRand());
    const geo = leafGeos[(k + i) % leafGeos.length];
    const mat = leafMats[(k * 3 + i) % leafMats.length];
    const leaf = mesh(geo, mat, `stepLeaf-${k}-${i}`);
    leaf.position.set(lx, top + 0.005 + lRand() * 0.005, lz);
    leaf.rotation.set(
      -Math.PI / 2 + (lRand() - 0.5) * 0.16,
      lRand() * Math.PI * 2,
      (lRand() - 0.5) * 0.16
    );
    const s = 0.72 + lRand() * 0.46;
    leaf.scale.setScalar(s);
    leaf.castShadow = false;
    leaf.receiveShadow = true;
    leaf.userData.noCast = true;
    leaf.userData.noOutline = true;
    root.add(leaf);
  }
}

export function createStoneSteps(M, options = {}) {
  const root = group('stoneSteps');
  root.userData.assetName = 'stoneSteps';
  const steps = options.steps ?? PATH.steps;
  const samples = [];
  let slabCount = 0;

  const stepLeafGeos = [
    leafSheetGeometry({ kind: 'maple', size: 0.085, thickness: 0.003, curl: 0.22, steps: 20 }),
    leafSheetGeometry({ kind: 'beech', size: 0.078, thickness: 0.003, curl: 0.18, steps: 18 }),
    leafSheetGeometry({ kind: 'maple', size: 0.072, thickness: 0.003, curl: 0.25, steps: 18 })
  ];
  const stepLeafMats = [
    M.leafSheetGroundRust,
    M.leafSheetGround,
    M.leafSheetGroundLight,
    M.leafSheetGroundWet,
    M.leafSheetFloatingAmber || M.leafSheetGroundRust
  ];
  const stepPineconeGeo = pineconeGeometry(0.026, 0.048, 519);

  for (let k = 0; k < steps; k++) {
    const rand = rng(k * 977 + 13);
    const zFront = frontZ(k);
    const top = stepTopY(k);
    const zBack = zFront - PATH.tread;
    const cz = (zFront + zBack) / 2;
    const count = rand() < 0.64 ? 3 : 4;
    const zoneMat = zoneMaterial(M, k);
    const spans = slabSplits(rand, count, pathShiftX(cz));
    const curveYaw = pathYaw(cz) * 0.36;

    for (let j = 0; j < spans.length; j++) {
      const [xa, xb] = spans[j];
      const cx = (xa + xb) / 2;
      const width = Math.max(0.32, xb - xa);
      const depth = PATH.tread * (0.90 + rand() * 0.16);
      const thickness = PATH.rise + BURIAL + rand() * 0.042;

      const geo = triplanarUv(
        ancientStepBlockGeometry(width, thickness, depth, k * 53 + j * 17 + 7, rand),
        UV_TILE,
        [cx, top, zFront]
      );
      const slab = mesh(geo, rand() < WET_ODDS ? M.stoneStepWet : zoneMat, `stoneStep-${k}-${j}`);
      place(slab, {
        x: cx + (rand() - 0.5) * 0.024,
        y: top + (rand() - 0.35) * JITTER_UP,
        z: cz + (rand() - 0.5) * 0.022,
        ry: curveYaw + lerp(-YAW_MAX, YAW_MAX, rand())
      });
      // 千年地基自然微沉降倾侧（打破机械水平面）
      slab.rotation.x = (rand() - 0.35) * 0.036;
      slab.rotation.z = (rand() - 0.5) * 0.034;
      slab.castShadow = true;
      slab.receiveShadow = true;
      root.add(slab);
      samples.push({ x: cx, y: top, z: cz });
      slabCount++;
    }

    addWeatheredSpallsAndMoss(root, M, k, zFront, top, rand, stepPineconeGeo);
    addStepLeaves(root, M, k, zFront, top, stepLeafGeos, stepLeafMats);
  }

  root.userData.samples = samples;
  root.userData.slabCount = slabCount;
  root.userData.meshCount = root.children.length;
  root.updateMatrixWorld(true);
  return root;
}
