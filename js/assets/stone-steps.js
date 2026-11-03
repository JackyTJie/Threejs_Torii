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
const BURIAL = 0.065;
const JOINT_GAP = [0.032, 0.064];
const YAW_MAX = 0.018;
const JITTER_UP = 0.012;
const MIN_SLAB_WIDTH = 0.60;
const WET_ODDS = 0.26;

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

/** 一级沿 X 的切分（随弯曲参道中心线偏移 shiftX） */
function slabSplits(rand, count, shiftX = 0) {
  const x0 = PATH.x0 + shiftX;
  const x1 = PATH.x1 + shiftX;
  const gaps = [];
  for (let i = 0; i < count - 1; i++) gaps.push(lerp(JOINT_GAP[0], JOINT_GAP[1], rand()));
  const totalGap = gaps.reduce((a, b) => a + b, 0);
  const usable = x1 - x0 - totalGap;
  const weights = [];
  for (let i = 0; i < count; i++) weights.push(0.68 + rand() * 0.68);
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

/**
 * 千年风化沧桑古石阶单块三维雕塑网格：
 * - 基于 14 × 5 × 8 细分 BoxGeometry（顶面 y = 0，底面 y = -thickness）；
 * - 1) 四周与前缘（踏鼻）大半径圆润磨损倒角（Pillow / Rounded Bevel），消除一切 90° 硬直棱；
 * - 2) 轮廓不规则风化内凹与缺角（局部岩石崩落豁口）；
 * - 3) 踏面中部千年足迹踩踏微凹弧度（Tread Dish Wear）与天然岩面层理起伏。
 */
function ancientStepBlockGeometry(width, thickness, depth, seed, rand) {
  const geo = new THREE.BoxGeometry(width, thickness, depth, 14, 5, 8);
  // 将顶面移至 y = 0，底面 y = -thickness，与原 slabGeometry 局部坐标系完全一致
  geo.translate(0, -thickness * 0.5, 0);

  const pos = geo.getAttribute('position');
  const hw = width * 0.5;
  const hd = depth * 0.5;

  // 为每块古石板生成 2 处随机风化崩角位置（常出现在前缘或左右角）
  const chip1X = (rand() < 0.5 ? -1 : 1) * hw * (0.55 + rand() * 0.42);
  const chip1Z = hd * (0.45 + rand() * 0.52);
  const chip1R = 0.08 + rand() * 0.09;
  const chip2X = (rand() - 0.5) * width * 0.75;
  const chip2Z = hd * (0.72 + rand() * 0.28);
  const chip2R = 0.06 + rand() * 0.08;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    const nx = x / Math.max(0.01, hw); // [-1, 1]
    const nz = z / Math.max(0.01, hd); // [-1, 1]，+1 为面向下山方向的前缘踏鼻
    const ny = (y + thickness) / Math.max(0.01, thickness); // [0=底, 1=顶]

    // 1. 三维自然层理噪声（打破横平竖直的边界线，使石板侧缘呈天然手工劈制的不规则弧线）
    const nMacro = fbm3(x * 3.4 + seed * 1.3, y * 4.2, z * 3.4 - seed * 0.7, 3);
    const nFine = fbm3(x * 8.5 - seed * 0.5, y * 9.0, z * 8.5 + seed * 1.9, 3);

    const edgeMaskX = smoothstep(0.55, 1.0, Math.abs(nx));
    const edgeMaskZ = smoothstep(0.50, 1.0, Math.abs(nz));
    const perimMask = Math.max(edgeMaskX, edgeMaskZ);

    // 平面轮廓不规则凹凸调制（前缘与左右缝呈自然弯曲风化边）
    x += (nMacro - 0.5) * 0.042 * edgeMaskX + (nFine - 0.5) * 0.016;
    z += (nMacro - 0.5) * 0.038 * edgeMaskZ + (nFine - 0.5) * 0.015;

    // 2. 局部沧桑崩角凹陷（前缘与角部不规则磨损退缩）
    const dChip1 = Math.hypot(x - chip1X, z - chip1Z);
    if (dChip1 < chip1R) {
      const k1 = (1 - dChip1 / chip1R);
      const shrink = k1 * k1 * 0.036;
      x -= Math.sign(x || 1) * shrink * 0.85;
      z -= Math.sign(z || 1) * shrink;
      if (ny > 0.35) y -= k1 * k1 * 0.024;
    }
    const dChip2 = Math.hypot(x - chip2X, z - chip2Z);
    if (dChip2 < chip2R) {
      const k2 = (1 - dChip2 / chip2R);
      z -= k2 * k2 * 0.028;
      if (ny > 0.35) y -= k2 * k2 * 0.018;
    }

    // 3. 千年圆润磨损倒角（Pillow Bevel）：顶面四周（尤其是前缘踏鼻 nz > 0.35 与侧棱）平滑下弯，立面顶部向内圆滑收拢
    const frontProximity = smoothstep(0.32, 1.0, nz);
    const backProximity = smoothstep(0.58, 1.0, -nz);
    const sideProximity = smoothstep(0.62, 1.0, Math.abs(nx));
    const cornerBlend = Math.min(1.0, Math.hypot(
      Math.max(0, (Math.abs(nx) - 0.58) / 0.42),
      Math.max(0, (Math.abs(nz) - 0.38) / 0.62)
    ));

    if (ny > 0.18) {
      const topWeight = smoothstep(0.18, 0.96, ny);
      // 前缘踏鼻因千年踩踏磨损最圆润（下沉 2.4~3.6cm），侧边与四角次之
      const bevelDrop = (
        frontProximity * frontProximity * (0.024 + 0.014 * nMacro) +
        sideProximity * sideProximity * (0.018 + 0.010 * nFine) +
        backProximity * backProximity * 0.012 +
        cornerBlend * cornerBlend * 0.016
      ) * topWeight;
      y -= bevelDrop;

      // 顶棱向内圆润收缩（消除垂直面与水平面交界的生硬折角）
      const inwardPull = topWeight * (0.018 + 0.012 * nMacro);
      x -= Math.sign(x) * sideProximity * inwardPull;
      z -= Math.sign(z) * Math.max(frontProximity, backProximity * 0.6) * inwardPull;

      // 4. 踏面中央常年踩踏微凹弧度（Tread Dish Wear）与岩面天然层理起伏
      const centerTread = (1 - perimMask * 0.85) * smoothstep(0.65, 1.0, ny);
      const footDish = Math.cos(nx * Math.PI * 0.5) * Math.cos(nz * Math.PI * 0.4) * 0.010;
      const surfaceUndulation = ((nMacro - 0.5) * 0.016 + (nFine - 0.5) * 0.007) * smoothstep(0.5, 1.0, ny);
      y += surfaceUndulation - footDish * centerTread;
    }

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  return geo;
}

function addWeatheredSpallsAndMoss(root, M, k, zFront, top, rand) {
  const czStep = zFront - PATH.tread * 0.5;
  const { x0, x1 } = pathBoundsAt(czStep);

  // 1) 圆润风化的石阶边角碎石（采用 rockGeometry 替代直棱方片）
  const chipCount = rand() < 0.25 ? 1 : 2;
  for (let i = 0; i < chipCount; i++) {
    const r = lerp(0.045, 0.095, rand());
    const cx = lerp(x0 + 0.12, x1 - 0.12, rand());
    const cz = zFront - lerp(0.05, 0.44, rand());
    const geo = triplanarUv(
      rockGeometry(r, 6400 + k * 31 + i * 7, {
        widthSegments: 10,
        heightSegments: 7,
        wobble: 0.28,
        flatten: 0.36
      }),
      0.35,
      [cx, top, cz]
    );
    const chip = mesh(geo, i % 2 === 0 ? M.stonePebble : M.stoneRockWet, `stepChip-${k}-${i}`);
    place(chip, {
      x: cx,
      y: top - 0.004 + rand() * 0.010,
      z: cz,
      ry: rand() * Math.PI * 2,
      sx: 1.15 + rand() * 0.35,
      sy: 0.65,
      sz: 0.95 + rand() * 0.35
    });
    chip.castShadow = true;
    chip.receiveShadow = true;
    chip.userData.noOutline = true;
    root.add(chip);
  }

  // 2) 石阶向溪侧（左侧 x0）与阶根背阴缝隙的立体厚青苔条垫
  const mossCount = rand() < 0.45 ? 1 : 2;
  for (let m = 0; m < mossCount; m++) {
    const biasLeft = Math.pow(rand(), 1.65); // 明显偏向左侧溪流潮湿侧
    const mx = lerp(x0 + 0.08, x1 - 0.25, biasLeft);
    const mz = m === 0 ? zFront - PATH.tread + 0.06 + rand() * 0.06 : zFront - lerp(0.08, 0.42, rand());
    const mr = lerp(0.085, 0.155, rand());
    const mGeo = triplanarUv(
      rockGeometry(mr, 7300 + k * 41 + m * 13, {
        widthSegments: 10,
        heightSegments: 7,
        wobble: 0.26,
        flatten: 0.22
      }),
      0.28,
      [mx, top, mz]
    );
    const mossPad = mesh(mGeo, m % 2 === 0 ? M.mossWet : M.mossPatch, `stepMoss-${k}-${m}`);
    mossPad.position.set(mx, top - 0.003, mz);
    mossPad.rotation.y = rand() * Math.PI * 2;
    mossPad.scale.set(1.45, 0.32, 0.95);
    mossPad.castShadow = false;
    mossPad.receiveShadow = true;
    mossPad.userData.noCast = true;
    mossPad.userData.noOutline = true;
    root.add(mossPad);
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

  for (let k = 0; k < steps; k++) {
    const rand = rng(k * 977 + 13);
    const zFront = frontZ(k);
    const top = stepTopY(k);
    const zBack = zFront - PATH.tread;
    const cz = (zFront + zBack) / 2;
    const count = rand() < 0.38 ? 3 : 2;
    const zoneMat = zoneMaterial(M, k);
    const spans = slabSplits(rand, count, pathShiftX(cz));
    const curveYaw = pathYaw(cz) * 0.32;

    for (let j = 0; j < spans.length; j++) {
      const [xa, xb] = spans[j];
      const cx = (xa + xb) / 2;
      const width = Math.max(0.32, xb - xa);
      const depth = PATH.tread * (0.96 + rand() * 0.08);
      const thickness = PATH.rise + BURIAL + rand() * 0.032;

      const geo = triplanarUv(
        ancientStepBlockGeometry(width, thickness, depth, k * 53 + j * 17 + 7, rand),
        UV_TILE,
        [cx, top, zFront]
      );
      const slab = mesh(geo, rand() < WET_ODDS ? M.stoneStepWet : zoneMat, `stoneStep-${k}-${j}`);
      place(slab, {
        x: cx + (rand() - 0.5) * 0.018,
        y: top + (rand() - 0.35) * JITTER_UP,
        z: cz + (rand() - 0.5) * 0.016,
        ry: curveYaw + lerp(-YAW_MAX, YAW_MAX, rand())
      });
      // 千年地基自然微沉降倾侧（打破机械水平面）
      slab.rotation.x = (rand() - 0.35) * 0.022;
      slab.rotation.z = (rand() - 0.5) * 0.020;
      slab.castShadow = true;
      slab.receiveShadow = true;
      root.add(slab);
      samples.push({ x: cx, y: top, z: cz });
      slabCount++;
    }

    addWeatheredSpallsAndMoss(root, M, k, zFront, top, rand);
    addStepLeaves(root, M, k, zFront, top, stepLeafGeos, stepLeafMats);
  }

  root.userData.samples = samples;
  root.userData.slabCount = slabCount;
  root.userData.meshCount = root.children.length;
  root.updateMatrixWorld(true);
  return root;
}
