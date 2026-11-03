// 樟（kusunoki / くすのき）：场景里的骨架级高大乔木，9 株（layout.TREES 中 species='kusunoki'）。
// 主干高耸挺拔（7.2 m 主干 + 树冠直达 10.6 m），使鸟居后方的樟树主干能直接从鸟居笠木上方穿出，
// 1:1 还原参考图中鸟居正上方高耸入云的深色树干剪影与双分叉树枝。
import { TREES, terrainHeight } from '../layout.js';
import { group, rng, leafBladeGeometry } from '../primitives.js';
import {
  makeSpine, buildTrunk, buildBranches, buildCrownClusters, treeNeighbours, SPECIES_REACH
} from '../tree-kit.js';

export const KUSUNOKI_MODEL = { canopyRadius: 2.8, canopyBottom: 3.8, height: 10.6, trunkRadius: 0.30 };

const D = {
  prefix: 'kusunoki',
  trunk: {
    points: [[0, 0, 0], [0.14, 2.4, -0.07], [-0.1, 4.4, 0.09], [0.06, 5.9, -0.04], [0, 7.2, 0.02]],
    radii: [0.3, 0.245, 0.195, 0.145, 0.105]
  },
  roots: { count: 4, azimuthBase: 0.55, fromY: 0.42, reach: 0.48, rFrom: 0.11, rTo: 0.045 },
  flare: { radius: 0.48, flatten: 0.28, wobble: 0.16, seed: 911 },
  barkFlakes: { count: 3, uStart: 0.1, uStep: 0.18, thetaBase: 0.8, width: 0.2, height: 0.42 },
  mossPatches: { count: 3, thetaBase: -1.4, radius: 0.28 },
  branch: {
    count: 8,
    anchorU: [0.54, 0.61, 0.68, 0.75, 0.81, 0.88, 0.94, 1.0],
    azimuthBase: 0.6,
    elevMin: 0.32,
    elevMax: 0.76,
    len1: 1.35,
    len2: 1.05,
    lenSide: 0.55,
    sideAzimuthDelta: -1.0,
    rRoot: 0.105,
    rMid: 0.068,
    rTip: 0.038,
    rSideRoot: 0.052,
    rSideTip: 0.028
  },
  clusters: {
    radius: 0.6,
    radiusJitter: [0.85, 1.25],
    leaves: [70, 94],
    crown: [
      { center: [0.15, 8.6, 0.05], radius: 1.18 },
      { center: [-0.15, 9.4, 0.08], radius: 0.98 },
      { center: [0.05, 10.0, -0.02], radius: 0.72 }
    ],
    leafBiasY: 0.5
  },
  leafSizes: [0.17, 0.2, 0.23, 0.26],
  leafWidthRatio: 0.48,
  leafThickness: 0.004,
  leafArch: 0.24,
  leafSteps: 8,
  sink: 0.1
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
    bark: M.barkKusunoki,
    flareMat: M.barkFlare,
    flakeMat: M.barkFlake,
    mossMat: M.barkMoss,
    leafMats: [M.leafSheetEvergreen, M.leafSheetEvergreenDeep, M.leafSheetEvergreenLight, M.leafSheetEvergreenDeep]
  };
}

export function createKusunokiTree(M, options = {}) {
  const scale = options.scale ?? 1.0;
  const seed = options.seed ?? 2311;
  const rand = rng(seed);
  const root = group('kusunokiTree');
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

export default createKusunokiGrove;
