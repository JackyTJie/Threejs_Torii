// 底座：规整正方形深灰基座（微缩模型的"展台"）。
// 顶面 / 倒角带 / 侧壁分成三个独立网格，各自一套材质，不合并、不加 group 多材质。
// chamferedSlabGeometry 的 uv 在 mergeInto 后与 position 长度不一致，因此这里
// 只取 position 重建分桶几何（pad 三套材质都没有 map，不需要 uv）。
import * as THREE from 'three';
import { chamferedSlabGeometry, group, mesh } from '../primitives.js';
import { PAD } from '../layout.js';

const TOP_NORMAL = 0.8;
const CHAMFER_NORMAL = 0.15;

/** 按面法线把非索引三角分到指定桶，重建为独立几何 */
function bucketByNormal(source, accept) {
  const src = source.getAttribute('position');
  const keep = [];
  for (let i = 0; i + 2 < src.count; i += 3) {
    const ax = src.getX(i), ay = src.getY(i), az = src.getZ(i);
    const bx = src.getX(i + 1), by = src.getY(i + 1), bz = src.getZ(i + 1);
    const cx = src.getX(i + 2), cy = src.getY(i + 2), cz = src.getZ(i + 2);
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    if (!accept(ny / len, nx / len, nz / len)) continue;
    keep.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createBasePad(M, options = {}) {
  const half = options.half ?? PAD.half;
  const thickness = options.thickness ?? PAD.thickness;
  const chamfer = options.chamfer ?? PAD.chamfer;

  const slab = chamferedSlabGeometry(half, thickness, chamfer, 3);
  slab.rotateX(-Math.PI / 2);

  const top = bucketByNormal(slab, (ny) => ny > TOP_NORMAL);
  const chamferBand = bucketByNormal(slab, (ny) => ny > CHAMFER_NORMAL && ny <= TOP_NORMAL);
  const skirt = bucketByNormal(slab, (ny) => ny <= CHAMFER_NORMAL);

  const root = group('basePad');
  root.userData.assetName = 'basePad';

  const topMesh = mesh(top, M.padTop, 'padTop');
  const chamferMesh = mesh(chamferBand, M.padChamfer, 'padChamfer');
  const skirtMesh = mesh(skirt, M.padEdge, 'padEdge');
  for (const piece of [topMesh, chamferMesh, skirtMesh]) {
    piece.userData.noOutline = true;
    root.add(piece);
  }

  //  slab 居中于 ±thickness/2；让顶面正好落在 PAD.topY
  root.position.set(0, PAD.topY - thickness / 2, 0);
  root.updateMatrixWorld(true);
  return root;
}
