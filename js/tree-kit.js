// 树类共用构建器（S6.1 枫 / S6.2 榉 共用骨架，不是资产本体，不出现在 asset-map）
// 约定：树体局部原点 = 树干基部；所有构件独立 Mesh；叶片簇 = Group + InstancedMesh（独立薄片几何体）。
import * as THREE from 'three';
import { TREES } from './layout.js';
import { group, mesh, rockGeometry } from './primitives.js';

const UP = new THREE.Vector3(0, 1, 0);
/** 叶片几何体的基准法线：leafSheetGeometry / leafBladeGeometry 均位于 XY 平面、法线 +Z */
export const LEAF_NORMAL = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3(0, 0, 0);
/** 黄金角：主枝方位错开，避免整株呈放射对称 */
export const GOLDEN = 2.399963229728653;

/**
 * 各树种枝展包络（D.branch.len1 + len2，scale = 1.0）。
 * 邻株避让要算「对方能伸多远」，而对方可能是另一个树种 —— 三个树资产各自建模，
 * 若各自维护一份对照表就会互相漂移，故集中在此，改动时与三个 D.branch 同步。
 */
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

/**
 * 一段树枝 / 树干：沿 from→to 的锥台。
 * CylinderGeometry 的 rTop 在局部 +Y 端，故 rTop = 远端半径；用 setFromUnitVectors 对齐枝向。
 */
export function limb(name, material, from, to, rFrom, rTo, segments = 12) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const body = mesh(new THREE.CylinderGeometry(rTo, rFrom, len, segments, 1, false), material, name);
  body.position.copy(from).add(to).multiplyScalar(0.5);
  body.quaternion.setFromUnitVectors(UP, dir.normalize());
  return body;
}

/** 方位角 + 仰角 → 单位方向 */
export function dirFrom(theta, elev) {
  const c = Math.cos(elev);
  return new THREE.Vector3(c * Math.cos(theta), Math.sin(elev), c * Math.sin(theta));
}

/** 树干 + 根回し盛土 + 板根 + 树皮剥落薄片 + 树脚青苔 */
export function buildTrunk(cfg, spine, barkMat, flareMat, flakeMat, mossMat, rand) {
  const p = cfg.prefix;
  const g = group(`${p}-trunk`);
  const pts = cfg.trunk.points;

  // 相邻段共用端点且半径一致 → 端面正好贴合，不留缝
  for (let i = 0; i < pts.length - 1; i++) {
    const a = new THREE.Vector3(pts[i][0], pts[i][1], pts[i][2]);
    const b = new THREE.Vector3(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
    g.add(limb(`${p}-trunk-seg-${i + 1}`, barkMat, a, b, cfg.trunk.radii[i], cfg.trunk.radii[i + 1], 16));
  }

  // 根回し盛土（低矮扁平土石座，部分埋入地面）
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

  // 板根：从树干基部向外下斜伸，压入盛土
  for (let i = 0; i < cfg.roots.count; i++) {
    const theta = cfg.roots.azimuthBase + i * ((Math.PI * 2) / cfg.roots.count) + (rand() - 0.5) * 0.3;
    const from = new THREE.Vector3(0, cfg.roots.fromY, 0);
    const to = new THREE.Vector3(Math.cos(theta) * cfg.roots.reach, -0.04, Math.sin(theta) * cfg.roots.reach);
    g.add(limb(`${p}-root-${i + 1}`, barkMat, from, to, cfg.roots.rFrom, cfg.roots.rTo, 10));
  }

  // 树皮剥落薄片：贴附树干，外凸 0.008（老化细节，不投影）
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
    plate.rotation.y = Math.PI / 2 - theta; // 局部 +Z 指向径向外侧
    plate.rotation.z = (rand() - 0.5) * 0.25;
    plate.castShadow = false;
    plate.userData.noCast = true; // 资产层明确不投影：组装层不得覆盖
    g.add(plate);
  }

  // 树脚青苔：只在树干背阴侧与板根内侧（长期潮湿位置）
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
    patch.userData.noCast = true; // 资产层明确不投影：组装层不得覆盖
    g.add(patch);
  }
  return g;
}

/**
 * 一个叶片簇：簇心处 InstancedMesh，叶片沿椭球壳分布、叶面大致朝外并略上仰。
 * 簇本身是 Group —— S7.3 摆动 Group，不逐实例计算。
 */
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
  instanced.castShadow = true; // 叶隙投影 = S7.4 斑驳光斑的物理来源
  instanced.receiveShadow = false;
  instanced.userData.noReceive = true; // 资产层明确不受影：组装层不得覆盖
  instanced.userData.noOutline = true; // InstancedMesh 不能做反向壳体描边

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (let k = 0; k < count; k++) {
    // 球面方向 + 壳层半径（0.45–1.0 R，靠外为主，簇内仍留层次）
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const rr = radius * (0.45 + 0.55 * Math.cbrt(rand()));
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    pos.set(rr * s * Math.cos(phi), rr * u * 0.85, rr * s * Math.sin(phi));
    nrm.copy(pos).normalize();
    nrm.y = nrm.y * 0.72 + biasY; // 叶面略上仰，避免全部竖直插着
    nrm.normalize();
    q.setFromUnitVectors(LEAF_NORMAL, nrm);
    spin.setFromAxisAngle(nrm, rand() * Math.PI * 2); // 绕自身法线随机滚转
    q.premultiply(spin);
    const sc = 0.8 + rand() * 0.45;
    scl.set(sc, sc, sc);
    m4.compose(pos, q, scl);
    instanced.setMatrixAt(k, m4);
  }
  instanced.instanceMatrix.needsUpdate = true;
  cluster.add(instanced);

  cluster.userData.leafCluster = {
    center: center.clone(), // 相对所属枝组 / 树根的局部坐标
    radius,
    phase: rand() * Math.PI * 2,
    period: 2.8 + rand() * 1.8,
    amplitude: 0.05
  };
  return cluster;
}



/** 6 m 半径内的同林邻株（用于枝展避让与落点复核） */
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

/**
 * 主枝方位选择：避开邻株。
 * 若某邻株在「本枝可达 + 邻株可达 + 余量」之内，且方位落在其方向 ±0.55 rad 扇区里，
 * 枝梢就会插进对方的木质构件（真正的穿模）—— 换一个方位重试，直到落在空档。
 * @param {Array<{angle:number, reach:number}>} avoid 邻株方向（树体局部方位角）与其枝展
 */
function pickAzimuth(base, rand, avoid, reach) {
  // 首段 + 二段（二段固定外弯 +0.32 rad）都要避开，否则梢部仍会探进邻株
  const bearings = [0, 0.32];
  for (let k = 0; k < 24; k++) {
    const theta = base + (rand() - 0.5) * 0.6 + k * 0.42;
    let clear = true;
    for (const n of avoid) {
      if (n.dist > reach + n.reach + 0.35) continue;
      for (const b of bearings) {
        if (wrappedAngle(theta + b - n.angle) < 0.95) { clear = false; break; }
      }
      if (!clear) break;
    }
    if (clear) return theta;
  }
  return base;
}

/** 角度差折到 [0, π] */
function wrappedAngle(a) {
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
}

/** 主枝若干（每枝 2 段 + 1 侧枝）+ 每枝 2 个叶片簇；每枝独立 Group 供逐枝摆动 */
export function buildBranches(cfg, spine, barkMat, leafMats, leafGeos, rand, avoid = []) {
  const p = cfg.prefix;
  const b = cfg.branch;
  const branches = [];
  let clusterIndex = 0;

  for (let i = 0; i < b.count; i++) {
    const anchor = spine.at(b.anchorU[i]);
    const reach = b.len1 + b.len2;
    const theta = pickAzimuth(b.azimuthBase + i * GOLDEN, rand, avoid, reach);
    const t = i / (b.count - 1);
    const elev = lerp(b.elevMin, b.elevMax, t) + (rand() - 0.5) * 0.12;

    const branch = group(`${p}-branch-${i + 1}`);
    branch.position.copy(anchor);

    const p1 = dirFrom(theta, elev).multiplyScalar(b.len1);
    const p2 = p1.clone().add(dirFrom(theta + 0.32 + (rand() - 0.5) * 0.2, elev + 0.18).multiplyScalar(b.len2));

    const sideRoot = p1.clone().multiplyScalar(0.62);
    const sideTheta = pickAzimuth(theta + b.sideAzimuthDelta, rand, avoid, b.len1 * 0.62 + b.lenSide);
    const pSide = sideRoot.clone().add(dirFrom(sideTheta, elev + 0.06).multiplyScalar(b.lenSide));

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

/** 顶冠簇（补足树冠顶部体量） */
export function buildCrownClusters(cfg, leafMats, leafGeos, rand, startIndex) {
  const clusters = [];
  cfg.clusters.crown.forEach((crown, i) => {
    const center = new THREE.Vector3(
      crown.center[0] + (rand() - 0.5) * 0.12,
      crown.center[1],
      crown.center[2] + (rand() - 0.5) * 0.12
    );
    clusters.push(buildLeafCluster(
      `${cfg.prefix}-cluster-crown-${i + 1}`, center, crown.radius,
      cfg.clusters.leaves, leafGeos, leafMats, rand, startIndex + i, cfg.clusters
    ));
  });
  return clusters;
}
