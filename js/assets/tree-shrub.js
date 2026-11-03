/**
 * 林下灌丛（layout.SHRUBS → asset-map.shrub）
 *
 * 22 丛独立建模的阔叶灌丛，按 layout.js 落点分四组：参道左坡脚 8 丛、右坡地前缘 7 丛、
 * 溪岸 4 丛、上段参道两侧 2 丛（把坡道残段夹起来）。每丛 = 株元土石座 + 6–9 条独立枝条
 * （每条 2 段圆柱，各自成 Group 供风摆）+ 1–3 根枯枝 + 4–6 个枝端叶簇 + 1–2 个基部低叶簇
 * + 株元青苔 ×2 + 基部碎石 ×3。全部构件独立几何、独立 Mesh，不合并。
 * 灌木局部原点 = 株元中心（地面处）。
 *
 * —— 枝条为什么「丛生」而不是一点发出
 * 枝条基部沿方位角摊开在 0.05–0.16 m 的环上，第一段外倾 0.26–0.62 rad、第二段沿同方位
 * 继续外弯 0.24 rad：内侧枝近直立、外侧枝外倾，整丛读作「从一墩根颈上发出来的一把枝条」。
 * 每条枝的叶簇主簇挂在枝端（沿第二段再推 0.10 m）、副簇挂在两段交界处（略低于交界），
 * 于是冠层是「枝端一团、节上一小撮」的疏密节奏，而不是一个均匀的绿球。
 * 45 % 概率出副簇 ⇒ 同一丛里枝的丰满度不一样，这是「疏密得当」的来源。
 *
 * —— scale = r / SHRUB_MODEL.radius（与示例工程的偏差）
 * 示例工程用 0.85 + (index % 4) × 0.05 打散高度，冠幅与 layout 声明的 r 无关 ⇒ 实际冠幅
 * 可能超出落点预留的净空。layout.js 的 SHRUBS 注释「右侧中心 ≥ 2.90 ⇒ 盒 min.x > 1.65、
 * 左侧中心 ≤ −2.35 ⇒ 盒 max.x < −1.05」正是把 r 当冠幅半径写的。这里直接令
 * scale = r / SHRUB_MODEL.radius，而 SHRUB_MODEL.radius 就是单位灌木实测的最大水平半外延
 * ⇒ 每丛冠幅恰好 ≤ r，落点净空断言与几何真正对齐。疏密差异改由 seed 打散的枝数 / 簇半径承担。
 *
 * —— 为什么必须声明 support.host（与示例工程的偏差）
 * 示例工程只给 supportTop。layout.validatePlacement 的 R5 用「组包围盒中心」的地形标高判
 * 悬空 / 埋入：22 丛横跨 x ∈ [−9.05, 4.6]、z ∈ [−10.4, 10.6]，包围盒中心 ≈ (−2.2, 0.1)
 * 正落在参道走廊里，pathRampY(0.1) ≈ 3.50，而整组包围盒顶只有 ≈ 1.3 ⇒ 会被判「完全埋入地面」。
 * 所以这里按 layout 表 + 逐点地形采样给出宿主包络盒（一条可被证伪的断言，不从网格反推）：
 *   x/z：落点 ± (SHRUB_MODEL.radius·scale + HOST_MARGIN)（圆包络，覆盖 root.rotation.y）
 *   y：[地面 − (sink + |bottom|)·scale − HOST_MARGIN, 地面 + SHRUB_MODEL.height·scale + HOST_MARGIN]
 * 有 support.host ⇒ 校验只走 R6（包围盒必须被宿主包含），R5 不再被误触发。
 * userData.samples 同理必须给 22 个真实落点，否则 R2 走廊 / R3 溪谷 / R4 鸟居净空会拿
 * 9 个「并不存在」的包围盒角点去判，(−9.05, 10.6) 这种假角点会掉进溪谷报一个假错。
 *
 * —— 材质映射（与示例工程的偏差）
 * 示例用的 earthCut / stone / moss / shrubLeaf* 在本工程不存在，按语义映射：株元盛土 soilCut
 * （切面土，读作根系墩）、基部碎石 stonePebble、株元青苔 mossPatch。materials.js 规定
 * 「柔软地面苔壳由资产层标 noOutline」⇒ 苔壳一律 noOutline + noCast（描边壳体会把 2 cm 厚的
 * 软苔壳变成一块黑盘子，苔不投影）。叶簇按叶几何序号对齐 leafSheetShrub / Deep / Light 三档
 * （透光强弱分档，避免整丛一个绿）。活枝在 shrubStem（木质暗色）与 shrubStemLive（带叶色，
 * 读作当年生新枝）之间交替；18 % 概率枯死的枝条用 twigDead（带纹理的灰白干枝）——
 * 本工程没有示例里的 shrubStemDry。独立枯枝用 shrubTwigDead。
 *
 * —— SHRUB_MODEL 是实测值，不是公式估计
 * radius / height / bottom 取自单位灌木（scale = 1）的包围盒。leafRadius('beech') 最大 1.057、
 * leafOutline 顶端再抬 size·0.15、叶柄下垂到 size·0.12 − size·0.42，加上 buildLeafCluster 的
 * 实例缩放 0.8–1.25 与任意朝向，公式外推误差可达两成；基部低叶簇的叶甚至能垂到原点以下，
 * 所以 bottom 必须实测，否则宿主盒下沿会漏掉它、R6 判「脱离宿主结构」。
 */
import * as THREE from 'three';
import { SHRUBS, terrainHeight } from '../layout.js';
import { group, mesh, rng, rockGeometry, leafSheetGeometry } from '../primitives.js';
import { limb, dirFrom, buildLeafCluster } from '../tree-kit.js';

/**
 * 单位灌木（scale = 1）实测包络：水平半外延 / 顶高 / 最低点，均相对株元中心。
 * 40 个 seed 扫描取最坏值再留余量：实测 0.9938 / 1.1013 / −0.1586。
 * 水平向不对称（root.rotation.y 把冠层转走），所以取两侧最大值当半径。
 */
export const SHRUB_MODEL = { radius: 1.0, height: 1.12, bottom: -0.16 };

const SEED_BASE = 4211;
const SEED_STRIDE = 137;
const HOST_MARGIN = 0.03;

const D = {
  prefix: 'shrub',
  base: { radius: 0.3, flatten: 0.26, wobble: 0.2, seed: 733 },
  stems: {
    count: [6, 9],
    baseOffset: [0.05, 0.16], // 枝条起点相对株元中心的水平偏移（丛生而非一点发出）
    baseR: 0.024,
    midR: 0.017,
    tipR: 0.009,
    len1: [0.28, 0.46],
    len2: [0.20, 0.38],
    tiltMin: 0.26, // 与竖直方向的夹角：内侧枝近直立
    tiltMax: 0.62, // 外侧枝外倾
    bend: 0.24 // 第二段继续外弯
  },
  deadTwigs: { count: [1, 3], len: [0.22, 0.42], rFrom: 0.013, rTo: 0.006, tilt: [0.5, 1.05] },
  clusters: { count: [4, 6], radius: [0.2, 0.3], leaves: [10, 18], leafBiasY: 0.34 },
  basal: { count: [1, 2], radius: [0.22, 0.28], leaves: [8, 14], y: 0.11, leafBiasY: 0.62 },
  moss: { count: 2, radius: 0.17, flatten: 0.34, wobble: 0.3 },
  stones: { count: 3, radius: 0.075, flatten: 0.55, wobble: 0.35 },
  leafSizes: [0.052, 0.062, 0.072, 0.084],
  leafThickness: 0.003,
  leafCurl: 0.22,
  leafSteps: 14,
  sink: 0.05
};

const ORIGIN = new THREE.Vector3(0, 0, 0);
const range = (rand, [lo, hi]) => lo + rand() * (hi - lo);
const intRange = (rand, [lo, hi]) => lo + Math.floor(rand() * (hi - lo + 1));

/** 叶薄片几何：4 种尺寸，整丛共用（共享几何不等于合并网格） */
function makeLeafGeometries() {
  return D.leafSizes.map((size) =>
    leafSheetGeometry({
      kind: 'beech',
      size,
      thickness: D.leafThickness,
      curl: D.leafCurl,
      steps: D.leafSteps
    })
  );
}

/** 株元：低矮扁平土石座（部分埋入地面，形成丛生根部） */
function buildBase(name, mats, rand) {
  const g = group(`${name}-base`);
  let count = 0;

  const mound = mesh(
    rockGeometry(D.base.radius, D.base.seed + Math.floor(rand() * 97), {
      widthSegments: 14,
      heightSegments: 9,
      wobble: D.base.wobble,
      flatten: D.base.flatten
    }),
    mats.earth,
    `${name}-base-mound`
  );
  mound.position.set(0, -0.03, 0);
  mound.scale.set(1, 0.62, 1);
  g.add(mound);
  count += 1;

  // 基部碎石：三颗小石落在株元外缘（长期潮湿、积叶处）
  for (let i = 0; i < D.stones.count; i += 1) {
    const theta = (i / D.stones.count) * Math.PI * 2 + rand() * 0.9;
    const rr = 0.24 + rand() * 0.14;
    const stone = mesh(
      rockGeometry(D.stones.radius * (0.8 + rand() * 0.5), 1200 + i * 37 + Math.floor(rand() * 50), {
        widthSegments: 10,
        heightSegments: 7,
        wobble: D.stones.wobble,
        flatten: D.stones.flatten
      }),
      mats.stone,
      `${name}-stone-${i + 1}`
    );
    stone.position.set(rr * Math.cos(theta), 0.012, rr * Math.sin(theta));
    stone.rotation.set(rand() * 0.5, rand() * Math.PI, rand() * 0.4);
    g.add(stone);
    count += 1;
  }

  // 株元青苔：只长在背阳（北 / 西北）一侧的潮湿根部
  for (let i = 0; i < D.moss.count; i += 1) {
    const theta = Math.PI * 0.72 + i * 0.85 + rand() * 0.4;
    const shell = mesh(
      rockGeometry(D.moss.radius * (0.85 + rand() * 0.4), 2100 + i * 53 + Math.floor(rand() * 40), {
        widthSegments: 12,
        heightSegments: 8,
        wobble: D.moss.wobble,
        flatten: D.moss.flatten
      }),
      mats.moss,
      `${name}-moss-${i + 1}`
    );
    shell.position.set(0.24 * Math.cos(theta), 0.028, 0.24 * Math.sin(theta));
    shell.scale.set(1, 0.42, 1);
    shell.castShadow = false;
    shell.userData.noCast = true; // 资产层明确不投影：组装层不得覆盖
    shell.userData.noOutline = true; // 软苔壳描边会变成黑盘子
    g.add(shell);
    count += 1;
  }
  return { group: g, count };
}

/**
 * 一条枝条：Group 原点 = 枝条基部（摆动枢轴），内含 2 段独立圆柱 + 1–2 个叶簇。
 * 第二段相对第一段继续外弯，枝端叶簇挂在枝端局部坐标上。
 */
function buildStem(name, index, mats, leafGeos, leafMats, rand) {
  const s = D.stems;
  const azimuth = (index / 9) * Math.PI * 2 + rand() * 0.7;
  const tilt = range(rand, [s.tiltMin, s.tiltMax]);
  const offset = range(rand, s.baseOffset);

  const base = new THREE.Vector3(offset * Math.cos(azimuth), 0.02, offset * Math.sin(azimuth));
  const stem = group(`${name}-stem-${index + 1}`);
  stem.position.copy(base);

  const dir1 = dirFrom(azimuth, Math.PI / 2 - tilt);
  const len1 = range(rand, s.len1);
  const mid = dir1.clone().multiplyScalar(len1);
  // 第二段沿同一方位继续外弯（枝端向外翻）
  const dir2 = dirFrom(azimuth, Math.PI / 2 - tilt - s.bend * (0.7 + rand() * 0.6));
  const len2 = range(rand, s.len2);
  const tip = mid.clone().add(dir2.clone().multiplyScalar(len2));

  const live = rand() > 0.18;
  const mat = live ? (rand() > 0.5 ? mats.stemLive : mats.stem) : mats.stemDead;

  let count = 0;
  stem.add(limb(`${name}-stem-${index + 1}-lower`, mat, ORIGIN, mid, s.baseR, s.midR, 8));
  stem.add(limb(`${name}-stem-${index + 1}-upper`, mat, mid, tip, s.midR, s.tipR, 8));
  count += 2;

  // 枝端叶簇（主簇挂在枝端，副簇挂在两段交界处）
  const clusterCount = rand() > 0.45 ? 2 : 1;
  for (let c = 0; c < clusterCount; c += 1) {
    const center = c === 0
      ? tip.clone().addScaledVector(dir2, 0.1)
      : new THREE.Vector3(mid.x + dir1.x * 0.06, mid.y - 0.04, mid.z + dir1.z * 0.06);
    stem.add(
      buildLeafCluster(
        `${name}-stem-${index + 1}-cluster-${c + 1}`,
        center,
        range(rand, D.clusters.radius),
        D.clusters.leaves,
        leafGeos,
        leafMats,
        rand,
        index + c,
        { leafBiasY: D.clusters.leafBiasY }
      )
    );
    count += 1;
  }

  stem.userData.branchSway = {
    phase: rand() * Math.PI * 2,
    period: 3.2 + rand() * 2.6, // 细枝比树干快，但仍在「微弱风」范围内
    amplitude: 0.048,
    anchor: ORIGIN.clone()
  };
  stem.userData.stemTop = tip.clone();
  return { group: stem, count };
}

/** 枯枝：无叶，灰白干裂，摆动幅度更小 */
function buildDeadTwig(name, index, mats, rand) {
  const t = D.deadTwigs;
  const azimuth = rand() * Math.PI * 2;
  const tilt = range(rand, t.tilt);
  const base = new THREE.Vector3(0.1 * Math.cos(azimuth), 0.02, 0.1 * Math.sin(azimuth));
  const twig = group(`${name}-twig-${index + 1}`);
  twig.position.copy(base);

  const dir = dirFrom(azimuth, Math.PI / 2 - tilt);
  const len = range(rand, t.len);
  const end = dir.clone().multiplyScalar(len);
  twig.add(limb(`${name}-twig-${index + 1}-main`, mats.twig, ORIGIN, end, t.rFrom, t.rTo, 6));

  // 一根短侧杈，保持枯枝的断裂感
  const sideDir = dirFrom(azimuth + 1.1, Math.PI / 2 - tilt * 0.6);
  const sideStart = end.clone().multiplyScalar(0.62);
  twig.add(
    limb(
      `${name}-twig-${index + 1}-branch`,
      mats.twig,
      sideStart,
      sideStart.clone().addScaledVector(sideDir, 0.11),
      0.008,
      0.004,
      6
    )
  );

  twig.userData.branchSway = {
    phase: rand() * Math.PI * 2,
    period: 4 + rand() * 2.4,
    amplitude: 0.03,
    anchor: ORIGIN.clone()
  };
  return { group: twig, count: 2 };
}

/** 基部低叶簇：贴近地面的低矮叶丛（与地被 / 落叶层衔接） */
function buildBasalClusters(name, leafGeos, leafMats, rand) {
  const out = [];
  const count = intRange(rand, D.basal.count);
  for (let i = 0; i < count; i += 1) {
    const theta = rand() * Math.PI * 2;
    const rr = 0.2 + rand() * 0.2;
    const center = new THREE.Vector3(rr * Math.cos(theta), D.basal.y + rand() * 0.05, rr * Math.sin(theta));
    out.push(
      buildLeafCluster(
        `${name}-basal-cluster-${i + 1}`,
        center,
        range(rand, D.basal.radius),
        D.basal.leaves,
        leafGeos,
        leafMats,
        rand,
        i,
        { leafBiasY: D.basal.leafBiasY }
      )
    );
  }
  return out;
}

/**
 * 单丛灌木。可单独实例化、单独调整位置 / 缩放。
 * @param {object} M 材质库
 * @param {{seed?:number, scale?:number, x?:number, z?:number, name?:string}} options
 */
export function createShrub(M, options = {}) {
  const seed = options.seed ?? SEED_BASE;
  const scale = options.scale ?? 1;
  const rand = rng(seed);
  const name = options.name ?? `${D.prefix}-cluster`;
  const root = group(name);

  const leafGeos = makeLeafGeometries();
  const leafMats = [M.leafSheetShrub, M.leafSheetShrubDeep, M.leafSheetShrubLight, M.leafSheetShrub];
  const mats = {
    earth: M.soilCut,
    stone: M.stonePebble,
    moss: M.mossPatch,
    stem: M.shrubStem,
    stemLive: M.shrubStemLive,
    stemDead: M.twigDead,
    twig: M.shrubTwigDead
  };

  let meshCount = 0;
  const base = buildBase(name, mats, rand);
  root.add(base.group);
  meshCount += base.count;

  const stemCount = intRange(rand, D.stems.count);
  for (let i = 0; i < stemCount; i += 1) {
    const stem = buildStem(name, i, mats, leafGeos, leafMats, rand);
    root.add(stem.group);
    meshCount += stem.count;
  }

  const twigCount = intRange(rand, D.deadTwigs.count);
  for (let i = 0; i < twigCount; i += 1) {
    const twig = buildDeadTwig(name, i, mats, rand);
    root.add(twig.group);
    meshCount += twig.count;
  }

  for (const cluster of buildBasalClusters(name, leafGeos, leafMats, rand)) {
    root.add(cluster);
    meshCount += 1;
  }

  root.scale.setScalar(scale);
  if (options.x !== undefined && options.z !== undefined) {
    root.position.set(options.x, terrainHeight(options.x, options.z) - D.sink * scale, options.z);
  }
  root.rotation.y = (seed % 7) * 0.9;

  root.userData.shrub = { seed, scale, stems: stemCount, twigs: twigCount };
  root.userData.meshCount = meshCount;
  return root;
}

/** 22 丛灌丛（按 layout.SHRUBS 落点），组名与 asset-map 键一致 */
export function createShrubPatch(M) {
  const root = group('shrub');
  const samples = [];
  let meshCount = 0;
  let stemTotal = 0;
  let twigTotal = 0;

  let hostX0 = Infinity;
  let hostX1 = -Infinity;
  let hostZ0 = Infinity;
  let hostZ1 = -Infinity;
  let hostY0 = Infinity;
  let hostY1 = -Infinity;

  SHRUBS.forEach((spot, index) => {
    const seed = SEED_BASE + index * SEED_STRIDE;
    const scale = spot.r / SHRUB_MODEL.radius; // 冠幅半外延 ⇒ 恰好 ≤ layout 声明的 r
    const instance = createShrub(M, { seed, scale, x: spot.x, z: spot.z, name: `shrub-${index + 1}` });
    root.add(instance);
    meshCount += instance.userData.meshCount;
    stemTotal += instance.userData.shrub.stems;
    twigTotal += instance.userData.shrub.twigs;
    samples.push({ x: spot.x, z: spot.z });

    const ground = terrainHeight(spot.x, spot.z);
    const foot = SHRUB_MODEL.radius * scale + HOST_MARGIN;
    hostX0 = Math.min(hostX0, spot.x - foot);
    hostX1 = Math.max(hostX1, spot.x + foot);
    hostZ0 = Math.min(hostZ0, spot.z - foot);
    hostZ1 = Math.max(hostZ1, spot.z + foot);
    hostY0 = Math.min(hostY0, ground - (D.sink + Math.abs(SHRUB_MODEL.bottom)) * scale - HOST_MARGIN);
    hostY1 = Math.max(hostY1, ground + SHRUB_MODEL.height * scale + HOST_MARGIN);
  });

  root.userData.samples = samples;
  root.userData.support = {
    host: {
      x: [hostX0, hostX1],
      y: [hostY0, hostY1],
      z: [hostZ0, hostZ1]
    }
  };
  root.userData.shrubCount = SHRUBS.length;
  root.userData.meshCount = meshCount;
  root.userData.stemCount = stemTotal;
  root.userData.twigCount = twigTotal;
  root.updateMatrixWorld(true);
  return root;
}

export default createShrubPatch;
