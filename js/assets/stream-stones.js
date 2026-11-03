/**
 * 溪内复合乱石群（WATER_SYSTEM.streamStones）
 *
 * 将原先单调的 8 颗圆石全面升级为 8 组多网格咬合的山涧乱石群（共 ~110+ 个独立岩石 Mesh）：
 * 每组包含：
 * 1) 主劈理山石（streamStone-main）：多面体劈理切削岩体，顶面严格锁定在 terrainHeight(x,z) + r × 1.2（供石上青苔精确落座）；
 * 2) 迎水/背水伴生护肩副石（streamStone-flank，2~3 块）：紧贴主石侧翼斜靠咬合，采用分层板岩（stoneRockStratified）与深色湿石交替；
 * 3) 近水面层理挑出石板（streamStone-ledge，2 块）：以凸多边形锐棱石板（slabGeometry）从主石根部水平挑出，形成水流漫过的天然石阶层理；
 * 4) 迎水石窝与背水尾流区的棱角河卵石与碎石片（streamStone-cobble / chip，6~8 颗）：大小错落、扁平度各异，消除孤立圆球感。
 */
import { STREAM_STONES, terrainHeight, waterY } from '../layout.js';
import { group, mesh, place, rng, rockGeometry, slabGeometry, triplanarUv } from '../primitives.js';

const SEED_BASE = 6107;
const TOP_LIFT = 1.2;
const STONE_TILE = 0.35;
const GRAVEL_TILE = 0.16;

const MAIN_STONE_SHAPE = { widthSegments: 26, heightSegments: 18, wobble: 0.24, flatten: 0.62 };
const FLANK_STONE_SHAPE = { widthSegments: 20, heightSegments: 14, wobble: 0.28, flatten: 0.56 };
const COBBLE_SHAPE = { widthSegments: 14, heightSegments: 10, wobble: 0.32, flatten: 0.52 };
const CHIP_SHAPE = { widthSegments: 10, heightSegments: 7, wobble: 0.36, flatten: 0.42 };

function stoneTop(x, z, r) {
  return terrainHeight(x, z) + r * TOP_LIFT;
}

function makeLedgeRing(rx, rz, rand, sides = 7) {
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    const k = 0.82 + rand() * 0.28;
    ring.push([Math.cos(a) * rx * k, Math.sin(a) * rz * k]);
  }
  return ring;
}

function seatRock(geo, material, name, x, z, targetTop, rand, isMain) {
  triplanarUv(geo, isMain ? STONE_TILE : GRAVEL_TILE, [x, 0, z]);
  geo.computeBoundingBox();
  const node = mesh(geo, material, name);
  place(node, {
    x,
    y: targetTop - geo.boundingBox.max.y,
    z,
    ry: rand() * Math.PI * 2,
    sx: isMain ? 1 + (rand() - 0.5) * 0.28 : 1 + (rand() - 0.5) * 0.34,
    sy: 1,
    sz: isMain ? 1 + (rand() - 0.5) * 0.28 : 1 + (rand() - 0.5) * 0.34
  });
  return node;
}

export function createStreamStones(M) {
  const root = group('streamStones');
  const samples = [];
  let meshCount = 0;

  const rockMats = [
    M.stoneRockMossy || M.stoneRockWet,
    M.stoneRockWet,
    M.stoneRockStratified || M.stoneRock,
    M.stoneStream,
    M.stoneRock
  ];

  STREAM_STONES.forEach((spec, index) => {
    const seed = SEED_BASE + index * 131;
    const rand = rng(seed);
    const { x, z, r } = spec;
    const ground = terrainHeight(x, z);
    const wy = waterY(z);
    const mainTop = stoneTop(x, z, r);

    // 1. 主劈理大石（顶面精确对齐 stoneTop；半数主石使用覆苔山石材质 M.stoneRockMossy）
    const mainGeo = rockGeometry(r, seed, MAIN_STONE_SHAPE);
    const mainMat = index % 2 === 0
      ? (M.stoneRockMossy || M.stoneRockWet)
      : index % 3 === 0
        ? (M.stoneRockStratified || M.stoneRockWet)
        : M.stoneRockWet;
    const mainStone = seatRock(mainGeo, mainMat, `streamStone-${index + 1}`, x, z, mainTop, rand, true);
    root.add(mainStone);
    meshCount += 1;
    samples.push({ x, z });

    // 2. 伴生护肩副石（2~3 块，斜靠在主石迎水/侧翼，形成有主次层次的复合山石组）
    const flankCount = 2 + (index % 2);
    for (let f = 0; f < flankCount; f++) {
      const fr = r * (0.48 + rand() * 0.22);
      const ang = (f / flankCount) * Math.PI * 2 + rand() * 0.7;
      const dist = r * (0.58 + rand() * 0.24);
      const fx = x + Math.cos(ang) * dist;
      const fz = z + Math.sin(ang) * dist;
      const fTop = ground + r * (0.62 + rand() * 0.32);
      const fGeo = rockGeometry(fr, seed * 19 + f * 37, FLANK_STONE_SHAPE);
      const fMat = rockMats[(index + f) % rockMats.length];
      const flank = seatRock(fGeo, fMat, `streamStone-flank-${index + 1}-${f + 1}`, fx, fz, fTop, rand, true);
      flank.rotation.x = (rand() - 0.5) * 0.22;
      flank.rotation.z = (rand() - 0.5) * 0.22;
      // 浸没在水面附近的矮副石不加黑边壳体，避免水中出现孤立黑线圈
      if (fTop <= waterY(fz) + 0.04) flank.userData.noOutline = true;
      root.add(flank);
      meshCount += 1;
    }

    // 3. 近水面层理挑出石板（2 块锐棱 slabGeometry，营造岩石节理台阶感）
    for (let l = 0; l < 2; l++) {
      const ang = l * Math.PI + (rand() - 0.5) * 0.8;
      const lx = x + Math.cos(ang) * r * 0.65;
      const lz = z + Math.sin(ang) * r * 0.65;
      const rx = r * (0.52 + rand() * 0.22);
      const rz = r * (0.38 + rand() * 0.18);
      const thick = 0.055 + rand() * 0.035;
      const lGeo = triplanarUv(slabGeometry(makeLedgeRing(rx, rz, rand, 7), thick), STONE_TILE, [lx, 0, lz]);
      const ledgeY = Math.max(ground + thick + 0.02, wy + (l === 0 ? 0.025 : -0.008));
      const ledge = mesh(lGeo, M.stoneRockStratified || M.stoneRock, `streamStone-ledge-${index + 1}-${l + 1}`);
      place(ledge, { x: lx, y: ledgeY, z: lz, ry: rand() * Math.PI * 2 });
      ledge.rotation.x = (rand() - 0.5) * 0.12;
      ledge.rotation.z = (rand() - 0.5) * 0.12;
      ledge.userData.noOutline = true;
      root.add(ledge);
      meshCount += 1;
    }

    // 4. 迎水石窝与背水尾流区的棱角溪石与碎石片（6~8 颗，全部浸泡于水中或贴近水线，不加黑边壳体以展现清澈水底实石质感）
    const cobbleCount = 6 + (index % 3);
    for (let i = 0; i < cobbleCount; i += 1) {
      const isChip = i >= 4;
      const gr = r * (isChip ? 0.15 + rand() * 0.10 : 0.24 + rand() * 0.15);
      const az = rand() * Math.PI * 2;
      const dist = r * (0.78 + rand() * 0.68);
      const gx = x + Math.cos(az) * dist;
      const gz = z + Math.sin(az) * dist;
      const gGround = terrainHeight(gx, gz);
      const gGeo = rockGeometry(gr, seed * 29 + i * 13, isChip ? CHIP_SHAPE : COBBLE_SHAPE);
      const gMat = isChip
        ? (M.stoneChip || M.stonePebble)
        : (i % 3 === 0 ? (M.stoneRockStratified || M.stoneStream) : i % 2 === 0 ? M.stoneStream : M.stoneRock);
      const topTarget = i < 2
        ? wy + 0.012 + rand() * 0.022
        : Math.min(waterY(gz) - 0.012, gGround + 0.048 + rand() * 0.032);
      const cobble = seatRock(
        gGeo,
        gMat,
        `streamStone-cobble-${index + 1}-${i + 1}`,
        gx,
        gz,
        topTarget,
        rand,
        false
      );
      cobble.rotation.x = (rand() - 0.5) * 0.25;
      cobble.rotation.z = (rand() - 0.5) * 0.25;
      cobble.userData.noCast = isChip;
      cobble.userData.noOutline = true;
      root.add(cobble);
      meshCount += 1;
    }
  });

  root.userData.samples = samples;
  root.userData.stoneCount = STREAM_STONES.length;
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}

export default createStreamStones;
