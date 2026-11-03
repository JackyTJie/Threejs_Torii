/**
 * 地面落叶与腐叶层（PATH_SYSTEM.leafLitter）
 *
 * 按 config.BUDGET.groundLeafSheets (2600 片) 与 groundLeafLayers (3 层) 构建：
 *   - 底层腐叶（leafSheetGroundDeep / leafSheetGroundWet）：紧贴潮湿泥地与坡面，色泽深暗
 *   - 中层落叶（leafSheetGround / leafSheetGroundRust）：铺满右侧陡坡、左脊林地、溪岸坡脚
 *   - 表层零星落叶（leafSheetGroundLight / leafSheetGround）：散落在石阶边缘、路肩与苔面上
 *
 * 每一片落叶均为真实三维薄片几何（leafSheetGeometry：beech / maple / oval 三种叶形），
 * 通过按「叶形 × 材质」分桶的 InstancedMesh 承载（共 2600 个独立变换实例，不合并网格）。
 * 每片落叶采样所在位置的真实地形或石阶踏面法线，顺坡贴附，绝不悬空或插入水体。
 */
import * as THREE from 'three';
import { BUDGET } from '../config.js';
import {
  CONTENT_HALF,
  PATH,
  STREAM,
  frontZ,
  lerp,
  stepTopY,
  streamBankHalf,
  streamDistance,
  terrainHeight
} from '../layout.js';
import { group, leafSheetGeometry, rng } from '../primitives.js';

const SEED_BASE = 9203;
const TOTAL_SHEETS = BUDGET.groundLeafSheets || 2600;
const SAFE_HALF = CONTENT_HALF - 0.35;

function makeGroundLeafGeometries() {
  const specs = [
    { kind: 'beech', size: 0.078, thickness: 0.0032, curl: 0.24, steps: 14 },
    { kind: 'maple', size: 0.086, thickness: 0.0034, curl: 0.28, steps: 16 },
    { kind: 'oval', size: 0.072, thickness: 0.003, curl: 0.2, steps: 12 }
  ];
  return specs.map((spec) => {
    const geo = leafSheetGeometry(spec);
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  });
}

function sampleSurface(x, z) {
  if (x >= PATH.x0 + 0.08 && x <= PATH.x1 - 0.08 && z <= PATH.zBottom - 0.05 && z >= PATH.zTop + 0.05) {
    const k = Math.min(
      PATH.steps - 1,
      Math.max(0, Math.floor((PATH.zBottom - z) / PATH.tread))
    );
    const zF = frontZ(k);
    const zSafe = Math.min(zF - 0.06, Math.max(zF - PATH.tread + 0.06, z));
    return {
      x,
      y: stepTopY(k),
      z: zSafe,
      normal: new THREE.Vector3(0, 1, 0),
      onStep: true
    };
  }

  const eps = 0.12;
  const yc = terrainHeight(x, z);
  const yx = terrainHeight(x + eps, z);
  const yz = terrainHeight(x, z + eps);
  const normal = new THREE.Vector3(yc - yx, eps, yc - yz).normalize();
  return { x, y: yc, z, normal, onStep: false };
}

function pickLeafSpot(rand) {
  for (let guard = 0; guard < 24; guard++) {
    const roll = rand();
    let x;
    let z;
    if (roll < 0.36) {
      x = lerp(PATH.x1 + 0.05, SAFE_HALF, Math.pow(rand(), 0.75));
      z = lerp(-SAFE_HALF, SAFE_HALF, rand());
    } else if (roll < 0.72) {
      x = lerp(-SAFE_HALF, PATH.x0 - 0.08, rand());
      z = lerp(-SAFE_HALF, SAFE_HALF, rand());
    } else if (roll < 0.88) {
      x = lerp(-6.5, 6.5, rand());
      z = lerp(-SAFE_HALF, -3.5, rand());
    } else {
      const side = rand() < 0.5 ? -1 : 1;
      x = side < 0
        ? lerp(PATH.x0 + 0.1, PATH.x0 + 0.65, rand())
        : lerp(PATH.x1 - 0.65, PATH.x1 - 0.1, rand());
      z = lerp(PATH.zTop + 0.2, PATH.zBottom - 0.2, rand());
    }

    const waterLim = Math.max(streamBankHalf(z) + 0.06, STREAM.clearMargin + 0.08);
    if (streamDistance(x, z) < waterLim) continue;
    return { x, z };
  }
  return { x: 2.6, z: 4.0 };
}

export function createLeafLitter(M) {
  const root = group('leafLitter');
  root.userData.assetName = 'leafLitter';

  const rand = rng(SEED_BASE);
  const geos = makeGroundLeafGeometries();
  const mats = [
    M.leafSheetGround,
    M.leafSheetGroundDeep,
    M.leafSheetGroundWet,
    M.leafSheetGroundRust,
    M.leafSheetGroundLight
  ];

  const buckets = [];
  for (let g = 0; g < geos.length; g++) {
    for (let m = 0; m < mats.length; m++) {
      buckets.push({ geoIndex: g, matIndex: m, matrices: [] });
    }
  }

  const up = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const qAlign = new THREE.Quaternion();
  const qSpin = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (let i = 0; i < TOTAL_SHEETS; i++) {
    const spot = pickLeafSpot(rand);
    const surf = sampleSurface(spot.x, spot.z);
    const layer = i % (BUDGET.groundLeafLayers || 3);
    const lift = (surf.onStep ? 0.008 : 0.012) + layer * 0.004 + rand() * 0.004;

    pos.set(surf.x, surf.y + lift, surf.z);
    qAlign.setFromUnitVectors(up, surf.normal);
    qSpin.setFromAxisAngle(surf.normal, rand() * Math.PI * 2);
    qAlign.premultiply(qSpin);

    const sc = 0.72 + rand() * 0.68;
    scl.set(sc, 1, sc * (0.85 + rand() * 0.3));
    m4.compose(pos, qAlign, scl);

    const gIdx = i % geos.length;
    const mPick = rand();
    const mIdx = mPick < 0.32 ? 0 : mPick < 0.62 ? 1 : mPick < 0.84 ? 2 : mPick < 0.94 ? 3 : 4;
    buckets[gIdx * mats.length + mIdx].matrices.push(m4.clone());
  }

  let meshCount = 0;
  for (const b of buckets) {
    if (!b.matrices.length) continue;
    const inst = new THREE.InstancedMesh(geos[b.geoIndex], mats[b.matIndex], b.matrices.length);
    inst.name = `leafLitter-g${b.geoIndex + 1}-m${b.matIndex + 1}`;
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.userData.noCast = true;
    inst.userData.noOutline = true;
    for (let i = 0; i < b.matrices.length; i++) {
      inst.setMatrixAt(i, b.matrices[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    root.add(inst);
    meshCount += 1;
  }

  root.userData.samples = [
    { x: 2.4, z: 8.0 },
    { x: 4.5, z: 2.0 },
    { x: -4.8, z: 6.0 },
    { x: -11.0, z: 4.0 },
    { x: 0.3, z: 5.0 }
  ];
  root.userData.support = {
    host: {
      x: [-CONTENT_HALF, CONTENT_HALF],
      y: [-0.1, 11.4],
      z: [-CONTENT_HALF, CONTENT_HALF]
    }
  };
  root.userData.sheetCount = TOTAL_SHEETS;
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}

export default createLeafLitter;
