/**
 * 地被植物与弯曲参道侧护石 / 前景画框枝叶 / 远景深林群山屏障（PATH_SYSTEM.groundCover）
 *
 * 承担五项核心构图结构：
 * 1) 随弯曲参道（pathBoundsAt）弧形延伸的左侧青苔石砌路缘护墙与下段铺石平台；
 * 2) 左下方蜿蜒叠瀑溪岸的湿滑乱石滩；
 * 3) 右侧陡坡裸露盘曲树根 + 护墙与溪岸鲜绿湿生草丛 + 林下地被莲座；
 * 4) 左右两侧探入画面的深翠尖叶画框枝条（不遮挡弯曲石阶通道）；
 * 5) 远景与两侧宽幅幽深森林群山三维林冠屏障（彻底消除宽屏下的一切空白天空）。
 */
import * as THREE from 'three';
import {
  CONTENT_HALF,
  PATH,
  STREAM,
  lerp,
  pathBoundsAt,
  pathRampY,
  pathYaw,
  stepTopY,
  streamBankHalf,
  streamCenterX,
  streamDistance,
  terrainHeight
} from '../layout.js';
import {
  group,
  leafBladeGeometry,
  leafSheetGeometry,
  mesh,
  place,
  rng,
  rockGeometry,
  slabGeometry,
  triplanarUv,
  tubeFromPoints
} from '../primitives.js';
import { LEAF_NORMAL, buildLeafCluster, limb } from '../tree-kit.js';

const SEED_BASE = 5401;
const CURB_OFFSET = -0.14;
const CURB_WIDTH = 0.28;

function curbRing(halfX, halfZ) {
  const c = 0.03;
  return [
    [-halfX + c, -halfZ], [halfX - c, -halfZ], [halfX, -halfZ + c], [halfX, halfZ - c],
    [halfX - c, halfZ], [-halfX + c, halfZ], [-halfX, halfZ - c], [-halfX, -halfZ + c]
  ];
}

function buildLeftCurbWall(M, rand) {
  const g = group('groundCover-curb');
  let count = 0;
  const blocks = 26;
  const zStart = PATH.zBottom + 2.2;
  const zEnd = -4.2;
  const span = (zStart - zEnd) / blocks;

  for (let i = 0; i < blocks; i++) {
    const z0 = zStart - i * span;
    const z1 = z0 - span + 0.025;
    const zc = (z0 + z1) * 0.5;
    const { x0 } = pathBoundsAt(zc);
    const curbX = x0 + CURB_OFFSET;
    const yaw = pathYaw(zc) * 0.45;
    const rampTop = zc <= PATH.zBottom ? pathRampY(zc) + 0.16 : PATH.bottomY + 0.08;
    const outerGround = terrainHeight(curbX - 0.22, zc);
    const height = Math.max(0.32, rampTop - outerGround + 0.24);
    const halfX = CURB_WIDTH * 0.5 * (0.92 + rand() * 0.18);
    const halfZ = (span - 0.025) * 0.5;

    const geo = slabGeometry(curbRing(halfX, halfZ), height);
    triplanarUv(geo, 0.85, [curbX, rampTop, zc]);
    const mat = rand() < 0.36 ? M.mossStone : rand() < 0.72 ? M.stoneStepLower : M.stoneStepMid;
    const block = mesh(geo, mat, `curbStone-${i + 1}`);
    place(block, {
      x: curbX + (rand() - 0.5) * 0.02,
      y: rampTop + (rand() - 0.5) * 0.008,
      z: zc,
      ry: yaw + (rand() - 0.5) * 0.025
    });
    block.castShadow = true;
    block.receiveShadow = true;
    g.add(block);
    count += 1;
  }

  // 下段近景平台延伸石板（随弯曲参道底端延伸 z ∈ [11.6, 14.0]）
  const apronRows = 5;
  for (let r = 0; r < apronRows; r++) {
    const zc = PATH.zBottom + 0.28 + r * 0.5;
    const { x0, x1, cx: pathCx } = pathBoundsAt(PATH.zBottom);
    const shiftOut = r * 0.12;
    const top = stepTopY(0) - 0.02 * r;
    for (let s = 0; s < 2; s++) {
      const xa = (s === 0 ? x0 : pathCx - 0.02) + shiftOut;
      const xb = (s === 0 ? pathCx - 0.05 : x1) + shiftOut;
      const cx = (xa + xb) * 0.5;
      const hw = (xb - xa) * 0.5;
      const geo = slabGeometry(curbRing(hw, 0.23), 0.18);
      triplanarUv(geo, 1.1, [cx, top, zc]);
      const slab = mesh(geo, (r + s) % 2 === 0 ? M.stoneStepLower : M.stoneStepMid, `apronSlab-${r}-${s}`);
      place(slab, { x: cx, y: top, z: zc, ry: pathYaw(PATH.zBottom) * 0.35 });
      slab.castShadow = true;
      slab.receiveShadow = true;
      g.add(slab);
      count += 1;
    }
  }

  // 溪岸与石阶护墙之间的湿滑溪谷乱石群
  const cobbleZs = [13.2, 12.6, 11.9, 11.2, 10.5, 9.8, 9.1, 8.4, 7.6, 6.8, 5.9, 5.0, 4.0, 2.8, 1.4, -0.2];
  cobbleZs.forEach((cz, idx) => {
    const scx = streamCenterX(cz);
    const shalf = streamBankHalf(cz);
    const side = idx % 2 === 0 ? 1 : -1;
    const cx = scx + side * (shalf + 0.18 + (idx % 3) * 0.14);
    const r = 0.24 + (idx % 4) * 0.04;
    const geo = rockGeometry(r, 6100 + idx * 43, {
      widthSegments: 12,
      heightSegments: 8,
      wobble: 0.22,
      flatten: 0.48
    });
    triplanarUv(geo, 0.7);
    const mat = idx % 3 === 0 ? M.mossStone : idx % 2 === 0 ? M.stoneRockWet : M.stoneStepLower;
    const stone = mesh(geo, mat, `streamCobble-${idx + 1}`);
    const gy = terrainHeight(cx, cz);
    place(stone, { x: cx, y: gy + r * 0.16, z: cz, ry: rand() * Math.PI });
    stone.castShadow = true;
    stone.receiveShadow = true;
    g.add(stone);
    count += 1;
  });

  return { group: g, count };
}

function buildSlopeRoots(M, rand) {
  const g = group('groundCover-roots');
  let count = 0;
  const rootZs = [10.4, 8.8, 7.3, 5.9, 4.4, 2.8, 1.3, -0.2, -1.8, -3.5, -5.2, -6.8];

  rootZs.forEach((zBase, i) => {
    const subCount = 2 + (i % 2);
    for (let k = 0; k < subCount; k++) {
      const z0 = zBase + (k - 0.5) * 0.45 + (rand() - 0.5) * 0.2;
      const { x1 } = pathBoundsAt(z0);
      const xLow = x1 + 0.12 + rand() * 0.32;
      const xHigh = xLow + 1.3 + rand() * 1.3;
      const pts = [];
      const steps = 4;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const x = lerp(xHigh, xLow, u);
        const z = z0 + Math.sin(u * Math.PI * 1.5 + i) * 0.22;
        const y = terrainHeight(x, z) + lerp(0.035, 0.012, u);
        pts.push(new THREE.Vector3(x, y, z));
      }
      const rRadius = lerp(0.022, 0.042, rand());
      const rootTube = tubeFromPoints(
        `slopeRoot-${i + 1}-${k + 1}`,
        k % 2 === 0 ? M.barkKusunoki : M.barkFlare,
        pts,
        rRadius,
        10,
        6
      );
      triplanarUv(rootTube.geometry, 0.4);
      rootTube.castShadow = true;
      rootTube.receiveShadow = true;
      g.add(rootTube);
      count += 1;
    }
  });

  return { group: g, count };
}

function buildFoliageCarpets(M, rand) {
  const g = group('groundCover-foliage');

  const grassGeos = [
    leafBladeGeometry({ length: 0.36, width: 0.032, thickness: 0.003, arch: 0.38, steps: 7 }),
    leafBladeGeometry({ length: 0.26, width: 0.026, thickness: 0.0028, arch: 0.32, steps: 6 })
  ];
  const rosetteGeo = leafSheetGeometry({ kind: 'beech', size: 0.088, thickness: 0.0032, curl: 0.24, steps: 14 });

  for (const bg of grassGeos) {
    bg.translate(0, 0.08, 0);
  }

  const grassMats = [M.leafSheetGrass, M.leafSheetGrassDeep, M.leafSheetFern];
  const rosetteMats = [M.leafSheetShrubDeep, M.leafSheetEvergreenDeep, M.leafSheetShrub];

  const grassBuckets = grassMats.map(() => []);
  const rosetteBuckets = rosetteMats.map(() => []);

  const tuftZs = [12.4, 11.4, 10.3, 9.2, 8.3, 7.4, 6.4, 5.2, 3.8, 2.2];
  const stepEdgeTufts = [];
  tuftZs.forEach((tz, idx) => {
    const { x0, x1 } = pathBoundsAt(tz);
    stepEdgeTufts.push({ x: x0 - 0.28, z: tz, blades: 44, spread: 0.34, scale: 1.22 });
    if (idx % 2 === 0) {
      stepEdgeTufts.push({ x: x1 + 0.24, z: tz, blades: 28, spread: 0.28, scale: 0.96 });
    }
    const scx = streamCenterX(tz);
    const shalf = streamBankHalf(tz);
    stepEdgeTufts.push({ x: scx - shalf - 0.28, z: tz, blades: 36, spread: 0.34, scale: 1.12 });
  });

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (const tuft of stepEdgeTufts) {
    for (let i = 0; i < tuft.blades; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = tuft.spread * Math.sqrt(rand());
      const bx = tuft.x + Math.cos(ang) * dist;
      const bz = tuft.z + Math.sin(ang) * dist;
      const by = terrainHeight(bx, bz) + 0.02;

      pos.set(bx, by, bz);
      const lean = 0.25 + (dist / Math.max(0.1, tuft.spread)) * 0.55;
      nrm.set(Math.cos(ang) * lean, 0.85, Math.sin(ang) * lean).normalize();
      q.setFromUnitVectors(LEAF_NORMAL, nrm);
      spin.setFromAxisAngle(nrm, rand() * Math.PI * 2);
      q.premultiply(spin);
      const sc = tuft.scale * (0.75 + rand() * 0.5);
      scl.set(sc, sc, sc);
      m4.compose(pos, q, scl);
      grassBuckets[i % grassBuckets.length].push(m4.clone());
    }
  }

  for (let c = 0; c < 140; c++) {
    const rx = lerp(-14.2, 14.2, rand());
    const rz = lerp(-13.8, 13.8, rand());
    const { x0, x1 } = pathBoundsAt(rz);
    if (rx >= x0 - 0.12 && rx <= x1 + 0.12) continue;
    const waterLim = Math.max(streamBankHalf(rz) - 0.02, STREAM.clearMargin);
    if (streamDistance(rx, rz) < waterLim + 0.18) continue;

    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rand() * 0.4;
      const d = 0.05 + rand() * 0.12;
      const lx = rx + Math.cos(a) * d;
      const lz = rz + Math.sin(a) * d;
      const ly = terrainHeight(lx, lz) + 0.022 + (k % 2) * 0.01;
      pos.set(lx, ly, lz);
      nrm.set(Math.cos(a) * 0.35, 0.92, Math.sin(a) * 0.35).normalize();
      q.setFromUnitVectors(LEAF_NORMAL, nrm);
      spin.setFromAxisAngle(nrm, a + Math.PI * 0.5);
      q.premultiply(spin);
      const sc = 0.75 + rand() * 0.55;
      scl.set(sc, sc, sc);
      m4.compose(pos, q, scl);
      rosetteBuckets[(c + k) % rosetteBuckets.length].push(m4.clone());
    }
  }

  let count = 0;
  grassBuckets.forEach((list, idx) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(grassGeos[idx % grassGeos.length], grassMats[idx], list.length);
    inst.name = `groundCover-grass-${idx + 1}`;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.userData.noOutline = true;
    for (let i = 0; i < list.length; i++) inst.setMatrixAt(i, list[i]);
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
    count += 1;
  });

  rosetteBuckets.forEach((list, idx) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(rosetteGeo, rosetteMats[idx], list.length);
    inst.name = `groundCover-rosette-${idx + 1}`;
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.userData.noCast = true;
    inst.userData.noOutline = true;
    for (let i = 0; i < list.length; i++) inst.setMatrixAt(i, list[i]);
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
    count += 1;
  });

  return { group: g, count };
}

/**
 * 前景画框枝条 + 远景深林群山立体冠层屏障（消除宽屏下的一切空白天空，同时衬托上段山路绕山消失）
 */
function buildForegroundFramingBranches(M, rand) {
  const g = group('groundCover-framing-branches');
  let count = 0;

  const leafGeos = [0.15, 0.18, 0.21, 0.24].map((size) =>
    leafBladeGeometry({
      length: size,
      width: size * 0.5,
      thickness: 0.0035,
      arch: 0.24,
      steps: 8
    })
  );
  const darkFrameMats = [M.leafSheetShrubDeep, M.leafSheetEvergreenDeep, M.leafSheetSakakiDeep, M.leafSheetEvergreen];
  const frameMats = [M.leafSheetEvergreen, M.leafSheetSakaki, M.leafSheetEvergreenDeep, M.leafSheetShrub];
  const backMats = [M.leafSheetMaple, M.leafSheetEvergreenLight, M.leafSheetMapleDeep, M.leafSheetSakaki];

  const framingSpecs = [
    // 左前景高枝（抬高至 y ≈ 3.5，不遮挡左下方蜿蜒叠瀑溪流视线）
    {
      name: 'frame-left-low',
      mats: darkFrameMats,
      origin: [-5.6, 3.3, 7.6],
      mid: [-4.4, 3.5, 7.0],
      tip: [-3.4, 3.6, 6.5],
      clusters: [
        { pos: [-5.0, 3.4, 7.3], r: 0.68, leaves: [78, 98] },
        { pos: [-4.1, 3.55, 6.8], r: 0.64, leaves: [74, 92] },
        { pos: [-3.4, 3.6, 6.5], r: 0.52, leaves: [60, 76] }
      ]
    },
    // 左中景主画框枝（自左坡探向鸟居左柱下半部 x ≈ -1.05，完美复现参考图左侧深绿枝叶画框）
    {
      name: 'frame-left-mid',
      mats: darkFrameMats,
      origin: [-3.8, 3.3, 4.2],
      mid: [-2.3, 3.75, 3.6],
      tip: [-1.05, 4.0, 3.2],
      clusters: [
        { pos: [-3.3, 3.45, 4.0], r: 0.76, leaves: [88, 110] },
        { pos: [-2.35, 3.75, 3.6], r: 0.72, leaves: [84, 106] },
        { pos: [-1.55, 3.92, 3.35], r: 0.64, leaves: [76, 96] },
        { pos: [-1.05, 4.02, 3.15], r: 0.52, leaves: [62, 80] }
      ]
    },
    // 左侧深林山脊封口（延伸至 x = -11，彻底封堵 16:9 宽屏左侧与左中景的一切空白）
    {
      name: 'frame-left-canopy-wall',
      mats: frameMats,
      origin: [-8.5, 4.2, -1.5],
      mid: [-5.2, 5.4, -0.2],
      tip: [-2.1, 6.2, 0.5],
      clusters: [
        { pos: [-9.2, 4.5, 2.5], r: 1.25, leaves: [120, 150] },
        { pos: [-7.4, 4.2, 1.8], r: 1.2, leaves: [115, 145] },
        { pos: [-5.6, 3.8, 1.2], r: 1.15, leaves: [112, 140] },
        { pos: [-3.8, 3.8, 0.5], r: 1.05, leaves: [108, 134] },
        { pos: [-2.6, 4.1, 0.1], r: 0.96, leaves: [100, 126] },
        { pos: [-8.8, 6.4, 0.5], r: 1.25, leaves: [120, 150] },
        { pos: [-6.8, 5.8, -0.2], r: 1.18, leaves: [115, 142] },
        { pos: [-4.8, 4.9, -0.2], r: 1.08, leaves: [110, 138] },
        { pos: [-3.5, 5.1, 0.2], r: 1.04, leaves: [106, 132] },
        { pos: [-2.35, 5.3, 0.4], r: 0.96, leaves: [98, 124] },
        { pos: [-4.5, 6.0, -0.5], r: 1.06, leaves: [108, 136] },
        { pos: [-3.2, 6.3, -0.1], r: 1.02, leaves: [104, 130] },
        { pos: [-2.2, 6.5, 0.2], r: 0.94, leaves: [96, 122] },
        { pos: [-4.0, 7.2, -0.6], r: 1.04, leaves: [106, 132] },
        { pos: [-2.7, 7.5, -0.3], r: 0.96, leaves: [98, 124] }
      ]
    },
    // 左上角垂枝画框
    {
      name: 'frame-left-high',
      mats: darkFrameMats,
      origin: [-4.2, 6.4, 4.6],
      mid: [-2.6, 6.1, 4.1],
      tip: [-1.35, 5.85, 3.8],
      clusters: [
        { pos: [-3.4, 6.3, 4.4], r: 0.78, leaves: [86, 108] },
        { pos: [-2.2, 6.05, 4.0], r: 0.72, leaves: [80, 100] },
        { pos: [-1.35, 5.85, 3.8], r: 0.58, leaves: [64, 82] }
      ]
    },
    // 右侧山坡凸出林冠（位于 z ≈ -1.5..4.5, x > 1.75，上段山路在 z < -4.4 处向右弯曲绕至这片山林后方消失！）
    {
      name: 'frame-right-mid',
      mats: darkFrameMats,
      origin: [3.6, 3.8, 5.2],
      mid: [2.5, 4.1, 4.6],
      tip: [1.75, 4.25, 4.2],
      clusters: [
        { pos: [2.9, 3.95, 4.9], r: 0.74, leaves: [84, 106] },
        { pos: [2.0, 4.18, 4.4], r: 0.62, leaves: [70, 88] },
        { pos: [2.6, 4.6, 1.8], r: 0.78, leaves: [86, 108] },
        { pos: [2.3, 5.0, -1.2], r: 0.84, leaves: [90, 114] }
      ]
    },
    // 右上角与右侧远山深林画框
    {
      name: 'frame-right-high',
      mats: frameMats,
      origin: [5.2, 5.8, 2.2],
      mid: [3.2, 6.6, 1.0],
      tip: [1.75, 7.2, 0.2],
      clusters: [
        { pos: [3.1, 5.8, 2.0], r: 0.88, leaves: [94, 118] },
        { pos: [2.05, 5.7, 1.5], r: 0.76, leaves: [80, 100] },
        { pos: [3.0, 6.8, 0.5], r: 0.96, leaves: [100, 126] },
        { pos: [2.0, 7.2, -0.2], r: 0.92, leaves: [96, 120] },
        { pos: [3.0, 8.1, -0.6], r: 0.98, leaves: [102, 128] },
        { pos: [1.9, 8.4, -1.0], r: 0.9, leaves: [94, 118] },
        { pos: [5.4, 6.8, 1.5], r: 1.18, leaves: [112, 140] },
        { pos: [7.2, 7.2, 0.5], r: 1.22, leaves: [118, 146] }
      ]
    },
    // 鸟居正后方与上段弯曲山路内外的幽深远山林冠（既露出向右蜿蜒消失的上段石板路，又封住远方地平线）
    {
      name: 'frame-upper-back-left',
      mats: backMats,
      origin: [-3.2, 5.5, -6.2],
      mid: [-1.6, 6.2, -7.8],
      tip: [-0.2, 6.8, -9.2],
      clusters: [
        { pos: [-2.4, 5.4, -5.8], r: 0.9, leaves: [90, 112] },
        { pos: [-1.4, 5.9, -7.2], r: 0.92, leaves: [92, 116] },
        { pos: [-0.3, 6.4, -8.8], r: 0.96, leaves: [96, 120] },
        { pos: [0.9, 6.8, -9.6], r: 0.98, leaves: [98, 124] }
      ]
    },
    {
      name: 'frame-upper-back-right',
      mats: backMats,
      origin: [5.8, 6.4, -8.2],
      mid: [4.2, 7.0, -9.4],
      tip: [2.4, 7.4, -10.2],
      clusters: [
        { pos: [5.4, 6.5, -8.4], r: 0.98, leaves: [98, 124] },
        { pos: [3.8, 6.9, -9.4], r: 0.98, leaves: [98, 124] },
        { pos: [2.2, 7.2, -10.0], r: 0.96, leaves: [96, 120] }
      ]
    }
  ];

  framingSpecs.forEach((spec, sIdx) => {
    const branchGroup = group(spec.name);
    const p0 = new THREE.Vector3(...spec.origin);
    const p1 = new THREE.Vector3(...spec.mid);
    const p2 = new THREE.Vector3(...spec.tip);

    branchGroup.add(limb(`${spec.name}-a`, M.barkSakaki, p0, p1, 0.038, 0.024, 8));
    branchGroup.add(limb(`${spec.name}-b`, M.barkSakaki, p1, p2, 0.024, 0.012, 8));
    count += 2;

    spec.clusters.forEach((cSpec, cIdx) => {
      const cluster = buildLeafCluster(
        `${spec.name}-cluster-${cIdx + 1}`,
        new THREE.Vector3(...cSpec.pos),
        cSpec.r,
        cSpec.leaves,
        leafGeos,
        spec.mats,
        rand,
        sIdx + cIdx,
        { leafBiasY: 0.38 }
      );
      branchGroup.add(cluster);
      count += 1;
    });

    g.add(branchGroup);
  });

  return { group: g, count };
}

export function createGroundCover(M) {
  const root = group('groundCover');
  root.userData.assetName = 'groundCover';

  const rand = rng(SEED_BASE);
  let meshCount = 0;

  const curb = buildLeftCurbWall(M, rand);
  root.add(curb.group);
  meshCount += curb.count;

  const roots = buildSlopeRoots(M, rand);
  root.add(roots.group);
  meshCount += roots.count;

  const foliage = buildFoliageCarpets(M, rand);
  root.add(foliage.group);
  meshCount += foliage.count;

  const framing = buildForegroundFramingBranches(M, rand);
  root.add(framing.group);
  meshCount += framing.count;

  root.userData.samples = [
    { x: pathBoundsAt(9.0).x0 + CURB_OFFSET, z: 9.0 },
    { x: pathBoundsAt(3.0).x0 + CURB_OFFSET, z: 3.0 },
    { x: pathBoundsAt(-2.0).x0 + CURB_OFFSET, z: -2.0 },
    { x: pathBoundsAt(6.0).x1 + 0.6, z: 6.0 },
    { x: pathBoundsAt(-2.0).x1 + 0.6, z: -2.0 }
  ];

  root.userData.support = {
    host: {
      x: [-CONTENT_HALF, CONTENT_HALF],
      y: [-0.25, 11.4],
      z: [-CONTENT_HALF, CONTENT_HALF]
    }
  };
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}

export default createGroundCover;
