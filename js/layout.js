// 布局数据层：底座 / 弯曲参道石阶 / 蜿蜒叠瀑溪谷水系 / 地形带 / 鸟居 / 全部放置点
// 所有资产模块只从本文件取坐标与标高函数。
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

/** 树冠安全半宽 */
export const CANOPY_SAFE = CONTENT_HALF - 0.2;

/* ------------------------------------------------------------ 弯曲参道山路系统 */

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
  /** 上段石板坡道终点（穿过鸟居后曲率增大，顺右侧山势大弧度绕进山后隐没） */
  zUpper: -9.2,
  /** 参道走廊净空判定区间（R2：石阶底端到顶端区间禁止非参道资产落点） */
  corridorZ0: -4.6,
  corridorZ1: 12.2
};

export const STAIRS = { steps: PATH.steps, rise: PATH.rise, tread: PATH.tread };

/**
 * 参道中心线 X(z) —— C¹ 连续的双段弧线：
 * 1) 下中段（z ∈ [-0.9, 11.6]）：从右下方坡脚（x = +1.06）顺着山坡以优雅小弧线微向左抱弯（中段 x ≈ -0.02），
 *    再自然回摆抵达前座鸟居（z = -0.9, x = +0.28）；
 * 2) 上段（z < -0.9）：穿过鸟居后曲率明显增大（二次+三次项递增），
 *    从后座鸟居（z = -2.2, x = +0.53）到石阶顶（z = -4.4, x = +1.36），
 *    再沿上段石板路（z = -4.4 → -9.2）大幅向右弯曲至 x ≈ +5.5，自然绕到右侧山坡背后消失。
 */
export function pathCenterX(z) {
  if (z >= -0.9) {
    const u = clamp((PATH.zBottom - z) / (PATH.zBottom - (-0.9)), 0, 1);
    return 0.82 * (1 - u) * (1 - u) + 2 * (-0.34) * u * (1 - u) + 0.28 * u * u;
  }
  const s = clamp(-0.9 - z, 0, 8.3);
  return 0.28 + 0.0992 * s + 0.032 * s * s;
}

/** 相对基准 centerX (0.3) 的横向偏移量 */
export function pathShiftX(z) {
  return pathCenterX(z) - PATH.centerX;
}

/** 任意 z 处的参道左右边界与中心 */
export function pathBoundsAt(z) {
  const cx = pathCenterX(z);
  return { x0: cx - PATH.halfWidth, x1: cx + PATH.halfWidth, cx };
}

/** 参道切线朝向角（绕 Y 轴旋转角，供石阶、护墙、上段石板贴合曲线旋转） */
export function pathYaw(z) {
  const dx = pathCenterX(z - 0.25) - pathCenterX(z + 0.25);
  return Math.atan2(-dx, 0.5);
}

/** 参道连续坡面：石阶段保持恒定坡度，过石阶顶（z < -4.4）后平缓收顶并向后缘自然微降，消除后景高耸断崖 */
export function pathRampY(z) {
  if (z > PATH.zBottom) return PATH.bottomY;
  if (z >= PATH.zTop) return PATH.bottomY + (PATH.zBottom - z) * PATH.grade;
  const extraZ = PATH.zTop - z;
  const rise = (extraZ * 0.08) / (1 + extraZ * 0.18);
  const rearRollOff = smoothstep(4.5, 11.6, extraZ) * 0.45;
  return PATH.topY + rise - rearRollOff;
}

/** 第 k 级（k = 0 … 31）的前缘 z；踏面覆盖 z → z - 0.50 */
export function frontZ(k) {
  return PATH.zBottom - PATH.tread * k;
}

/** 第 k 级的踏面标高 */
export function stepTopY(k) {
  return PATH.bottomY + PATH.rise * (k + 1);
}

/** 第 k 级石板包围盒（随弯曲参道中心线偏移并留出旋转余量） */
export function stepBox(k) {
  const top = stepTopY(k);
  const z = frontZ(k);
  const cz = z - PATH.tread * 0.5;
  const { x0, x1 } = pathBoundsAt(cz);
  return {
    min: { x: x0 - 0.12, y: top - PATH.rise, z: z - PATH.tread - 0.05 },
    max: { x: x1 + 0.12, y: top, z: z + 0.05 }
  };
}

/** 参道走廊遮罩（随弯曲参道中心线计算） */
export function pathCorridorMask(x, z) {
  const { x0, x1 } = pathBoundsAt(z);
  const dx = Math.max(x0 - x, 0, x - x1);
  if (dx <= 0) return 1;
  if (dx >= 1.2) return 0;
  return 1 - smoothstep(0, 1.2, dx);
}

/** 点是否落在弯曲石阶 / 上段坡道的铺装范围内 */
export function pathInside(x, z) {
  if (z > PATH.zBottom || z < PATH.zUpper) return false;
  const { x0, x1 } = pathBoundsAt(z);
  return x >= x0 && x <= x1;
}

/* ------------------------------------------------------------ 蜿蜒叠瀑溪流系统 */

/**
 * 蜿蜒 S 型山涧浅溪折线：
 * 在前中景紧邻石阶左护墙蜿蜒流淌，使竖屏与宽屏视角下左下方均能清晰观赏到弯弯绕绕的多级小瀑布、清澈泥底与漩涡波光。
 */
export const STREAM_PATH = [
  { x: -6.6, z: -14.5 },
  { x: -5.4, z: -12.0 },
  { x: -6.2, z: -9.2 },
  { x: -4.7, z: -6.4 },
  { x: -5.4, z: -3.6 },
  { x: -3.85, z: -0.8 },
  { x: -4.45, z: 2.0 },
  { x: -2.95, z: 4.8 },
  { x: -3.45, z: 7.4 },
  { x: -2.15, z: 10.0 },
  { x: -2.65, z: 12.2 },
  { x: -1.85, z: 14.5 }
];

/**
 * 6 级山涧小瀑布 / 跌水石堰（段落ち / 小滝）：
 * 溪水不再是平缓镜面斜坡，而是由 7 段清澈深潭与 6 级叠水小瀑布交替构成！
 */
export const STREAM_CASCADES = [
  { z: -10.6, drop: 0.26, halfSpan: 0.34 },
  { z: -6.6, drop: 0.28, halfSpan: 0.34 },
  { z: -2.2, drop: 0.30, halfSpan: 0.35 },
  { z: 1.8, drop: 0.32, halfSpan: 0.36 },
  { z: 5.8, drop: 0.34, halfSpan: 0.38 },
  { z: 9.5, drop: 0.34, halfSpan: 0.38 }
];

export const STREAM = {
  widthStart: 1.42,
  widthEnd: 1.98,
  depth: 0.16,
  clearMargin: 0.3
};

const BED_DEPTH = Math.abs(LEVEL.streamBedOffset);
const WATER_EDGE_DEPTH = Math.abs(LEVEL.waterOffset);
const BED_FLAT_RATIO = 0.62;
const BANK_RISE = 0.65;

export function streamPoint(t) {
  const n = STREAM_PATH.length - 1;
  const u = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(u));
  const f = u - i;
  const s = f * f * (3 - 2 * f);
  const a = STREAM_PATH[i];
  const b = STREAM_PATH[i + 1];
  const z = lerp(a.z, b.z, f);
  const wiggle = Math.sin(z * 0.85 + 0.7) * 0.14;
  return { x: lerp(a.x, b.x, s) + wiggle, z };
}

export function streamWidthAt(t) {
  const base = STREAM.widthStart + (STREAM.widthEnd - STREAM.widthStart) * clamp(t, 0, 1);
  // 跌水潭处略宽、石堰口略窄，形成自然的「束水-跌落-深潭」宽窄节奏
  const rhythm = Math.sin(t * Math.PI * 12) * 0.14;
  return base + rhythm;
}

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

export function streamCenterX(z) {
  const pts = STREAM_PATH;
  const wiggle = Math.sin(z * 0.85 + 0.7) * 0.14;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (z >= a.z && z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      const s = t * t * (3 - 2 * t);
      return lerp(a.x, b.x, s) + wiggle;
    }
  }
  return (z < pts[0].z ? pts[0].x : pts[pts.length - 1].x) + wiggle;
}

export function streamDistance(x, z) {
  const cx = streamCenterX(z);
  const cxNext = streamCenterX(z + 0.2);
  const slopeX = (cxNext - cx) / 0.2;
  const cos = 1 / Math.hypot(1, slopeX);
  return Math.abs(x - cx) * cos;
}

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

export function streamBankHalf(z) {
  return streamWidthAt(streamTAt(z)) / 2;
}

/* ------------------------------------------------------------ 叠瀑溪谷标高 */

/**
 * 含 6 级小瀑布台阶落差的溪谷基准标高：
 * 潭面平缓流动，经过 STREAM_CASCADES 各级石堰时陡降 0.26–0.34 m，形成层叠小瀑布。
 */
export function valleyLevel(z) {
  const gentleSlope = Math.max(0, (PATH.zBottom + 2.2 - z) * 0.086);
  let cascadeSum = 0;
  for (const c of STREAM_CASCADES) {
    cascadeSum += c.drop * (1 - smoothstep(c.z - c.halfSpan, c.z + c.halfSpan, z));
  }
  return Math.max(LEVEL.valleyFloor - 0.08, LEVEL.valleyFloor - 0.04 + gentleSlope + cascadeSum);
}

/** 某 z 处是否处于小瀑布陡降段（0 = 平缓潭水，1 = 瀑布跌水中心） */
export function cascadeFactorAt(z) {
  let best = 0;
  for (const c of STREAM_CASCADES) {
    const u = Math.abs(z - c.z) / c.halfSpan;
    if (u < 1.3) {
      const k = Math.max(0, 1 - u * u * 0.65);
      if (k > best) best = k;
    }
  }
  return best;
}

export function waterY(z) {
  return valleyLevel(z) + LEVEL.waterOffset;
}

export function streamBedY(z) {
  return valleyLevel(z) + LEVEL.streamBedOffset;
}

const RIDGE_RISE_RATE = (LEVEL.leftRidgeHigh - LEVEL.leftRidgeLow) / (PATH.zBottom - STREAM_PATH[0].z);

export function ridgeLevel(z) {
  return valleyLevel(z) + LEVEL.leftRidgeLow + (PATH.zBottom - z) * RIDGE_RISE_RATE;
}

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

export function streamBankMask(x, z) {
  const d = streamDistance(x, z);
  const half = streamBankHalf(z);
  if (d <= half) return 1;
  if (d >= half + 1.0) return 0;
  return 1 - smoothstep(0, 1.0, d - half);
}

/* ------------------------------------------------------------ 地形主带（随弯曲参道与蜿蜒溪流动态贴合） */

const VALLEY_LEFT = 1.5;
const VALLEY_RIGHT = 1.05;
const LEFT_SLOPE_SPAN = 1.4;
const SHOULDER_WIDTH = 1.35;
export const LEFT_RIDGE_OUTER = -(CONTENT_HALF + 8);
export const FEATHER = 0.85;

export const BAND_ORDER = ['leftRidge', 'leftSlope', 'valley', 'leftFoot', 'path', 'shoulder', 'rightHill'];

export const BANDS = {
  leftRidge: { label: '左脊林', note: '溪谷外侧山体：樟 / 枫主干林、厚落叶层、青苔巨石' },
  leftSlope: { label: '左陡坡', note: '山脊 → 溪谷的过渡陡坡，裸露根系' },
  valley: { label: '溪谷带', note: '蜿蜒叠瀑浅溪、溪底泥沙卵石、湿滑石堰、蕨类' },
  leftFoot: { label: '参道左坡脚', note: '溪谷 → 弧形石阶的过渡坡' },
  path: { label: '参道走廊', note: '32 级弧形独立石阶 + 弯曲上段石板路 + 侧边泥土地' },
  shoulder: { label: '右路肩', note: '碎石、落叶、湿石块' },
  rightHill: { label: '右坡林地', note: '右侧山坡地形（参道绕此山坡弯曲并向山后隐没）' }
};

function bandRanges(z) {
  const c = streamCenterX(z);
  const { x0: px0, x1: px1 } = pathBoundsAt(z);
  const valley = valleyLevel(z);
  const ridge = ridgeLevel(z);
  const ramp = pathRampY(z);
  const slopeX0 = c - VALLEY_LEFT - LEFT_SLOPE_SPAN;
  const valleyX0 = c - VALLEY_LEFT;
  const valleyX1 = Math.min(px0 - 0.25, c + VALLEY_RIGHT);
  const footSpan = Math.max(0.45, px0 - valleyX1);
  const rightShoulderX1 = Math.min(CONTENT_HALF - 3.5, px1 + SHOULDER_WIDTH);
  const shoulderSpan = Math.max(0.45, rightShoulderX1 - px1);
  const hillSpan = Math.max(5.5, CONTENT_HALF - rightShoulderX1);

  // 塑造「左侧为深涧山谷、右侧为陡峭抬升山坡」的自然地貌：
  // 右侧山势整体陡峭高耸，同时在右后方外角（z < -10, x > 9）做圆润收顶，既保证右侧山坡陡峭感又消除边缘尖角
  const frontMidLift = lerp(1.15, 0.28, smoothstep(11.0, -6.5, z));
  const rearTaper = lerp(1.0, 0.54, smoothstep(-3.0, -14.5, z));
  const shoulderRise = (LEVEL.pathShoulder + frontMidLift * 0.28) * lerp(1.0, 0.58, smoothstep(-4.0, -14.0, z));
  const hillTopRise = (LEVEL.rightHillTop + frontMidLift * 0.95) * rearTaper;
  const rearFootFloor = lerp(valley, ramp - 0.35, smoothstep(-3.5, -10.0, z));

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
      x1: px0,
      levelAt: (x) => {
        const u = clamp((x - valleyX1) / footSpan, 0, 1);
        const vBase = lerp(valley, rearFootFloor, smoothstep(0.0, 0.5, u));
        return lerp(vBase, ramp, smoothstep(0, 1, u));
      }
    },
    { name: 'path', x0: px0, x1: px1, levelAt: () => ramp },
    {
      name: 'shoulder',
      x0: px1,
      x1: rightShoulderX1,
      levelAt: (x) => ramp + shoulderRise * smoothstep(0, 1, (x - px1) / shoulderSpan)
    },
    {
      name: 'rightHill',
      x0: rightShoulderX1,
      x1: CONTENT_HALF,
      levelAt: (x) => {
        const u = clamp((x - rightShoulderX1) / hillSpan, 0, 1);
        // 前段陡峭抬升（u^0.78），后外角圆润收坡防止底座边界尖刺
        const steepSlope = 0.52 * Math.pow(u, 0.78) + 0.48 * smoothstep(0, 1, u);
        const cornerRound = 1 - 0.36 * smoothstep(-9.5, -15.8, z) * smoothstep(8.5, 15.8, x);
        return ramp + lerp(shoulderRise, hillTopRise * cornerRound, steepSlope);
      }
    }
  ];
}

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

export function siteGrade(x, z) {
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

/* ------------------------------------------------------------ 鸟居（同规格 2 座 · 随弯曲参道一前一后紧挨） */

export const TORII = {
  gap: 1.3,
  postSpan: 3.6,
  totalHeight: 4.38,
  pair: [
    { id: 'front', name: 'toriiFront', x: pathCenterX(-0.9), z: -0.9, step: 25, yaw: pathYaw(-0.9) * 0.45 },
    { id: 'rear', name: 'toriiRear', x: pathCenterX(-2.2) - 0.34, z: -2.2, step: 28, yaw: pathYaw(-2.2) * 0.45 }
  ],
  parts: {
    post: { label: '柱', count: 2, height: 4.0, rBottom: 0.21, rTop: 0.16, leanDeg: 1.5, x: 1.8, y0: 0.0, y1: 4.0, color: 'toriiVermilion' },
    isizue: { label: '台石', count: 2, width: 0.56, height: 0.26, depth: 0.56, x: 1.8, y0: -0.26, y1: 0.0, color: 'stoneWet' },
    shimaki: { label: '島木', count: 1, length: 4.8, height: 0.25, depth: 0.28, y0: 3.75, y1: 4.0, color: 'toriiVermilion' },
    nimaki: { label: '眉木', count: 1, length: 5.0, height: 0.14, depth: 0.25, y0: 4.0, y1: 4.14, color: 'toriiBlack' },
    kasagi: { label: '笠木', count: 1, length: 5.2, height: 0.24, depth: 0.3, camber: 0.18, y0: 4.14, y1: 4.38, color: 'toriiBlack' },
    nuki: { label: '貫', count: 1, length: 4.45, height: 0.2, depth: 0.2, protrude: 0.42, y0: 2.62, y1: 2.82, color: 'toriiVermilion' },
    tsuka: { label: '束', count: 1, width: 0.14, height: 0.93, depth: 0.14, xOffsets: [0], y0: 2.82, y1: 3.75, color: 'toriiVermilion' },
    gakuzuka: { label: '額束', count: 1, width: 0.26, height: 0.93, depth: 0.16, y0: 2.82, y1: 3.75, color: 'toriiVermilion', text: false }
  }
};

export function toriiBaseY(z) {
  return pathRampY(z);
}

export function toriiClearanceBoxes() {
  return TORII.pair.map((t) => {
    const base = toriiBaseY(t.z);
    return {
      name: t.name,
      x0: t.x - TORII.postSpan / 2,
      x1: t.x + TORII.postSpan / 2,
      z0: t.z - 0.5,
      z1: t.z + 0.5,
      y0: base - 0.32,
      y1: base + TORII.totalHeight
    };
  });
}

/* ------------------------------------------------------------ 乔木（围合参道深林画框與远山密林） */

export const TREES = [
  // 左侧密林带（移开镜头正前方的近景遮挡树，让左下方蜿蜒叠瀑溪流完整展现！）
  { id: 1, x: -5.8, z: 7.8, species: 'kusunoki', scale: 1.28 },
  { id: 2, x: -6.4, z: 2.2, species: 'kusunoki', scale: 1.32 },
  { id: 3, x: -6.6, z: 10.8, species: 'kaede', scale: 1.22 },
  { id: 4, x: -7.2, z: -2.2, species: 'sakaki', scale: 1.25 },
  { id: 5, x: -6.2, z: 12.2, species: 'sakaki', scale: 1.15 },
  { id: 6, x: -6.8, z: -6.2, species: 'sakaki', scale: 1.25 },
  { id: 7, x: -7.8, z: -10.5, species: 'kusunoki', scale: 1.28 },
  { id: 8, x: -7.6, z: 4.5, species: 'kusunoki', scale: 1.25 },
  { id: 9, x: -5.6, z: 4.8, species: 'sakaki', scale: 1.15 },

  // 右侧陡坡密林带（参道绕着这片山林形成小弧线，并在鸟居后方大弯绕至这片山林背后消失）
  { id: 10, x: 3.3, z: 5.2, species: 'kusunoki', scale: 1.3 },
  { id: 11, x: 3.9, z: -0.4, species: 'kusunoki', scale: 1.26 },
  { id: 12, x: 3.5, z: 9.2, species: 'sakaki', scale: 1.2 },
  { id: 13, x: 5.4, z: 10.8, species: 'kaede', scale: 1.2 },
  { id: 14, x: 3.6, z: 11.8, species: 'sakaki', scale: 1.12 },
  { id: 15, x: 4.4, z: -4.2, species: 'sakaki', scale: 1.22 },
  { id: 16, x: 6.4, z: 6.2, species: 'kusunoki', scale: 1.15 },
  { id: 17, x: 7.4, z: -7.5, species: 'kaede', scale: 1.14 },
  { id: 18, x: 2.9, z: 7.4, species: 'sakaki', scale: 1.08 },
  { id: 19, x: 6.6, z: -11.2, species: 'sakaki', scale: 1.12 },
  { id: 20, x: 6.8, z: 1.8, species: 'kusunoki', scale: 1.12 },
  { id: 21, x: 5.8, z: -2.4, species: 'kaede', scale: 1.15 },

  // 鸟居正后方与上段弯曲山路内侧的高耸主干与透光林冠
  { id: 22, x: -0.55, z: -7.6, species: 'kusunoki', scale: 1.18 },
  { id: 23, x: 0.45, z: -8.6, species: 'kusunoki', scale: 1.16 },
  { id: 24, x: -2.4, z: -5.6, species: 'kaede', scale: 1.20 },
  { id: 25, x: 3.6, z: -5.2, species: 'kaede', scale: 1.16 },
  { id: 26, x: -1.65, z: -6.6, species: 'kusunoki', scale: 1.16 },

  // 后景纵深密林带（填补鸟居后方与远景视野空白，营造层层叠叠的深山幽谷密林感）
  { id: 27, x: -1.35, z: -9.8, species: 'sakaki', scale: 1.16 },
  { id: 28, x: 0.15, z: -10.8, species: 'kusunoki', scale: 1.15 },
  { id: 29, x: 1.65, z: -9.6, species: 'kaede', scale: 1.14 },
  { id: 30, x: -2.65, z: -11.4, species: 'kusunoki', scale: 1.15 },
  { id: 31, x: -0.75, z: -12.4, species: 'sakaki', scale: 1.16 },
  { id: 32, x: 1.25, z: -12.4, species: 'kusunoki', scale: 1.14 },
  { id: 33, x: 2.95, z: -11.2, species: 'sakaki', scale: 1.15 },
  { id: 34, x: -3.35, z: -9.2, species: 'kaede', scale: 1.14 },
  { id: 35, x: 4.65, z: -9.8, species: 'kusunoki', scale: 1.10 },
  { id: 36, x: 2.35, z: -7.8, species: 'sakaki', scale: 1.14 },

  // 左侧后方加密深林带（封堵左后方溪谷上空与鸟居左侧背景空隙）
  { id: 37, x: -3.25, z: -3.4, species: 'sakaki', scale: 1.20 },
  { id: 38, x: -3.35, z: -6.2, species: 'kusunoki', scale: 1.18 },
  { id: 39, x: -4.15, z: -11.2, species: 'sakaki', scale: 1.18 },
  { id: 40, x: -3.15, z: -12.2, species: 'kusunoki', scale: 1.16 },
  { id: 41, x: -8.2, z: -0.6, species: 'kusunoki', scale: 1.22 },
  { id: 42, x: -8.6, z: -4.2, species: 'kaede', scale: 1.20 },
  { id: 43, x: -8.4, z: -8.2, species: 'kusunoki', scale: 1.18 },
  { id: 44, x: -9.2, z: -11.8, species: 'sakaki', scale: 1.18 },
  { id: 45, x: -9.6, z: -6.4, species: 'sakaki', scale: 1.18 },

  // 右侧陡坡加密背景林带（在陡峭右侧山坡上层层叠叠铺满高大乔木，消除右侧背景空白）
  { id: 46, x: 4.8, z: 3.6, species: 'kusunoki', scale: 1.14 },
  { id: 47, x: 5.2, z: 0.4, species: 'sakaki', scale: 1.16 },
  { id: 48, x: 4.9, z: -6.4, species: 'kusunoki', scale: 1.08 },
  { id: 49, x: 5.6, z: -9.2, species: 'sakaki', scale: 1.12 },
  { id: 50, x: 8.2, z: 4.2, species: 'kusunoki', scale: 1.08 },
  { id: 51, x: 8.4, z: 0.2, species: 'kaede', scale: 1.12 },
  { id: 52, x: 8.6, z: -3.8, species: 'kusunoki', scale: 1.02 },
  { id: 53, x: 8.8, z: -8.4, species: 'sakaki', scale: 1.08 },
  { id: 54, x: 8.2, z: -11.6, species: 'kusunoki', scale: 1.02 }
];

/* ------------------------------------------------------------ 灌丛 */

export const SHRUBS = [
  // 参道左坡脚与溪谷外岸（让开左前景溪流主视线，使 6 级叠瀑与清澈深潭一览无余）
  { x: -5.2, z: 9.8, r: 0.9 },
  { x: -5.5, z: 7.4, r: 0.92 },
  { x: -5.2, z: 5.2, r: 0.92 },
  { x: -2.3, z: 2.8, r: 0.88 },
  { x: -2.4, z: -0.4, r: 0.88 },
  { x: -3.2, z: -3.6, r: 0.95 },
  { x: -3.2, z: -6.8, r: 0.92 },
  { x: -4.2, z: -9.8, r: 0.92 },
  // 右坡地前缘与中后坡林下灌丛（贴合陡峭右侧山坡）
  { x: 3.3, z: 10.6, r: 0.92 },
  { x: 3.1, z: 8.2, r: 0.95 },
  { x: 2.7, z: 6.0, r: 0.9 },
  { x: 2.6, z: 3.6, r: 0.95 },
  { x: 2.6, z: 1.2, r: 0.9 },
  { x: 3.1, z: -1.6, r: 0.95 },
  { x: 3.8, z: -4.2, r: 0.92 },
  { x: 5.2, z: -6.4, r: 0.92 },
  { x: 4.5, z: 4.8, r: 0.95 },
  { x: 4.6, z: 2.0, r: 0.94 },
  { x: 4.4, z: -0.8, r: 0.95 },
  { x: 4.8, z: -3.2, r: 0.94 },
  { x: 6.2, z: 3.2, r: 0.96 },
  { x: 6.4, z: -0.4, r: 0.95 },
  { x: 6.4, z: -4.6, r: 0.95 },
  { x: 6.2, z: -8.2, r: 0.94 },
  // 溪流左外岸与左后方密林灌木
  { x: -5.4, z: 11.8, r: 0.9 },
  { x: -5.9, z: 3.2, r: 0.92 },
  { x: -6.1, z: -0.8, r: 0.95 },
  { x: -6.8, z: -4.6, r: 0.95 },
  { x: -7.4, z: -2.4, r: 0.96 },
  { x: -7.5, z: -6.8, r: 0.96 },
  { x: -7.8, z: -9.6, r: 0.95 },
  { x: -3.6, z: -8.2, r: 0.94 },
  { x: -3.8, z: -11.4, r: 0.95 },
  { x: -7.2, z: -12.0, r: 0.95 },
  // 上段弯曲参道内侧与后景深林灌木层（封堵鸟居后方低处空洞）
  { x: -1.8, z: -4.8, r: 0.92 },
  { x: 0.4, z: -7.2, r: 0.9 },
  { x: -0.85, z: -6.4, r: 0.95 },
  { x: 0.65, z: -6.8, r: 0.92 },
  { x: -1.45, z: -8.2, r: 0.96 },
  { x: -0.15, z: -8.8, r: 0.95 },
  { x: 1.35, z: -8.4, r: 0.94 },
  { x: -2.25, z: -9.6, r: 0.95 },
  { x: 0.35, z: -10.2, r: 0.96 },
  { x: 2.15, z: -9.8, r: 0.92 },
  { x: -1.15, z: -11.2, r: 0.95 },
  { x: 0.95, z: -11.5, r: 0.94 }
];

/* ------------------------------------------------------------ 蕨类 */

export const FERNS = [
  // 蜿蜒溪谷两岸交替（紧贴各级叠瀑与深潭岸边，严格在水线之外）
  { x: -3.8, z: 11.4 },
  { x: -1.15, z: 10.4 },
  { x: -4.6, z: 8.4 },
  { x: -1.55, z: 7.2 },
  { x: -4.5, z: 5.4 },
  { x: -1.85, z: 4.0 },
  { x: -5.8, z: 2.2 },
  { x: -2.4, z: 0.8 },
  { x: -5.6, z: -1.4 },
  { x: -3.4, z: -2.8 },
  { x: -6.4, z: -4.6 },
  { x: -3.5, z: -6.2 },
  { x: -7.2, z: -8.2 },
  { x: -4.2, z: -10.0 },
  // 左前景与左坡脚阴面
  { x: -3.65, z: 9.8 },
  { x: -4.85, z: 6.8 },
  { x: -2.1, z: 2.4 },
  { x: -2.5, z: -0.6 },
  { x: -3.2, z: -3.6 },
  { x: -3.4, z: -6.0 },
  { x: -4.4, z: -9.0 },
  { x: -4.2, z: -12.0 },
  // 右坡地阴坡（沿弧形参道右侧）
  { x: 2.95, z: 9.4 },
  { x: 2.45, z: 5.4 },
  { x: 2.35, z: 1.8 },
  { x: 3.3, z: -3.2 }
];

/* ------------------------------------------------------------ 溪内石块（配合蜿蜒溪道与瀑布潭口） */

export const STREAM_STONES = [
  { x: streamCenterX(12.2) + 0.12, z: 12.2, r: 0.28 },
  { x: streamCenterX(10.2) - 0.14, z: 10.2, r: 0.26 },
  { x: streamCenterX(8.0) + 0.15, z: 8.0, r: 0.25 },
  { x: streamCenterX(5.2) - 0.12, z: 5.2, r: 0.28 },
  { x: streamCenterX(2.8) + 0.14, z: 2.8, r: 0.25 },
  { x: streamCenterX(-0.8) - 0.12, z: -0.8, r: 0.28 },
  { x: streamCenterX(-4.6) + 0.14, z: -4.6, r: 0.26 },
  { x: streamCenterX(-8.8) - 0.15, z: -8.8, r: 0.3 }
];

/* ------------------------------------------------------------ 湿石块 */

export const WET_ROCKS = [
  // 溪岸与左下方乱石滩（严格位于水面岸线之外）
  { x: -4.15, z: 11.8, r: 0.3 },
  { x: -0.95, z: 11.2, r: 0.24 },
  { x: -4.45, z: 9.0, r: 0.28 },
  { x: -1.45, z: 8.2, r: 0.24 },
  { x: -4.65, z: 6.2, r: 0.3 },
  { x: -2.05, z: 4.8, r: 0.25 },
  // 弯曲参道两侧泥地
  { x: pathBoundsAt(9.6).x0 - 0.18, z: 9.6, r: 0.22 },
  { x: pathBoundsAt(8.4).x1 + 0.26, z: 8.4, r: 0.22 },
  { x: pathBoundsAt(6.2).x0 - 0.25, z: 6.2, r: 0.24 },
  { x: pathBoundsAt(3.2).x1 + 0.28, z: 3.2, r: 0.24 },
  { x: pathBoundsAt(1.6).x0 - 0.28, z: 1.6, r: 0.22 },
  { x: pathBoundsAt(-1.0).x1 + 0.95, z: -1.0, r: 0.26 },
  // 坡地
  { x: 3.15, z: 11.2, r: 0.28 },
  { x: 3.2, z: 6.0, r: 0.32 },
  { x: 3.6, z: -2.6, r: 0.28 },
  { x: 6.8, z: -8.8, r: 0.34 }
];

/* ------------------------------------------------------------ 积水洼（自动随弯曲石阶偏移） */

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
  // 路肩泥地（贴合弯曲参道外侧）
  { host: 'ground', x: pathBoundsAt(10.6).x0 - 0.16, z: 10.6, r: 0.28, rz: 0.22 },
  { host: 'ground', x: pathBoundsAt(9.2).x1 + 0.36, z: 9.2, r: 0.26, rz: 0.21 },
  { host: 'ground', x: pathBoundsAt(6.8).x0 - 0.28, z: 6.8, r: 0.28, rz: 0.22 },
  { host: 'ground', x: pathBoundsAt(4.2).x1 + 0.38, z: 4.2, r: 0.24, rz: 0.19 },
  { host: 'ground', x: pathBoundsAt(2.4).x0 - 0.35, z: 2.4, r: 0.28, rz: 0.22 },
  { host: 'ground', x: pathBoundsAt(0.2).x1 + 0.38, z: 0.2, r: 0.26, rz: 0.21 }
].map((p) => {
  if (p.host === 'step') {
    const cz = frontZ(p.step) - PATH.tread / 2;
    return { ...p, x: p.x + pathShiftX(cz), z: cz };
  }
  return p;
});

/* ------------------------------------------------------------ 青苔斑（遵循「靠近溪流密集、靠近路边次之、路正中稀少」的片状分布） */

export const MOSS_PATCHES = [
  // 石阶靠溪侧（左侧 -X 边缘，连绵成片）与靠右路边（右侧 +X 边缘），避开台阶正中间踩踏区
  { host: 'step', step: 2, x: -0.72, r: 0.34 },
  { host: 'step', step: 4, x: 1.18, r: 0.30 },
  { host: 'step', step: 6, x: -0.68, r: 0.36 },
  { host: 'step', step: 8, x: -0.76, r: 0.36 },
  { host: 'step', step: 10, x: 1.24, r: 0.28 },
  { host: 'step', step: 12, x: -0.64, r: 0.34 },
  { host: 'step', step: 14, x: -0.74, r: 0.35 },
  { host: 'step', step: 16, x: 1.16, r: 0.30 },
  { host: 'step', step: 18, x: -0.68, r: 0.34 },
  { host: 'step', step: 21, x: -0.62, r: 0.34 },
  { host: 'step', step: 24, x: -0.70, r: 0.32 },
  { host: 'step', step: 27, x: 1.18, r: 0.28 },
  // 石上青苔
  { host: 'rock', rock: { list: 'wetRock', index: 0 }, r: 0.42 },
  { host: 'rock', rock: { list: 'wetRock', index: 1 }, r: 0.34 },
  { host: 'rock', rock: { list: 'wetRock', index: 2 }, r: 0.42 },
  { host: 'rock', rock: { list: 'wetRock', index: 3 }, r: 0.34 },
  { host: 'rock', rock: { list: 'wetRock', index: 4 }, r: 0.44 },
  { host: 'rock', rock: { list: 'wetRock', index: 5 }, r: 0.36 },
  { host: 'rock', rock: { list: 'streamStone', index: 0 }, r: 0.28 },
  { host: 'rock', rock: { list: 'streamStone', index: 2 }, r: 0.24 },
  { host: 'rock', rock: { list: 'streamStone', index: 4 }, r: 0.26 },
  { host: 'rock', rock: { list: 'streamStone', index: 6 }, r: 0.28 },
  // 树基与坡地苔毯
  { host: 'ground', x: -5.4, z: 7.8, r: 0.55 },
  { host: 'ground', x: 3.3, z: 5.2, r: 0.6 },
  { host: 'ground', x: 3.5, z: 9.2, r: 0.5 },
  { host: 'ground', x: -0.55, z: -7.6, r: 0.55 },
  { host: 'ground', x: 0.45, z: -8.6, r: 0.55 },
  { host: 'ground', x: -4.2, z: -2.4, r: 0.45 },
  { host: 'ground', x: 4.4, z: -4.2, r: 0.5 },
  { host: 'ground', x: -6.2, z: 1.2, r: 0.4 }
].map((p) => {
  if (p.host === 'step') {
    const fz = frontZ(p.step);
    const cz = fz - PATH.tread * 0.5;
    return { ...p, x: p.x + pathShiftX(cz), z: fz, y: stepTopY(p.step) - PATH.rise };
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
  { x: -4.2, z: 10.6 },
  { x: -4.8, z: 6.4 },
  { x: -5.8, z: 1.2 },
  { x: -6.6, z: -4.8 },
  { x: -7.8, z: -10.6 },
  { x: -4.9, z: 8.2 },
  { x: -3.2, z: -2.4 },
  { x: 3.1, z: 11.4 },
  { x: 3.2, z: 8.8 },
  { x: 3.6, z: 4.0 },
  { x: 3.4, z: -0.8, az: 0 },
  { x: 4.6, z: -5.4 },
  { x: 6.4, z: -9.8 },
  { x: -3.2, z: -11.6 }
];

/* ------------------------------------------------------------ 视点与焦点（默认在参道左旁溪谷侧观察，非死板正中间） */

export const POINTS = {
  cameraTarget: { x: -0.15, y: 4.25, z: -0.8 },
  stepBottom: { x: pathCenterX(11.6), y: 0.16, z: 11.6 },
  stepTop: { x: pathCenterX(-4.4), y: 4.8, z: -4.4 },
  streamMouth: { x: streamCenterX(13.5), y: 0.25, z: 13.5 },
  forestEdge: { x: 1.8, y: 7.0, z: -13.5 },
  padFront: { x: 0.3, y: 0, z: 15.9 }
};

export const DOF_FOCUS = { x: 0.22, y: 5.2, z: -1.5 };

/* ------------------------------------------------------------ 放置校验 */

function waterEdgeLimit(z) {
  return Math.max(streamBankHalf(z) - 0.05, STREAM.clearMargin);
}

export const PATH_SYSTEM = new Set([
  'basePad', 'stoneSteps', 'upperPath', 'pathSoil', 'torii', 'toriiFront', 'toriiRear', 'puddle', 'wetRock',
  'terrain',
  'groundCover', 'leafLitter',
  'mossPatch'
]);
export const WATER_SYSTEM = new Set(['streamWater', 'streamBed', 'streamStones', 'mossPatch']);
export const ATMOSPHERE_SYSTEM = new Set(['mist']);

function insideCorridor(x, z) {
  if (z < PATH.corridorZ0 || z > PATH.corridorZ1) return false;
  const { x0, x1 } = pathBoundsAt(z);
  return x >= x0 && x <= x1;
}

export function validatePlacement(box, name, support = null, samples = null) {
  const issues = [];
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const isPath = PATH_SYSTEM.has(name);
  const isWater = WATER_SYSTEM.has(name);
  const isAtmosphere = ATMOSPHERE_SYSTEM.has(name);

  if (box.min.x < -PAD.half - 0.05 || box.max.x > PAD.half + 0.05) issues.push('R1 x 越出底座');
  if (box.min.z < -PAD.half - 0.05 || box.max.z > PAD.half + 0.05) issues.push('R1 z 越出底座');

  const probePoints = (Array.isArray(samples) && samples.length)
    ? samples.map((p) => ({ x: p.x, z: p.z }))
    : [box.min.x, cx, box.max.x].flatMap((x) => [box.min.z, cz, box.max.z].map((z) => ({ x, z })));

  if (!isPath && !isWater && !isAtmosphere) {
    const hit = probePoints.find((p) => insideCorridor(p.x, p.z));
    if (hit) issues.push(`R2 侵入参道走廊 (${hit.x.toFixed(2)}, ${hit.z.toFixed(2)})`);
  }

  if (!isWater && !isAtmosphere) {
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

  const ground = terrainHeight(cx, cz);
  const host = (support && typeof support === 'object') ? support.host : null;
  const topArg = (support && typeof support === 'object') ? support.top : support;
  const g = (topArg != null && topArg > ground) ? topArg : ground;

  if (name !== 'basePad') {
    if (isAtmosphere || (support && typeof support === 'object' && support.overhead)) {
      // 雾卡 / 架空构件不参与接地判据
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
