// 山林阔叶高树（kaede / 鸟居后上方采光林冠）：9 株（layout.TREES 中 species='kaede'）。
import { TREES, terrainHeight } from '../layout.js';
import { group, rng, leafBladeGeometry } from '../primitives.js';
import {
  makeSpine, buildTrunk, buildBranches, buildCrownClusters, treeNeighbours, SPECIES_REACH, GOLDEN
} from '../tree-kit.js';

export const KAEDE_MODEL = { canopyRadius: 2.48, canopyBottom: 2.3, height: 6.95, trunkRadius: 0.235 };

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
    radius: 0.52,
    radiusJitter: [0.85, 1.25],
    leaves: [64, 86],
    crown: [
      { center: [0.1, 5.85, 0.02], radius: 0.95 },
      { center: [-0.08, 6.25, 0.04], radius: 0.78 }
    ],
    leafBiasY: 0.42
  },
  leafSizes: [0.145, 0.17, 0.195, 0.22],
  leafWidthRatio: 0.46,
  leafThickness: 0.0036,
  leafArch: 0.24,
  leafSteps: 8,
  sink: 0.09
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
    bark: M.barkKaede,
    flareMat: M.barkFlare,
    flakeMat: M.barkFlake,
    mossMat: M.barkMoss,
    leafMats: [M.leafSheetMaple, M.leafSheetMapleDeep, M.leafSheetMapleLight, M.leafSheetEvergreenLight]
  };
}

export function createKaedeTree(M, options = {}) {
  const scale = options.scale ?? 1.0;
  const seed = options.seed ?? 1207;
  const rand = rng(seed);
  const root = group('kaedeTree');
  const mats = options.materials || makeMaterials(M);
  const leafGeos = makeLeafGeometries();

  root.add(buildTrunk(D, spine, mats.bark, mats.flareMat, mats.flakeMat, mats.mossMat, rand));

  const rotY = treeRotationY(seed);
  const { branches, clusterIndex } = buildBranches(
    D, spine, mats.bark, mats.leafMats, leafGeos, rand,
    avoidFor(options.x, options.z, rotY)
  );
  for (const branch of branches) root.add(branch);
  for (const crown of buildCrownClusters(D, mats.leafMats, leafGeos, rand, clusterIndex)) root.add(crown);

  root.scale.setScalar(scale);
  root.userData.treeKind = 'kaede';
  root.userData.canopyRadius = KAEDE_MODEL.canopyRadius * scale;
  root.userData.canopyBottom = KAEDE_MODEL.canopyBottom * scale;
  root.userData.treeHeight = KAEDE_MODEL.height * scale;

  if (options.x !== undefined && options.z !== undefined) {
    placeTree(root, options.x, options.z, scale, rotY, rand);
  }
  return root;
}

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

  root.userData.samples = samples;
  root.userData.treeCount = index;
  return root;
}

function placeTree(root, x, z, scale, rotY, rand) {
  root.position.set(x, terrainHeight(x, z) - D.sink * scale, z);
  root.rotation.set(
    (rand() - 0.5) * 0.035,
    rotY,
    (rand() - 0.5) * 0.035
  );
}

function treeRotationY(seed) {
  const r = rng(seed * 41 + 19)();
  return ((seed * GOLDEN) + r * 1.4) % (Math.PI * 2);
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

export default createKaedeGrove;
