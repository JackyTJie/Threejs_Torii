// 樟（kusunoki / くすのき）：场景里的骨架级高大乔木，9 株（layout.TREES 中 species='kusunoki'）。
// 一株 = 树干 4 段 + 根回し盛土 + 4 条板根 + 树皮剥落薄片 ×3 + 树脚青苔 ×3
//   + 主枝 8 条（每枝 2 段 + 1 侧枝，各自成 Group，供逐枝摆动）
//   + 叶片簇 19 个（8×2 枝梢簇 + 3 顶冠簇；每簇一个 InstancedMesh，叶片为独立薄片几何体）
// 全部构件独立 Mesh、独立材质槽，不合并；树体局部原点 = 树干基部（地面处）。骨架见 js/tree-kit.js。
//
// 【造型依据】樟是日本神社境内最常见的巨木（「神社の大木」多半就是樟），剪影与枫正相反：
//   主干高而直、第一分枝点很高（本株 5.9 m 才到顶，分枝从 u=0.52 起），树冠是向上收拢的
//   卵圆形大团，而不是枫那种横向铺开的扁冠。因此主枝仰角取 0.30–0.72 rad（17°–41°），
//   冠幅 2.60 对树高 9.45 —— 竖高 > 横宽。樟也是常绿，叶色走 leafSheetEvergreen 三档，
//   不参与秋色；它是「深林秘境」冷绿基调的主要承担者，所以给了最高的叶量（每簇 40–56 片）。
//   樟的根盘最发达（4 条板根 + 半径 0.82 的根回し盛土），大树的重量感来自根脚而不是树干粗细。
//
// 【叶片几何体的选择】樟叶是椭圆状披针形（全缘、革质、有光泽），不是掌状也不是圆叶。
//   primitives.leafSheetGeometry 的 kind 只有 maple / beech / 默认波浪圆，leafRadius 里没有
//   椭圆档 —— 用 'broad' 会得到一张波浪圆盘，读起来像山毛榉。故改用 leafBladeGeometry：
//   长 X / 宽 Y / 拱 Z 的披针形薄片，长宽比 1:0.42 正是樟叶比例，arch 0.24 给革质叶的纵向内卷。
//   代价：leafBladeGeometry 是非索引三角片（无封闭壳体），asset-check 会把它列进「开口面片」，
//   这不是失败项；叶片簇本身 userData.noOutline，描边阶段整体跳过，不影响轮廓。
//
// 【与 exemplar 的差异】本仓库材质库没有 M.variant()，树干与主枝共用 M.barkKusunoki 单例
//   （详见 js/assets/tree-kaede.js 头部说明）。
import { TREES, terrainHeight } from '../layout.js';
import { group, rng, leafBladeGeometry } from '../primitives.js';
import {
  makeSpine, buildTrunk, buildBranches, buildCrownClusters, treeNeighbours, SPECIES_REACH
} from '../tree-kit.js';

/**
 * 樟树尺度模型（scale = 1.0）。四个数值取 9 株随机种子的实测包围盒，不用公式估算：
 *   最大水平半宽 2.62（公式 1.30·cos0.30 + 1.00·cos0.72 + 簇 0.55 + 叶半宽 ≈ 2.72 反而偏大：
 *   pickAzimuth 的避让会把枝推向切向、枝梢簇半径取 jitter[0]×0.9，冠缘实际比串联公式更收），取 2.65 留余量；
 *   叶簇最低 3.55、树顶 9.21（含根回し盛土后整株包围盒 −0.20…9.21）。
 *   落点判据 max(|x|,|z|) + 2.65·scale ≤ CANOPY_SAFE(15.7) 已在 layout 侧逐株核对（见 layout.TREES 注释）。
 */
export const KUSUNOKI_MODEL = { canopyRadius: 2.65, canopyBottom: 3.55, height: 9.21, trunkRadius: 0.30 };

const D = {
  prefix: 'kusunoki',
  trunk: {
    points: [[0, 0, 0], [0.16, 2.1, -0.09], [-0.12, 3.6, 0.12], [0.08, 4.9, -0.04], [0, 5.9, 0.03]],
    radii: [0.3, 0.245, 0.19, 0.135, 0.1]
  },
  // 樟根盘发达：4 条板根 + 大盛土，把「巨木」的重量感落在根脚
  roots: { count: 4, azimuthBase: 0.55, fromY: 0.55, reach: 0.72, rFrom: 0.13, rTo: 0.05 },
  flare: { radius: 0.82, flatten: 0.3, wobble: 0.18, seed: 911 },
  barkFlakes: { count: 3, uStart: 0.1, uStep: 0.18, thetaBase: 0.8, width: 0.2, height: 0.42 },
  mossPatches: { count: 3, thetaBase: -1.4, radius: 0.28 },
  branch: {
    count: 8,
    // 分枝点从 u=0.52（≈3.1 m）起，到梢顶均匀排布 —— 樟的下部是干净的直干
    anchorU: [0.52, 0.6, 0.67, 0.74, 0.8, 0.87, 0.94, 1.0],
    azimuthBase: 0.6,
    // 仰角 0.30–0.72 rad：樟枝向上收拢，与枫（0.20–0.62）形成明确的树种剪影差异
    elevMin: 0.3,
    elevMax: 0.72,
    len1: 1.3,
    len2: 1.0,
    lenSide: 0.52,
    sideAzimuthDelta: -1.0,
    rRoot: 0.1,
    rMid: 0.062,
    rTip: 0.034,
    rSideRoot: 0.048,
    rSideTip: 0.027
  },
  clusters: {
    radius: 0.46,
    radiusJitter: [0.8, 1.2],
    // 每簇 40–56 片：樟是冠面最大的树种，叶量不足会让最大的树看起来最空
    leaves: [40, 56],
    crown: [
      { center: [0.15, 7.3, 0.05], radius: 0.95 },
      { center: [-0.15, 8.1, 0.08], radius: 0.75 },
      { center: [0.05, 8.75, -0.02], radius: 0.5 }
    ],
    leafBiasY: 0.5
  },
  leafSizes: [0.1, 0.115, 0.13, 0.145],
  leafWidthRatio: 0.42,
  leafThickness: 0.004,
  leafArch: 0.24,
  leafSteps: 8,
  sink: 0.1
};

const spine = makeSpine(D.trunk.points, D.trunk.radii);

/** 樟叶披针形薄片几何体：4 种尺寸，整株 / 整林共用（共享几何不等于合并网格） */
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
    bark: M.barkKusunoki,
    flareMat: M.barkFlare,
    flakeMat: M.barkFlake,
    mossMat: M.barkMoss,
    leafMats: [M.leafSheetEvergreen, M.leafSheetEvergreenDeep, M.leafSheetEvergreenLight, M.leafSheetEvergreen]
  };
}

/**
 * 创建一株樟树（局部原点 = 树干基部）。
 * @param {object} M 材质库
 * @param {{scale?:number, seed?:number, x?:number, z?:number, materials?:object}} options
 * @returns {import('three').Group}
 */
export function createKusunokiTree(M, options = {}) {
  const scale = options.scale ?? 1.0;
  const seed = options.seed ?? 2311;
  const rand = rng(seed);
  const root = group('kusunokiTree');
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
  root.userData.treeKind = 'kusunoki';
  root.userData.canopyRadius = KUSUNOKI_MODEL.canopyRadius * scale;
  root.userData.canopyBottom = KUSUNOKI_MODEL.canopyBottom * scale;
  root.userData.treeHeight = KUSUNOKI_MODEL.height * scale;

  if (options.x !== undefined && options.z !== undefined) {
    placeTree(root, options.x, options.z, scale, treeRotationY(seed));
  }
  return root;
}

/**
 * 按 layout.TREES 生成全部樟树（每株独立构件树）。
 * @param {object} M 材质库
 * @returns {import('three').Group} 组名 treeKusunoki（asset-map 键名），各株已落在世界坐标
 */
export function createKusunokiGrove(M) {
  const root = group('treeKusunoki');
  const samples = [];
  let index = 0;
  const mats = makeMaterials(M);

  for (const tree of TREES) {
    if (tree.species !== 'kusunoki') continue;
    const seed = 2311 + index * 137;
    const instance = createKusunokiTree(M, { scale: tree.scale, seed, x: tree.x, z: tree.z, materials: mats });
    instance.name = `kusunoki-${tree.id}`;
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
 * 邻株可能是榊 / 枫，枝展取 tree-kit.SPECIES_REACH，避免只按樟自己的枝展低估对方。
 * 樟是场景里枝展最大的树种（2.30），因此它最容易把邻株「逼」到对侧 —— 邻株避让对樟最关键。
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

export default createKusunokiGrove;
