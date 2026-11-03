// 树类共用构建器（樟 / 榊 / 枫 共用骨架，不是资产本体，不出现在 asset-map）
// 约定：树体局部原点 = 树干基部；所有构件独立 Mesh；叶片簇 = Group + InstancedMesh（独立薄片几何体）。
import * as THREE from 'three';
import { TREES } from './layout.js';
import { group, mesh, rockGeometry } from './primitives.js';

const UP = new THREE.Vector3(0, 1, 0);
/** 叶片几何体的基准法线：leafSheetGeometry / leafBladeGeometry 均位于 XY 平面、法线 +Z */
export const LEAF_NORMAL = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3(0, 0, 0);
/** 黄金角：主枝方位错开，保证整株树枝在 360° 全方位自然环绕散开，绝不偏向同一侧 */
export const GOLDEN = 2.399963229728653;

export const SPECIES_REACH = { kusunoki: 2.30, sakaki: 1.42, kaede: 1.88 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** 折线（树干）插值器：u∈[0,1] 沿整条折线取点 / 取半径 */
export function makeSpine(points, radii) {
  const segs = points.length - 1;
  const at = (u) => {
    const s = clamp(u, 0, 1) * segs;
    const i = Math.min(segs - 1, Math.floor(s));
    const f = s - i;
    const a = points[i];
    const b = points[i + 1];
    return new THREE.Vector3(lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f));
  };
  const radius = (u) => {
    const s = clamp(u, 0, 1) * segs;
    const i = Math.min(segs - 1, Math.floor(s));
    return lerp(radii[i], radii[i + 1], s - i);
  };
  return { at, radius };
}

export function limb(name, material, from, to, rFrom, rTo, segments = 12) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const body = mesh(new THREE.CylinderGeometry(rTo, rFrom, len, segments, 1, false), material, name);
  body.position.copy(from).add(to).multiplyScalar(0.5);
  body.quaternion.setFromUnitVectors(UP, dir.normalize());
  return body;
}

export function dirFrom(theta, elev) {
  const c = Math.cos(elev);
  return new THREE.Vector3(c * Math.cos(theta), Math.sin(elev), c * Math.sin(theta));
}

export function buildTrunk(cfg, spine, barkMat, flareMat, flakeMat, mossMat, rand) {
  const p = cfg.prefix;
  const g = group(`${p}-trunk`);
  const pts = cfg.trunk.points;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = new THREE.Vector3(pts[i][0], pts[i][1], pts[i][2]);
    const b = new THREE.Vector3(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
    g.add(limb(`${p}-trunk-seg-${i + 1}`, barkMat, a, b, cfg.trunk.radii[i], cfg.trunk.radii[i + 1], 16));
  }

  const flare = mesh(
    rockGeometry(cfg.flare.radius, cfg.flare.seed, {
      widthSegments: 16,
      heightSegments: 10,
      wobble: cfg.flare.wobble,
      flatten: cfg.flare.flatten
    }),
    flareMat,
    `${p}-root-flare`
  );
  flare.position.set(0, -0.05, 0);
  g.add(flare);

  for (let i = 0; i < cfg.roots.count; i++) {
    const theta = cfg.roots.azimuthBase + i * ((Math.PI * 2) / cfg.roots.count) + (rand() - 0.5) * 0.3;
    const from = new THREE.Vector3(0, cfg.roots.fromY, 0);
    const to = new THREE.Vector3(Math.cos(theta) * cfg.roots.reach, -0.04, Math.sin(theta) * cfg.roots.reach);
    g.add(limb(`${p}-root-${i + 1}`, barkMat, from, to, cfg.roots.rFrom, cfg.roots.rTo, 10));
  }

  for (let i = 0; i < cfg.barkFlakes.count; i++) {
    const u = cfg.barkFlakes.uStart + i * cfg.barkFlakes.uStep;
    const theta = cfg.barkFlakes.thetaBase + i * 2.1 + (rand() - 0.5) * 0.4;
    const c = spine.at(u);
    const r = spine.radius(u) + 0.004;
    const plate = mesh(
      new THREE.BoxGeometry(cfg.barkFlakes.width, cfg.barkFlakes.height, 0.012),
      flakeMat,
      `${p}-bark-flake-${i + 1}`
    );
    plate.position.set(c.x + Math.cos(theta) * r, c.y, c.z + Math.sin(theta) * r);
    plate.rotation.y = Math.PI / 2 - theta;
    plate.rotation.z = (rand() - 0.5) * 0.25;
    plate.castShadow = false;
    plate.userData.noCast = true;
    g.add(plate);
  }

  for (let i = 0; i < cfg.mossPatches.count; i++) {
    const theta = cfg.mossPatches.thetaBase + i * 1.15 + (rand() - 0.5) * 0.3;
    const patch = mesh(
      new THREE.SphereGeometry(cfg.mossPatches.radius, 14, 9),
      mossMat,
      `${p}-base-moss-${i + 1}`
    );
    patch.position.set(Math.cos(theta) * (cfg.mossPatches.radius - 0.04), 0.05, Math.sin(theta) * (cfg.mossPatches.radius - 0.04));
    patch.scale.set(1.15, 0.34, 1.0);
    patch.castShadow = false;
    patch.userData.noCast = true;
    g.add(patch);
  }
  return g;
}

export function buildLeafCluster(name, center, radius, countRange, leafGeos, leafMats, rand, index, options = {}) {
  const biasY = options.leafBiasY ?? 0.42;
  const cluster = group(name);
  cluster.position.copy(center);

  const count = countRange[0] + Math.floor(rand() * (countRange[1] - countRange[0] + 1));
  const instanced = new THREE.InstancedMesh(
    leafGeos[index % leafGeos.length],
    leafMats[index % leafMats.length],
    count
  );
  instanced.name = `${name}-leaves`;
  instanced.castShadow = true;
  instanced.receiveShadow = false;
  instanced.userData.noReceive = true;
  instanced.userData.noOutline = true;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (let k = 0; k < count; k++) {
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const rr = radius * (0.45 + 0.55 * Math.cbrt(rand()));
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    pos.set(rr * s * Math.cos(phi), rr * u * 0.85, rr * s * Math.sin(phi));
    nrm.copy(pos).normalize();
    nrm.y = nrm.y * 0.72 + biasY;
    nrm.normalize();
    q.setFromUnitVectors(LEAF_NORMAL, nrm);
    spin.setFromAxisAngle(nrm, rand() * Math.PI * 2);
    q.premultiply(spin);
    const sc = 0.8 + rand() * 0.45;
    scl.set(sc, sc, sc);
    m4.compose(pos, q, scl);
    instanced.setMatrixAt(k, m4);
  }
  instanced.instanceMatrix.needsUpdate = true;
  cluster.add(instanced);

  cluster.userData.leafCluster = {
    center: center.clone(),
    radius,
    phase: rand() * Math.PI * 2,
    period: 2.8 + rand() * 1.8,
    amplitude: 0.05
  };
  return cluster;
}

export function treeNeighbours(x, z) {
  const out = [];
  for (const t of TREES) {
    if (t.x === x && t.z === z) continue;
    const dx = t.x - x;
    const dz = t.z - z;
    const dist = Math.hypot(dx, dz);
    if (dist > 6) continue;
    out.push({ ...t, dx, dz, dist });
  }
  return out;
}

function wrappedAngle(a) {
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
}

/**
 * 360° 全方位自然分枝选择：
 * 严格围绕黄金角（base + i * GOLDEN）向四周均匀发散，同时与同株相邻枝保持至少 1.05 rad 夹角，
 * 彻底杜绝多根树枝扎堆指向同一方向的“梳子/梯子枝”现象；若某方向正对极近邻株树干则仅微偏方位并略收枝长。
 */
function pickSpreadAzimuth(base, rand, avoid, reach, recentThetas) {
  const candidates = [0, 0.24, -0.24, 0.48, -0.48, 0.72, -0.72];
  let bestTheta = base + (rand() - 0.5) * 0.28;
  let bestScore = -Infinity;

  for (const delta of candidates) {
    const theta = base + delta + (rand() - 0.5) * 0.14;
    let minRecentDiff = Math.PI;
    for (const prev of recentThetas) {
      minRecentDiff = Math.min(minRecentDiff, wrappedAngle(theta - prev));
    }
    // 避开直接撞上近处邻株的主干核心区（仅窄角 0.32 rad）
    let trunkPenalty = 0;
    for (const n of avoid) {
      if (n.dist > reach + 0.55) continue;
      const dAng = wrappedAngle(theta - n.angle);
      if (dAng < 0.34) trunkPenalty += (0.34 - dAng) * 4.0;
    }
    const score = minRecentDiff * 2.2 - Math.abs(delta) * 0.8 - trunkPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestTheta = theta;
    }
  }
  return bestTheta;
}

/** 主枝若干（每枝 2 段 + 1 侧枝）+ 每枝 2 个叶片簇；每枝沿 360° 错落伸展 */
export function buildBranches(cfg, spine, barkMat, leafMats, leafGeos, rand, avoid = []) {
  const p = cfg.prefix;
  const b = cfg.branch;
  const branches = [];
  const recentThetas = [];
  let clusterIndex = 0;

  // 为每株树赋予独立的起始方位偏移，保证不同植株的主枝朝向完全不同
  const treePhaseOffset = rand() * Math.PI * 2;

  for (let i = 0; i < b.count; i++) {
    const anchor = spine.at(b.anchorU[i]);
    const reach = b.len1 + b.len2;
    const targetBase = b.azimuthBase + treePhaseOffset + i * GOLDEN;
    const theta = pickSpreadAzimuth(targetBase, rand, avoid, reach, recentThetas);
    recentThetas.push(theta);
    if (recentThetas.length > 3) recentThetas.shift();

    // 若该方向上有近邻树干，适度缩放本枝外伸长度（0.76~1.0），既防穿模又不改变四面舒展的树冠形态
    let reachScale = 0.88 + rand() * 0.22;
    for (const n of avoid) {
      if (n.dist < reach + n.reach * 0.5 && wrappedAngle(theta - n.angle) < 0.45) {
        reachScale = Math.min(reachScale, Math.max(0.68, (n.dist - 0.45) / Math.max(0.5, reach)));
      }
    }

    const t = i / Math.max(1, b.count - 1);
    const elev = lerp(b.elevMin, b.elevMax, t) + (rand() - 0.5) * 0.16;

    const branch = group(`${p}-branch-${i + 1}`);
    branch.position.copy(anchor);

    // 二段外弯方向左右交替并带随机曲率，避免单向顺拐
    const bendSign = (i % 2 === 0 ? 1 : -1);
    const bendDelta = bendSign * (0.22 + rand() * 0.22);
    const p1 = dirFrom(theta, elev).multiplyScalar(b.len1 * reachScale);
    const p2 = p1.clone().add(dirFrom(theta + bendDelta, elev + 0.14 + (rand() - 0.5) * 0.10).multiplyScalar(b.len2 * reachScale));

    const sideRoot = p1.clone().multiplyScalar(0.58 + rand() * 0.12);
    const sideTheta = theta - bendSign * (Math.abs(b.sideAzimuthDelta) * (0.75 + rand() * 0.45));
    const pSide = sideRoot.clone().add(dirFrom(sideTheta, elev + 0.08 + (rand() - 0.5) * 0.12).multiplyScalar(b.lenSide * reachScale));

    branch.add(limb(`${p}-branch-${i + 1}-a`, barkMat, ORIGIN, p1, b.rRoot, b.rMid, 12));
    branch.add(limb(`${p}-branch-${i + 1}-b`, barkMat, p1, p2, b.rMid, b.rTip, 10));
    branch.add(limb(`${p}-branch-${i + 1}-side`, barkMat, sideRoot, pSide, b.rSideRoot, b.rSideTip, 8));

    const jitter = cfg.clusters.radiusJitter;
    branch.add(buildLeafCluster(
      `${p}-cluster-${i + 1}a`, p2, cfg.clusters.radius * (jitter[0] + rand() * (jitter[1] - jitter[0])),
      cfg.clusters.leaves, leafGeos, leafMats, rand, clusterIndex++, cfg.clusters
    ));
    branch.add(buildLeafCluster(
      `${p}-cluster-${i + 1}b`, pSide, cfg.clusters.radius * (jitter[0] * 0.9 + rand() * (jitter[1] - jitter[0] * 0.9)),
      cfg.clusters.leaves, leafGeos, leafMats, rand, clusterIndex++, cfg.clusters
    ));

    branch.userData.branchSway = {
      phase: rand() * Math.PI * 2,
      period: 4.5 + rand() * 3.0,
      amplitude: 0.035,
      anchor: anchor.clone()
    };
    branches.push(branch);
  }
  return { branches, clusterIndex };
}

export function buildCrownClusters(cfg, leafMats, leafGeos, rand, startIndex) {
  const clusters = [];
  cfg.clusters.crown.forEach((crown, i) => {
    const center = new THREE.Vector3(
      crown.center[0] + (rand() - 0.5) * 0.16,
      crown.center[1],
      crown.center[2] + (rand() - 0.5) * 0.16
    );
    clusters.push(buildLeafCluster(
      `${cfg.prefix}-cluster-crown-${i + 1}`, center, crown.radius,
      cfg.clusters.leaves, leafGeos, leafMats, rand, startIndex + i, cfg.clusters
    ));
  });
  return clusters;
}
