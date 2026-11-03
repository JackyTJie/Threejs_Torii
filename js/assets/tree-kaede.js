// 枫（kaede / かえで）：本场景唯一的秋色来源，9 株（layout.TREES 中 species='kaede'）。
// 一株 = 树干 3 段 + 根回し盛土 + 3 条板根 + 树皮剥落薄片 ×3 + 树脚青苔 ×2
//   + 主枝 7 条（每枝 2 段 + 1 侧枝，各自成 Group，供逐枝摆动）
//   + 叶片簇 16 个（7×2 枝梢簇 + 2 顶冠簇；每簇一个 InstancedMesh，叶片为独立薄片几何体）
// 全部构件独立 Mesh、独立材质槽，不合并；树体局部原点 = 树干基部（地面处）。骨架见 js/tree-kit.js。
//
// 【造型依据】枫 = 日本神社参道最常见的落叶阔叶树，剪影特征是「枝条近水平四散、冠面横向铺开」，
//   而不是樟那种向上收拢的卵圆冠。因此主枝仰角压在 0.20–0.62 rad（11°–36°），冠幅 2.20 而树高只有 6.85：
//   横宽 > 竖高，读起来才是枫。叶片用 leafSheetGeometry({kind:'maple'}) —— 5 裂掌状轮廓，
//   这是 primitives 里唯一真正为枫准备的叶形（leafRadius 另有 beech 与默认波浪圆，均不是枫）。
//
// 【与 exemplar 的差异】骨架与尺度参数沿用同作者已验证过的枫树形态（枝长/仰角/簇半径的
//   「压低仰角同时缩短枝长以保持外轮廓包络」这一平衡），但材质与配色按本场景重调：
//   1) 本仓库材质库没有 M.variant()，也没有 leafMapleWarm —— 只有成品单例。因此树干与主枝
//      共用 M.barkKaede（exemplar 是两份 applyWeathering 变体）。代价是树干与枝同色，
//      换来的是审计里不会出现 9 套同名同参材质；做旧、苔附已由 barkKaede/barkMoss 自带。
//   2) 叶色配比由 exemplar 的「Light×2 + Warm + Deep」（漫山金黄）改为
//      「Maple×2 + Deep + Light」：本场景是雨后阴天、整体低饱和，秋色只作点缀，
//      四分之三暖金会把整片林子读成秋天，破坏「深林秘境」的冷绿基调。
import { TREES, terrainHeight } from '../layout.js';
import { group, rng, leafSheetGeometry } from '../primitives.js';
import {
  makeSpine, buildTrunk, buildBranches, buildCrownClusters, treeNeighbours, SPECIES_REACH
} from '../tree-kit.js';

/**
 * 枫树尺度模型（scale = 1.0）。四个数值取 9 株随机种子的实测包围盒，不用公式估算：
 *   最大水平半宽 2.31（公式 1.02·cos0.20 + 0.86·cos0.38 + 簇 0.43 ≈ 2.15 偏小：枝梢簇半径走
 *   jitter[0]×0.9、顶冠簇另有 ±0.06 抖动，冠缘实际比串联公式更远），取 2.35 留余量；
 *   叶簇最低 2.38、树顶 6.82（含根回し盛土后整株包围盒 −0.19…6.82）。
 *   落点判据 |x| + 2.35·scale ≤ CANOPY_SAFE(15.7) 已在 layout 侧逐株核对（见 layout.TREES 注释）。
 */
export const KAEDE_MODEL = { canopyRadius: 2.35, canopyBottom: 2.38, height: 6.82, trunkRadius: 0.235 };

const D = {
  prefix: 'kaede',
  trunk: {
    points: [[0, 0, 0], [0.13, 1.80, -0.07], [-0.09, 3.15, 0.10], [0.05, 4.45, -0.03]],
    radii: [0.235, 0.185, 0.135, 0.088]
  },
  roots: { count: 3, azimuthBase: 0.4, fromY: 0.44, reach: 0.54, rFrom: 0.105, rTo: 0.042 },
  flare: { radius: 0.62, flatten: 0.34, wobble: 0.16, seed: 311 },
  barkFlakes: { count: 3, uStart: 0.12, uStep: 0.16, thetaBase: 1.1, width: 0.17, height: 0.36 },
  mossPatches: { count: 2, thetaBase: -1.9, radius: 0.24 },
  branch: {
    count: 7,
    anchorU: [0.55, 0.64, 0.72, 0.80, 0.87, 0.94, 1.0],
    azimuthBase: 0.35,
    // 仰角 0.20–0.62 rad：枫枝近水平。压低仰角会放大水平枝伸（cos 项），故枝长取 1.02/0.86，
    // 使外轮廓包络与更陡的形态持平 —— 本场景株距 2.3–3.5 m，冠幅真外扩会让邻株枝梢互穿。
    elevMin: 0.2,
    elevMax: 0.62,
    len1: 1.02,
    len2: 0.86,
    lenSide: 0.42,
    sideAzimuthDelta: -0.95,
    rRoot: 0.088,
    rMid: 0.055,
    rTip: 0.03,
    rSideRoot: 0.042,
    rSideTip: 0.024
  },
  clusters: {
    radius: 0.36,
    radiusJitter: [0.8, 1.2],
    // 每簇 34–48 片：密度是树冠体量的第一观感来源，比放大外轮廓更有效（不越底座判据）。
    leaves: [34, 48],
    crown: [
      { center: [0.1, 5.85, 0.02], radius: 0.72 },
      { center: [-0.08, 6.25, 0.04], radius: 0.58 }
    ],
    leafBiasY: 0.42
  },
  leafSizes: [0.095, 0.105, 0.115, 0.125],
  leafThickness: 0.0035,
  leafCurl: 0.3,
  leafSteps: 18,
  sink: 0.09
};

const spine = makeSpine(D.trunk.points, D.trunk.radii);

/** 枫叶薄片几何体：4 种尺寸，整株 / 整林共用（共享几何不等于合并网格） */
function makeLeafGeometries() {
  return D.leafSizes.map((size) =>
    leafSheetGeometry({
      kind: 'maple',
      size,
      thickness: D.leafThickness,
      curl: D.leafCurl,
      steps: D.leafSteps
    })
  );
}

/** 材质全部取库内成品单例（林组共用一份）；leafSheet 前缀 → 描边阶段自动跳过 */
function makeMaterials(M) {
  return {
    bark: M.barkKaede,
    flareMat: M.barkFlare,
    flakeMat: M.barkFlake,
    mossMat: M.barkMoss,
    leafMats: [M.leafSheetMaple, M.leafSheetMapleDeep, M.leafSheetMapleLight, M.leafSheetMaple]
  };
}

/**
 * 创建一株枫树（局部原点 = 树干基部）。
 * @param {object} M 材质库
 * @param {{scale?:number, seed?:number, x?:number, z?:number, materials?:object}} options
 * @returns {import('three').Group}
 */
export function createKaedeTree(M, options = {}) {
  const scale = options.scale ?? 1.0;
  const seed = options.seed ?? 1207;
  const rand = rng(seed);
  const root = group('kaedeTree');
  // 材质由林组共用一份：逐株造材质会得到 9 套同名同参材质，白占槽位还分不清归属。网格仍逐株独立。
  const mats = options.materials || makeMaterials(M);
  const leafGeos = makeLeafGeometries();

  root.add(buildTrunk(D, spine, mats.bark, mats.flareMat, mats.flakeMat, mats.mossMat, rand));

  const { branches, clusterIndex } = buildBranches(
    D, spine, mats.bark, mats.leafMats, leafGeos, rand,
    avoidFor(options.x, options.z, treeRotationY(seed))
  );
  for (const branch of branches) root.add(branch);
  for (const crown of buildCrownClusters(D, mats.leafMats, leafGeos, rand, clusterIndex)) root.add(crown);

  root.scale.setScalar(scale);
  root.userData.treeKind = 'kaede';
  root.userData.canopyRadius = KAEDE_MODEL.canopyRadius * scale;
  root.userData.canopyBottom = KAEDE_MODEL.canopyBottom * scale;
  root.userData.treeHeight = KAEDE_MODEL.height * scale;

  if (options.x !== undefined && options.z !== undefined) {
    placeTree(root, options.x, options.z, scale, treeRotationY(seed));
  }
  return root;
}

/**
 * 按 layout.TREES 生成全部枫树（每株独立构件树）。
 * @param {object} M 材质库
 * @returns {import('three').Group} 组名 treeKaede（asset-map 键名），各株已落在世界坐标
 */
export function createKaedeGrove(M) {
  const root = group('treeKaede');
  const samples = [];
  let index = 0;
  const mats = makeMaterials(M);

  for (const tree of TREES) {
    if (tree.species !== 'kaede') continue;
    const seed = 1207 + index * 131;
    const instance = createKaedeTree(M, { scale: tree.scale, seed, x: tree.x, z: tree.z, materials: mats });
    instance.name = `kaede-${tree.id}`;
    root.add(instance);
    samples.push({ x: tree.x, z: tree.z });
    index++;
  }

  // 落点样本：validatePlacement 用它逐点跑走廊 / 溪岸 / 鸟居净空判据（否则只测包围盒 8 角，
  // 对整林包围盒毫无意义 —— 盒心可能落在参道上而实际树都不在）。
  root.userData.samples = samples;
  root.userData.treeCount = index;
  return root;
}

/** 落位：树干基部坐在地形标高上（下沉 sink 形成根脚埋入感），并给一个稳定的朝向错开 */
function placeTree(root, x, z, scale, rotY) {
  root.position.set(x, terrainHeight(x, z) - D.sink * scale, z);
  root.rotation.y = rotY;
}

/** 株向（决定枝方位的世界朝向） */
function treeRotationY(seed) {
  return (seed % 9) * 0.7;
}

/**
 * 邻株枝展避让表：把邻株方向换算到本株局部方位角（本株已绕 Y 旋转）。
 * 邻株可能是樟 / 榊，枝展取 tree-kit.SPECIES_REACH，避免只按枫自己的枝展低估对方。
 */
function avoidFor(x, z, rotY) {
  if (x === undefined || z === undefined) return [];
  const ownReach = D.branch.len1 + D.branch.len2;
  return treeNeighbours(x, z).map((n) => ({
    angle: Math.atan2(n.dz, n.dx) - rotY,
    dist: n.dist,
    reach: (SPECIES_REACH[n.species] ?? ownReach) * n.scale
  }));
}

export default createKaedeGrove;
