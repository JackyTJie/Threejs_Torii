/**
 * 林下灌丛（layout.SHRUBS → asset-map.shrub）
 *
 * 22 丛独立建模的阔叶灌丛，按 layout.js 落点分四组：参道左坡脚 8 丛、右坡地前缘 8 丛、
 * 溪岸 4 丛、上段参道两侧 2 丛。每丛 = 株元土石座 + 6–9 条独立枝条（每条 2 段圆柱，
 * 各自成 Group 供风摆）+ 1–3 根枯枝 + 枝端叶簇 + 基部低叶簇 + 株元青苔 ×2 + 基部碎石 ×3。
 * 全部构件独立几何、独立 Mesh，不合并。灌木局部原点 = 株元中心（地面处）。
 */
import * as THREE from 'three';
import { SHRUBS, terrainHeight } from '../layout.js';
import { group, mesh, rng, rockGeometry, leafBladeGeometry } from '../primitives.js';
import { limb, dirFrom, buildLeafCluster } from '../tree-kit.js';

export const SHRUB_MODEL = { radius: 1.08, height: 1.24, bottom: -0.22 };

const SEED_BASE = 4211;
const SEED_STRIDE = 137;
const HOST_MARGIN = 0.06;

const D = {
  prefix: 'shrub',
  base: { radius: 0.3, flatten: 0.26, wobble: 0.2, seed: 733 },
  stems: {
    count: [7, 10],
    baseOffset: [0.05, 0.16],
    baseR: 0.024,
    midR: 0.017,
    tipR: 0.009,
    len1: [0.3, 0.48],
    len2: [0.22, 0.4],
    tiltMin: 0.26,
    tiltMax: 0.62,
    bend: 0.24
  },
  deadTwigs: { count: [1, 3], len: [0.22, 0.42], rFrom: 0.013, rTo: 0.006, tilt: [0.5, 1.05] },
  clusters: { count: [4, 6], radius: [0.26, 0.36], leaves: [28, 42], leafBiasY: 0.36 },
  basal: { count: [2, 3], radius: [0.24, 0.32], leaves: [22, 32], y: 0.11, leafBiasY: 0.62 },
  moss: { count: 2, radius: 0.17, flatten: 0.34, wobble: 0.3 },
  stones: { count: 3, radius: 0.075, flatten: 0.55, wobble: 0.35 },
  leafSizes: [0.11, 0.13, 0.15, 0.17],
  leafWidthRatio: 0.45,
  leafThickness: 0.0032,
  leafArch: 0.24,
  leafSteps: 8,
  sink: 0.05
};

const ORIGIN = new THREE.Vector3(0, 0, 0);
const range = (rand, [lo, hi]) => lo + rand() * (hi - lo);
const intRange = (rand, [lo, hi]) => lo + Math.floor(rand() * (hi - lo + 1));

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
    shell.userData.noCast = true;
    shell.userData.noOutline = true;
    g.add(shell);
    count += 1;
  }
  return { group: g, count };
}

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
  const dir2 = dirFrom(azimuth, Math.PI / 2 - tilt - s.bend * (0.7 + rand() * 0.6));
  const len2 = range(rand, s.len2);
  const tip = mid.clone().add(dir2.clone().multiplyScalar(len2));

  const live = rand() > 0.18;
  const mat = live ? (rand() > 0.5 ? mats.stemLive : mats.stem) : mats.stemDead;

  let count = 0;
  stem.add(limb(`${name}-stem-${index + 1}-lower`, mat, ORIGIN, mid, s.baseR, s.midR, 8));
  stem.add(limb(`${name}-stem-${index + 1}-upper`, mat, mid, tip, s.midR, s.tipR, 8));
  count += 2;

  const clusterCount = rand() > 0.35 ? 2 : 1;
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
    period: 3.2 + rand() * 2.6,
    amplitude: 0.048,
    anchor: ORIGIN.clone()
  };
  stem.userData.stemTop = tip.clone();
  return { group: stem, count };
}

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

export function createShrub(M, options = {}) {
  const seed = options.seed ?? SEED_BASE;
  const scale = options.scale ?? 1;
  const rand = rng(seed);
  const name = options.name ?? `${D.prefix}-cluster`;
  const root = group(name);

  const leafGeos = makeLeafGeometries();
  const leafMats = [M.leafSheetShrub, M.leafSheetShrubDeep, M.leafSheetShrubLight, M.leafSheetShrubDeep];
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
    const scale = spot.r / SHRUB_MODEL.radius;
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
