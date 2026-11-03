// 榊（sakaki / さかき）：神社境内的神圣小叶常绿树，8 株（layout.TREES 中 species='sakaki'）。
// 一株 = 树干 3 段 + 根回し盛土 + 3 条板根 + 树皮剥落薄片 ×2 + 树脚青苔 ×2
//   + 主枝 7 条（每枝 2 段 + 1 侧枝，各自成 Group，供逐枝摆动）
//   + 叶片簇 16 个（7×2 枝梢簇 + 2 顶冠簇；每簇一个 InstancedMesh，叶片为独立薄片几何体）
import { TREES, terrainHeight } from '../layout.js';
import { group, rng, leafBladeGeometry } from '../primitives.js';
import {
  makeSpine, buildTrunk, buildBranches, buildCrownClusters, treeNeighbours, SPECIES_REACH
} from '../tree-kit.js';

export const SAKAKI_MODEL = { canopyRadius: 1.72, canopyBottom: 1.95, height: 5.5, trunkRadius: 0.155 };

const D = {
  prefix: 'sakaki',
  trunk: {
    points: [[0, 0, 0], [0.07, 1.5, -0.05], [-0.05, 2.6, 0.06], [0.03, 3.6, -0.02]],
    radii: [0.155, 0.125, 0.098, 0.072]
  },
  roots: { count: 3, azimuthBase: 1.2, fromY: 0.36, reach: 0.44, rFrom: 0.075, rTo: 0.032 },
  flare: { radius: 0.48, flatten: 0.34, wobble: 0.15, seed: 1103 },
  barkFlakes: { count: 2, uStart: 0.16, uStep: 0.2, thetaBase: 1.6, width: 0.12, height: 0.26 },
  mossPatches: { count: 2, thetaBase: -0.8, radius: 0.19 },
  branch: {
    count: 7,
    anchorU: [0.46, 0.56, 0.65, 0.74, 0.82, 0.91, 1.0],
    azimuthBase: 1.9,
    elevMin: 0.38,
    elevMax: 0.85,
    len1: 0.85,
    len2: 0.68,
    lenSide: 0.38,
    sideAzimuthDelta: 0.9,
    rRoot: 0.072,
    rMid: 0.045,
    rTip: 0.024,
    rSideRoot: 0.034,
    rSideTip: 0.019
  },
  clusters: {
    radius: 0.46,
    radiusJitter: [0.88, 1.25],
    leaves: [54, 72],
    crown: [
      { center: [0.06, 4.35, 0.02], radius: 0.78 },
      { center: [-0.08, 4.95, 0.05], radius: 0.62 }
    ],
    leafBiasY: 0.5
  },
  leafSizes: [0.145, 0.17, 0.195, 0.22],
  leafWidthRatio: 0.5,
  leafThickness: 0.0042,
  leafArch: 0.2,
  leafSteps: 8,
  sink: 0.07
};

const spine = makeSpine(D.trunk.points, D.trunk.radii);

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

function makeMaterials(M) {
  return {
    bark: M.barkSakaki,
    flareMat: M.barkFlare,
    flakeMat: M.barkFlake,
    mossMat: M.barkMoss,
    leafMats: [M.leafSheetSakaki, M.leafSheetSakakiDeep, M.leafSheetEvergreenDeep]
  };
}

export function createSakakiTree(M, options = {}) {
  const scale = options.scale ?? 1.0;
  const seed = options.seed ?? 1709;
  const rand = rng(seed);
  const root = group('sakakiTree');
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

  root.userData.samples = samples;
  root.userData.treeCount = index;
  return root;
}

function placeTree(root, x, z, scale, rotY) {
  root.position.set(x, terrainHeight(x, z) - D.sink * scale, z);
  root.rotation.y = rotY;
}

function treeRotationY(seed) {
  return (seed % 9) * 0.7;
}

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
