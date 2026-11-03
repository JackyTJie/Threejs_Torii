/**
 * 散落湿石块（PATH_SYSTEM.wetRock）
 *
 * 16 颗独立建模的石块，分布在溪岸（6）、参道两侧泥地（6）、右侧坡地（4）。
 * 每颗独立 rockGeometry / 独立 Mesh / 独立 UV 采样，另带 1–2 颗碎石（独立小几何）。
 *
 * 与 stream-stones.js 共用同一套「顶面反解」配方：顶面 = terrainHeight(x,z) + r × 1.2，
 * 因为 layout.js 的 MOSS_PATCHES 里 6 处「石上青苔」的承托面就是按这个公式算的
 * （wetRock index 0–5）。石头顶不精确对齐 ⇒ 青苔悬空或埋进石头里。
 *
 * 形状参数与溪石不同：陆地石块要「钝」而不是「圆」，所以 wobble 0.26 / flatten 0.635，
 * 埋深 = 2·flatten·(1+wobble)·r − 1.2r = 0.40r（amp 回退到最小时 0.11r）。
 * flatten 0.635 是把埋深压下来的关键：用默认 flatten 0.78 会埋进 1.02r，
 * 最大的 r = 0.36 会往下陷 0.37 m，石块只剩一个帽顶，比例就崩了。
 *
 * 材质：溪岸 / 参道两侧用 stoneRockWet（clearcoat 0.7 湿膜高光）为主，
 * 坡地以 stoneRock（带 applyWeathering + applyMossAttachment 的干石）为主 ——
 * 雨后场景里坡地石块干得比溪岸边快，这个干湿差是「明暗层次」的一部分。
 *
 * 校验：wetRock ∈ PATH_SYSTEM ⇒ R2 走廊 / R4 鸟居净空跳过（石块本来就在路肩上），
 * 但 R3 溪谷净空仍然生效 ⇒ 必须用 userData.samples 给出 16 个真实落点，
 * 否则 asset-check 会拿整组的 9 个包围盒角点去判，(-8.9, -10.8) 这种「并不存在」的
 * 角点会掉进溪水范围里，报一个假错。
 * R5/R6：改用 support.host 包络盒。包络盒由 layout 表（落点 + 半径）与逐点采样地形
 * 推出，不从网格包围盒反推 ⇒ 它是一条可被证伪的断言，而不是自我循环。
 *   x/z：落点 ± 1.55r（石块水平外沿 r(1+wobble)·scale ≤ 1.41r，碎石外沿 ≤ 1.47r）
 *   y：[min(地面) − 0.20, max(地面 + 1.2r) + 0.06]
 */
import { WET_ROCKS, terrainHeight } from '../layout.js';
import { group, mesh, place, rng, rockGeometry, triplanarUv } from '../primitives.js';

const SEED_BASE = 4703;
const TOP_LIFT = 1.2;
const STONE_TILE = 0.42;
const GRAVEL_TILE = 0.16;
const STONE_SHAPE = { widthSegments: 22, heightSegments: 14, wobble: 0.26, flatten: 0.635 };
const GRAVEL_SHAPE = { widthSegments: 10, heightSegments: 7, wobble: 0.34, flatten: 0.6 };
/** 溪岸 / 路肩 / 坡地三段的 wet 概率：越靠近溪越湿 */
const WET_ODDS_BY_GROUP = [0.9, 0.6, 0.3];
const HOST_FOOT_FACTOR = 1.55;
const HOST_Y_SINK = 0.2;
const HOST_Y_RISE = 0.06;

function seatRock(geo, material, name, x, z, targetTop, rand, tile) {
  triplanarUv(geo, tile, [x, 0, z]);
  geo.computeBoundingBox();
  const node = mesh(geo, material, name);
  place(node, {
    x,
    y: targetTop - geo.boundingBox.max.y,
    z,
    ry: rand() * Math.PI * 2,
    sx: 1 + (rand() - 0.5) * 0.26,
    sy: 1 + (rand() - 0.5) * 0.1,
    sz: 1 + (rand() - 0.5) * 0.26
  });
  return node;
}

export function createWetRock(M) {
  const root = group('wetRock');
  const samples = [];
  const grounds = [];
  let meshCount = 0;

  let hostX0 = Infinity;
  let hostX1 = -Infinity;
  let hostZ0 = Infinity;
  let hostZ1 = -Infinity;
  let hostY0 = Infinity;
  let hostY1 = -Infinity;

  WET_ROCKS.forEach((spec, index) => {
    const seed = SEED_BASE + index * 137;
    const rand = rng(seed);
    const { x, z, r } = spec;
    const ground = terrainHeight(x, z);
    const top = ground + r * TOP_LIFT;
    const groupIndex = index < 6 ? 0 : index < 12 ? 1 : 2;
    const wet = rand() < WET_ODDS_BY_GROUP[groupIndex];

    const geo = rockGeometry(r, seed, STONE_SHAPE);
    const rock = seatRock(
      geo,
      wet ? M.stoneRockWet : M.stoneRock,
      `wetRock-${index + 1}`,
      x, z, top, rand, STONE_TILE
    );
    root.add(rock);
    meshCount += 1;
    samples.push({ x, z });
    grounds.push(ground);

    hostX0 = Math.min(hostX0, x - r * HOST_FOOT_FACTOR);
    hostX1 = Math.max(hostX1, x + r * HOST_FOOT_FACTOR);
    hostZ0 = Math.min(hostZ0, z - r * HOST_FOOT_FACTOR);
    hostZ1 = Math.max(hostZ1, z + r * HOST_FOOT_FACTOR);
    hostY0 = Math.min(hostY0, ground - HOST_Y_SINK);
    hostY1 = Math.max(hostY1, top + HOST_Y_RISE);

    // 碎石：贴着石块根部，顶面略高于泥地 ⇒ 读作「长在泥里的碎石」而不是悬空
    const gravelCount = 1 + (rand() < 0.6 ? 1 : 0);
    for (let i = 0; i < gravelCount; i += 1) {
      const gr = r * (0.18 + rand() * 0.14);
      const az = rand() * Math.PI * 2;
      const dist = r * (0.9 + rand() * 0.45);
      const gx = x + Math.cos(az) * dist;
      const gz = z + Math.sin(az) * dist;
      const gGeo = rockGeometry(gr, seed * 23 + i, GRAVEL_SHAPE);
      const gravel = seatRock(
        gGeo,
        rand() < 0.5 ? M.stoneRockWet : M.stonePebble,
        `wetRock-gravel-${index + 1}-${i + 1}`,
        gx, gz,
        terrainHeight(gx, gz) + 0.02,
        rand, GRAVEL_TILE
      );
      gravel.userData.noCast = true;
      gravel.userData.noOutline = true;
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
