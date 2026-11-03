/**
 * 朱红明神鸟居（PATH_SYSTEM.toriiFront / toriiRear）
 *
 * 两座同规格鸟居由同一个工厂产出：各自独立根 Group、独立 Mesh、独立材质实例
 * （makeToriiMaterials 各调一次 ⇒ 褪色 / 掉漆 / 苔痕的噪声种子不同，两座不会一模一样）。
 *
 * 局部坐标原点 = 两柱基中心，y = 柱基面（该 z 处的参道坡面 toriiBaseY(z)）。
 * 所有构件标高严格取 layout.TORII.parts，不在资产里另立一套尺寸。
 *
 * 两处与 TORII.parts 的有意偏差（已记入 docs/ASSET_INDEX.md）：
 * 1) isizue（台石 0.62×0.30×0.62，顶面 y=0）会被第 25 / 30 级石阶石板完全埋没
 *    ⇒ 按「根巻石套」建模：下部埋入石 + 上部露出石帽，柱脚嵌进石帽 0.16 m，
 *    柱基面仍在 y = 0（layout 契约与材质 baseY 都不动）。
 * 2) kasagi 的 0.16 m 反り按真实曲线扫掠 ⇒ 端部局部最高 ≈ 4.54 > totalHeight 4.38。
 *    净空盒只用于约束「其它」资产，没有任何资产高到 4.38，因此不影响校验。
 *
 * 笠木用 sweepProfileGeometry 沿 XY 平面样条扫掠梯形截面：曲线取在 XY 平面时
 * side = (0,0,-1)、up ≈ (0,1,0) ⇒ u 沿宽、v 沿厚，反り处截面自动跟随法线而不被压扁。
 * 扫掠 / slab 几何都不产 uv ⇒ 挂 map 之前必须 triplanarUv（按世界米铺贴图）。
 * 柱身是 CylinderGeometry（自带 uv 且环绕接缝连续）⇒ 只做整数倍 uv 缩放，
 * 绝不对圆柱侧壁做 triplanar（相邻面片投影轴切换会在柱面留下可见折线）。
 */
import * as THREE from 'three';
import { TORII, toriiBaseY } from '../layout.js';
import {
  group,
  mesh,
  rng,
  taperedCylinder,
  panelWithFrame,
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

const ROOT_LOWER = { half: 0.33, thickness: 0.32, topY: -0.02, bevel: 0.075 };
const ROOT_CAP = { half: 0.28, thickness: 0.18, topY: 0.16, bevel: 0.05 };
const POST_EMBED = 0.16;

const MOSS_STRIP = { halfX: 0.5, xCenter: 0.6, width: 1.0, height: 0.035, depth: 0.12 };

/** 整数倍缩放已有 uv：保持 CylinderGeometry 的环绕接缝连续，同时把贴图换算到世界米 */
function scaleUv(geo, su, sv) {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

/** 矩形 XZ 轮廓（slabGeometry 要求凸且按顺序环绕） */
function rectRing(halfX, halfZ) {
  return [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]];
}

/** 带棱边倒角的方形 XZ 轮廓（8 点，仍严格凸 ⇒ 质心扇形三角化不会翻面） */
function beveledSquareRing(half, bevel) {
  const c = Math.min(bevel, half * 0.4);
  const h = half;
  return [
    [-h + c, -h], [h - c, -h], [h, -h + c], [h, h - c],
    [h - c, h], [-h + c, h], [-h, h - c], [-h, -h + c]
  ];
}

/**
 * 水平梁：slabGeometry 顶面在 y = 0 ⇒ Mesh 的 y 就是梁顶标高。
 * triplanarUv 的 offset 取梁顶标高，使贴图按世界 Y 对齐（上下表面自然衔接）。
 */
function beam(name, material, { halfX, halfZ, thickness, topY, tile = BEAM_TILE }) {
  const geo = slabGeometry(rectRing(halfX, halfZ), thickness);
  triplanarUv(geo, tile, [0, topY, 0]);
  const m = mesh(geo, material, name);
  m.position.y = topY;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 笠木：沿 XY 平面样条扫掠梯形截面（顺时针 ⇒ 外法线正确；capEnds ⇒ 水密） */
function kasagiGeometry() {
  const half = P.kasagi.length / 2;
  const camber = P.kasagi.camber;
  const midY = P.kasagi.y1 - P.kasagi.height / 2;
  const steps = 6;
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

/**
 * 根巻石套（替代被石板埋没的 isizue）：下部埋入石 + 上部石帽。
 * 两块用同一 triplanar offset 基准 ⇒ 接缝处贴图连续。
 */
function rootStone(name, material, px, rand) {
  const g = group(name);
  const parts = [ROOT_LOWER, ROOT_CAP];
  for (let i = 0; i < parts.length; i++) {
    const spec = parts[i];
    const geo = slabGeometry(beveledSquareRing(spec.half, spec.bevel), spec.thickness);
    triplanarUv(geo, STONE_TILE, [px, spec.topY, 0]);
    const m = mesh(geo, material, `${name}-${i === 0 ? 'body' : 'cap'}`);
    m.position.set(px, spec.topY, 0);
    m.rotation.y = (i === 1 ? 1 : 0) * (rand() - 0.5) * 0.06;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/**
 * 掉漆露出木纹：贴在柱面上的薄板（独立 Mesh）。
 * 平板贴在圆柱面上时，板边会比板心更「陷」进去（弦 vs 弧）⇒ 外凸量必须
 * 覆盖矢高 (w/2)²/(2r)，否则就是穿模。
 */
function bareWoodPatches(post, material, rand) {
  const h = P.post.height;
  const count = 3;
  for (let i = 0; i < count; i++) {
    const u = 0.16 + (i + rand() * 0.6) / count;
    const yLocal = -h / 2 + u * h;
    const radius = P.post.rBottom + (P.post.rTop - P.post.rBottom) * u;
    const width = 0.09 + rand() * 0.10;
    const tall = 0.20 + rand() * 0.34;
    const proud = (width / 2) ** 2 / (2 * radius) + 0.004;
    const geo = new THREE.BoxGeometry(width, tall, 0.012);
    triplanarUv(geo, SMALL_TILE, [0, yLocal, 0]);
    const m = mesh(geo, material, `post-bare-${i}`);
    const azimuth = rand() * Math.PI * 2;
    m.position.set(
      Math.cos(azimuth) * (radius + proud),
      yLocal,
      Math.sin(azimuth) * (radius + proud)
    );
    m.rotation.y = Math.PI / 2 - azimuth;
    m.rotation.z = (rand() - 0.5) * 0.22;
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.noCast = true;
    m.userData.noOutline = true;
    post.add(m);
  }
}

/** 雨水冲刷 / 积尘薄痕：贴在梁前脸上的独立薄片（不描边，避免变成硬边贴纸） */
function streakPlate(name, material, { x, y, z, width, height }) {
  const geo = new THREE.BoxGeometry(width, height, 0.012);
  triplanarUv(geo, SMALL_TILE, [x, y, z]);
  const m = mesh(geo, material, name);
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = true;
  m.userData.noCast = true;
  m.userData.noOutline = true;
  return m;
}

/** 貫顶面凹槽处的积苔 / 积尘条（避开三根束的 X 区间，绝不与束相交） */
function nukiMossStrip(name, material, xCenter) {
  const geo = new THREE.BoxGeometry(MOSS_STRIP.width, MOSS_STRIP.height, MOSS_STRIP.depth);
  triplanarUv(geo, SMALL_TILE, [xCenter, P.nuki.y0 + MOSS_STRIP.height / 2, 0]);
  const m = mesh(geo, material, name);
  m.position.set(xCenter, P.nuki.y0 + MOSS_STRIP.height / 2, 0);
  m.castShadow = false;
  m.receiveShadow = true;
  m.userData.noCast = true;
  return m;
}

/**
 * 柱：上细下粗锥形 + 1.5° 内倾。
 * taperedCylinder 内部是 rotation.set(tiltX, ry, tiltZ) ⇒ 绕 Z 转 θ 把局部
 * (0, -h/2, 0) 映到 ((h/2)sinθ, -(h/2)cosθ, 0)。要让柱顶向参道中心内倾，
 * 右柱（px>0）取 tiltZ = +lean、左柱取 -lean，并把 Mesh 中心沿 -X 偏移
 * (h/2)sinθ ⇒ 柱脚正好落在 x = ±1.8、柱顶收到 ±1.695。
 */
function post(name, material, px, rand) {
  const h = P.post.height;
  const lean = P.post.leanDeg * DEG;
  const sign = Math.sign(px);
  const m = taperedCylinder(name, material, {
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
  bareWoodPatches(m, material.woodBare, rand);
  return m;
}

/**
 * 額束：只留框 + 黑底板，不写任何文字（参考图上的奉纳文字按「全程无文字」规格省略）。
 * 沿 +Z 挪到 0.11 ⇒ 后面正好贴住束的前脸（z = 0.07）、前面正好与島木前脸（z = 0.15）齐平，
 * 既支撑得住又完全不穿模。
 */
function gakuzuka(T) {
  const g = panelWithFrame('gakuzuka', { frame: T.lacquer, panel: T.black }, {
    width: P.gakuzuka.width,
    height: P.gakuzuka.height,
    frame: 0.06,
    depth: P.gakuzuka.depth,
    panelInset: 0.012,
    mullions: 0
  });
  const centerY = (P.gakuzuka.y0 + P.gakuzuka.y1) / 2;
  g.position.set(0, centerY, 0.11);
  g.traverse((o) => {
    if (!o.isMesh) return;
    triplanarUv(o.geometry, SMALL_TILE, [o.position.x, o.position.y, o.position.z]);
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

export function createTorii(M, options = {}) {
  const id = options.id ?? 'front';
  const pair = TORII.pair.find((t) => t.id === id) ?? TORII.pair[0];
  const baseY = toriiBaseY(pair.z);
  const seed = options.seed ?? (pair.id === 'front' ? 23 : 41);
  const T = M.makeToriiMaterials({ seed, baseY });
  const rand = rng(pair.step * 613 + 17);

  const root = group(pair.name);
  root.userData.assetName = pair.name;
  root.userData.toriiId = pair.id;

  for (const px of [P.post.x, -P.post.x]) {
    root.add(rootStone(`isizue-${px > 0 ? 'right' : 'left'}`, T.stoneBase, px, rand));
    root.add(post(`post-${px > 0 ? 'right' : 'left'}`, { woodBare: T.woodBare }, px, rand));
  }

  root.add(beam('nuki', T.blackFade, {
    halfX: P.nuki.length / 2, halfZ: P.nuki.depth / 2,
    thickness: P.nuki.height, topY: P.nuki.y1
  }));
  root.add(nukiMossStrip('nuki-moss-a', T.blackFade, MOSS_STRIP.xCenter));
  root.add(nukiMossStrip('nuki-moss-b', T.blackFade, -MOSS_STRIP.xCenter));

  for (const offset of P.tsuka.xOffsets) {
    const geo = new THREE.BoxGeometry(P.tsuka.width, P.tsuka.height, P.tsuka.depth);
    const centerY = P.tsuka.y1 - P.tsuka.height / 2;
    triplanarUv(geo, SMALL_TILE, [offset, centerY, 0]);
    const m = mesh(geo, T.lacquer, `tsuka-${offset}`);
    m.position.set(offset, centerY, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
  }

  root.add(beam('shimaki', T.lacquer, {
    halfX: P.shimaki.length / 2, halfZ: P.shimaki.depth / 2,
    thickness: P.shimaki.height, topY: P.shimaki.y1
  }));
  root.add(beam('nimaki', T.black, {
    halfX: P.nimaki.length / 2, halfZ: P.nimaki.depth / 2,
    thickness: P.nimaki.height, topY: P.nimaki.y1
  }));

  const kasagi = mesh(kasagiGeometry(), T.black, 'kasagi');
  kasagi.castShadow = true;
  kasagi.receiveShadow = true;
  root.add(kasagi);

  root.add(gakuzuka(T));

  const shimakiFace = P.shimaki.depth / 2 + 0.006;
  const nimakiFace = P.nimaki.depth / 2 + 0.006;
  for (const side of [1, -1]) {
    root.add(streakPlate(`shimaki-streak-${side > 0 ? 'r' : 'l'}`, T.blackFade, {
      x: side * 1.3, y: (P.shimaki.y0 + P.shimaki.y1) / 2, z: shimakiFace,
      width: 1.9, height: P.shimaki.height * 0.78
    }));
    root.add(streakPlate(`nimaki-streak-${side > 0 ? 'r' : 'l'}`, T.blackFade, {
      x: side * 1.35, y: (P.nimaki.y0 + P.nimaki.y1) / 2, z: nimakiFace,
      width: 1.7, height: P.nimaki.height * 0.72
    }));
  }

  root.position.set(pair.x, baseY, pair.z);

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

