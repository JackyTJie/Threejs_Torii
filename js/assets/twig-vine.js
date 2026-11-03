/**
 * 细树干与藤蔓（layout.TWIGS → asset-map.twig）
 *
 * 包含三部分独立建模的林间细节构件：
 * 1) 14 处坡地与溪岸倒伏细干 / 枯枝（按 layout.TWIGS 落点）；
 * 2) 乔木主干攀援藤蔓（依附于参道两侧与鸟居后方高大树干）；
 * 3) 鸟居正上方林间横跨的悬垂细藤索（还原参考图 ref/20261102-170814.jpg 中
 *    鸟居笠木上方高大树干之间优雅横跨的 3 条弧形林间细藤/注连索细节）。
 */
import * as THREE from 'three';
import {
  TWIGS,
  TREES,
  PATH,
  clamp,
  lerp,
  streamBankHalf,
  streamDistance,
  terrainHeight,
  toriiClearanceBoxes
} from '../layout.js';
import {
  group,
  leafBladeGeometry,
  mesh,
  rng,
  rockGeometry,
  saggingCable,
  triplanarUv,
  tubeFromPoints
} from '../primitives.js';
import { LEAF_NORMAL } from '../tree-kit.js';

export const TWIG_MODEL = { radius: 0.78, height: 0.52, bottom: -0.18 };

const SEED_BASE = 8101;
const SEED_STRIDE = 163;
const HOST_MARGIN = 0.05;

const LOG_LEN = [0.72, 1.18];
const LOG_R_BASE = [0.032, 0.052];
const LOG_R_TIP = [0.016, 0.028];
const FORK_LEN = [0.24, 0.42];
const MOSS_R = [0.07, 0.12];
const VINE_LEAVES = [10, 16];

function makeVineLeafGeos() {
  return [0.055, 0.068, 0.08, 0.092].map((length) =>
    leafBladeGeometry({
      length,
      width: length * 0.48,
      thickness: 0.0032,
      arch: 0.22,
      steps: 6
    })
  );
}

function isSafeSpot(x, z) {
  if (x >= PATH.x0 - 0.15 && x <= PATH.x1 + 0.15 && z >= PATH.corridorZ0 && z <= PATH.corridorZ1) {
    return false;
  }
  const lim = Math.max(streamBankHalf(z) - 0.05, 0.3);
  if (streamDistance(x, z) < lim + 0.12) return false;
  for (const b of toriiClearanceBoxes()) {
    if (x >= b.x0 - 0.15 && x <= b.x1 + 0.15 && z >= b.z0 - 0.15 && z <= b.z1 + 0.15) return false;
  }
  return true;
}

function pickSafeAzimuth(x, z, halfLen, preferredAz, rand) {
  const base = preferredAz !== undefined ? preferredAz : rand() * Math.PI * 2;
  for (let k = 0; k < 16; k++) {
    const az = base + k * 0.3927;
    const dx = Math.cos(az) * halfLen;
    const dz = Math.sin(az) * halfLen;
    if (isSafeSpot(x + dx, z + dz) && isSafeSpot(x - dx, z - dz)) {
      return az;
    }
  }
  return base;
}

function buildVineLeaves(name, curve, count, leafGeo, leafMat, rand) {
  const inst = new THREE.InstancedMesh(leafGeo, leafMat, count);
  inst.name = name;
  inst.castShadow = true;
  inst.receiveShadow = false;
  inst.userData.noReceive = true;
  inst.userData.noOutline = true;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const u = 0.08 + 0.84 * (i / Math.max(1, count - 1));
    const pt = curve.getPointAt(u);
    const tan = curve.getTangentAt(u).normalize();
    const side = (i % 2 === 0 ? 1 : -1) * (0.025 + rand() * 0.03);
    pos.set(pt.x - tan.z * side, pt.y + 0.015 + (rand() - 0.5) * 0.02, pt.z + tan.x * side);

    nrm.set((rand() - 0.5) * 0.6, 0.65 + rand() * 0.35, (rand() - 0.5) * 0.6).normalize();
    q.setFromUnitVectors(LEAF_NORMAL, nrm);
    spin.setFromAxisAngle(nrm, rand() * Math.PI * 2);
    q.premultiply(spin);
    const s = 0.82 + rand() * 0.38;
    scl.set(s, s, s);
    m4.compose(pos, q, scl);
    inst.setMatrixAt(i, m4);
  }
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

function buildFallenTwig(index, spec, M, leafGeos, rand) {
  const name = `twig-${index + 1}`;
  const g = group(name);
  const cx = spec.x;
  const cz = spec.z;
  const len = lerp(LOG_LEN[0], LOG_LEN[1], rand());
  const half = len * 0.5;
  const az = pickSafeAzimuth(cx, cz, half, spec.az, rand);
  const cos = Math.cos(az);
  const sin = Math.sin(az);

  const rBase = lerp(LOG_R_BASE[0], LOG_R_BASE[1], rand());
  const rTip = lerp(LOG_R_TIP[0], LOG_R_TIP[1], rand());
  const rMid = (rBase + rTip) * 0.5;

  const pts = [];
  for (let s = 0; s <= 3; s++) {
    const t = -half + (len * s) / 3;
    const wobbleLat = (s === 1 || s === 2) ? (rand() - 0.5) * 0.06 : 0;
    const wx = cx + cos * t - sin * wobbleLat;
    const wz = cz + sin * t + cos * wobbleLat;
    const wy = terrainHeight(wx, wz) + lerp(rBase, rTip, s / 3) * 0.72;
    pts.push(new THREE.Vector3(wx, wy, wz));
  }

  const barkMat = rand() < 0.5 ? M.woodWeathered : M.twigBark;
  const mainTube = tubeFromPoints(`${name}-trunk`, barkMat, pts, rMid, 14, 8);
  triplanarUv(mainTube.geometry, 0.45);
  mainTube.castShadow = true;
  mainTube.receiveShadow = true;
  g.add(mainTube);
  let meshCount = 1;

  for (let end = 0; end < 2; end++) {
    const ep = end === 0 ? pts[0] : pts[3];
    const er = end === 0 ? rBase * 0.92 : rTip * 0.88;
    const capGeo = rockGeometry(er, SEED_BASE + index * 31 + end, {
      widthSegments: 8,
      heightSegments: 6,
      wobble: 0.14,
      flatten: 0.55
    });
    triplanarUv(capGeo, 0.25);
    const cap = mesh(capGeo, M.twigDead, `${name}-end-${end + 1}`);
    cap.position.copy(ep);
    cap.castShadow = false;
    cap.receiveShadow = true;
    cap.userData.noCast = true;
    g.add(cap);
    meshCount += 1;
  }

  for (let f = 0; f < 2; f++) {
    const anchor = pts[f + 1].clone();
    const forkAz = az + (f === 0 ? 1 : -1) * (0.55 + rand() * 0.45);
    const forkLen = lerp(FORK_LEN[0], FORK_LEN[1], rand());
    const midPt = new THREE.Vector3(
      anchor.x + Math.cos(forkAz) * forkLen * 0.55,
      anchor.y + 0.04 + rand() * 0.05,
      anchor.z + Math.sin(forkAz) * forkLen * 0.55
    );
    const tipX = anchor.x + Math.cos(forkAz) * forkLen;
    const tipZ = anchor.z + Math.sin(forkAz) * forkLen;
    const tipY = Math.max(terrainHeight(tipX, tipZ) + 0.02, anchor.y + 0.06 + rand() * 0.08);
    const tipPt = new THREE.Vector3(tipX, tipY, tipZ);
    const forkTube = tubeFromPoints(
      `${name}-fork-${f + 1}`,
      f === 0 ? M.twigBark : M.twigDead,
      [anchor, midPt, tipPt],
      rTip * 0.58,
      8,
      6
    );
    triplanarUv(forkTube.geometry, 0.35);
    forkTube.castShadow = true;
    forkTube.receiveShadow = true;
    g.add(forkTube);
    meshCount += 1;
  }

  const mossCount = 1 + (rand() < 0.55 ? 1 : 0);
  for (let m = 0; m < mossCount; m++) {
    const mp = pts[1 + m].clone();
    const mr = lerp(MOSS_R[0], MOSS_R[1], rand());
    const mGeo = rockGeometry(mr, SEED_BASE + index * 71 + m, {
      widthSegments: 10,
      heightSegments: 7,
      wobble: 0.3,
      flatten: 0.28
    });
    triplanarUv(mGeo, 0.28);
    const moss = mesh(mGeo, M.mossDamp, `${name}-moss-${m + 1}`);
    moss.position.set(mp.x, mp.y + rMid * 0.55, mp.z);
    moss.scale.set(1.2, 0.45, 0.9);
    moss.castShadow = false;
    moss.receiveShadow = true;
    moss.userData.noCast = true;
    moss.userData.noOutline = true;
    g.add(moss);
    meshCount += 1;
  }

  const vinePts = pts.map((p, k) => {
    const off = (k % 2 === 0 ? 1 : -1) * rMid * 0.85;
    return new THREE.Vector3(p.x - sin * off, p.y + rMid * 0.78, p.z + cos * off);
  });
  const vineCurve = new THREE.CatmullRomCurve3(vinePts, false, 'centripetal', 0.5);
  const vineGeo = new THREE.TubeGeometry(vineCurve, 14, 0.0085, 6, false);
  triplanarUv(vineGeo, 0.25);
  const vineMesh = mesh(vineGeo, M.vineStem, `${name}-vine`);
  vineMesh.castShadow = false;
  vineMesh.receiveShadow = true;
  vineMesh.userData.noCast = true;
  g.add(vineMesh);
  meshCount += 1;

  const leafCount = Math.round(lerp(VINE_LEAVES[0], VINE_LEAVES[1], rand()));
  const leaves = buildVineLeaves(
    `${name}-vine-leaves`,
    vineCurve,
    leafCount,
    leafGeos[index % leafGeos.length],
    M.leafSheetVine,
    rand
  );
  g.add(leaves);
  meshCount += 1;

  return { group: g, meshCount };
}

/** 乔木主干攀援藤蔓 + 鸟居上方横跨细藤索 */
function buildTreeClimbingVines(M, leafGeos, rand) {
  const g = group('twig-tree-vines');
  let meshCount = 0;
  const hostTreeIds = [1, 2, 4, 10, 11, 12, 22, 23];

  hostTreeIds.forEach((id, idx) => {
    const tree = TREES.find((t) => t.id === id);
    if (!tree) return;
    const baseGround = terrainHeight(tree.x, tree.z);
    const rTrunk = (tree.species === 'kusunoki' ? 0.26 : tree.species === 'kaede' ? 0.2 : 0.14) * tree.scale;
    const maxH = (tree.species === 'kusunoki' ? 4.2 : 2.6) * tree.scale;
    const pts = [];
    const steps = 6;
    const startAngle = rand() * Math.PI * 2;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const angle = startAngle + u * 2.2;
      const rad = lerp(rTrunk * 1.05, rTrunk * 0.78, u);
      pts.push(new THREE.Vector3(
        tree.x + Math.cos(angle) * rad,
        baseGround + u * maxH,
        tree.z + Math.sin(angle) * rad
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const geo = new THREE.TubeGeometry(curve, 16, 0.011, 6, false);
    triplanarUv(geo, 0.3);
    const stem = mesh(geo, M.vineStem, `tree-vine-stem-${idx + 1}`);
    stem.castShadow = false;
    stem.receiveShadow = true;
    stem.userData.noCast = true;
    g.add(stem);
    meshCount += 1;

    const leaves = buildVineLeaves(
      `tree-vine-leaves-${idx + 1}`,
      curve,
      14,
      leafGeos[idx % leafGeos.length],
      M.leafSheetVine,
      rand
    );
    g.add(leaves);
    meshCount += 1;
  });

  // 鸟居上方高处林木间横跨的 3 条悬垂细藤弧线（还原参考图中鸟居笠木上方树干间的弧线细节）
  const overheadSpans = [
    { a: [-2.8, 10.6, -4.8], b: [0.25, 9.8, -5.8], sag: 0.65, r: 0.014 },
    { a: [-2.6, 9.9, -4.5], b: [1.4, 9.4, -5.2], sag: 0.78, r: 0.012 },
    { a: [-1.45, 11.2, -5.4], b: [2.6, 10.4, -4.6], sag: 0.58, r: 0.013 }
  ];
  overheadSpans.forEach((span, idx) => {
    const cable = saggingCable(
      `overhead-vine-${idx + 1}`,
      M.vineStem,
      new THREE.Vector3(...span.a),
      new THREE.Vector3(...span.b),
      span.sag,
      span.r,
      20
    );
    triplanarUv(cable.geometry, 0.35);
    cable.castShadow = false;
    cable.receiveShadow = true;
    cable.userData.noCast = true;
    g.add(cable);
    meshCount += 1;
  });

  return { group: g, meshCount };
}

export function createTwigVine(M) {
  const root = group('twig');
  root.userData.assetName = 'twig';

  const leafGeos = makeVineLeafGeos();
  const samples = [];
  let meshCount = 0;

  let hostX0 = Infinity;
  let hostX1 = -Infinity;
  let hostY0 = Infinity;
  let hostY1 = -Infinity;
  let hostZ0 = Infinity;
  let hostZ1 = -Infinity;

  const expandHost = (x, z, r, hLow, hHigh) => {
    const g = terrainHeight(x, z);
    hostX0 = Math.min(hostX0, x - r - HOST_MARGIN);
    hostX1 = Math.max(hostX1, x + r + HOST_MARGIN);
    hostZ0 = Math.min(hostZ0, z - r - HOST_MARGIN);
    hostZ1 = Math.max(hostZ1, z + r + HOST_MARGIN);
    hostY0 = Math.min(hostY0, g - hLow - HOST_MARGIN);
    hostY1 = Math.max(hostY1, g + hHigh + HOST_MARGIN);
  };

  TWIGS.forEach((spec, index) => {
    const rand = rng(SEED_BASE + index * SEED_STRIDE);
    const built = buildFallenTwig(index, spec, M, leafGeos, rand);
    root.add(built.group);
    meshCount += built.meshCount;
    samples.push({ x: spec.x, z: spec.z });
    expandHost(spec.x, spec.z, TWIG_MODEL.radius, Math.abs(TWIG_MODEL.bottom), TWIG_MODEL.height);
  });

  const treeVines = buildTreeClimbingVines(M, leafGeos, rng(SEED_BASE + 999));
  root.add(treeVines.group);
  meshCount += treeVines.meshCount;
  for (const id of [1, 2, 4, 10, 11, 12, 22, 23]) {
    const tree = TREES.find((t) => t.id === id);
    if (tree) expandHost(tree.x, tree.z, 0.65, 0.1, 6.8);
  }

  root.userData.samples = samples;
  root.userData.support = {
    host: {
      x: [clamp(hostX0, -15.9, 15.9), clamp(hostX1, -15.9, 15.9)],
      y: [hostY0, Math.max(hostY1, 12.0)],
      z: [clamp(hostZ0, -15.9, 15.9), clamp(hostZ1, -15.9, 15.9)]
    }
  };
  root.userData.twigCount = TWIGS.length;
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}

export default createTwigVine;
