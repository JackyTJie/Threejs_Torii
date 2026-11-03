/**
 * 青苔斑（PATH_SYSTEM + WATER_SYSTEM.mossPatch）
 *
 * 30 处独立建模的苔群，按 layout.js 的 MOSS_PATCHES 分三类宿主：
 * 12 处「立面青苔」贴在各级石板的 riser 面上、10 处「石上青苔」长在湿石块 / 溪石顶面、
 * 8 处「苔毯」铺在树基与坡地。每群由 5–9 枚苔片（flakes）+ 1–3 枚苔瘤（lumps）
 * + 2–4 颗苔中碎石（pebbles）+ 0–3 层苔膜（films）组成，逐件独立几何、独立材质。
 *
 * —— 台阶宿主：为什么苔片必须朝 +z 摊开
 * 第 k 级石板的 riser 是平面 z = frontZ(k)，跨越 y ∈ [stepTopY(k)−rise, stepTopY(k)]；
 * 它前面那块踏面属于第 k−1 级，范围 z ∈ [frontZ(k), frontZ(k)+tread]、标高
 * stepTopY(k−1) = stepTopY(k)−rise = 本群宿主标高。所以群落原点正好落在
 * 「riser 与踏面的那条棱」上；在宿主标高这一层，z < frontZ(k) 是第 k 级石板内部，
 * 苔片往那里长就被埋进石头里 ⇒ 台阶上的苔片一律朝 +z（观者方向）偏置，
 * 读作「从 riser 根部爬出来、漫过半张踏面的一条苔带」。
 *
 * —— 立面苔膜：rotateX(π/2) 把横卧的薄壳立起来
 * rockGeometry 的薄轴是 Y（flatten 0.16）。绕 X 转 90° 后 old z → new y、old y → new z，
 * 薄轴变成 Z、穹顶变成竖直的一片，正好贴住 riser。取高度 fh ∈ [0.09, 0.145]，
 * 反解 rf = fh / (2(1+wobble))（bbox 竖直向 = ±(rf+amp)），使苔膜高度正好等于 riser 高 0.145：
 * 苔膜顶不超过 riser 顶、底边往踏面转角里陷 12 mm，读作「转角处长出来的一层」。
 * 沿 z 的层厚 = (0.65+1.35)·flatten·(rf+amp) ≈ 0.43rf ≈ 16–25 mm，只往 riser 面外凸出
 * 这么多，另外 6 mm 埋进石面 —— 太厚就成了挂在石头上的气球。
 *
 * —— 石块宿主：苔片半径为什么封顶 0.14
 * 石块顶面不是平面，曲率半径 ≈ (r+amp)/(2·flatten)。wetRock 的 r = 0.30 时约 0.30 m，
 * 一枚半径 0.20 的平苔片边缘要高出石面 0.20²/(2·0.30) ≈ 67 mm —— 苔变成悬在石头上的盘子。
 * 所以石块宿主把苔片半径压到 ≤ 0.14，并按尺寸加大嵌入量（0.012 + 0.10·rf），
 * 让苔片边缘真正陷进石面里。
 *
 * —— 为什么群落本身不绕 Y 旋转（与示例工程的偏差）
 * 示例工程给整个群落 group 一个 rotation.y。立面苔膜必须与 riser 面平行，
 * 群落一转就斜插进石板里；所以这里群落不转，朝向逐构件给 ry。
 * 代价是苔群的「整体朝向」要靠落点分布打散，靠 rng(seed) 保证确定性。
 *
 * —— 材质（与示例工程的偏差）
 * 示例用的 mossGround / mossFilm / mossThick / rockChip 在本工程不存在，按语义映射：
 * 苔片 mossPatch ↔ mossDamp 交替、水平苔膜 mossWet、立面苔膜 mossStone
 * （带 applyMossAttachment，按高度往石面上长苔，正是立面该有的读法）、苔瘤 mossDamp、
 * 苔中碎石 mossStone。materials.js 明确写了「柔软地面苔壳由资产层标 noOutline」⇒
 * 苔件全部 noOutline（描边壳体会把 2 cm 厚的软苔壳变成一块黑盘子），
 * 只有苔中碎石保留描边，让它读作苔里露出的硬石。全部 noCast：苔不投影。
 *
 * 校验：mossPatch 同时属于 PATH_SYSTEM 与 WATER_SYSTEM ⇒ R2 走廊 / R3 溪谷 / R4 鸟居净空
 * 全部跳过（苔本来就长在路肩、石面和溪石上），只剩 R1 底座范围与 R6 宿主包含。
 * R6 的宿主盒由 layout 表推出（不从网格包围盒反推，避免自我循环）：
 *   台阶宿主 x [max(PATH.x0, x−1.4r), min(PATH.x1, x+1.4r)]、z [frontZ−0.02, frontZ+tread]、
 *            y [宿主标高−0.035, 宿主标高+rise+0.015]
 *   石块 / 坡地宿主 x/z 落点 ±1.4r、y [宿主标高−0.04, 宿主标高+0.14]
 * 每个构件按「自己绕 Y 转完之后的世界半外延」反解 clamp（转完的 AABB 半外延
 * = ex|cos|+ez|sin|，比直接拿 ex/ez 严格），放不下就缩尺寸 ⇒ 群落包围盒必然落在
 * 各自宿主盒内，宿主盒的并集必然包住整组包围盒，R6 可过。
 */
import { MOSS_PATCHES, PATH, frontZ, clamp } from '../layout.js';
import { group, mesh, place, rng, rockGeometry, triplanarUv } from '../primitives.js';

export const MOSS_PATCH_MODEL = { radius: 0.5, height: 0.15 };

const SEED_BASE = 7301;
const SEED_STRIDE = 173;

/** 苔壳贴图的世界平铺尺寸（米）：苔是细碎的东西，贴图必须比石块贴图密得多 */
const FLAKE_TILE = 0.34;
const FILM_TILE = 0.22;
const LUMP_TILE = 0.28;
const PEBBLE_TILE = 0.12;

const FLAKE_SHAPE = { widthSegments: 14, heightSegments: 8, wobble: 0.5, flatten: 0.15 };
const FILM_SHAPE = { widthSegments: 12, heightSegments: 7, wobble: 0.34, flatten: 0.16 };
const LUMP_SHAPE = { widthSegments: 12, heightSegments: 9, wobble: 0.62, flatten: 0.46 };
const PEBBLE_SHAPE = { widthSegments: 9, heightSegments: 6, wobble: 0.42, flatten: 0.6 };

/** 立面苔膜的竖直高度（米）：上限取 riser 高 0.145，超过就翻过踏板 */
const FILM_HEIGHT = [0.09, 0.145];
const FILM_SINK = 0.012;
const FILM_EMBED = 0.006;

/** 苔片嵌入宿主的深度（米）；石块宿主按尺寸加大，见文件头 */
const SINK_BY_HOST = { step: 0.01, ground: 0.014 };
const ROCK_SINK_BASE = 0.012;
const ROCK_SINK_GAIN = 0.1;
const ROCK_FLAKE_MAX = 0.14;

/** 苔片半径 / 群落半径 */
const FLAKE_RADIUS = { step: [0.22, 0.36], rock: [0.22, 0.34], ground: [0.3, 0.52] };
const LUMP_RADIUS = [0.14, 0.26];
const PEBBLE_RADIUS = [0.07, 0.13];

const MIX = {
  step: { flakes: [5, 8], films: [2, 3], lumps: [1, 2], pebbles: [2, 3] },
  rock: { flakes: [4, 7], films: [0, 0], lumps: [1, 2], pebbles: [2, 3] },
  ground: { flakes: [6, 9], films: [1, 2], lumps: [2, 3], pebbles: [3, 4] }
};

/** 苔群整体朝阴面偏移：与示例工程一致的 shade 方向，让苔不是各向同性的圆饼 */
const SHADE_DIR = { x: 0.876, z: -0.396 };

/** R6 反解时留的余量，必须小于 layout 的宿主容差 0.06 */
const HOST_SLACK = 0.05;
const HOST_FOOT_FACTOR = 1.4;

function count(rand, range) {
  return range[0] + Math.floor(rand() * (range[1] - range[0] + 1));
}

function hostBox(p) {
  const foot = p.r * HOST_FOOT_FACTOR;
  if (p.host === 'step') {
    const fz = frontZ(p.step);
    return {
      x: [Math.max(PATH.x0, p.x - foot), Math.min(PATH.x1, p.x + foot)],
      y: [p.y - 0.035, p.y + PATH.rise + 0.015],
      z: [fz - 0.02, fz + PATH.tread]
    };
  }
  return {
    x: [p.x - foot, p.x + foot],
    y: [p.y - 0.04, p.y + 0.14],
    z: [p.z - foot, p.z + foot]
  };
}

/** 绕 Y 转 ry 之后的世界半外延：AABB 转完仍是 AABB，半外延 = ex|cos| + ez|sin| */
function extents(geo, sx, sz, ry) {
  const bb = geo.boundingBox;
  const ex = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * sx;
  const ez = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)) * sz;
  const c = Math.abs(Math.cos(ry));
  const s = Math.abs(Math.sin(ry));
  return { hwx: ex * c + ez * s, hwz: ex * s + ez * c };
}

/**
 * 通用落座：把「bbox.min.y = 宿主标高 − 嵌入量」反解成 Mesh 的 y，
 * 并按构件转完之后的真实外延把中心 clamp 进宿主盒；放不下就缩水平尺寸。
 * scale.y 必须在反解之前定下来（世界 min.y = node.y + bbox.min.y·sy）。
 */
function seatPart(geo, material, name, host, want, tile) {
  triplanarUv(geo, tile, [want.x, 0, want.z]);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  let sx = want.sx;
  let sy = want.sy;
  let sz = want.sz;
  let ext = extents(geo, sx, sz, want.ry);
  for (let guard = 0; guard < 6; guard++) {
    const fitsX = host.x[1] - host.x[0] + 2 * HOST_SLACK >= 2 * ext.hwx;
    const fitsZ = host.z[1] - host.z[0] + 2 * HOST_SLACK >= 2 * ext.hwz;
    const fitsY = want.bottom + bb.max.y * sy <= host.y[1] + HOST_SLACK;
    if (fitsX && fitsZ && fitsY) break;
    if (!fitsX || !fitsZ) { sx *= 0.82; sz *= 0.82; ext = extents(geo, sx, sz, want.ry); }
    if (!fitsY) sy *= 0.85;
  }
  const loX = host.x[0] + ext.hwx - HOST_SLACK;
  const hiX = host.x[1] - ext.hwx + HOST_SLACK;
  const loZ = host.z[0] + ext.hwz - HOST_SLACK;
  const hiZ = host.z[1] - ext.hwz + HOST_SLACK;
  const cx = loX <= hiX ? clamp(want.x, loX, hiX) : (host.x[0] + host.x[1]) / 2;
  const cz = loZ <= hiZ ? clamp(want.z, loZ, hiZ) : (host.z[0] + host.z[1]) / 2;

  const node = mesh(geo, material, name);
  place(node, { x: cx, y: want.bottom - bb.min.y * sy, z: cz, ry: want.ry, sx, sy, sz });
  node.castShadow = false;
  node.receiveShadow = true;
  node.userData.noCast = true;
  node.userData.noOutline = true;
  return node;
}

/** 极坐标落点（石块 / 坡地宿主），沿阴面偏移 */
function polarSpot(rand, r) {
  const angle = rand() * Math.PI * 2;
  const dist = r * (0.12 + 0.78 * Math.sqrt(rand()));
  return {
    dx: Math.cos(angle) * dist * (1 + 0.22 * SHADE_DIR.x),
    dz: Math.sin(angle) * dist * (1 + 0.22 * SHADE_DIR.z)
  };
}

/** 条带落点（台阶宿主）：x 在群落宽度内散开，z 一律朝观者方向偏置 */
function bandSpot(rand, r) {
  const half = Math.min(r * 1.05, 0.34);
  return { dx: (rand() - 0.5) * 2 * half, dz: 0.06 + rand() * 0.3 };
}

function buildColony(root, p, index, M) {
  const seed = SEED_BASE + index * SEED_STRIDE;
  const rand = rng(seed);
  const host = hostBox(p);
  const mix = MIX[p.host];
  const nameOf = (kind, i) => `moss-patch-${index + 1}-${p.host}-${kind}-${i + 1}`;
  let parts = 0;

  const flakeRange = FLAKE_RADIUS[p.host];
  const spot = p.host === 'step' ? bandSpot : polarSpot;
  const sink = p.host === 'rock' ? null : SINK_BY_HOST[p.host];

  for (let i = 0; i < count(rand, mix.flakes); i++) {
    let rf = p.r * (flakeRange[0] + rand() * (flakeRange[1] - flakeRange[0]));
    if (p.host === 'rock') rf = Math.min(rf, ROCK_FLAKE_MAX);
    const embed = sink !== null ? sink : ROCK_SINK_BASE + ROCK_SINK_GAIN * rf;
    const { dx, dz } = spot(rand, p.r);
    const geo = rockGeometry(rf, seed * 31 + i, FLAKE_SHAPE);
    root.add(seatPart(
      geo,
      rand() < 0.55 ? M.mossPatch : M.mossDamp,
      nameOf('flake', i),
      host,
      {
        x: p.x + dx,
        z: p.z + dz,
        bottom: p.y - embed,
        ry: rand() * Math.PI * 2,
        sx: 1 + rand() * 0.3,
        sy: 0.7 + rand() * 0.5,
        sz: 1 + rand() * 0.3
      },
      FLAKE_TILE
    ));
    parts++;
  }

  for (let i = 0; i < count(rand, mix.lumps); i++) {
    const rl = p.r * (LUMP_RADIUS[0] + rand() * (LUMP_RADIUS[1] - LUMP_RADIUS[0]));
    const { dx, dz } = spot(rand, p.r * 0.7);
    const geo = rockGeometry(rl, seed * 41 + i, LUMP_SHAPE);
    root.add(seatPart(
      geo,
      M.mossDamp,
      nameOf('lump', i),
      host,
      {
        x: p.x + dx,
        z: p.z + dz,
        bottom: p.y - rl * 0.55,
        ry: rand() * Math.PI * 2,
        sx: 1 + rand() * 0.35,
        sy: 0.85 + rand() * 0.35,
        sz: 1 + rand() * 0.35
      },
      LUMP_TILE
    ));
    parts++;
  }

  for (let i = 0; i < count(rand, mix.pebbles); i++) {
    const rp = p.r * (PEBBLE_RADIUS[0] + rand() * (PEBBLE_RADIUS[1] - PEBBLE_RADIUS[0]));
    const { dx, dz } = spot(rand, p.r * 0.85);
    const geo = rockGeometry(rp, seed * 53 + i, PEBBLE_SHAPE);
    const pebble = seatPart(
      geo,
      M.mossStone,
      nameOf('pebble', i),
      host,
      {
        x: p.x + dx,
        z: p.z + dz,
        bottom: p.y - rp * 0.42,
        ry: rand() * Math.PI * 2,
        sx: 1 + rand() * 0.3,
        sy: 0.9 + rand() * 0.3,
        sz: 1 + rand() * 0.3
      },
      PEBBLE_TILE
    );
    // 苔里露出的碎石是硬边，保留描边（苔壳本身一律不描边）
    pebble.userData.noOutline = false;
    root.add(pebble);
    parts++;
  }

  // 水平苔膜：比苔片更薄更贴地，用来把同群的苔片缝成一片
  for (let i = 0; i < count(rand, mix.films); i++) {
    const rf = p.r * (0.34 + rand() * 0.26);
    const { dx, dz } = spot(rand, p.r * 0.6);
    const geo = rockGeometry(rf, seed * 67 + i, FILM_SHAPE);
    root.add(seatPart(
      geo,
      M.mossWet,
      nameOf('film', i),
      host,
      {
        x: p.x + dx,
        z: p.z + dz,
        bottom: p.y - 0.008,
        ry: rand() * Math.PI * 2,
        sx: 1.1 + rand() * 0.5,
        sy: 1,
        sz: 1.1 + rand() * 0.5
      },
      FILM_TILE
    ));
    parts++;
  }

  // 立面苔膜：贴在 riser 上，必须与 riser 面平行 ⇒ 自己不带 ry
  if (p.host === 'step') {
    const fz = frontZ(p.step);
    const n = count(rand, mix.films);
    for (let i = 0; i < n; i++) {
      const fh = FILM_HEIGHT[0] + rand() * (FILM_HEIGHT[1] - FILM_HEIGHT[0]);
      const rf = fh / (2 * (1 + FILM_SHAPE.wobble));
      const geo = rockGeometry(rf, seed * 17 + i, FILM_SHAPE);
      geo.rotateX(Math.PI / 2);
      triplanarUv(geo, FILM_TILE, [p.x, p.y, fz]);
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const ex = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
      const loX = host.x[0] + ex - HOST_SLACK;
      const hiX = host.x[1] - ex + HOST_SLACK;
      const wantX = p.x + (i - (n - 1) / 2) * p.r * 0.62 + (rand() - 0.5) * 0.06;
      const node = mesh(geo, M.mossStone, nameOf('riser', i));
      place(node, {
        x: loX <= hiX ? clamp(wantX, loX, hiX) : p.x,
        y: p.y - FILM_SINK - bb.min.y,
        z: fz - FILM_EMBED - bb.min.z
      });
      node.castShadow = false;
      node.receiveShadow = true;
      node.userData.noCast = true;
      node.userData.noOutline = true;
      root.add(node);
      parts++;
    }
  }

  return parts;
}

export function createMossPatch(M) {
  const root = group('mossPatch');
  const samples = [];
  let meshCount = 0;
  let hostX0 = Infinity;
  let hostX1 = -Infinity;
  let hostY0 = Infinity;
  let hostY1 = -Infinity;
  let hostZ0 = Infinity;
  let hostZ1 = -Infinity;

  MOSS_PATCHES.forEach((p, index) => {
    const host = hostBox(p);
    if (host.x[0] < hostX0) hostX0 = host.x[0];
    if (host.x[1] > hostX1) hostX1 = host.x[1];
    if (host.y[0] < hostY0) hostY0 = host.y[0];
    if (host.y[1] > hostY1) hostY1 = host.y[1];
    if (host.z[0] < hostZ0) hostZ0 = host.z[0];
    if (host.z[1] > hostZ1) hostZ1 = host.z[1];
    meshCount += buildColony(root, p, index, M);
    samples.push({ x: p.x, z: p.z });
  });

  root.userData.samples = samples;
  root.userData.colonyCount = MOSS_PATCHES.length;
  // 宿主盒并集：R6 用它证明「每一群苔都没长出自己的宿主」，而不是从网格 bbox 反推
  root.userData.support = {
    host: { x: [hostX0, hostX1], y: [hostY0, hostY1], z: [hostZ0, hostZ1] }
  };
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}

export default createMossPatch;
