/**
 * 蕨类（layout.FERNS → asset-map.fern）
 *
 * 26 株独立建模的蕨，按 layout.FERNS 落点分三组：溪谷两岸 14 株（左右交替）、参道左坡脚
 * 阴面 8 株、右坡地阴坡 4 株。每株 = 株元根颈土墩 + 基部碎石 ×2 + 苔壳 ×1 + 枯叶柄基 ×2
 * + 拳卷叶（crozier）×1–2 + 5–8 条叶轴（frond）；每条叶轴 = 1 根连续弯管 + 8–12 对羽片
 * + 1 枚顶生羽片，羽片按沿叶轴的位置分三档 InstancedMesh 承载。全部构件独立几何、独立
 * Mesh，不合并。蕨株局部原点 = 根颈中心（地面处）。
 *
 * —— 为什么叶轴用「一条 CatmullRom 弯管」而不是两段圆柱折线
 * 蕨叶轴是一根从根颈抽出、先直立后外翻下垂的连续弧线，用折线会在拐点出现明显的折角，
 * 三渲二描边会把那个折角描成一条硬棱。这里用 CatmullRomCurve3 + TubeGeometry 得到真正
 * 连续的弧，同时 curve 本身还能给羽片定位（getPointAt / getTangentAt）——羽片因此能严格
 * 贴在叶轴上、并随叶轴弯曲一起倾斜，而不是各自水平摆放。primitives.tubeFromPoints 不返回
 * curve，所以本文件自建 curve（不是为了换 API，是为了拿到羽片定位用的插值器）。
 * 叶轴半径恒定 0.011 m：蕨叶轴粗细近乎均匀，「由粗到细」的读感是由羽片长度沿叶轴递减
 * 承担的（见 D.pinna.taper），把粗细也做渐变只会让梢部糊成一团。
 *
 * —— 羽片朝向：面内垂向 + 前倾角 φ（这是蕨读作蕨的关键）
 * 叶轴骨架落在叶轴 Group 的局部 YZ 平面（所有骨架点 x = 0），所以叶轴与全部羽片共面
 * ——蕨是平面叶，羽片不会绕叶轴翻成螺旋。记叶轴切向 T = (0, Ty, Tz)：
 *   面内垂向 L = X̂ × T = (0, −Tz, Ty)（同时垂直于叶平面法向 X̂ 与 T ⇒ 必在叶平面内）；
 *   前倾 = 绕 X̂ 转 −φ（X̂ 是叶平面法向，绕它转不会离开该平面）：
 *     (0, −Tz, Ty) → (0, −Tz·cosφ + Ty·sinφ, Tz·sinφ + Ty·cosφ)
 *     ⇒ T·L' = −Ty(Tz cosφ − Ty sinφ) + Tz(Tz sinφ + Ty cosφ) = sinφ·(Ty² + Tz²) = +sinφ
 *   即 φ > 0 时羽片确实指向叶尖一侧（羽毛状前倾）。若把符号写成 +φ，T·L' = −sinφ，
 *   羽片全部倒向叶基，整株读作「倒刺」而不是蕨。
 *   宽向 W = T − (T·L')L'（把 T 正交化到 L' 的垂面）⇒ 羽片的「宽」沿叶轴方向铺开；
 *   法向 N = L' × W 保证 makeBasis 行列式为 +1（内侧羽片用 −L'、−W 配同一个 N，同样
 *   右手，不产生镜像法线导致的反面明暗）。
 * 实例矩阵用 makeBasis(L'·k, W·k, N) 一次含住旋转 + 均匀缩放：k·标称长 = 目标长，所以
 * 羽片近端正好落在叶轴上（中心外推 want/2），不会浮空也不会插进叶轴。
 *
 * —— 三档羽片（几何 + 材质同时分档）
 * 基部羽片最长最深（leafSheetFernDeep）、中段标准（leafSheetFern）、梢部最短最亮
 * （leafSheetFernTip）。三档各一份共享几何、各一个 InstancedMesh，实例只带位姿 + 均匀
 * 缩放 ⇒ 26 株 × 3 档 = 78 个 InstancedMesh 承载全部羽片，而每片仍是独立几何实例、
 * 独立受光，没有把蕨「烘焙成一张面片」。
 *
 * —— 靠水侧叶轴缩短
 * 溪谷一侧的蕨如果叶轴径直伸向水面，叶尖会读成插进水里（蕨不长在水里）。所以逐叶轴做
 * 一次差分：沿该叶轴的外伸方向探 0.25 m，若那里离溪更近就把叶轴缩到 0.72 倍。这是纯
 * 几何避让，不改变落点（layout 校验用的是 samples 落点，不是叶轴末端）。
 *
 * —— 摆动幅度为什么定 0.05（不是乔木的 0.06）
 * tree-sway 的换算链：authored 0.05 → collectSwayTargets 按 ANIM.treeSway.branchAmplitude
 * /0.035 缩到 0.04 → 组装层再按 ANIM.treeSway.shrubScale(0.6) 缩到 0.024 rad。蕨高约
 * 0.8 m ⇒ 叶尖位移 ≈ 0.019 m，是「看得见但不会破坏静谧」的量级。写 0.06 会得到 0.0288
 * 撞上 cap 0.028 被削平，蕨就与乔木同幅摆动（失去层次），故必须 0.05。
 * 蕨叶材质刻意不带 flutterPeriod（materials.js 的静谧优先决定），所以蕨的动只能来自
 * 叶轴摆动，不能靠叶片振膜 shader —— 这也是把羽片留在叶轴 Group 内部的原因。
 *
 * —— 为什么 root.rotation.y = 0（与灌丛不同）
 * 株元土墩 / 碎石 / 苔壳都挂 map，uv 用 triplanarUv 以 [x, 0, z] 做世界米对齐；若整株
 * 再转一个角度，纹理偏移与网格朝向就不一致，同一块土在不同株上会错位。株与株的朝向差异
 * 改由逐叶轴方位角承担（蕨本来就是「一撮朝各个方向的叶」，比灌丛更需要各自转向）。
 * triplanarUv 的 y 偏移取 0：株元只有 16 cm 高，垂直向不做世界对齐，否则每株落在不同
 * 标高的纹理带上，苔/土色调会随海拔漂移（参道上下差 4.5 m）。
 *
 * —— FERN_MODEL 是实测值，不是公式估计
 * radius / height / bottom 取自单位蕨株（scale = 1）的包围盒：羽片实例可以伸到叶轴外侧
 * 一个羽片长、顶生羽片沿切向再伸一个羽片长、枯叶柄与苔壳又能垂到原点以下，公式外推误差
 * 很大。宿主包络盒（support.host）与 scale = 1 的落点净空都建立在这三个数上，必须实测。
 */
import * as THREE from 'three';
import { FERNS, terrainHeight, streamDistance } from '../layout.js';
import { group, mesh, rng, rockGeometry, leafBladeGeometry, triplanarUv } from '../primitives.js';
import { GOLDEN } from '../tree-kit.js';

/**
 * 单位蕨株（scale = 1）实测包络：水平半外延 / 顶高 / 最低点，均相对根颈中心。
 * 40 个 seed（seed = 6101 + s·149，scale = 1）扫描取最坏值：
 *   水平 max(max.x, max.z) = 0.6405 / min(min.x, min.z) = -0.5686 ⇒ radius 取 0.66
 *   顶 max.y = 0.8916 ⇒ height 取 0.92；底 min.y = -0.0412 ⇒ bottom 取 -0.05
 * 平均 34.8 网格 / 株（其中 20.5 个是羽片 InstancedMesh）。
 */
export const FERN_MODEL = { radius: 0.66, height: 0.92, bottom: -0.05 };

const SEED_BASE = 6101;
const SEED_STRIDE = 149;
const HOST_MARGIN = 0.03;

const D = {
  prefix: 'fern',
  /** 株元根颈土墩：蕨是从一墩根颈上抽出叶轴的，没有这墩土叶轴会读成「插在地上的铁丝」 */
  crown: { radius: 0.16, seed: 8801, soilTile: 0.55, sink: 0.02, squash: 0.6 },
  crownShape: { widthSegments: 12, heightSegments: 8, wobble: 0.24, flatten: 0.3 },
  gravel: { count: 2, radius: 0.055, seed: 1501, tile: 0.16, ring: [0.13, 0.22] },
  gravelShape: { widthSegments: 10, heightSegments: 7, wobble: 0.34, flatten: 0.6 },
  moss: { count: 1, radius: 0.11, seed: 2601, tile: 0.28, squash: 0.42 },
  mossShape: { widthSegments: 12, heightSegments: 8, wobble: 0.3, flatten: 0.34 },
  /** 枯叶柄基：上一年留下的短桩，读作「多年生」而不是刚插上去的 */
  deadPetiole: { count: 2, len: [0.14, 0.24], radius: 0.009, seed: 3301 },
  /** 拳卷叶：蕨特有的卷曲幼叶，是「这是蕨」最强的形态信号 */
  fiddlehead: { count: [1, 2], len: [0.16, 0.28], radius: 0.008, seed: 4102 },
  crownRing: { count: [5, 8], radius: [0.03, 0.1], pivotY: 0.035 },
  axis: {
    len: [0.62, 0.84],
    radius: 0.011,
    tubularSegments: 14,
    radialSegments: 6,
    /** 归一化骨架 [x, y, z]（×len）：叶轴骨架落在局部 YZ 平面 ⇒ x 恒为 0；
     *  y 沿叶轴高度、z 沿外伸量。末段趋平 ⇒ 叶尖外翻下垂 */
    profile: [[0, 0.02, 0], [0, 0.38, 0.1], [0, 0.7, 0.28], [0, 0.88, 0.48], [0, 0.9, 0.58]],
    /** 拳卷叶的归一化骨架：上去、外翻、再向内卷回下方 */
    crozier: [[0, 0.02, 0], [0, 0.42, 0.1], [0, 0.76, 0.26], [0, 0.98, 0.55], [0, 0.95, 0.82], [0, 0.7, 0.86], [0, 0.55, 0.7]],
    /** 枯叶柄的归一化骨架：短、外倾、梢部折断 */
    stub: [[0, 0.02, 0], [0, 0.45, 0.16], [0, 0.72, 0.4], [0, 0.78, 0.66]],
    leanFactor: 0.72,
    leanProbe: 0.25,
    swayAmplitude: 0.05,
    swayPeriodMin: 4.6,
    swayPeriodSpan: 2.8
  },
  pinna: {
    pairs: [8, 12],
    u0: 0.12,
    u1: 0.92,
    /** 三档标称长度（leafBladeGeometry 的 length）与分档上界（沿叶轴的 u） */
    tiers: [
      { nominal: 0.165, below: 0.45 },
      { nominal: 0.128, below: 0.78 },
      { nominal: 0.098, below: 1.01 }
    ],
    widthRatio: 0.42,
    thickness: 0.004,
    arch: 0.3,
    steps: 8,
    lenFactor: 0.24,
    taper: 0.6,
    jitter: [0.88, 1.12],
    lean: [0.12, 0.35],
    twist: 0.25
  },
  scale: [0.6, 1.18]
};

const ORIGIN = new THREE.Vector3(0, 0, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

const range = (rand, [lo, hi]) => lo + rand() * (hi - lo);
const intRange = (rand, [lo, hi]) => lo + Math.floor(rand() * (hi - lo + 1));

/** 自建弯管：需要 curve 本身给羽片定位，故不走 primitives.tubeFromPoints */
function bentTube(name, material, points, radius, tubularSegments, radialSegments) {
  const vs = points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(vs, false, 'centripetal', 0.5);
  const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  return { node: mesh(geo, material, name), curve };
}

/** 株元：根颈土墩 + 基部碎石 ×2 + 苔壳 ×1 */
function buildCrown(name, mats, rand, x, z) {
  const g = group(`${name}-crown`);
  let count = 0;

  const moundGeo = rockGeometry(D.crown.radius, D.crown.seed + Math.floor(rand() * 97), D.crownShape);
  triplanarUv(moundGeo, D.crown.soilTile, [x, 0, z]);
  const mound = mesh(moundGeo, mats.earth, `${name}-crown-mound`);
  mound.position.set(0, -D.crown.sink, 0);
  mound.scale.set(1, D.crown.squash, 1);
  g.add(mound);
  count += 1;

  for (let i = 0; i < D.gravel.count; i += 1) {
    const geo = rockGeometry(
      D.gravel.radius * (0.8 + rand() * 0.5),
      D.gravel.seed + i * 41 + Math.floor(rand() * 61),
      D.gravelShape
    );
    triplanarUv(geo, D.gravel.tile, [x, 0, z]);
    const node = mesh(geo, mats.gravel, `${name}-crown-gravel-${i + 1}`);
    const az = Math.PI * 0.35 + i * 2.1 + rand() * 0.5;
    const rr = range(rand, D.gravel.ring);
    node.position.set(rr * Math.sin(az), 0.008, rr * Math.cos(az));
    node.scale.set(1, 0.72, 1);
    g.add(node);
    count += 1;
  }

  for (let i = 0; i < D.moss.count; i += 1) {
    const geo = rockGeometry(
      D.moss.radius * (0.85 + rand() * 0.4),
      D.moss.seed + i * 53 + Math.floor(rand() * 47),
      D.mossShape
    );
    triplanarUv(geo, D.moss.tile, [x, 0, z]);
    const node = mesh(geo, mats.moss, `${name}-crown-moss-${i + 1}`);
    const az = Math.PI * 0.72 + i * 0.85 + rand() * 0.4;
    node.position.set(0.13 * Math.sin(az), 0.022, 0.13 * Math.cos(az));
    node.scale.set(1, D.moss.squash, 1);
    // 软苔壳描边会变成一块黑盘子；苔不投影（materials.js 的「柔软地面苔壳由资产层标 noOutline」）
    node.castShadow = false;
    node.userData.noCast = true;
    node.userData.noOutline = true;
    g.add(node);
    count += 1;
  }

  return { group: g, count };
}

/** 枯叶柄基 / 拳卷叶：沿方位角摊开的短弯管 */
function buildShortFronds(name, mats, rand) {
  const out = [];
  let count = 0;

  for (let i = 0; i < D.deadPetiole.count; i += 1) {
    const az = i * 2.4 + rand() * 1.1;
    const len = range(rand, D.deadPetiole.len);
    // 方位约定与叶轴一致：az 是世界 xz 里的方位，外伸 = (sin az, ·, cos az)，
    // 与叶轴 Group 的 rotation.y = az 同一套（骨架局部 +Z 外伸）
    const pts = D.axis.stub.map(([, py, pz]) => [Math.sin(az) * pz * len, py * len, Math.cos(az) * pz * len]);
    const { node } = bentTube(
      `${name}-petiole-${i + 1}`,
      mats.dry,
      pts,
      D.deadPetiole.radius,
      8,
      5
    );
    node.position.set(Math.sin(az) * 0.05, 0.01, Math.cos(az) * 0.05);
    out.push(node);
    count += 1;
  }

  const crozierCount = intRange(rand, D.fiddlehead.count);
  for (let i = 0; i < crozierCount; i += 1) {
    const az = (i + 0.5) * 2.6 + rand() * 1.3;
    const len = range(rand, D.fiddlehead.len);
    const pts = D.axis.crozier.map(([, py, pz]) => [Math.sin(az) * pz * len, py * len, Math.cos(az) * pz * len]);
    const { node } = bentTube(
      `${name}-crozier-${i + 1}`,
      mats.stem,
      pts,
      D.fiddlehead.radius,
      12,
      5
    );
    node.position.set(Math.sin(az) * 0.04, 0.012, Math.cos(az) * 0.04);
    node.userData.branchSway = {
      phase: rand() * Math.PI * 2,
      period: D.axis.swayPeriodMin + rand() * D.axis.swayPeriodSpan,
      amplitude: D.axis.swayAmplitude * 0.5,
      anchor: ORIGIN.clone()
    };
    out.push(node);
    count += 1;
  }

  return { nodes: out, count, croziers: crozierCount };
}

/** 羽片分档：沿叶轴位置 u 决定用哪一档几何 / 材质 */
function tierOf(u) {
  for (let t = 0; t < D.pinna.tiers.length; t += 1) {
    if (u < D.pinna.tiers[t].below) return t;
  }
  return D.pinna.tiers.length - 1;
}

/**
 * 一条叶轴（frond）：Group 原点 = 摆动枢轴（根颈处），骨架落在 Group 局部 YZ 平面。
 * 羽片留在本 Group 内 ⇒ 随叶轴一起摆。
 */
function buildFrond(name, index, mats, bladeGeos, bladeMats, rand, spot, azimuth) {
  const g = group(`${name}-frond-${index + 1}`);
  const ring = range(rand, D.crownRing.radius);
  const sx = Math.sin(azimuth);
  const sz = Math.cos(azimuth);
  g.position.set(sx * ring, D.crownRing.pivotY, sz * ring);
  g.rotation.y = azimuth;

  let len = range(rand, D.axis.len);
  // 靠水侧叶轴缩短：沿外伸方向探一下，离溪更近就不往水里伸
  const here = streamDistance(spot.x, spot.z);
  const ahead = streamDistance(spot.x + D.axis.leanProbe * sx, spot.z + D.axis.leanProbe * sz);
  const nearWater = ahead < here;
  if (nearWater) len *= D.axis.leanFactor;

  const pts = D.axis.profile.map(([, py, pz]) => new THREE.Vector3(0, py * len, pz * len));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const rachis = mesh(
    new THREE.TubeGeometry(curve, D.axis.tubularSegments, D.axis.radius, D.axis.radialSegments, false),
    rand() > 0.78 ? mats.dry : mats.stem,
    `${name}-frond-${index + 1}-rachis`
  );
  g.add(rachis);
  let count = 1;

  const pairs = intRange(rand, D.pinna.pairs);
  const tiers = [[], [], []];
  const L = new THREE.Vector3();
  const W = new THREE.Vector3();
  const N = new THREE.Vector3();

  for (let i = 0; i < pairs; i += 1) {
    const u = D.pinna.u0 + (D.pinna.u1 - D.pinna.u0) * (pairs === 1 ? 0 : i / (pairs - 1));
    const P = curve.getPointAt(u);
    const T = curve.getTangentAt(u).normalize();
    const tier = tierOf(u);
    const want = len * D.pinna.lenFactor * (1 - D.pinna.taper * u) * range(rand, D.pinna.jitter);
    const k = want / D.pinna.tiers[tier].nominal;

    L.crossVectors(X_AXIS, T).normalize();
    L.applyAxisAngle(X_AXIS, -range(rand, D.pinna.lean)); // 前倾：T·L = +sinφ（见文件头推导）
    W.copy(T).addScaledVector(L, -T.dot(L)).normalize();
    W.applyAxisAngle(L, (rand() - 0.5) * 2 * D.pinna.twist); // 面法向微扰：羽片不是整排同倾
    N.crossVectors(L, W).normalize();

    for (let s = -1; s <= 1; s += 2) {
      const m = new THREE.Matrix4().makeBasis(
        L.clone().multiplyScalar(k * s),
        W.clone().multiplyScalar(k * s),
        N.clone()
      );
      m.setPosition(P.clone().addScaledVector(L, (s * want) / 2));
      tiers[tier].push(m);
    }
  }

  // 顶生羽片：沿切向伸出。makeBasis(T, L, X̂) 行列式 = T·(L×X̂) = |T|² = +1（右手，无镜像）
  {
    const tip = curve.getPointAt(1);
    const T = curve.getTangentAt(1).normalize();
    L.crossVectors(X_AXIS, T).normalize();
    const tier = D.pinna.tiers.length - 1;
    const want = len * D.pinna.lenFactor * (1 - D.pinna.taper) * range(rand, D.pinna.jitter);
    const k = want / D.pinna.tiers[tier].nominal;
    const m = new THREE.Matrix4().makeBasis(
      T.clone().multiplyScalar(k),
      L.clone().multiplyScalar(k),
      X_AXIS.clone().multiplyScalar(k)
    );
    m.setPosition(tip.clone().addScaledVector(T, want / 2));
    tiers[tier].push(m);
  }

  for (let t = 0; t < tiers.length; t += 1) {
    const list = tiers[t];
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(bladeGeos[t], bladeMats[t], list.length);
    inst.name = `${name}-frond-${index + 1}-pinnae-${t + 1}`;
    inst.castShadow = true;
    inst.receiveShadow = false;
    inst.userData.noReceive = true;
    inst.userData.noOutline = true; // leafSheet* 前缀本就命中，显式写一次避免材质改名后失配
    for (let i = 0; i < list.length; i += 1) inst.setMatrixAt(i, list[i]);
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
    count += 1;
  }

  g.userData.branchSway = {
    phase: rand() * Math.PI * 2,
    period: D.axis.swayPeriodMin + rand() * D.axis.swayPeriodSpan,
    amplitude: D.axis.swayAmplitude,
    anchor: ORIGIN.clone()
  };
  g.userData.frond = { index: index + 1, azimuth, length: len, pairs, nearWater };
  return { group: g, count };
}

/**
 * 单株蕨。
 * @param {object} M 材质库
 * @param {{seed?:number, scale?:number, x?:number, z?:number, name?:string}} options
 */
export function createFern(M, options = {}) {
  const seed = Number.isInteger(options.seed) ? options.seed : SEED_BASE;
  const scale = Number.isFinite(options.scale) ? options.scale : 1;
  const name = options.name || `${D.prefix}-${seed}`;
  const rand = rng(seed);
  const root = group(name);

  const mats = {
    earth: M.soilCut,
    gravel: M.stonePebble,
    moss: M.mossDamp,
    stem: M.fernStem,
    dry: M.fernDry
  };

  const uvX = Number.isFinite(options.x) ? options.x : 0;
  const uvZ = Number.isFinite(options.z) ? options.z : 0;

  const bladeGeos = D.pinna.tiers.map((tier) =>
    leafBladeGeometry({
      length: tier.nominal,
      width: tier.nominal * D.pinna.widthRatio,
      thickness: D.pinna.thickness,
      arch: D.pinna.arch,
      steps: D.pinna.steps
    })
  );
  const bladeMats = [M.leafSheetFernDeep, M.leafSheetFern, M.leafSheetFernTip];

  let meshCount = 0;
  const crown = buildCrown(name, mats, rand, uvX, uvZ);
  root.add(crown.group);
  meshCount += crown.count;

  const shorts = buildShortFronds(name, mats, rand);
  for (const node of shorts.nodes) {
    root.add(node);
    meshCount += 1;
  }

  const frondCount = intRange(rand, D.crownRing.count);
  const spot = { x: uvX, z: uvZ };
  let nearWaterCount = 0;
  for (let i = 0; i < frondCount; i += 1) {
    const azimuth = i * GOLDEN + rand() * 0.42;
    const frond = buildFrond(name, i, mats, bladeGeos, bladeMats, rand, spot, azimuth);
    root.add(frond.group);
    meshCount += frond.count;
    if (frond.group.userData.frond.nearWater) nearWaterCount += 1;
  }

  root.scale.setScalar(scale);
  if (Number.isFinite(options.x) && Number.isFinite(options.z)) {
    root.position.set(options.x, terrainHeight(options.x, options.z) - D.crown.sink * scale, options.z);
  }
  root.rotation.y = 0; // 见文件头：保住 triplanarUv 的世界对齐

  root.userData.fern = {
    seed,
    scale,
    fronds: frondCount,
    croziers: shorts.croziers,
    frondsLeaned: nearWaterCount
  };
  root.userData.meshCount = meshCount;
  return root;
}

/** 26 株蕨（按 layout.FERNS 落点），组名与 asset-map 键一致 */
export function createFernPatch(M) {
  const root = group(D.prefix);
  const samples = [];
  let meshCount = 0;
  let frondTotal = 0;

  let hostX0 = Infinity;
  let hostX1 = -Infinity;
  let hostZ0 = Infinity;
  let hostZ1 = -Infinity;
  let hostY0 = Infinity;
  let hostY1 = -Infinity;

  FERNS.forEach((spot, index) => {
    const seed = SEED_BASE + index * SEED_STRIDE;
    const instance = createFern(M, {
      seed,
      scale: range(rng(seed + 7), D.scale),
      x: spot.x,
      z: spot.z,
      name: `${D.prefix}-${index + 1}`
    });
    root.add(instance);
    meshCount += instance.userData.meshCount;
    frondTotal += instance.userData.fern.fronds;
    samples.push({ x: spot.x, z: spot.z });

    const ground = terrainHeight(spot.x, spot.z);
    const foot = FERN_MODEL.radius * instance.userData.fern.scale + HOST_MARGIN;
    hostX0 = Math.min(hostX0, spot.x - foot);
    hostX1 = Math.max(hostX1, spot.x + foot);
    hostZ0 = Math.min(hostZ0, spot.z - foot);
    hostZ1 = Math.max(hostZ1, spot.z + foot);
    hostY0 = Math.min(hostY0, ground - (D.crown.sink + Math.abs(FERN_MODEL.bottom)) * instance.userData.fern.scale - HOST_MARGIN);
    hostY1 = Math.max(hostY1, ground + FERN_MODEL.height * instance.userData.fern.scale + HOST_MARGIN);
  });

  root.userData.samples = samples;
  root.userData.support = {
    host: {
      x: [hostX0, hostX1],
      y: [hostY0, hostY1],
      z: [hostZ0, hostZ1]
    }
  };
  root.userData.fernCount = FERNS.length;
  root.userData.meshCount = meshCount;
  root.userData.frondCount = frondTotal;
  root.updateMatrixWorld(true);
  return root;
}

export default createFernPatch;
