/**
 * 溪内湿石（WATER_SYSTEM.streamStones）
 *
 * 8 颗水冲卵石，逐颗独立建模（独立 rockGeometry / 独立 Mesh / 独立 UV 采样），
 * 不实例化、不合并、不共享几何。每颗另带 1–2 颗水线以下的砾石，把石头「坐」在溪床里。
 *
 * 顶面标高为什么钉死在 terrainHeight(x,z) + r × 1.2：
 *   layout.js 的 MOSS_PATCHES 用 `terrainHeight(ref.x,ref.z) + ref.r * 1.2` 作为
 *   「石上青苔」的承托面标高。石头顶必须正好落在这个高度，否则青苔斑块要么悬在石头
 *   上空、要么整块埋进石头里。rockGeometry 的包围盒高度随 wobble / flatten 变化，
 *   还会因为防翻面重试把振幅 amp 逐级回退，所以这里不用公式推高度，
 *   而是 computeBoundingBox() 之后按 bbox.max.y 反解 y ⇒ 顶面精确等于声称标高。
 *
 * 埋入深度：height = 2·flatten·(r + amp)，埋深 = height − 1.2r。
 *   取 flatten 0.62 / wobble 0.18 ⇒ 埋深 0.263r；amp 被回退到最小时仍有 0.10r，
 *   石头永远坐在溪床内，不会浮在水面上。露出水面高度 = 1.2r − (waterY − ground)
 *   = 1.2r − 0.11 ⇒ 最小的 r = 0.22 也露出 0.154 m，是「半截出水的光滑溪石」而不是全淹。
 *
 * 材质分工（六大类材质里的「石材·水冲」子类）：
 *   主石 stoneRockWet（clearcoat 0.7 的湿膜高光，出水那半截的湿润反光）
 *   砾石 stoneStream（水底石，色温更冷、无 clearcoat，读作「在水下」）
 *   triplanarUv tile = 0.35 m：对 0.22–0.32 m 的石头正好「一颗石头一遍纹理」，
 *   offset 取世界坐标 ⇒ 每颗采样 stoneTexture 的不同区域，不会出现八颗一样的花纹。
 *
 * 校验：streamStones ∈ WATER_SYSTEM ⇒ R2 走廊 / R3 溪谷 / R4 鸟居 / R5 接地 / R6 宿主
 *   全部跳过，只剩 R1 底座范围。石头本来就该泡在水里，越出岸线是想要的效果。
 */
import { STREAM_STONES, terrainHeight, waterY } from '../layout.js';
import { group, mesh, place, rng, rockGeometry, triplanarUv } from '../primitives.js';

const SEED_BASE = 6107;
const TOP_LIFT = 1.2;
const STONE_TILE = 0.35;
const GRAVEL_TILE = 0.16;
const STONE_SHAPE = { widthSegments: 20, heightSegments: 13, wobble: 0.18, flatten: 0.62 };
const GRAVEL_SHAPE = { widthSegments: 10, heightSegments: 7, wobble: 0.3, flatten: 0.58 };
const WET_ODDS = 0.75;

/** 石头顶面标高：与 MOSS_PATCHES 的 rock host 公式严格一致 */
function stoneTop(x, z, r) {
  return terrainHeight(x, z) + r * TOP_LIFT;
}

/** 把一颗 rockGeometry 的顶面摆到 targetTop，返回该 Mesh */
function seatRock(geo, material, name, x, z, targetTop, rand, isMain) {
  triplanarUv(geo, isMain ? STONE_TILE : GRAVEL_TILE, [x, 0, z]);
  geo.computeBoundingBox();
  const node = mesh(geo, material, name);
  place(node, {
    x,
    y: targetTop - geo.boundingBox.max.y,
    z,
    ry: rand() * Math.PI * 2,
    sx: isMain ? 1 + (rand() - 0.5) * 0.24 : 1 + (rand() - 0.5) * 0.3,
    sy: 1,
    sz: isMain ? 1 + (rand() - 0.5) * 0.24 : 1 + (rand() - 0.5) * 0.3
  });
  return node;
}

export function createStreamStones(M) {
  const root = group('streamStones');
  const samples = [];
  let meshCount = 0;

  STREAM_STONES.forEach((spec, index) => {
    const seed = SEED_BASE + index * 131;
    const rand = rng(seed);
    const { x, z, r } = spec;
    const ground = terrainHeight(x, z);

    const geo = rockGeometry(r, seed, STONE_SHAPE);
    const stone = seatRock(
      geo,
      rand() < WET_ODDS ? M.stoneRockWet : M.stoneStream,
      `streamStone-${index + 1}`,
      x, z,
      stoneTop(x, z, r),
      rand,
      true
    );
    root.add(stone);
    meshCount += 1;
    samples.push({ x, z });

    // 水线以下的砾石：顶面压在溪床之上一点点，永远低于水面（waterY − ground ≈ 0.11）
    const gravelCount = 1 + (rand() < 0.55 ? 1 : 0);
    for (let i = 0; i < gravelCount; i += 1) {
      const gr = r * (0.2 + rand() * 0.13);
      const az = rand() * Math.PI * 2;
      const dist = r * (0.85 + rand() * 0.5);
      const gx = x + Math.cos(az) * dist;
      const gz = z + Math.sin(az) * dist;
      const gGeo = rockGeometry(gr, seed * 17 + i, GRAVEL_SHAPE);
      const gravel = seatRock(
        gGeo,
        M.stoneStream,
        `streamStone-gravel-${index + 1}-${i + 1}`,
        gx, gz,
        Math.min(waterY(gz) - 0.03, ground + 0.045),
        rand,
        false
      );
      gravel.userData.noCast = true;
      gravel.userData.noOutline = true;
      root.add(gravel);
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
