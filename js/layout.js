// 布局数据层：底座 / 参道石阶 / 溪谷水系 / 地形带 / 鸟居 / 全部放置点
// 与 docs/LAYOUT_PLAN.md 严格一致；所有资产模块只从本文件取坐标。
// 与文档的偏差、公式修正全部记录在 docs/ASSET_INDEX.md「布局决策」一节。
import { PAD, LEVEL } from './config.js';
import { fbm3 } from './primitives.js';

export { PAD, LEVEL };

/* ------------------------------------------------------------ 数学小工具 */

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------ 内容区 */

/** 内容半宽：底座 ±16.0，四周留 0.1 m 唇边露明（所有资产包围盒硬边界） */
export const CONTENT_HALF = PAD.half - 0.1;

/**
 * 树冠安全半宽。
 * 林缘树木的冠幅若按自然半径外扩会越过 CONTENT_HALF 把枝叶悬到底座之外，
 * 因此 tree-kit 的每一个冠簇中心都被夹进 ±CANOPY_SAFE：展台边缘的树冠向内偏斜，
 * 这正是真实林缘树（向林内趋光）的姿态，比切在底座边缘更合理。
 */
export const CANOPY_SAFE = CONTENT_HALF - 0.2;

/* ------------------------------------------------------------ 参道石阶 */

export const PATH = {
  centerX: 0.3,
  halfWidth: 1.35,
  x0: -1.05,
  x1: 1.65,
  steps: 32,
  rise: 0.145,
  tread: 0.5,
  bottomY: 0.16,
  zBottom: 11.6,
  zTop: -4.4,
  topY: 4.8,
  grade: 0.29,
  /** 上段石板坡道残段终点（z ≈ -7 处被两侧树木围合遮蔽） */
  zUpper: -7.6,
  /** 参道走廊净空判定区间（R2） */
  corridorZ0: -8.0,
  corridorZ1: 12.2
};

export const STAIRS = { steps: PATH.steps, rise: PATH.rise, tread: PATH.tread };

/** 参道连续坡面：地形与石阶共用的基准坡面 */
export function pathRampY(z) {
  return z <= PATH.zBottom ? PATH.bottomY + (PATH.zBottom - z) * PATH.grade : PATH.bottomY;
}

/** 第 k 级（k = 0 … 31）的前缘 z；踏面覆盖 z → z - 0.50 */
export function frontZ(k) {
  return PATH.zBottom - PATH.tread * k;
}

/** 第 k 级的踏面标高 */
export function stepTopY(k) {
  return PATH.bottomY + PATH.rise * (k + 1);
}

/** 第 k 级石板包围盒（每级再沿 X 切成 2–3 块独立石板，切分逻辑在 stone-steps.js） */
export function stepBox(k) {
  const top = stepTopY(k);
  const z = frontZ(k);
  return {
    min: { x: PATH.x0, y: top - PATH.rise, z: z - PATH.tread },
    max: { x: PATH.x1, y: top, z }
  };
}

/** 参道走廊遮罩（只随 x 变化：该列的地形标高在整个 z 上都是 pathRampY） */
export function pathCorridorMask(x, z) {
  const dx = Math.max(PATH.x0 - x, 0, x - PATH.x1);
  if (dx <= 0) return 1;
  if (dx >= 1.2) return 0;
  return 1 - smoothstep(0, 1.2, dx);
}

/** 点是否落在石阶 / 上段坡道的铺装范围内 */
export function pathInside(x, z) {
  return x >= PATH.x0 && x <= PATH.x1 && z <= PATH.zBottom && z >= PATH.zUpper;
}

/* ------------------------------------------------------------ 溪流曲线 */

export const STREAM_PATH = [
  { x: -8.2, z: -14.5 },
  { x: -7.9, z: -11.0 },
  { x: -7.4, z: -8.0 },
  { x: -6.9, z: -5.0 },
  { x: -6.4, z: -2.0 },
  { x: -6.0, z: 1.0 },
  { x: -5.7, z: 4.0 },
  { x: -5.5, z: 7.0 },
  { x: -5.35, z: 10.0 },
  { x: -5.2, z: 13.5 }
];

export const STREAM = {
  widthStart: 1.7,
  widthEnd: 2.5,
  depth: 0.16,
  clearMargin: 0.3
};

/** 溪床下切深度（LEVEL.streamBedOffset 的绝对值） */
const BED_DEPTH = Math.abs(LEVEL.streamBedOffset);
/** 水面与护岸顶的高差 = 护岸净空 */
const WATER_EDGE_DEPTH = Math.abs(LEVEL.waterOffset);
/** 溪床平底占半宽的比例 */
const BED_FLAT_RATIO = 0.62;
/** 水面出露处 → 护岸顶 的抬升横向跨度 */
const BANK_RISE = 0.9;

/** 沿溪流的归一化位置 t∈[0,1] 处的中心线点 */
export function streamPoint(t) {
  const n = STREAM_PATH.length - 1;
  const u = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(u));
  const f = u - i;
  const a = STREAM_PATH[i];
  const b = STREAM_PATH[i + 1];
  return { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) };
}

export function streamWidthAt(t) {
  return STREAM.widthStart + (STREAM.widthEnd - STREAM.widthStart) * clamp(t, 0, 1);
}

/** 点到折线的最短距离 */
export function distanceToPolyline(x, z, polyline) {
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1) : 0;
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}

export function streamDistance(x, z) {
  return distanceToPolyline(x, z, STREAM_PATH);
}

/** 给定 z 处的溪流中心线 x（折线单调上升，直接按 z 反查） */
export function streamCenterX(z) {
  const pts = STREAM_PATH;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (z >= a.z && z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      return lerp(a.x, b.x, t);
    }
  }
  return z < pts[0].z ? pts[0].x : pts[pts.length - 1].x;
}

/** 给定 z 处的归一化溪流位置 t（z 单调 ⇒ 直接分段反查） */
export function streamTAt(z) {
  const pts = STREAM_PATH;
  const n = pts.length - 1;
  for (let i = 0; i < n; i += 1) {
    if (z <= pts[i + 1].z) {
      const span = pts[i + 1].z - pts[i].z;
      return (i + clamp((z - pts[i].z) / span, 0, 1)) / n;
    }
  }
  return 1;
}

/**
 * 护岸半宽。
 * 文档写成 `0.85 + (z + 14.5) × 0.014286` 的线性式；这里直接取
 * `streamWidthAt(t)/2`，两者在 [−14.5, 13.5] 内相差 < 0.006 m，
 * 但在 path 端点之外自动被 clamp 住，不会出现负宽或继续外扩。
 */
export function streamBankHalf(z) {
  return streamWidthAt(streamTAt(z)) / 2;
}

/* ------------------------------------------------------------ 溪谷标高 */

/**
 * 溪谷谷底。
 * z > 11.6 之后必须封顶：否则 valleyLevel(13.5) = −0.051，水面落到底座顶面以下，
 * 溪口会整段沉进展台里。封顶后溪口成为一片与第 1 级踏面几乎齐平的浅滩。
 */
export function valleyLevel(z) {
  return Math.max(LEVEL.valleyFloor, LEVEL.valleyFloor + (PATH.zBottom - z) * 0.185);
}

export function waterY(z) {
  return valleyLevel(z) + LEVEL.waterOffset;
}

export function streamBedY(z) {
  return valleyLevel(z) + LEVEL.streamBedOffset;
}

/**
 * 左侧山脊标高：相对谷底由 1.58 m（前缘）抬到 2.10 m（后缘），
 * 跨距 11.6 → −14.5 共 26.1 m。
 */
const RIDGE_RISE_RATE = (LEVEL.leftRidgeHigh - LEVEL.leftRidgeLow) / (PATH.zBottom - STREAM_PATH[0].z);

export function ridgeLevel(z) {
  return valleyLevel(z) + LEVEL.leftRidgeLow + (PATH.zBottom - z) * RIDGE_RISE_RATE;
}

/**
 * 溪床下切遮罩（0…1，乘以 BED_DEPTH 得到实际下切量）。
 *
 * 断面形状是「平底 + 缓岸」的梯形，而不是从中心一路平滑下切：
 *   d ≤ 0.62·half          切满 0.16（溪床平底）
 *   0.62·half → half       0.16 → 0.05（在 d = half 处地面正好等于水面）
 *   half → half + 0.90     0.05 → 0（护岸顶 = 谷底 = 水面 + 0.05 净空）
 * 这样「地面 = 水面」恰好发生在 d = half ⇒ 出露水面宽度正好等于 STREAM.width，
 * 与文档的 1.70 → 2.50 m 一致；若整段用一条 smoothstep 下切，水面会漫到
 * d ≈ 1.70（前缘宽 3.4 m），比声称的宽度宽出 0.9 m。
 */
export function streamMask(x, z) {
  const d = streamDistance(x, z);
  const half = streamBankHalf(z);
  const edgeRatio = WATER_EDGE_DEPTH / BED_DEPTH;
  const flat = half * BED_FLAT_RATIO;
  if (d <= flat) return 1;
  if (d <= half) return lerp(1, edgeRatio, smoothstep(flat, half, d));
  const outer = half + BANK_RISE;
  if (d >= outer) return 0;
  return edgeRatio * (1 - smoothstep(half, outer, d));
}

/** 护岸遮罩：用于把蕨类 / 石块等「贴着岸」的资产限制在岸坡范围内 */
export function streamBankMask(x, z) {
  const d = streamDistance(x, z);
  const half = streamBankHalf(z);
  if (d <= half) return 1;
  if (d >= half + 1.3) return 0;
  return 1 - smoothstep(0, 1.3, d - half);
}

/* ------------------------------------------------------------ 地形主带 */

/** 主带严格划分、只共边不重叠；带边界随 C(z) 摆动 ⇒ 必须按 z 求 */
const VALLEY_LEFT = 2.4;
const VALLEY_RIGHT = 2.2;
const LEFT_SLOPE_SPAN = 1.5;
const RIGHT_SHOULDER_X1 = 3.6;
/** 左脊带的横向外沿：有限哨兵值（不能用 ±Infinity，Math.max(hypot) 会得到 NaN） */
export const LEFT_RIDGE_OUTER = -(CONTENT_HALF + 8);

/** 相邻带之间的羽化宽度 */
export const FEATHER = 0.85;

export const BAND_ORDER = ['leftRidge', 'leftSlope', 'valley', 'leftFoot', 'path', 'shoulder', 'rightHill'];

export const BANDS = {
  leftRidge: { label: '左脊林', note: '溪谷外侧山体：樟 / 枫主干林、厚落叶层、青苔巨石' },
  leftSlope: { label: '左陡坡', note: '山脊 → 溪谷的过渡陡坡，裸露根系；把 1.58→2.10 的抬升摊在 1.5 m 上而不是在谷边切出一面 61° 的墙' },
  valley: { label: '溪谷带', note: '浅溪、溪底沙石、湿滑石块、蕨类；带内再切溪床' },
  leftFoot: { label: '参道左坡脚', note: '溪谷 → 石阶的过渡陡坡（前缘近水平，后缘 ≈28°）' },
  path: { label: '参道走廊', note: '32 级独立石阶 + 侧边泥土地 + 积水洼' },
  shoulder: { label: '右路肩', note: '碎石、落叶、湿石块' },
  rightHill: { label: '右坡林地', note: '山坡林地、裸露根系、灌丛、樟 / 榊' }
};

function bandRanges(z) {
  const c = streamCenterX(z);
  const valley = valleyLevel(z);
  const ridge = ridgeLevel(z);
  const ramp = pathRampY(z);
  const slopeX0 = c - VALLEY_LEFT - LEFT_SLOPE_SPAN;
  const valleyX0 = c - VALLEY_LEFT;
  const valleyX1 = c + VALLEY_RIGHT;
  const footSpan = Math.max(0.3, PATH.x0 - valleyX1);
  const hillSpan = Math.max(0.3, CONTENT_HALF - RIGHT_SHOULDER_X1);
  return [
    { name: 'leftRidge', x0: LEFT_RIDGE_OUTER, x1: slopeX0, levelAt: () => ridge },
    {
      name: 'leftSlope',
      x0: slopeX0,
      x1: valleyX0,
      levelAt: (x) => lerp(ridge, valley, smoothstep(0, 1, (x - slopeX0) / LEFT_SLOPE_SPAN))
    },
    { name: 'valley', x0: valleyX0, x1: valleyX1, levelAt: () => valley },
    {
      name: 'leftFoot',
      x0: valleyX1,
      x1: PATH.x0,
      levelAt: (x) => lerp(valley, ramp, smoothstep(0, 1, (x - valleyX1) / footSpan))
    },
    { name: 'path', x0: PATH.x0, x1: PATH.x1, levelAt: () => ramp },
    {
      name: 'shoulder',
      x0: PATH.x1,
      x1: RIGHT_SHOULDER_X1,
      levelAt: (x) => ramp + LEVEL.pathShoulder * smoothstep(0, 1, (x - PATH.x1) / (RIGHT_SHOULDER_X1 - PATH.x1))
    },
    {
      name: 'rightHill',
      x0: RIGHT_SHOULDER_X1,
      x1: CONTENT_HALF,
      levelAt: (x) => ramp + lerp(LEVEL.pathShoulder, LEVEL.rightHillTop, smoothstep(0, 1, (x - RIGHT_SHOULDER_X1) / hillSpan))
    }
  ];
}

/** 某 z 断面上的带边界（绝对 x），terrain.js 用它构造随 z 变化的 breakpoint 网格 */
export function bandEdges(z) {
  return bandRanges(z).map((r) => ({ name: r.name, x0: r.x0, x1: r.x1 }));
}

export function bandLevel(name, x, z) {
  const range = bandRanges(z).find((r) => r.name === name);
  if (!range) return LEVEL.pad;
  return range.levelAt(clamp(x, range.x0, range.x1));
}

export function bandOf(x, z) {
  const ranges = bandRanges(z);
  for (const r of ranges) {
    if (x >= r.x0 && x <= r.x1) return r.name;
  }
  return x < ranges[0].x0 ? 'leftRidge' : 'rightHill';
}

/**
 * 多个主带按权重平均取 level，而不是「谁近听谁的」：max-weight 在两个矩形共用
 * 边界两侧各选一个 level，地面出现硬接缝 —— 实测 forecourt(0.30) / valleyFloor(0.22)
 * 在 z = 8.0 处跳 8 cm、stationBand / forecourt 在 z = 3.0 处跳 4 cm，溪流与碎石小径
 * 正从这两条线上穿过（水面 / 路面出现台阶）。本工程同理：七条带只用 x 方向羽化
 * （每条带都贯穿整个 z，dz 恒为 0），且带边界处两侧 level 本来就相等 ⇒ 接缝为零。
 */
export function siteGrade(x, z) {
  // 先 clamp 再取样：底座之外的采样点停在边缘标高，不会掉到 pad，
  // 相机贴地守卫才不会在 CONTENT_HALF 附近读到悬崖。
  const xc = clamp(x, LEFT_RIDGE_OUTER, CONTENT_HALF);
  const ranges = bandRanges(z);
  let sumW = 0;
  let sumL = 0;
  let weight = 0;
  for (const r of ranges) {
    const dx = Math.max(r.x0 - xc, 0, xc - r.x1);
    const w = 1 - smoothstep(0, FEATHER, dx);
    if (w <= 0) continue;
    sumW += w;
    sumL += w * r.levelAt(xc);
    if (w > weight) weight = w;
  }
  if (sumW <= 0) return { level: LEVEL.pad, weight: 0, band: bandOf(x, z) };
  return { level: sumL / sumW, weight, band: bandOf(x, z) };
}

/**
 * 微起伏。
 * 参道走廊与溪谷带内被压平（石阶与水面自己会造形），护岸坡脚保留起伏但
 * 额外给一点向上偏置：护岸净空只有 0.05 m，纯负向的 fbm 会把它抹平、
 * 让水漫上路面。
 */
export function microRelief(x, z) {
  const base = (fbm3(x * 0.28, 7.31, z * 0.28, 4) - 0.4688) * 0.24;
  const bank = streamBankMask(x, z);
  const damp = Math.max(0.1, 1 - 0.9 * pathCorridorMask(x, z) - 0.85 * bank);
  const bankOuter = bank * (1 - streamMask(x, z));
  return base * damp + 0.035 * bankOuter;
}

export function naturalHeight(x, z) {
  return siteGrade(x, z).level + microRelief(x, z);
}

export function terrainHeight(x, z) {
  const h = naturalHeight(x, z) + LEVEL.streamBedOffset * streamMask(x, z);
  return Math.max(h, LEVEL.pad + 0.02);
}

export const groundHeight = terrainHeight;

/* ------------------------------------------------------------ 鸟居（同规格 2 座） */

/**
 * 局部坐标原点在两柱基中心、y = 柱基面（台石顶）。
 * 两座由同一个工厂产出 ⇒ 规格完全相同；各自独立根 Group / 独立 Mesh / 独立材质实例。
 * 額束只留框与黑底板：参考图上的奉纳文字按「全程无文字」规格省略。
 */
export const TORII = {
  gap: 2.5,
  postSpan: 3.6,
  totalHeight: 4.38,
  pair: [
    { id: 'front', name: 'toriiFront', x: 0.3, z: -0.9, step: 25 },
    { id: 'rear', name: 'toriiRear', x: 0.3, z: -3.4, step: 30 }
  ],
  parts: {
    post: { label: '柱', count: 2, height: 4.0, rBottom: 0.22, rTop: 0.16, leanDeg: 1.5, x: 1.8, y0: 0.0, y1: 4.0, color: 'toriiVermilion' },
    isizue: { label: '台石', count: 2, width: 0.62, height: 0.3, depth: 0.62, x: 1.8, y0: -0.3, y1: 0.0, color: 'stoneWet' },
    shimaki: { label: '島木', count: 1, length: 4.8, height: 0.26, depth: 0.3, y0: 3.74, y1: 4.0, color: 'toriiVermilion' },
    nimaki: { label: '眉木', count: 1, length: 5.0, height: 0.16, depth: 0.26, y0: 4.0, y1: 4.16, color: 'toriiBlack' },
    kasagi: { label: '笠木', count: 1, length: 5.2, height: 0.22, depth: 0.3, camber: 0.16, y0: 4.16, y1: 4.38, color: 'toriiBlack' },
    nuki: { label: '貫', count: 1, length: 4.4, height: 0.18, depth: 0.2, protrude: 0.4, y0: 2.55, y1: 2.73, color: 'toriiBlackFade' },
    tsuka: { label: '束', count: 3, width: 0.12, height: 1.01, depth: 0.14, xOffsets: [0, 1.2, -1.2], y0: 2.73, y1: 3.74, color: 'toriiVermilion' },
    gakuzuka: { label: '額束', count: 1, width: 0.55, height: 0.62, depth: 0.08, y0: 3.12, y1: 3.74, color: 'toriiVermilion', text: false }
  }
};

/** 柱基标高严格取参道坡面：前座 3.785、后座 4.510（文档写 4.515 是 5 mm 舍入误差） */
export function toriiBaseY(z) {
  return pathRampY(z);
}

/**
 * 每座鸟居自己的净空盒（R4）。
 * 文档给的是两座并集；并集会把两座之间 1.1 m 的空档也算成禁区，
 * 实际那里是可以放湿石块 / 灌木的（参考图正是如此），所以按单座判定。
 */
export function toriiClearanceBoxes() {
  return TORII.pair.map((t) => {
    const base = toriiBaseY(t.z);
    return {
      name: t.name,
      x0: t.x - TORII.postSpan / 2,
      x1: t.x + TORII.postSpan / 2,
      z0: t.z - 0.7,
      z1: t.z + 0.7,
      y0: base - 0.32,
      y1: base + TORII.totalHeight
    };
  });
}

/* ------------------------------------------------------------ 乔木 */

/** species: kusunoki 樟 / sakaki 榊 / kaede 枫；高度 樟 8–13、枫 6–10、榊 4–7 m */
export const TREES = [
  { id: 1, x: -12.5, z: 6.0, species: 'kusunoki', scale: 1.15 },
  { id: 2, x: -12.2, z: -1.5, species: 'kusunoki', scale: 1.25 },
  { id: 3, x: -11.0, z: 10.5, species: 'kaede', scale: 1.0 },
  { id: 4, x: -10.2, z: -5.5, species: 'kaede', scale: 0.95 },
  { id: 5, x: -9.6, z: 8.5, species: 'sakaki', scale: 0.9 },
  { id: 6, x: -11.8, z: -9.0, species: 'sakaki', scale: 1.0 },
  { id: 7, x: -10.4, z: -12.0, species: 'kusunoki', scale: 1.1 },
  { id: 8, x: -13.0, z: 3.0, species: 'kaede', scale: 1.1 },
  { id: 9, x: -7.8, z: 12.5, species: 'sakaki', scale: 0.85 },
  { id: 10, x: 7.5, z: 4.5, species: 'kusunoki', scale: 1.2 },
  { id: 11, x: 12.0, z: -2.0, species: 'kusunoki', scale: 1.3 },
  { id: 12, x: 5.2, z: 9.0, species: 'kaede', scale: 1.05 },
  { id: 13, x: 9.8, z: 11.0, species: 'kaede', scale: 1.15 },
  { id: 14, x: 4.2, z: 12.0, species: 'sakaki', scale: 0.9 },
  { id: 15, x: 6.4, z: -7.5, species: 'sakaki', scale: 1.0 },
  { id: 16, x: 12.6, z: 5.5, species: 'kusunoki', scale: 1.1 },
  { id: 17, x: 13.2, z: -9.5, species: 'kaede', scale: 1.0 },
  { id: 18, x: 3.6, z: 6.5, species: 'sakaki', scale: 0.8 },
  { id: 19, x: 8.8, z: -12.5, species: 'sakaki', scale: 0.95 },
  { id: 20, x: 12.7, z: 11.4, species: 'kusunoki', scale: 1.05 },
  { id: 21, x: 13.0, z: -4.0, species: 'kaede', scale: 1.1 },
  // 22–26：上段参道两侧的收口树，把 z < −7 的坡道残段挡在林里
  // 22/23 的 z 由 −13.5 / −13.8 向内收到 −12.7 / −12.5：樟的实测冠半宽 2.62·scale，
  //   原落点的冠缘到 z −16.44 / −16.39，越过 CANOPY_SAFE(15.7) 甚至 R1 硬界 ±16.05，枝叶会悬到底座外。
  { id: 22, x: -2.8, z: -12.7, species: 'kusunoki', scale: 1.25 },
  { id: 23, x: 3.2, z: -12.5, species: 'kusunoki', scale: 1.2 },
  { id: 24, x: -2.4, z: -11.0, species: 'kaede', scale: 1.0 },
  { id: 25, x: 2.9, z: -9.2, species: 'sakaki', scale: 0.95 },
  { id: 26, x: -2.4, z: -7.0, species: 'kaede', scale: 1.0 }
];

/* ------------------------------------------------------------ 灌丛 */

/** r = 冠幅半径；右侧中心 ≥ 2.90（盒 min.x > 1.65）、左侧中心 ≤ −2.35（盒 max.x < −1.05）⇒ 都不进参道走廊 */
export const SHRUBS = [
  // 参道左坡脚
  { x: -2.6, z: 9.5, r: 0.9 },
  { x: -3.6, z: 7.2, r: 0.95 },
  { x: -2.4, z: 5.0, r: 0.85 },
  { x: -4.2, z: 2.2, r: 0.95 },
  { x: -3.1, z: -1.2, r: 0.9 },
  { x: -4.6, z: -4.2, r: 0.95 },
  { x: -3.4, z: -7.6, r: 0.85 },
  { x: -5.0, z: -10.4, r: 0.9 },
  // 右坡地前缘
  { x: 3.1, z: 10.6, r: 0.85 },
  { x: 3.6, z: 8.2, r: 0.95 },
  { x: 2.95, z: 6.1, r: 0.8 },
  { x: 4.3, z: 3.4, r: 0.9 },
  { x: 3.1, z: 1.0, r: 0.85 },
  { x: 4.6, z: -1.6, r: 0.95 },
  { x: 3.2, z: -4.6, r: 0.85 },
  { x: 4.1, z: -6.4, r: 0.9 },
  // 溪岸（让位溪流：|x − C(z)| 均 > 0.3 + r 的等效净空）
  { x: -7.3, z: 9.2, r: 0.75 },
  { x: -4.05, z: 5.6, r: 0.7 },
  { x: -9.05, z: -6.2, r: 0.8 },
  { x: -5.3, z: -9.6, r: 0.7 },
  // 上段参道两侧（把坡道残段夹起来）
  { x: -2.35, z: -6.6, r: 0.85 },
  { x: 2.95, z: -7.4, r: 0.85 }
];

/* ------------------------------------------------------------ 蕨类 */

export const FERNS = [
  // 溪谷两岸交替
  { x: -7.05, z: 11.2 },
  { x: -4.1, z: 10.4 },
  { x: -7.35, z: 8.0 },
  { x: -4.35, z: 6.8 },
  { x: -7.7, z: 5.2 },
  { x: -4.55, z: 3.6 },
  { x: -8.05, z: 2.0 },
  { x: -4.85, z: 0.4 },
  { x: -8.45, z: -1.4 },
  { x: -5.15, z: -3.0 },
  { x: -8.8, z: -4.6 },
  { x: -5.6, z: -6.4 },
  { x: -9.3, z: -8.2 },
  { x: -6.1, z: -10.0 },
  // 参道左坡脚阴面
  { x: -2.85, z: 8.8 },
  { x: -3.9, z: 4.4 },
  { x: -2.6, z: 2.6 },
  { x: -4.4, z: -0.6 },
  { x: -3.3, z: -3.2 },
  { x: -4.9, z: -6.0 },
  { x: -3.7, z: -9.0 },
  { x: -5.4, z: -12.2 },
  // 右坡地阴坡
  { x: 4.6, z: 7.6 },
  { x: 6.2, z: 2.4 },
  { x: 5.1, z: -3.2 },
  { x: 7.4, z: -8.6 }
];

/* ------------------------------------------------------------ 溪内石块 */

/** 全部落在河道内（|x − C(z)| < half）；资产名 streamStones 走 WATER_SYSTEM 免检 */
export const STREAM_STONES = [
  { x: -4.95, z: 11.0, r: 0.3 },
  { x: -5.9, z: 8.6, r: 0.26 },
  { x: -5.1, z: 6.2, r: 0.22 },
  { x: -6.25, z: 3.8, r: 0.28 },
  { x: -5.55, z: 1.4, r: 0.24 },
  { x: -6.85, z: -1.6, r: 0.3 },
  { x: -6.45, z: -5.2, r: 0.26 },
  { x: -8.05, z: -9.4, r: 0.32 }
];

/* ------------------------------------------------------------ 湿石块 */

export const WET_ROCKS = [
  // 溪岸
  { x: -6.85, z: 9.6, r: 0.3 },
  // 从 (-4.6, 7.8) 外移：原点到中心线 0.91 m，而该处岸线半宽 1.17 m，石块整颗在水里
  { x: -4.15, z: 7.4, r: 0.26 },
  { x: -8.2, z: 3.2, r: 0.32 },
  // 从 (-5.05, -0.2) 外移：原点到中心线 1.01 m < 岸线半宽 1.05 m
  { x: -4.75, z: -0.2, r: 0.28 },
  { x: -8.9, z: -5.6, r: 0.34 },
  { x: -5.9, z: -8.8, r: 0.26 },
  // 参道两侧泥地
  { x: -1.45, z: 9.8, r: 0.24 },
  { x: 1.95, z: 8.4, r: 0.22 },
  { x: -1.4, z: 5.6, r: 0.26 },
  { x: 2.0, z: 3.0, r: 0.24 },
  { x: -1.42, z: 1.4, r: 0.22 },
  // 从 1.98 外移到 2.45：1.98 会插进前座鸟居净空盒（x ≤ 2.10）
  { x: 2.45, z: -1.0, r: 0.26 },
  // 坡地
  { x: 3.3, z: 11.2, r: 0.3 },
  { x: 5.6, z: 6.0, r: 0.34 },
  { x: 4.2, z: -2.6, r: 0.28 },
  { x: 6.8, z: -10.8, r: 0.36 }
];

/* ------------------------------------------------------------ 积水洼 */

/**
 * 石阶上的积水沿 X 拉长（r 0.28–0.40）、沿 Z 收窄（rz 0.18–0.22）。
 * 文档的 0.22–0.40 各向同性半径会越过 0.50 m 的踏步深，R6 宿主包含判据（容差 0.06）过不去；
 * 真实台阶上的积水本来就是顺着踏面横向摊开的一条椭圆。
 */
export const PUDDLES = [
  { host: 'step', step: 1, x: 0.05, r: 0.34, rz: 0.2 },
  { host: 'step', step: 3, x: 1.05, r: 0.3, rz: 0.19 },
  { host: 'step', step: 5, x: -0.35, r: 0.38, rz: 0.21 },
  { host: 'step', step: 7, x: 0.6, r: 0.28, rz: 0.18 },
  { host: 'step', step: 9, x: 1.2, r: 0.32, rz: 0.2 },
  { host: 'step', step: 11, x: -0.15, r: 0.36, rz: 0.21 },
  { host: 'step', step: 13, x: 0.85, r: 0.3, rz: 0.19 },
  { host: 'step', step: 15, x: -0.55, r: 0.34, rz: 0.2 },
  { host: 'step', step: 17, x: 0.3, r: 0.4, rz: 0.22 },
  { host: 'step', step: 19, x: 1.3, r: 0.28, rz: 0.18 },
  { host: 'step', step: 22, x: -0.25, r: 0.36, rz: 0.21 },
  { host: 'step', step: 26, x: 0.7, r: 0.32, rz: 0.2 },
  // 路肩泥地
  { host: 'ground', x: -1.55, z: 10.6, r: 0.3, rz: 0.24 },
  { host: 'ground', x: 2.05, z: 9.2, r: 0.26, rz: 0.21 },
  { host: 'ground', x: -1.5, z: 6.8, r: 0.28, rz: 0.22 },
  { host: 'ground', x: 2.1, z: 4.2, r: 0.24, rz: 0.19 },
  { host: 'ground', x: -1.52, z: 2.4, r: 0.3, rz: 0.24 },
  { host: 'ground', x: 2.08, z: 0.2, r: 0.26, rz: 0.21 }
].map((p) => ({ ...p, z: p.host === 'step' ? frontZ(p.step) - PATH.tread / 2 : p.z }));

/* ------------------------------------------------------------ 青苔斑 */

export const MOSS_PATCHES = [
  // 立面青苔：贴在各级石板的 riser 面上（z = 该级前缘）
  { host: 'step', step: 2, x: -0.45, r: 0.24 },
  { host: 'step', step: 4, x: 1.1, r: 0.28 },
  { host: 'step', step: 6, x: 0.05, r: 0.22 },
  { host: 'step', step: 8, x: -0.7, r: 0.3 },
  { host: 'step', step: 10, x: 1.35, r: 0.24 },
  { host: 'step', step: 12, x: 0.4, r: 0.26 },
  { host: 'step', step: 14, x: -0.2, r: 0.22 },
  { host: 'step', step: 16, x: 1.05, r: 0.28 },
  { host: 'step', step: 18, x: -0.6, r: 0.24 },
  { host: 'step', step: 21, x: 0.75, r: 0.3 },
  { host: 'step', step: 24, x: -0.35, r: 0.26 },
  { host: 'step', step: 27, x: 1.2, r: 0.22 },
  // 石上青苔：长在湿石块 / 溪石顶面
  { host: 'rock', rock: { list: 'wetRock', index: 0 }, r: 0.42 },
  { host: 'rock', rock: { list: 'wetRock', index: 1 }, r: 0.36 },
  { host: 'rock', rock: { list: 'wetRock', index: 2 }, r: 0.46 },
  { host: 'rock', rock: { list: 'wetRock', index: 3 }, r: 0.4 },
  { host: 'rock', rock: { list: 'wetRock', index: 4 }, r: 0.5 },
  { host: 'rock', rock: { list: 'wetRock', index: 5 }, r: 0.36 },
  { host: 'rock', rock: { list: 'streamStone', index: 0 }, r: 0.3 },
  { host: 'rock', rock: { list: 'streamStone', index: 2 }, r: 0.26 },
  { host: 'rock', rock: { list: 'streamStone', index: 4 }, r: 0.28 },
  { host: 'rock', rock: { list: 'streamStone', index: 6 }, r: 0.3 },
  // 树基与坡地苔毯
  { host: 'ground', x: -12.5, z: 6.0, r: 0.55 },
  { host: 'ground', x: 7.5, z: 4.5, r: 0.6 },
  { host: 'ground', x: 5.2, z: 9.0, r: 0.5 },
  { host: 'ground', x: -2.8, z: -13.5, r: 0.6 },
  { host: 'ground', x: 3.2, z: -13.8, r: 0.55 },
  { host: 'ground', x: -6.8, z: -2.4, r: 0.45 },
  { host: 'ground', x: 4.8, z: -5.4, r: 0.5 },
  { host: 'ground', x: -9.6, z: 1.2, r: 0.4 }
].map((p) => {
  if (p.host === 'step') {
    return { ...p, x: p.x, z: frontZ(p.step), y: stepTopY(p.step) - PATH.rise };
  }
  if (p.host === 'rock') {
    const src = p.rock.list === 'wetRock' ? WET_ROCKS : STREAM_STONES;
    const ref = src[p.rock.index];
    return { ...p, x: ref.x, z: ref.z, y: terrainHeight(ref.x, ref.z) + ref.r * 1.2 };
  }
  return { ...p, y: terrainHeight(p.x, p.z) };
});

/* ------------------------------------------------------------ 细树干与藤蔓 */

export const TWIGS = [
  { x: -6.8, z: 10.2 },
  { x: -8.6, z: 6.4 },
  { x: -9.9, z: 1.2 },
  // 从 (-7.2, -4.8) 外移：该点到中心线 0.33 m < 岸线半宽 0.99 m，枯干整根插在水里
  { x: -8.4, z: -4.8 },
  { x: -9.6, z: -10.6 },
  { x: -3.2, z: 7.6 },
  { x: -4.1, z: -2.4 },
  { x: 2.6, z: 11.4 },
  { x: 4.8, z: 8.8 },
  { x: 6.6, z: 4.0 },
  // 倒向 +X（横躺在路肩上）
  { x: 3.9, z: -0.8, az: 0 },
  { x: 5.8, z: -5.4 },
  { x: 7.6, z: -9.8 },
  { x: -2.9, z: -12.6 }
];

/* ------------------------------------------------------------ 视点与焦点 */

export const POINTS = {
  cameraTarget: { x: 0.3, y: 3.6, z: -0.9 },
  stepBottom: { x: 0.3, y: 0.16, z: 11.6 },
  stepTop: { x: 0.3, y: 4.8, z: -4.4 },
  streamMouth: { x: -5.2, y: 0.25, z: 13.5 },
  forestEdge: { x: 0.3, y: 7.0, z: -13.5 },
  padFront: { x: 0.3, y: 0, z: 15.9 }
};

/** 景深焦点固定在两座鸟居之间的空档，不跟随相机注视点 */
export const DOF_FOCUS = { x: 0.3, y: 5.6, z: -2.15 };

/* ------------------------------------------------------------ 放置校验 */

/** 非水体资产允许的最小溪岸退距：岸线内缩 5 cm（允许浅埋贴岸）与中心线退距取大者 */
function waterEdgeLimit(z) {
  return Math.max(streamBankHalf(z) - 0.05, STREAM.clearMargin);
}

export const PATH_SYSTEM = new Set([
  'basePad', 'stoneSteps', 'upperPath', 'pathSoil', 'torii', 'toriiFront', 'toriiRear', 'puddle', 'wetRock',
  // 地形本身横跨参道 / 溪谷 / 坡地（32×32 连续高度场），走廊与溪谷净空对它无意义；
  // 它的边界由 R1 与自身的裙壁收边保证。
  'terrain',
  // 地被 / 落叶层是贴地薄层，落在石阶上正是想要的效果，不参与走廊与鸟居净空判定
  'groundCover', 'leafLitter',
  // 青苔斑块本来就长在石阶立面 / 石块 / 溪岸上，不参与走廊、溪谷与鸟居净空判定
  'mossPatch'
]);
export const WATER_SYSTEM = new Set(['streamWater', 'streamBed', 'streamStones', 'mossPatch']);
export const ATMOSPHERE_SYSTEM = new Set(['mist']);

/** 非参道资产不得落进参道走廊 */
function insideCorridor(x, z) {
  return x >= PATH.x0 && x <= PATH.x1 && z >= PATH.corridorZ0 && z <= PATH.corridorZ1;
}

/**
 * R1 底座范围 / R2 参道走廊净空 / R3 溪谷净空 / R4 鸟居净空 /
 * R5 悬空或埋入 / R6 宿主包含。（R7 树冠重叠是工具级两两比对，不在这里。）
 */
export function validatePlacement(box, name, support = null, samples = null) {
  const issues = [];
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const isPath = PATH_SYSTEM.has(name);
  const isWater = WATER_SYSTEM.has(name);
  const isAtmosphere = ATMOSPHERE_SYSTEM.has(name);

  if (box.min.x < -PAD.half - 0.05 || box.max.x > PAD.half + 0.05) issues.push('R1 x 越出底座');
  if (box.min.z < -PAD.half - 0.05 || box.max.z > PAD.half + 0.05) issues.push('R1 z 越出底座');

  // 走廊判据取样：多实例资产（树、灌丛、石块）的包围盒角点并不代表真实落点，
  // 允许通过 userData.samples 显式给出各实例 footprint 中心，改用真实点取样。
  const probePoints = (Array.isArray(samples) && samples.length)
    ? samples.map((p) => ({ x: p.x, z: p.z }))
    : [box.min.x, cx, box.max.x].flatMap((x) => [box.min.z, cz, box.max.z].map((z) => ({ x, z })));

  if (!isPath && !isWater && !isAtmosphere) {
    const hit = probePoints.find((p) => insideCorridor(p.x, p.z));
    if (hit) issues.push(`R2 侵入参道走廊 (${hit.x.toFixed(2)}, ${hit.z.toFixed(2)})`);
  }

  if (!isWater && !isAtmosphere) {
    // 溪谷净空按「水面出露范围」判定，而不是拿溪床标高去比整条断面：
    // streamMask 的梯形断面保证 d = streamBankHalf 处地面正好等于水面，岸坡上的地面
    // 本来就高于溪床 5–16 cm，用溪床判定会把贴着岸的石块 / 蕨类 / 枯枝全部误杀。
    const wet = probePoints.find((p) => streamDistance(p.x, p.z) < waterEdgeLimit(p.z));
    if (wet) {
      issues.push(`R3 落进水面范围 (d=${streamDistance(wet.x, wet.z).toFixed(2)} < 岸线 ${waterEdgeLimit(wet.z).toFixed(2)})`);
    }
  }

  if (!isPath && !isWater && !isAtmosphere) {
    const boxes = toriiClearanceBoxes();
    const hit = probePoints.find((p) => boxes.some((b) => (
      p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1
    )));
    if (hit) issues.push(`R4 侵入鸟居净空 (${hit.x.toFixed(2)}, ${hit.z.toFixed(2)})`);
  }

  // 支撑面基准：默认取自然地形；搭建在石阶 / 石块 / 坡面之上的构件通过 support.top
  // 声明其承托面标高，嵌在宿主结构内的构件改用「必须落在宿主包围盒内」。
  const ground = terrainHeight(cx, cz);
  const host = (support && typeof support === 'object') ? support.host : null;
  const topArg = (support && typeof support === 'object') ? support.top : support;
  const g = (topArg != null && topArg > ground) ? topArg : ground;

  if (name !== 'basePad') {
    if (isAtmosphere || (support && typeof support === 'object' && support.overhead)) {
      // 雾卡 / 架空构件不参与接地判据：其支撑构件由各自资产自行校验
    } else if (host) {
      const tol = 0.06;
      const out = box.min.x < host.x[0] - tol || box.max.x > host.x[1] + tol ||
        box.min.y < host.y[0] - tol || box.max.y > host.y[1] + tol ||
        box.min.z < host.z[0] - tol || box.max.z > host.z[1] + tol;
      if (out) issues.push('R6 脱离宿主结构（构件超出宿主包围盒）');
    } else {
      if (box.min.y > g + 0.36) issues.push(`R5 悬空 (底 ${box.min.y.toFixed(2)} > 地面 ${g.toFixed(2)})`);
      if (box.max.y < g - 0.02) issues.push(`R5 完全埋入地面 (顶 ${box.max.y.toFixed(2)} < 地面 ${g.toFixed(2)})`);
    }
  }

  return issues;
}
