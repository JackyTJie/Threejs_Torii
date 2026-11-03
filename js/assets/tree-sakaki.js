// 榊（sakaki / さかき）：神社境内的神圣小叶常绿树，8 株（layout.TREES 中 species='sakaki'）。
// 一株 = 树干 3 段 + 根回し盛土 + 3 条板根 + 树皮剥落薄片 ×2 + 树脚青苔 ×2
//   + 主枝 7 条（每枝 2 段 + 1 侧枝，各自成 Group，供逐枝摆动）
//   + 叶片簇 16 个（7×2 枝梢簇 + 2 顶冠簇；每簇一个 InstancedMesh，叶片为独立薄片几何体）
// 全部构件独立 Mesh、独立材质槽，不合并；树体局部原点 = 树干基部（地面处）。骨架见 js/tree-kit.js。
//
// 【造型依据】榊是神社的「玉串」之树（さかき＝境木，插在土里划界的神木），也是境内灌木带上限
//   最低的那一档：它既不是樟那样的巨木，也不是枫那样铺开秋色的高叶树，而是 4–6 m 的一丛直立小乔木。
//   因此本株的骨架刻意做小：树干只到 3.60 m、半径 0.155（樟 0.30 / 枫 0.235），分枝从 u=0.50
//   （1.8 m）起，仰角 0.45–0.90 rad（26°–52°）—— 樟 0.30–0.72、枫 0.20–0.62，榊最直立，
//   读起来是「往上窜」而不是「往外摊」。冠幅 1.60 对树高 5.45，是三树种里最窄最高的比例，
//   正好用来填樟与枫之间的中景高度带，让林冠出现三层而不是两层。
//   榊叶小而厚、正面发亮（革质、全缘、3–7 cm 椭圆），所以叶色走 leafSheetSakaki 两档
//   （库内 flutter 周期 3.7 / 4.3，比樟 3.1/3.5 更慢一点，小叶摆起来更沉），叶量 30–44 片/簇，
//   是三树种里最省的 —— 小冠不需要大叶量，硬塞只会糊成一团绿。
//
// 【叶片几何体的选择】与樟同理：榊叶是椭圆形全缘革质叶，primitives.leafSheetGeometry 的 kind
//   只有 maple / beech / 默认波浪圆，leafRadius 没有椭圆档。故用 leafBladeGeometry，
//   长宽比 1:0.46（比樟 1:0.42 略宽，榊叶更卵圆）、arch 0.20（比樟 0.24 平，叶更小所以内卷更少）。
//   代价同樟：非索引三角片会被 asset-check 列进「开口面片」，不是失败项；叶簇 userData.noOutline，
//   描边阶段整体跳过。
//
// 【与 exemplar 的差异】本仓库材质库没有 M.variant()，树干与主枝共用 M.barkSakaki 单例
//   （详见 js/assets/tree-kaede.js 头部说明）。
import { TREES, terrainHeight } from '../layout.js';
import { group, rng, leafBladeGeometry } from '../primitives.js';
import {
  makeSpine, buildTrunk, buildBranches, buildCrownClusters, treeNeighbours, SPECIES_REACH
} from '../tree-kit.js';

/**
 * 榊尺度模型（scale = 1.0）。四个数值取 8 株随机种子的实测包围盒（与樟 / 枫同一口径）：
 *   最大水平半宽 1.58（公式 0.80·cos0.45 + 0.62·cos0.63 + 簇 0.41 + 叶半宽 ≈ 1.62 略偏大，
 *   因为枝梢簇半径取 jitter[0]×0.9 且 pickAzimuth 的避让会把枝推向切向），取 1.60 留余量；
 *   叶簇最低 2.04、树顶 5.37（含根回し盛土后整株包围盒 −0.15…5.37）。
 *   落点判据 max(|x|,|z|) + 1.60·scale ≤ CANOPY_SAFE(15.7) 已在 layout 侧逐株核对（实测最远 13.81）。
 */
export const SAKAKI_MODEL = { canopyRadius: 1.6, canopyBottom: 2.04, height: 5.37, trunkRadius: 0.155 };

const D = {
  prefix: 'sakaki',
  trunk: {
    points: [[0, 0, 0], [0.07, 1.5, -0.05], [-0.05, 2.6, 0.06], [0.03, 3.6, -0.02]],
    radii: [0.155, 0.125, 0.098, 0.072]
  },
  // 榊是中小乔木，根盘浅：3 条板根 + 半径 0.48 的小盛土（樟 4 条 / 0.82），根脚轻才不像巨木
  roots: { count: 3, azimuthBase: 1.2, fromY: 0.36, reach: 0.44, rFrom: 0.075, rTo: 0.032 },
  flare: { radius: 0.48, flatten: 0.34, wobble: 0.15, seed: 1103 },
  barkFlakes: { count: 2, uStart: 0.16, uStep: 0.2, thetaBase: 1.6, width: 0.12, height: 0.26 },
  mossPatches: { count: 2, thetaBase: -0.8, radius: 0.19 },
  branch: {
    count: 7,
    // 分枝点从 u=0.50（≈1.8 m）起：榊的下部同样干净，但只有 1.8 m 而不是樟的 3.1 m
    anchorU: [0.5, 0.59, 0.67, 0.75, 0.83, 0.92, 1.0],
    azimuthBase: 1.9,
    // 仰角 0.45–0.90 rad：三树种里最直立的一档，枝梢几乎朝上收拢成窄冠
    elevMin: 0.45,
    elevMax: 0.9,
    len1: 0.8,
    len2: 0.62,
    lenSide: 0.34,
    sideAzimuthDelta: 0.9,
    rRoot: 0.072,
    rMid: 0.045,
    rTip: 0.024,
    rSideRoot: 0.034,
    rSideTip: 0.019
  },
  clusters: {
    radius: 0.34,
    radiusJitter: [0.85, 1.2],
    // 每簇 30–44 片：小冠配小叶量，叶多即糊
    leaves: [30, 44],
    crown: [
      { center: [0.06, 4.35, 0.02], radius: 0.62 },
      { center: [-0.08, 4.95, 0.05], radius: 0.46 }
    ],
    leafBiasY: 0.5
  },
  leafSizes: [0.085, 0.1, 0.115, 0.13],
  leafWidthRatio: 0.46,
  leafThickness: 0.0042,
  leafArch: 0.2,
  leafSteps: 8,
  sink: 0.07
};

const spine = makeSpine(D.trunk.points, D.trunk.radii);

/** 榊叶椭圆薄片几何体：4 种尺寸，整株 / 整林共用（共享几何不等于合并网格） */
function makeLeafGeometries() {
  return D.leafSizes.map((size) =>
    leafBladeGeometry({
      length: size,
      width: size * D.leafWidthRatio,
      thickness: D.leafThickness,
      arch: D.leafArch,
      steps: D.leafSteps
    })
  );
}

/** 材质全部取库内成品单例（林组共用一份）；leafSheet 前缀 → 描边阶段自动跳过 */
function makeMaterials(M) {
  return {
    bark: M.barkSakaki,
    flareMat: M.barkFlare,
    flakeMat: M.barkFlake,
    mossMat: M.barkMoss,
    leafMats: [M.leafSheetSakaki, M.leafSheetSakakiDeep, M.leafSheetSakaki]
  };
}

/**
 * 创建一株榊（局部原点 = 树干基部）。
 * @param {object} M 材质库
 * @param {{scale?:number, seed?:number, x?:number, z?:number, materials?:object}} options
 * @returns {import('three').Group}
 */
export function createSakakiTree(M, options = {}) {
  const scale = options.scale ?? 1.0;
  const seed = options.seed ?? 1709;
  const rand = rng(seed);
  const root = group('sakakiTree');
  // 材质由林组共用一份：逐株造材质会得到 8 套同名同参材质，白占槽位还分不清归属。网格仍逐株独立。
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
  root.userData.treeKind = 'sakaki';
  root.userData.canopyRadius = SAKAKI_MODEL.canopyRadius * scale;
  root.userData.canopyBottom = SAKAKI_MODEL.canopyBottom * scale;
  root.userData.treeHeight = SAKAKI_MODEL.height * scale;

  if (options.x !== undefined && options.z !== undefined) {
    placeTree(root, options.x, options.z, scale, treeRotationY(seed));
  }
  return root;
}

/**
 * 按 layout.TREES 生成全部榊（每株独立构件树）。
 * @param {object} M 材质库
 * @returns {import('three').Group} 组名 treeSakaki（asset-map 键名），各株已落在世界坐标
 */
export function createSakakiGrove(M) {
  const root = group('treeSakaki');
  const samples = [];
  let index = 0;
  const mats = makeMaterials(M);

  for (const tree of TREES) {
    if (tree.species !== 'sakaki') continue;
    const seed = 1709 + index * 149;
    const instance = createSakakiTree(M, { scale: tree.scale, seed, x: tree.x, z: tree.z, materials: mats });
    instance.name = `sakaki-${tree.id}`;
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
 * 榊的落点全在樟与枫的缝隙里，邻株多半比它高、比它枝展大 —— 枝展取 tree-kit.SPECIES_REACH，
 * 若只按榊自己的 1.42 估算，会把大树的枝当成不存在，两株的冠会直接互穿。
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

export default createSakakiGrove;
