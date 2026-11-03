/**
 * 朱红明神鸟居与参道对称春日木灯笼（PATH_SYSTEM.toriiFront / toriiRear）
 *
 * 1:1 对照用户参考图升级：
 * 1) 移除横梁（貫）处的注连绳与纸垂，保持明神鸟居纯粹利落的建筑骨相（不加中央牌匾）；
 * 2) 参考第三张图，在横梁（貫）正面两端与侧面、以及立柱侧面添加极简暗金色奉纳铭文笔画细节（奉 / 納 与竖排铭文）；
 * 3) 三段式真实老化与深暗朱漆质感：
 *    - 顶部笠木（kasagi）与眉木积灰、覆苔最严重（叠加立体厚青苔垫与风化积尘）；
 *    - 立柱底部因雨水溅射、泥土接触，漆面剥落发黑并露出深褐竖向木纹；
 *    - 立柱腰部高度（1.0~1.7m）因常年游客触碰，漆面更光滑温润、色泽稍亮；
 *    - 整体朱红偏深暗，受光面偏暖橙，背阴面偏深红褐，彻底消除亮红塑料感；
 * 4) 参考第二张图，在靠近前座鸟居的参道一左一右对称设置一对 1:1 还原的日式朱涂木造春日灯笼（含台石、黑漆根巻、
 *    奉纳墨迹朱柱、腕木受台、绿格子窗棂、暖黄微光障子纸火袋、白壁与反り黑漆切妻屋顶），夜晚发出暖黄微光且面板可控亮度。
 */
import * as THREE from 'three';
import { TORII, terrainHeight, toriiBaseY } from '../layout.js';
import {
  group,
  mesh,
  rng,
  rockGeometry,
  taperedCylinder,
  slabGeometry,
  sweepProfileGeometry,
  triplanarUv
} from '../primitives.js';

const P = TORII.parts;
const DEG = Math.PI / 180;

const STONE_TILE = 0.5;
const BEAM_TILE = 0.6;
const SMALL_TILE = 0.4;
const POST_UV_U = 3;
const POST_UV_V = 8;

const ROOT_LOWER = { half: 0.3, thickness: 0.28, topY: -0.02, bevel: 0.065 };
const ROOT_CAP = { half: 0.25, thickness: 0.14, topY: 0.1, bevel: 0.045 };

const MOSS_STRIP = { xCenter: 0.72, width: 0.88, height: 0.028, depth: 0.12 };

function scaleUv(geo, su, sv) {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

function rectRing(halfX, halfZ) {
  return [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]];
}

function beveledSquareRing(half, bevel) {
  const c = Math.min(bevel, half * 0.4);
  const h = half;
  return [
    [-h + c, -h], [h - c, -h], [h, -h + c], [h, h - c],
    [h - c, h], [-h + c, h], [-h, h - c], [-h, -h + c]
  ];
}

function beam(name, material, { halfX, halfZ, thickness, topY, tile = BEAM_TILE }) {
  const geo = slabGeometry(rectRing(halfX, halfZ), thickness);
  triplanarUv(geo, tile, [0, topY, 0]);
  const m = mesh(geo, material, name);
  m.position.y = topY;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function kasagiGeometry() {
  const half = P.kasagi.length / 2;
  const camber = P.kasagi.camber;
  const midY = P.kasagi.y1 - P.kasagi.height / 2;
  const steps = 8;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const x = -half + (2 * half * i) / steps;
    points.push(new THREE.Vector3(x, midY + camber * (x / half) ** 2, 0));
  }
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  const halfDepth = P.kasagi.depth / 2;
  const halfTopDepth = halfDepth - 0.02;
  const halfHeight = P.kasagi.height / 2;
  const profile = [
    [-halfDepth, -halfHeight],
    [-halfTopDepth, halfHeight],
    [halfTopDepth, halfHeight],
    [halfDepth, -halfHeight]
  ];
  const geo = sweepProfileGeometry(curve, profile, 28);
  triplanarUv(geo, BEAM_TILE, [0, midY, 0]);
  return geo;
}

function shimakiGeometry() {
  const half = P.shimaki.length / 2;
  const camber = P.kasagi.camber * 0.65;
  const midY = P.shimaki.y1 - P.shimaki.height / 2;
  const steps = 8;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const x = -half + (2 * half * i) / steps;
    points.push(new THREE.Vector3(x, midY + camber * (x / half) ** 2, 0));
  }
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  const halfDepth = P.shimaki.depth / 2;
  const halfHeight = P.shimaki.height / 2;
  const profile = [
    [-halfDepth, -halfHeight],
    [-halfDepth, halfHeight],
    [halfDepth, halfHeight],
    [halfDepth, -halfHeight]
  ];
  const geo = sweepProfileGeometry(curve, profile, 28);
  triplanarUv(geo, BEAM_TILE, [0, midY, 0]);
  return geo;
}

function rootStone(name, stoneMat, blackMat, px, rand) {
  const g = group(name);
  const parts = [ROOT_LOWER, ROOT_CAP];
  for (let i = 0; i < parts.length; i++) {
    const spec = parts[i];
    const geo = slabGeometry(beveledSquareRing(spec.half, spec.bevel), spec.thickness);
    triplanarUv(geo, STONE_TILE, [px, spec.topY, 0]);
    const m = mesh(geo, stoneMat, `${name}-${i === 0 ? 'body' : 'cap'}`);
    m.position.set(px, spec.topY, 0);
    m.rotation.y = (i === 1 ? 1 : 0) * (rand() - 0.5) * 0.06;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  const nemaki = taperedCylinder(`${name}-nemaki`, blackMat, {
    x: px,
    y: 0.16,
    z: 0,
    height: 0.18,
    rBottom: P.post.rBottom + 0.01,
    rTop: P.post.rBottom + 0.005,
    segments: 20
  });
  scaleUv(nemaki.geometry, 2, 1);
  nemaki.castShadow = true;
  nemaki.receiveShadow = true;
  g.add(nemaki);
  return g;
}

/**
 * 立柱表面细节：
 * - 底部（u ∈ [0.06, 0.24]）因雨水溅射与泥土接触，漆面大块剥落发黑、露出深色纵向木纹；
 * - 腰部（u ∈ [0.26, 0.44]）保持光滑完整（由着色器 waistTouch 强化温润微亮光泽）；
 * - 上部局部风化水痕。
 */
function postSurfaceDetails(postMesh, woodBareMat, darkStreakMat, rand) {
  const h = P.post.height;
  // 1) 柱底雨水溅射剥落发黑与露木纹斑块（集中在底部 hLocal < 0.85m）
  const basePeelSpecs = [
    { u: 0.09, w: 0.085, tall: 0.34, az: Math.PI * 0.48, dark: true },
    { u: 0.13, w: 0.072, tall: 0.28, az: Math.PI * 0.65, dark: false },
    { u: 0.11, w: 0.078, tall: 0.32, az: Math.PI * 0.32, dark: false },
    { u: 0.16, w: 0.064, tall: 0.24, az: Math.PI * 0.82, dark: true },
    { u: 0.08, w: 0.090, tall: 0.30, az: -Math.PI * 0.45, dark: true }
  ];
  basePeelSpecs.forEach((sp, i) => {
    const yLocal = -h / 2 + sp.u * h;
    const radius = P.post.rBottom + (P.post.rTop - P.post.rBottom) * sp.u;
    const proud = (sp.w / 2) ** 2 / (2 * radius) + 0.0035;
    const geo = new THREE.BoxGeometry(sp.w, sp.tall, 0.009);
    triplanarUv(geo, SMALL_TILE, [0, yLocal, 0]);
    const m = mesh(geo, sp.dark ? darkStreakMat : woodBareMat, `post-base-peel-${i}`);
    m.position.set(
      Math.cos(sp.az) * (radius + proud),
      yLocal,
      Math.sin(sp.az) * (radius + proud)
    );
    m.rotation.y = Math.PI / 2 - sp.az;
    m.rotation.z = (rand() - 0.5) * 0.08;
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.noCast = true;
    m.userData.noOutline = true;
    postMesh.add(m);
  });

  // 2) 柱身上段竖向雨水冲刷墨痕（避开腰部光滑触摸区 u ∈ [0.25, 0.44]）
  const streakSegments = [
    { u: 0.58, w: 0.022, h: 0.42, dAz: 0.05 },
    { u: 0.64, w: 0.018, h: 0.32, dAz: -0.08 },
    { u: 0.14, w: 0.024, h: 0.38, dAz: -0.04 }
  ];
  streakSegments.forEach((seg, idx) => {
    const yLocal = -h / 2 + seg.u * h;
    const radius = P.post.rBottom + (P.post.rTop - P.post.rBottom) * seg.u;
    const proud = (seg.w / 2) ** 2 / (2 * radius) + 0.004;
    const az = Math.PI * 0.5 + seg.dAz;
    const geo = new THREE.BoxGeometry(seg.w, seg.h, 0.008);
    triplanarUv(geo, SMALL_TILE, [0, yLocal, 0]);
    const s = mesh(geo, darkStreakMat, `post-streak-${idx}`);
    s.position.set(Math.cos(az) * (radius + proud), yLocal, Math.sin(az) * (radius + proud));
    s.rotation.y = Math.PI / 2 - az;
    s.castShadow = false;
    s.receiveShadow = true;
    s.userData.noCast = true;
    s.userData.noOutline = true;
    postMesh.add(s);
  });
}

function streakPlate(name, material, { x, y, z, width, height }) {
  const geo = new THREE.BoxGeometry(width, height, 0.01);
  triplanarUv(geo, SMALL_TILE, [x, y, z]);
  const m = mesh(geo, material, name);
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = true;
  m.userData.noCast = true;
  m.userData.noOutline = true;
  return m;
}

function nukiMossStrip(name, material, xCenter) {
  const geo = new THREE.BoxGeometry(MOSS_STRIP.width, MOSS_STRIP.height, MOSS_STRIP.depth);
  triplanarUv(geo, SMALL_TILE, [xCenter, P.nuki.y1 + MOSS_STRIP.height / 2, 0]);
  const m = mesh(geo, material, name);
  m.position.set(xCenter, P.nuki.y1 + MOSS_STRIP.height / 2, 0);
  m.castShadow = false;
  m.receiveShadow = true;
  m.userData.noCast = true;
  m.userData.noOutline = true;
  return m;
}

function nukiWedges(T, mossMat) {
  const g = group('kusabi-group');
  const yCenter = (P.nuki.y0 + P.nuki.y1) / 2;
  for (const px of [P.post.x, -P.post.x]) {
    for (const side of [-1, 1]) {
      const wx = px + side * (P.post.rBottom + 0.042);
      const geo = new THREE.BoxGeometry(0.075, P.nuki.height + 0.065, P.nuki.depth + 0.036);
      triplanarUv(geo, SMALL_TILE, [wx, yCenter, 0]);
      const w = mesh(geo, T.deep, `kusabi-${px > 0 ? 'r' : 'l'}-${side > 0 ? 'out' : 'in'}`);
      w.position.set(wx, yCenter, 0);
      w.castShadow = true;
      w.receiveShadow = true;
      g.add(w);
    }
    if (mossMat) {
      const mGeo = new THREE.BoxGeometry(0.46, 0.032, P.nuki.depth + 0.04);
      triplanarUv(mGeo, SMALL_TILE, [px, P.nuki.y1 + 0.015, 0]);
      const mPad = mesh(mGeo, mossMat, `joint-moss-${px > 0 ? 'r' : 'l'}`);
      mPad.position.set(px, P.nuki.y1 + 0.015, 0);
      mPad.castShadow = false;
      mPad.receiveShadow = true;
      mPad.userData.noCast = true;
      mPad.userData.noOutline = true;
      g.add(mPad);
    }
  }
  return g;
}

function post(name, T, px, rand) {
  const h = P.post.height;
  const lean = P.post.leanDeg * DEG;
  const sign = Math.sign(px);
  const m = taperedCylinder(name, T.post, {
    x: px - (h / 2) * Math.sin(lean) * sign,
    y: (h / 2) * Math.cos(lean),
    z: 0,
    height: h,
    rBottom: P.post.rBottom,
    rTop: P.post.rTop,
    segments: 20,
    tiltZ: lean * sign
  });
  scaleUv(m.geometry, POST_UV_U, POST_UV_V);
  m.castShadow = true;
  m.receiveShadow = true;
  postSurfaceDetails(m, T.woodBare, T.blackFade, rand);
  return m;
}

/**
 * 中央額束（gakuzuka）：参考图中島木与貫之间仅有中央一根朱红立束，不挂牌匾
 */
function gakuzuka(T) {
  const g = group('gakuzuka');
  const centerY = (P.gakuzuka.y0 + P.gakuzuka.y1) / 2;
  const bodyGeo = new THREE.BoxGeometry(P.gakuzuka.width, P.gakuzuka.height, P.gakuzuka.depth);
  triplanarUv(bodyGeo, SMALL_TILE, [0, centerY, 0]);
  const body = mesh(bodyGeo, T.lacquer, 'gakuzuka-strut');
  body.position.set(0, centerY, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  for (const [tag, yOff] of [['top', P.gakuzuka.y1 - 0.05], ['bot', P.gakuzuka.y0 + 0.05]]) {
    const collarGeo = new THREE.BoxGeometry(P.gakuzuka.width + 0.04, 0.08, P.gakuzuka.depth + 0.03);
    triplanarUv(collarGeo, SMALL_TILE, [0, yOff, 0]);
    const collar = mesh(collarGeo, T.deep, `gakuzuka-collar-${tag}`);
    collar.position.set(0, yOff, 0);
    collar.castShadow = true;
    collar.receiveShadow = true;
    g.add(collar);
  }
  return g;
}

/**
 * 顶部笠木（kasagi）重度积灰与厚青苔层：
 * 沿反り弧形笠木顶面铺设多簇立体深山厚青苔垫（mossStone / mossWet），体现顶部常年雨淋积灰长苔最严重。
 */
function buildKasagiHeavyMoss(T, M, rand) {
  const g = group('kasagi-moss-group');
  const half = P.kasagi.length / 2 - 0.22;
  const camber = P.kasagi.camber;
  const topY = P.kasagi.y1;
  const mossCount = 11;

  for (let i = 0; i < mossCount; i++) {
    const u = -0.92 + (1.84 * i) / (mossCount - 1) + (rand() - 0.5) * 0.06;
    const x = u * half;
    const y = topY + camber * (x / (P.kasagi.length / 2)) ** 2 - 0.008;
    const z = (rand() - 0.5) * (P.kasagi.depth * 0.36);
    const r = 0.14 + rand() * 0.11;
    const mGeo = rockGeometry(r, 9400 + i * 29, {
      widthSegments: 10,
      heightSegments: 7,
      wobble: 0.26,
      flatten: 0.24
    });
    triplanarUv(mGeo, 0.28, [x, y, z]);
    const mat = i % 2 === 0 ? M.mossWet : M.mossStone;
    const mPatch = mesh(mGeo, mat, `kasagi-moss-${i}`);
    mPatch.position.set(x, y, z);
    mPatch.scale.set(1.55, 0.36, 0.82);
    mPatch.castShadow = false;
    mPatch.receiveShadow = true;
    mPatch.userData.noCast = true;
    mPatch.userData.noOutline = true;
    g.add(mPatch);
  }
  return g;
}

/**
 * 参考第三张图：横梁（貫）与立柱交接处及横梁侧面的极简暗金色「奉」「納」及竖向奉纳铭文细节（纯几何笔画，不使用任何字体加载）。
 */
function buildDedicationInscriptions(T) {
  const g = group('torii-inscriptions');
  const yCenter = (P.nuki.y0 + P.nuki.y1) / 2;
  const zFront = P.nuki.depth / 2 + 0.012;
  const mat = T.goldInscription;

  const addStroke = (name, x, y, z, w, h, d, rz = 0) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    triplanarUv(geo, SMALL_TILE, [x, y, z]);
    const s = mesh(geo, mat, name);
    s.position.set(x, y, z);
    s.rotation.z = rz;
    s.castShadow = false;
    s.receiveShadow = true;
    s.userData.noCast = true;
    s.userData.noOutline = true;
    g.add(s);
  };

  // 1) 右柱横梁正面：「奉」字极简暗金笔画（三横一竖一撇一捺）
  const rx = P.post.x * 0.94;
  addStroke('insc-hou-h1', rx, yCenter + 0.048, zFront, 0.095, 0.012, 0.006, 0.03);
  addStroke('insc-hou-h2', rx, yCenter + 0.018, zFront, 0.076, 0.011, 0.006, 0.02);
  addStroke('insc-hou-h3', rx, yCenter - 0.012, zFront, 0.112, 0.012, 0.006, 0.02);
  addStroke('insc-hou-v1', rx, yCenter - 0.004, zFront, 0.013, 0.125, 0.006, 0.0);
  addStroke('insc-hou-s1', rx - 0.036, yCenter - 0.032, zFront, 0.055, 0.011, 0.006, 0.58);
  addStroke('insc-hou-s2', rx + 0.036, yCenter - 0.032, zFront, 0.055, 0.011, 0.006, -0.58);

  // 2) 左柱横梁正面：「納」字极简暗金笔画（绞丝旁 + 内框）
  const lx = -P.post.x * 0.94;
  addStroke('insc-nou-l1', lx - 0.034, yCenter + 0.028, zFront, 0.042, 0.011, 0.006, 0.62);
  addStroke('insc-nou-l2', lx - 0.034, yCenter - 0.002, zFront, 0.044, 0.011, 0.006, -0.52);
  addStroke('insc-nou-l3', lx - 0.034, yCenter - 0.036, zFront, 0.012, 0.062, 0.006, 0.0);
  addStroke('insc-nou-r1', lx + 0.024, yCenter + 0.038, zFront, 0.064, 0.012, 0.006, 0.0);
  addStroke('insc-nou-r2', lx - 0.004, yCenter - 0.008, zFront, 0.012, 0.095, 0.006, 0.0);
  addStroke('insc-nou-r3', lx + 0.052, yCenter - 0.008, zFront, 0.012, 0.095, 0.006, 0.0);
  addStroke('insc-nou-r4', lx + 0.024, yCenter + 0.002, zFront, 0.036, 0.011, 0.006, -0.45);

  // 3) 横梁（貫）左右外伸侧面与立柱外侧的极简暗金色奉纳小字铭文列
  for (const side of [-1, 1]) {
    const xOut = side * (P.nuki.length / 2 - 0.16);
    for (let k = 0; k < 4; k++) {
      const yk = yCenter + 0.042 - k * 0.028;
      addStroke(`insc-side-${side > 0 ? 'r' : 'l'}-${k}`, xOut, yk, zFront, 0.032, 0.009, 0.005, (k % 2 - 0.5) * 0.15);
    }
  }

  return g;
}

/**
 * 参考第二张图（93A117F0-2F1E-44B6-9BD2-61BF94E36758.png）：
 * 1:1 还原日式朱涂木造春日灯笼（木造朱塗灯籠）：
 * - 覆苔基础台石 + 黑漆根巻
 * - 朱红方形竿柱（正面带竖排奉纳墨迹笔画）
 * - 十字交叉朱红腕木（带黑漆端头木口）+ 叠涩中台受座
 * - 火袋：四角朱柱 + 暖黄微光障子纸内芯 + 四面深绿木格子窗棂（緑格子 3×3）+ 中央暗金徽章 + 檐下白壁
 * - 反り弧形黑漆切妻造屋顶（含朱红飞檐垂木、前后破风板、悬鱼与栋木鬼板）
 */
function buildWoodenShrineLantern(name, T, M, lx, ly, lz, rand) {
  const lantern = group(name);
  lantern.position.set(lx, ly, lz);

  const addBox = (partName, mat, x, y, z, w, h, d, opts = {}) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    triplanarUv(geo, SMALL_TILE, [lx + x, ly + y, lz + z]);
    const m = mesh(geo, mat, `${name}-${partName}`);
    m.position.set(x, y, z);
    if (opts.rx) m.rotation.x = opts.rx;
    if (opts.ry) m.rotation.y = opts.ry;
    if (opts.rz) m.rotation.z = opts.rz;
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    if (opts.noCast) m.userData.noCast = true;
    if (opts.noOutline) m.userData.noOutline = true;
    lantern.add(m);
    return m;
  };

  // 1) 基础台石（覆苔石座）+ 黑漆根巻
  const baseGeo = slabGeometry(beveledSquareRing(0.21, 0.04), 0.16);
  triplanarUv(baseGeo, STONE_TILE, [lx, ly + 0.08, lz]);
  const stonePlinth = mesh(baseGeo, T.stoneBase, `${name}-plinth`);
  stonePlinth.position.set(0, 0.08, 0);
  stonePlinth.castShadow = true;
  stonePlinth.receiveShadow = true;
  lantern.add(stonePlinth);

  addBox('nemaki', T.black, 0, 0.24, 0, 0.21, 0.22, 0.21);
  addBox('nemaki-collar', T.blackFade, 0, 0.35, 0, 0.22, 0.025, 0.22, { noOutline: true, noCast: true, cast: false });

  // 2) 朱红方形竿柱（高 1.18m，正面带竖排奉纳墨迹笔画）
  const postH = 1.18;
  const postY = 0.35 + postH / 2;
  addBox('post', T.post, 0, postY, 0, 0.165, postH, 0.165);

  // 竿柱正面竖排奉纳墨字细节（还原第二张图灯笼柱身上的竖排黑墨字）
  for (let c = 0; c < 5; c++) {
    const cy = 0.56 + c * 0.14;
    addBox(`post-kanji-h-${c}`, T.black, 0, cy, 0.086, 0.048, 0.012, 0.005, {
      rz: (rand() - 0.5) * 0.15, noOutline: true, noCast: true, cast: false
    });
    addBox(`post-kanji-v-${c}`, T.black, (c % 2 - 0.5) * 0.014, cy - 0.015, 0.086, 0.012, 0.052, 0.005, {
      noOutline: true, noCast: true, cast: false
    });
  }

  // 3) 十字腕木（支撑横木）与中台受座
  const armY = 1.56;
  addBox('arm-x', T.lacquer, 0, armY, 0, 0.58, 0.068, 0.095);
  addBox('arm-z', T.lacquer, 0, armY, 0, 0.095, 0.068, 0.58);
  // 腕木两端黑漆木口包头
  for (const s of [-1, 1]) {
    addBox(`arm-cap-x-${s > 0 ? 'r' : 'l'}`, T.black, s * 0.292, armY, 0, 0.018, 0.072, 0.10, { noOutline: true });
    addBox(`arm-cap-z-${s > 0 ? 'f' : 'b'}`, T.black, 0, armY, s * 0.292, 0.10, 0.072, 0.018, { noOutline: true });
  }
  // 中台受座与白壁间板
  addBox('platform-neck', T.lanternWhiteWall, 0, 1.625, 0, 0.38, 0.055, 0.38);
  addBox('platform-main', T.lacquer, 0, 1.675, 0, 0.52, 0.058, 0.52);
  addBox('platform-rim', T.deep, 0, 1.715, 0, 0.44, 0.032, 0.44);

  // 4) 火袋（Firebox）：暖黄微光障子纸内芯 + 四角朱柱 + 深绿木格子窗棂（緑格子）
  const fireH = 0.44;
  const fireY = 1.73 + fireH / 2;
  // 暖黄发光障子纸内胆（夜晚与面板滑块联动发光）
  const paperCore = addBox('firebox-paper', T.lanternPaper, 0, fireY, 0, 0.34, fireH - 0.02, 0.34, {
    noOutline: true, noCast: true, cast: false
  });
  paperCore.userData.isLanternGlow = true;

  // 四角朱红立框柱
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(`firebox-corner-${sx > 0 ? 'r' : 'l'}${sz > 0 ? 'f' : 'b'}`, T.lacquer, sx * 0.175, fireY, sz * 0.175, 0.044, fireH, 0.044);
    }
  }

  // 四面深绿窗框与 3×3 绿格子（1:1 还原第二张图中的绿色木格窗与中央小金章）
  const faceDist = 0.176;
  for (const side of [-1, 1]) {
    // 前后面（±Z）
    const zFace = side * faceDist;
    addBox(`grille-z-top-${side}`, T.lanternLattice, 0, fireY + 0.18, zFace, 0.31, 0.024, 0.016, { noOutline: true });
    addBox(`grille-z-bot-${side}`, T.lanternLattice, 0, fireY - 0.18, zFace, 0.31, 0.024, 0.016, { noOutline: true });
    for (const gx of [-0.085, 0, 0.085]) {
      addBox(`grille-z-v-${side}-${gx}`, T.lanternLattice, gx, fireY, zFace, 0.014, 0.36, 0.014, { noOutline: true, noCast: true, cast: false });
    }
    for (const gy of [-0.085, 0, 0.085]) {
      addBox(`grille-z-h-${side}-${gy}`, T.lanternLattice, 0, fireY + gy, zFace, 0.31, 0.014, 0.014, { noOutline: true, noCast: true, cast: false });
    }
    addBox(`grille-z-emblem-${side}`, T.goldInscription, 0, fireY, zFace + side * 0.006, 0.046, 0.056, 0.008, { noOutline: true, noCast: true, cast: false });

    // 左右面（±X）
    const xFace = side * faceDist;
    addBox(`grille-x-top-${side}`, T.lanternLattice, xFace, fireY + 0.18, 0, 0.016, 0.024, 0.31, { noOutline: true });
    addBox(`grille-x-bot-${side}`, T.lanternLattice, xFace, fireY - 0.18, 0, 0.016, 0.024, 0.31, { noOutline: true });
    for (const gz of [-0.085, 0, 0.085]) {
      addBox(`grille-x-v-${side}-${gz}`, T.lanternLattice, xFace, fireY, gz, 0.014, 0.36, 0.014, { noOutline: true, noCast: true, cast: false });
    }
    for (const gy of [-0.085, 0, 0.085]) {
      addBox(`grille-x-h-${side}-${gy}`, T.lanternLattice, xFace, fireY + gy, 0, 0.014, 0.014, 0.31, { noOutline: true, noCast: true, cast: false });
    }
    addBox(`grille-x-emblem-${side}`, T.goldInscription, xFace + side * 0.006, fireY, 0, 0.008, 0.056, 0.046, { noOutline: true, noCast: true, cast: false });
  }

  // 5) 檐下白壁与朱红头贯斗栱层（还原第二张图火袋上方的白色小壁面与朱红梁枋）
  addBox('top-tie-beam', T.lacquer, 0, 2.18, 0, 0.44, 0.045, 0.44);
  addBox('upper-white-wall', T.lanternWhiteWall, 0, 2.255, 0, 0.39, 0.105, 0.39);
  addBox('eave-rafter-plate', T.lacquer, 0, 2.32, 0, 0.62, 0.036, 0.58);

  // 6) 反り弧形黑漆切妻造屋顶（Curved Black Gable Roof）
  const roofY = 2.34;
  const roofHalfW = 0.42;
  const roofHalfD = 0.38;
  const ridgeH = 0.26;

  for (const side of [-1, 1]) {
    // 沿 X 方向从中央屋脊（x=0, y=roofY+ridgeH）向两侧微翘飞檐（x=side*roofHalfW, y=roofY）扫掠弧形坡面
    const slopePts = [];
    const segs = 6;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const sx = side * u * roofHalfW;
      // 传统切妻屋顶微凹反り曲线（中段微垂、檐口上翘）
      const sy = roofY + ridgeH * (1 - u) + Math.sin(u * Math.PI) * (-0.032) + (u ** 3) * 0.024;
      slopePts.push(new THREE.Vector3(sx, sy, 0));
    }
    const slopeCurve = new THREE.CatmullRomCurve3(slopePts, false, 'centripetal', 0.5);
    const slopeProfile = [
      [-roofHalfD, -0.022],
      [-roofHalfD, 0.022],
      [roofHalfD, 0.022],
      [roofHalfD, -0.022]
    ];
    const slopeGeo = sweepProfileGeometry(slopeCurve, slopeProfile, 14);
    triplanarUv(slopeGeo, SMALL_TILE, [lx, ly + roofY, lz]);
    const slopeMesh = mesh(slopeGeo, T.black, `${name}-roof-slope-${side > 0 ? 'r' : 'l'}`);
    slopeMesh.castShadow = true;
    slopeMesh.receiveShadow = true;
    lantern.add(slopeMesh);

    // 屋檐下方朱红色飞檐底板
    addBox(`eave-under-${side > 0 ? 'r' : 'l'}`, T.lacquer, side * 0.21, roofY + 0.07, 0, 0.36, 0.018, roofHalfD * 1.82, {
      rz: -side * 0.52, noOutline: true
    });
  }

  // 屋脊栋木（棟木）与两端翘起鬼板（鬼瓦）
  addBox('roof-ridge', T.black, 0, roofY + ridgeH + 0.02, 0, 0.075, 0.055, roofHalfD * 2.06);
  for (const sz of [-1, 1]) {
    addBox(`roof-oni-${sz > 0 ? 'f' : 'b'}`, T.black, 0, roofY + ridgeH + 0.042, sz * (roofHalfD + 0.015), 0.095, 0.085, 0.032);
    // 破风山花下的暗金/黑漆悬鱼装饰
    addBox(`roof-gegyo-${sz > 0 ? 'f' : 'b'}`, T.goldInscription, 0, roofY + ridgeH - 0.065, sz * (roofHalfD - 0.01), 0.048, 0.058, 0.014, {
      noOutline: true, noCast: true, cast: false
    });
  }

  // 屋顶表面轻微青苔积尘点缀
  const roofMossGeo = rockGeometry(0.085, 9700 + Math.floor(rand() * 100), {
    widthSegments: 8, heightSegments: 6, wobble: 0.22, flatten: 0.22
  });
  triplanarUv(roofMossGeo, 0.25, [lx, ly + roofY + ridgeH, lz]);
  const roofMoss = mesh(roofMossGeo, M.mossWet, `${name}-roof-moss`);
  roofMoss.position.set(0.08, roofY + ridgeH - 0.02, -0.06);
  roofMoss.scale.set(1.4, 0.3, 1.1);
  roofMoss.castShadow = false;
  roofMoss.receiveShadow = true;
  roofMoss.userData.noCast = true;
  roofMoss.userData.noOutline = true;
  lantern.add(roofMoss);

  return lantern;
}

/**
 * 供 lighting.js 获取两座参道木灯笼火袋在世界空间中的精确坐标，以便布置暖黄微光点光源
 */
export function getShrineLanternWorldPositions() {
  const front = TORII.pair[0];
  const baseY = toriiBaseY(front.z);
  const yaw = front.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const zLocal = 0.86;
  const fireYLocal = 1.95;

  return [-1, 1].map((side) => {
    const xLocal = side * 1.62;
    const wx = front.x + xLocal * cos + zLocal * sin;
    const wz = front.z - xLocal * sin + zLocal * cos;
    const groundY = terrainHeight(wx, wz);
    return {
      side: side < 0 ? 'left' : 'right',
      x: wx,
      y: Math.max(groundY, baseY - 0.26) + fireYLocal,
      z: wz
    };
  });
}

export function createTorii(M, options = {}) {
  const id = options.id ?? 'front';
  const pair = TORII.pair.find((t) => t.id === id) ?? TORII.pair[0];
  const baseY = toriiBaseY(pair.z);
  const seed = options.seed ?? (pair.id === 'front' ? 23 : 41);
  const shade = pair.id === 'rear' ? 0.82 : 1.0;
  const T = M.makeToriiMaterials({ seed, baseY, shade });
  const rand = rng(pair.step * 613 + 17);

  const root = group(pair.name);
  root.userData.assetName = pair.name;
  root.userData.toriiId = pair.id;

  for (const px of [P.post.x, -P.post.x]) {
    root.add(rootStone(`isizue-${px > 0 ? 'right' : 'left'}`, T.stoneBase, T.black, px, rand));
    root.add(post(`post-${px > 0 ? 'right' : 'left'}`, T, px, rand));
  }

  root.add(beam('nuki', T.lacquer, {
    halfX: P.nuki.length / 2,
    halfZ: P.nuki.depth / 2,
    thickness: P.nuki.height,
    topY: P.nuki.y1
  }));
  root.add(nukiWedges(T, M.mossWet));
  root.add(nukiMossStrip('nuki-moss-a', T.deep, MOSS_STRIP.xCenter));
  root.add(nukiMossStrip('nuki-moss-b', T.deep, -MOSS_STRIP.xCenter));

  // 横梁（貫）与柱侧的极简暗金色奉纳铭文笔画细节（不加牌匾、不挂注连绳纸垂）
  root.add(buildDedicationInscriptions(T));

  const shimaki = mesh(shimakiGeometry(), T.lacquer, 'shimaki');
  shimaki.castShadow = true;
  shimaki.receiveShadow = true;
  root.add(shimaki);

  root.add(beam('nimaki', T.black, {
    halfX: P.nimaki.length / 2,
    halfZ: P.nimaki.depth / 2,
    thickness: P.nimaki.height,
    topY: P.nimaki.y1
  }));

  const kasagi = mesh(kasagiGeometry(), T.black, 'kasagi');
  kasagi.castShadow = true;
  kasagi.receiveShadow = true;
  root.add(kasagi);

  // 顶部笠木重度积灰与厚青苔覆盖层
  root.add(buildKasagiHeavyMoss(T, M, rand));

  root.add(gakuzuka(T));

  const nukiFace = P.nuki.depth / 2 + 0.006;
  for (const side of [1, -1]) {
    root.add(streakPlate(`nuki-streak-${side > 0 ? 'r' : 'l'}`, T.deep, {
      x: side * 0.92,
      y: (P.nuki.y0 + P.nuki.y1) / 2,
      z: nukiFace,
      width: 1.05,
      height: P.nuki.height * 0.42
    }));
  }

  // 在前座鸟居（toriiFront）前方的参道两侧对称布置一对 1:1 还原的日式朱涂春日木灯笼
  if (pair.id === 'front') {
    const yaw = pair.yaw ?? 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const zLocal = 0.86;
    for (const side of [-1, 1]) {
      const xLocal = side * 1.62;
      const wx = pair.x + xLocal * cos + zLocal * sin;
      const wz = pair.z - xLocal * sin + zLocal * cos;
      const groundY = terrainHeight(wx, wz);
      const yLocal = Math.max(groundY - baseY, -0.26);
      root.add(buildWoodenShrineLantern(
        `torii-lantern-${side < 0 ? 'left' : 'right'}`,
        T,
        M,
        xLocal,
        yLocal,
        zLocal,
        rand
      ));
    }
  }

  root.position.set(pair.x, baseY, pair.z);
  root.rotation.y = pair.yaw ?? 0;

  root.userData.samples = [
    { x: pair.x + P.post.x, y: baseY, z: pair.z },
    { x: pair.x - P.post.x, y: baseY, z: pair.z },
    { x: pair.x + P.kasagi.length / 2, y: baseY + P.kasagi.y1, z: pair.z },
    { x: pair.x - P.kasagi.length / 2, y: baseY + P.kasagi.y1, z: pair.z },
    { x: pair.x, y: baseY + P.nuki.y0, z: pair.z }
  ];

  let meshCount = 0;
  root.traverse((o) => { if (o.isMesh) meshCount++; });
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}
