/**
 * 朱红明神鸟居（PATH_SYSTEM.toriiFront / toriiRear）
 *
 * 两座同规格鸟居由同一个工厂产出：各自独立根 Group、独立 Mesh、独立材质实例。
 * 1:1 对照参考图（ref/20261102-170814.jpg）校准并升级第二优先级细节：
 * - 笠木（kasagi）与眉木（nimaki）：黑漆反り弧形顶梁，两端微翘；
 * - 島木（shimaki）、貫（nuki）、額束（gakuzuka）、柱（post）：全套风化朱红漆（T.lacquer / T.post），
 *   带木纹磨损、微粗糙度不均匀高光与根部/榫缝青苔遮罩；
 * - 貫（下横梁）正面悬挂立体多股扭编日式注连绳（しめ縄 shimenawa）与 5 挂 Z 字折纸垂（紙垂 shide），
 *   纸垂与草穗带独立枢轴 Group（branchSway），随山林微风轻柔低速摆动；
 * - 柱身正面带竖向深色雨水冲刷墨痕与局部斑驳木纹，柱脚配低矮根巻与覆苔台石。
 */
import * as THREE from 'three';
import { TORII, toriiBaseY } from '../layout.js';
import {
  group,
  mesh,
  rng,
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

function postSurfaceDetails(postMesh, woodBareMat, darkStreakMat, rand) {
  const h = P.post.height;
  const count = 3;
  for (let i = 0; i < count; i++) {
    const u = 0.18 + (i + rand() * 0.55) / count;
    const yLocal = -h / 2 + u * h;
    const radius = P.post.rBottom + (P.post.rTop - P.post.rBottom) * u;
    const width = 0.065 + rand() * 0.06;
    const tall = 0.16 + rand() * 0.24;
    const proud = (width / 2) ** 2 / (2 * radius) + 0.004;
    const geo = new THREE.BoxGeometry(width, tall, 0.01);
    triplanarUv(geo, SMALL_TILE, [0, yLocal, 0]);
    const m = mesh(geo, woodBareMat, `post-bare-${i}`);
    const azimuth = rand() * Math.PI * 2;
    m.position.set(
      Math.cos(azimuth) * (radius + proud),
      yLocal,
      Math.sin(azimuth) * (radius + proud)
    );
    m.rotation.y = Math.PI / 2 - azimuth;
    m.rotation.z = (rand() - 0.5) * 0.18;
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.noCast = true;
    m.userData.noOutline = true;
    postMesh.add(m);
  }

  // 柱身正面竖向雨水冲刷墨痕细节（还原参考图立柱表面深色纵向水痕）
  const streakSegments = [
    { u: 0.45, w: 0.022, h: 0.48, dAz: 0.05 },
    { u: 0.3, w: 0.02, h: 0.36, dAz: -0.07 },
    { u: 0.56, w: 0.018, h: 0.24, dAz: -0.12 }
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
    // 柱与贯交接榫眼缝隙处的深山潮湿青苔垫
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
 * 中央額束（gakuzuka）：参考图中島木与貫之间仅有中央一根朱红立束，两侧留白通透
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

  // 上下端木榫箍边
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
 * 单挂日式折纸「紙垂（しで）」：
 * 原点设在注连绳下缘挂点处，由 4 折 Z 字雷纹纸片构成，挂有 branchSway 以随微风轻柔摆动。
 */
function buildSingleShide(name, shideMat, x, y, z, scale, rand) {
  const pivot = group(name);
  pivot.position.set(x, y, z);

  // 4 段 Z 字形阶梯折纸片（稻妻/雷纹造型）
  const folds = [
    { dx: 0.0, dy: -0.042, dz: 0.004, w: 0.052, h: 0.088, rz: 0.14, rx: 0.06 },
    { dx: 0.024, dy: -0.105, dz: 0.008, w: 0.058, h: 0.092, rz: -0.22, rx: -0.05 },
    { dx: -0.012, dy: -0.172, dz: 0.012, w: 0.064, h: 0.098, rz: 0.20, rx: 0.06 },
    { dx: 0.018, dy: -0.248, dz: 0.015, w: 0.072, h: 0.112, rz: -0.16, rx: -0.04 }
  ];

  folds.forEach((f, idx) => {
    const geo = new THREE.BoxGeometry(f.w * scale, f.h * scale, 0.006);
    triplanarUv(geo, SMALL_TILE, [x + f.dx, y + f.dy, z]);
    const flap = mesh(geo, shideMat, `${name}-flap-${idx}`);
    flap.position.set(f.dx * scale, f.dy * scale, f.dz * scale);
    flap.rotation.set(f.rx, (rand() - 0.5) * 0.08, f.rz);
    flap.castShadow = true;
    flap.receiveShadow = true;
    pivot.add(flap);
  });

  // 绑定微风低速摆动参数（由 tree-sway 统一驱动）
  pivot.userData.branchSway = {
    phase: rand() * Math.PI * 2,
    period: 3.1 + rand() * 1.2,
    amplitude: 0.032,
    anchor: new THREE.Vector3(0, 0, 0)
  };
  return pivot;
}

/**
 * 横梁（貫 nuki）处的日式注连绳（しめ縄）与纸垂（紙垂）装饰组件：
 * - 双股螺旋拧结的悬链线稻草绳（中间浑厚饱满，向两侧立柱收束并扎结）
 * - 3 处草绳束结与两端垂穗
 * - 5 挂随风轻摆的白色奉书纸纸垂
 */
function buildShimenawa(T, rand) {
  const g = group('shimenawa-group');
  const spanHalf = P.post.x - 0.12; // 1.68 m，两端紧箍在左右立柱内侧
  const baseY = P.nuki.y1 - 0.04;   // 2.78 m，沿贯（下横梁）正面上沿悬挂
  const baseZ = P.nuki.depth / 2 + 0.052;
  const sag = 0.13;
  const samples = 32;

  // 双股拧绳：沿悬链线互相螺旋缠绕，利用圆柱截面扫掠形成中段粗、两端细的注连绳本体
  for (let strand = 0; strand < 2; strand++) {
    const phase0 = strand * Math.PI;
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const x = -spanHalf + u * (spanHalf * 2);
      const tNorm = x / spanHalf; // [-1, 1]
      const catenaryY = baseY - sag * (1 - tNorm * tNorm);
      const envelope = Math.sin(u * Math.PI); // 中央最粗，两端收细
      const twistAngle = u * Math.PI * 14 + phase0;
      const twistR = 0.018 * (0.45 + 0.55 * envelope);
      pts.push(new THREE.Vector3(
        x,
        catenaryY + Math.sin(twistAngle) * twistR,
        baseZ + Math.cos(twistAngle) * twistR + 0.012 * envelope
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const tubeGeo = new THREE.TubeGeometry(curve, 36, 0.036, 8, false);
    // 将中段顶点沿法线适度外扩，呈现传统「大根注連」中腹饱满鼓起的立体造型
    const pos = tubeGeo.getAttribute('position');
    const nrm = tubeGeo.getAttribute('normal');
    for (let k = 0; k < pos.count; k++) {
      const vx = pos.getX(k);
      const swell = Math.max(0, 1 - (vx / spanHalf) ** 2);
      const extra = swell * 0.024;
      pos.setXYZ(
        k,
        vx + nrm.getX(k) * extra * 0.25,
        pos.getY(k) + nrm.getY(k) * extra,
        pos.getZ(k) + nrm.getZ(k) * extra
      );
    }
    tubeGeo.computeVertexNormals();
    triplanarUv(tubeGeo, SMALL_TILE, [0, baseY, baseZ]);
    const ropeMesh = mesh(tubeGeo, T.shimenawa, `shimenawa-strand-${strand}`);
    ropeMesh.castShadow = true;
    ropeMesh.receiveShadow = true;
    g.add(ropeMesh);
  }

  // 两端立柱捆扎绳箍与中央绳结
  for (const [tag, kx, rKnot] of [['left', -spanHalf + 0.06, 0.048], ['center', 0, 0.068], ['right', spanHalf - 0.06, 0.048]]) {
    const tNorm = kx / spanHalf;
    const ky = baseY - sag * (1 - tNorm * tNorm);
    const knot = taperedCylinder(`shimenawa-knot-${tag}`, T.shimenawa, {
      x: kx,
      y: ky,
      z: baseZ + 0.008,
      height: 0.095,
      rBottom: rKnot,
      rTop: rKnot * 0.94,
      segments: 12,
      tiltZ: Math.PI / 2
    });
    triplanarUv(knot.geometry, SMALL_TILE, [kx, ky, baseZ]);
    knot.castShadow = true;
    knot.receiveShadow = true;
    g.add(knot);
  }

  // 绳中段 3 束下垂草穗（の子 / わら房）
  const tasselPositions = [-0.86, 0.0, 0.86];
  tasselPositions.forEach((tx, idx) => {
    const tNorm = tx / spanHalf;
    const ty = baseY - sag * (1 - tNorm * tNorm) - 0.03;
    const tasselPivot = group(`shimenawa-tassel-${idx}`);
    tasselPivot.position.set(tx, ty, baseZ + 0.006);
    const tassel = taperedCylinder(`shimenawa-tassel-mesh-${idx}`, T.shimenawa, {
      x: 0,
      y: -0.085,
      z: 0,
      height: 0.17,
      rBottom: 0.026,
      rTop: 0.012,
      segments: 10
    });
    triplanarUv(tassel.geometry, SMALL_TILE, [tx, ty - 0.085, baseZ]);
    tassel.castShadow = true;
    tassel.receiveShadow = true;
    tasselPivot.add(tassel);
    tasselPivot.userData.branchSway = {
      phase: rand() * Math.PI * 2,
      period: 3.6 + rand() * 1.2,
      amplitude: 0.022,
      anchor: new THREE.Vector3(0, 0, 0)
    };
    g.add(tasselPivot);
  });

  // 5 挂神圣白纸垂（しで），沿注连绳下缘对称错落排布
  const shideOffsets = [
    { x: -1.18, scale: 0.88 },
    { x: -0.58, scale: 0.96 },
    { x: 0.0, scale: 1.06 },
    { x: 0.58, scale: 0.96 },
    { x: 1.18, scale: 0.88 }
  ];
  shideOffsets.forEach((item, idx) => {
    const tNorm = item.x / spanHalf;
    const sy = baseY - sag * (1 - tNorm * tNorm) - 0.038;
    const sz = baseZ + 0.024 + (1 - tNorm * tNorm) * 0.01;
    g.add(buildSingleShide(`shide-${idx}`, T.shide, item.x, sy, sz, item.scale, rand));
  });

  return g;
}

export function createTorii(M, options = {}) {
  const id = options.id ?? 'front';
  const pair = TORII.pair.find((t) => t.id === id) ?? TORII.pair[0];
  const baseY = toriiBaseY(pair.z);
  const seed = options.seed ?? (pair.id === 'front' ? 23 : 41);
  // 后座鸟居（rear）位于林荫更深处，明度微压（shade = 0.82），使前后双鸟居叠影层次分明
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

  // 横梁（貫）悬挂注连绳与随风摆动的纸垂装饰
  root.add(buildShimenawa(T, rand));

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
