/**
 * 散落山石露头（PATH_SYSTEM.wetRock）
 *
 * 将原先 16 颗孤立圆石全面升级为 16 组多网格天然劈理山石露头（共 ~160+ 个独立岩石 Mesh）：
 * 每组山石露头包含：
 * 1) 主劈理山石（wetRock-main）：高细分多面体切削山石，顶面精确对齐 terrainHeight(x,z) + r × 1.2（供石上青苔宿主对齐）；
 * 2) 冻裂伴生副石（wetRock-split，2 块）：沿岩层节理裂隙错位倚靠在主石旁，采用分层劈理岩（stoneRockStratified）与冷灰安山岩（stoneRock）；
 * 3) 根部层状基座石板（wetRock-plate，1~2 块）：使用锐棱凸多边形石板（slabGeometry）半埋在主石根部潮湿泥土中；
 * 4) 散落棱角碎石片（wetRock-chip，4~5 颗）：围绕石根散落的尖锐碎石与扁平砾石，全部严格约束在 support.host 包络盒内。
 */
import { WET_ROCKS, clamp, terrainHeight } from '../layout.js';
import { group, mesh, place, rng, rockGeometry, slabGeometry, triplanarUv } from '../primitives.js';

const SEED_BASE = 4703;
const TOP_LIFT = 1.2;
const STONE_TILE = 0.42;
const GRAVEL_TILE = 0.16;

const MAIN_STONE_SHAPE = { widthSegments: 26, heightSegments: 18, wobble: 0.28, flatten: 0.635 };
const SPLIT_STONE_SHAPE = { widthSegments: 20, heightSegments: 14, wobble: 0.30, flatten: 0.58 };
const CHIP_SHAPE = { widthSegments: 12, heightSegments: 8, wobble: 0.36, flatten: 0.46 };

const WET_ODDS_BY_GROUP = [0.75, 0.45, 0.25];
const HOST_FOOT_FACTOR = 1.55;
const HOST_Y_SINK = 0.2;
const HOST_Y_RISE = 0.06;

function makePlateRing(rx, rz, rand, sides = 6) {
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (rand() - 0.5) * 0.22;
    const k = 0.8 + rand() * 0.26;
    ring.push([Math.cos(a) * rx * k, Math.sin(a) * rz * k]);
  }
  return ring;
}

function seatRock(geo, material, name, x, z, targetTop, rand, tile, sxRange = 0.26) {
  triplanarUv(geo, tile, [x, 0, z]);
  geo.computeBoundingBox();
  const node = mesh(geo, material, name);
  const sx = 1 + (rand() - 0.5) * sxRange;
  const sy = 1 + (rand() - 0.5) * 0.08;
  const sz = 1 + (rand() - 0.5) * sxRange;
  place(node, {
    x,
    y: targetTop - geo.boundingBox.max.y * sy,
    z,
    ry: rand() * Math.PI * 2,
    sx,
    sy,
    sz
  });
  return node;
}

export function createWetRock(M) {
  const root = group('wetRock');
  const samples = [];
  let meshCount = 0;

  let hostX0 = Infinity;
  let hostX1 = -Infinity;
  let hostZ0 = Infinity;
  let hostZ1 = -Infinity;
  let hostY0 = Infinity;
  let hostY1 = -Infinity;

  const stratMat = M.stoneRockStratified || M.stoneRock;
  const chipMat = M.stoneChip || M.stonePebble;

  WET_ROCKS.forEach((spec, index) => {
    const seed = SEED_BASE + index * 137;
    const rand = rng(seed);
    const { x, z, r } = spec;
    const ground = terrainHeight(x, z);
    const top = ground + r * TOP_LIFT;
    const groupIndex = index < 6 ? 0 : index < 12 ? 1 : 2;
    const wet = rand() < WET_ODDS_BY_GROUP[groupIndex];

    const footLimit = r * HOST_FOOT_FACTOR;
    hostX0 = Math.min(hostX0, x - footLimit);
    hostX1 = Math.max(hostX1, x + footLimit);
    hostZ0 = Math.min(hostZ0, z - footLimit);
    hostZ1 = Math.max(hostZ1, z + footLimit);
    hostY0 = Math.min(hostY0, ground - HOST_Y_SINK);
    hostY1 = Math.max(hostY1, top + HOST_Y_RISE);

    // 1. 主节理山石（顶面锁定为 ground + r * 1.2；约半数湿石采用覆苔山石材质 M.stoneRockMossy）
    const geo = rockGeometry(r, seed, MAIN_STONE_SHAPE);
    const mossyMat = M.stoneRockMossy || M.stoneRockWet;
    const mainMat = index % 2 === 0
      ? mossyMat
      : wet
        ? M.stoneRockWet
        : (index % 3 === 0 ? stratMat : M.stoneRock);
    const rock = seatRock(geo, mainMat, `wetRock-${index + 1}`, x, z, top, rand, STONE_TILE, 0.24);
    root.add(rock);
    meshCount += 1;
    samples.push({ x, z });

    // 2. 冻裂伴生副石（2 块，紧邻主石侧翼，营造山石劈裂咬合感）
    for (let s = 0; s < 2; s++) {
      const sr = r * (0.44 + rand() * 0.16);
      const az = s * Math.PI + (rand() - 0.5) * 0.85;
      const dist = r * (0.52 + rand() * 0.18);
      const sx = clamp(x + Math.cos(az) * dist, x - footLimit + sr * 1.25, x + footLimit - sr * 1.25);
      const sz = clamp(z + Math.sin(az) * dist, z - footLimit + sr * 1.25, z + footLimit - sr * 1.25);
      const sGround = terrainHeight(sx, sz);
      const sTop = Math.min(top - 0.03, sGround + r * (0.58 + rand() * 0.26));
      const sGeo = rockGeometry(sr, seed * 17 + s * 41, SPLIT_STONE_SHAPE);
      const sMat = s === 0 ? stratMat : (wet ? M.stoneRock : M.stoneRockWet);
      const splitNode = seatRock(sGeo, sMat, `wetRock-split-${index + 1}-${s + 1}`, sx, sz, sTop, rand, STONE_TILE, 0.18);
      root.add(splitNode);
      meshCount += 1;
    }

    // 3. 根部层状基座石板（1~2 块锐棱 slabGeometry）
    const plateCount = 1 + (index % 2);
    for (let p = 0; p < plateCount; p++) {
      const az = rand() * Math.PI * 2;
      const dist = r * (0.48 + rand() * 0.22);
      const prx = r * (0.38 + rand() * 0.14);
      const prz = r * (0.28 + rand() * 0.12);
      const px = clamp(x + Math.cos(az) * dist, x - footLimit + prx * 1.2, x + footLimit - prx * 1.2);
      const pz = clamp(z + Math.sin(az) * dist, z - footLimit + prz * 1.2, z + footLimit - prz * 1.2);
      const pGround = terrainHeight(px, pz);
      const thick = 0.045 + rand() * 0.025;
      const pGeo = triplanarUv(slabGeometry(makePlateRing(prx, prz, rand, 6), thick), STONE_TILE, [px, 0, pz]);
      const plate = mesh(pGeo, stratMat, `wetRock-plate-${index + 1}-${p + 1}`);
      place(plate, {
        x: px,
        y: Math.max(hostY0 + thick + 0.02, pGround + 0.028 + rand() * 0.02),
        z: pz,
        ry: rand() * Math.PI * 2
      });
      root.add(plate);
      meshCount += 1;
    }

    // 4. 根部散落棱角碎石片（4~5 颗 Scree Chips）
    const chipCount = 4 + (index % 2);
    for (let i = 0; i < chipCount; i += 1) {
      const gr = r * (0.14 + rand() * 0.12);
      const az = rand() * Math.PI * 2;
      const dist = r * (0.75 + rand() * 0.36);
      const gx = clamp(x + Math.cos(az) * dist, x - footLimit + gr * 1.3, x + footLimit - gr * 1.3);
      const gz = clamp(z + Math.sin(az) * dist, z - footLimit + gr * 1.3, z + footLimit - gr * 1.3);
      const gGround = terrainHeight(gx, gz);
      const gGeo = rockGeometry(gr, seed * 23 + i * 19, CHIP_SHAPE);
      const gMat = i % 3 === 0 ? chipMat : i % 3 === 1 ? M.stoneRock : M.stonePebble;
      const gravel = seatRock(
        gGeo,
        gMat,
        `wetRock-gravel-${index + 1}-${i + 1}`,
        gx,
        gz,
        Math.min(top - 0.04, Math.max(hostY0 + gr * 1.5, gGround + 0.025 + rand() * 0.02)),
        rand,
        GRAVEL_TILE,
        0.2
      );
      gravel.userData.noCast = true;
      gravel.userData.noOutline = i >= 2;
      root.add(gravel);
      meshCount += 1;
    }
  });

  root.userData.samples = samples;
  root.userData.support = {
    host: {
      x: [hostX0, hostX1],
      y: [hostY0, hostY1],
      z: [hostZ0, hostZ1]
    }
  };
  root.userData.rockCount = WET_ROCKS.length;
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}

export default createWetRock;
