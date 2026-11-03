/**
 * 积水洼（PATH_SYSTEM.puddle）
 *
 * 18 处独立建模的雨后积水：12 处落在石阶踏面上、6 处落在参道两侧路肩泥地。
 * 每处由两片独立几何组成 —— 水面圆盘（puddleWater-N）+ 一圈湿痕环
 * （puddleHalo-N，水沿边缘把石头/泥土洇深一圈的那条暗边）。两片都是
 * 28 扇区的非索引三角片，独立材质、独立 uv，不合并、不共享。
 *
 * —— 为什么水面是椭圆而不是圆
 * layout.js 的 PUDDLES 把 X 向半径写成 0.28–0.40、Z 向收窄到 0.18–0.22。
 * 各向同性的 0.22–0.40 会越过 0.50 m 的踏步深，R6 宿主包含判据（容差 0.06）过不去；
 * 而真实台阶上的积水本来就是顺着踏面横向摊开的一条椭圆。半径按
 * R(θ) = 1 / hypot(cosθ/r, sinθ/rz) 逐角解析给出，不是缩放出来的圆。
 *
 * —— 台阶宿主：水面必须裁进承载它的那一块石板里
 * 每级石板沿 X 被切成 2–3 块独立石板，块间有 22–42 mm 的错缝。跨在错缝上的水面
 * 会悬在空气里（穿模）。所以逐角把椭圆半径再夹一次：
 *   R(θ) = min( 椭圆半径, 石板 X 边界到中心的距离, 踏步前后边界到中心的距离 )
 * 承载块由 stone-steps.js 导出的 stepSlabSpans(k) 精确复现（同种子、同抽样顺序），
 * 边界再内缩 INSET_X / INSET_Z，保证水面边缘真正落在石板实体之上。
 * 12 处实测有 5 处（第 1、7、11、13、17 级）被石板边界裁到，最狠的一处（第 13 级）
 * 保留 56 % 的椭圆面积、仍是一块 0.16 m² 的水面，并沿石板错缝留下一条直边 ——
 * 这正是「水积在两块石板的接缝边」该有的读法，不需要改布局。被裁后最小半径 0.028 m，
 * 不会出现退化三角形。Z 向从不被裁（rz ≤ 0.22 < 踏步半深 − INSET_Z = 0.23）。
 *
 * —— 路肩宿主：水面是「 draped 薄膜」，不是平面圆盘
 * 参道是一条坡道（grade 0.29），路肩地形沿 +z 单调下降；在一块 0.5 m 见方的洼地里
 * 实测高差 0.14–0.33 m。直接放一张水平圆盘，下坡那一侧会浮起最多 13 cm —— 一块
 * 悬在半空的镜子。这里先对椭圆足迹内的地形做最小二乘平面拟合，再逐顶点取
 *   y = max( 拟合平面 + WATER_LIFT, 实际地形 + MIN_LIFT )
 * 地面平的地方就是一张平的反射水面，地面有微起伏凸起的地方就变成贴着地面的一层薄膜：
 * 既不穿模，也不浮空。
 * 拟合不需要解线性方程组：采样网格关于中心对称、且只保留椭圆内的点，于是
 * Σdx = Σdz = Σdx·dz = 0，正规方程自动解耦成 a = Σdx·y/Σdx²、b = Σdz·y/Σdz²、c = Σy/n。
 * 12×12 全解版本实测残差 ≤ 0.024 m，且拟合平面始终落在足迹的地形标高区间之内。
 *
 * —— 为什么台阶上的水面保持平面
 * 踏面本身就是平面（每级顶面等高），平面拟合在这里退化成常数；draped 只会引入噪声。
 *
 * —— 抬升量
 * 水面 WATER_LIFT 16 mm、湿痕环 HALO_LIFT 9 mm。石板顶面带最高 +5 mm 的抖动
 * （stone-steps.js 的 JITTER_UP），所以环必须抬到 9 mm 以上才始终高出任何一块石板顶
 * ≥ 4 mm；draped 薄膜的保底 MIN_LIFT 6 mm 保证任何顶点都不低于当地地形。
 * 涟漪的竖直幅度上限 4 mm（ANIM.puddleRipple.amplitudeMax）：16 − 4 > 5 > 石板抖动、
 * 6 − 4 > 0 > 地形 ⇒ 动画期间同样不会穿模。
 *
 * —— 湿痕环的宽度
 * 外沿 outer = min( R(θ)·1.34 + 15 mm, 石板边界内缩 5 mm 后的夹取半径 )，
 * 内沿 inner = min( R(θ), outer − 18 mm )。石板边界内缩 5 mm 的夹取半径恒比水面
 * 夹取半径大 ≥ 15 mm（X 向多 25 mm、Z 向多 15 mm），所以环永远在水面之外、
 * 又永远不越过石板边；空间不够时内沿允许往水面底下钻最多 3 mm —— 湿痕本来就会
 * 从水底下漫过去。路肩宿主没有石板可裁，直接 inner = R(θ)、outer = 1.34·R(θ)。
 *
 * —— uv 平铺（与溪流的偏差，刻意为之）
 * 水面用 0.85 m 平铺。照搬溪流的 2.5 m 会让一块 0.5–0.8 m 的积水只采样到
 * waterDetailTexture 的一个角落，读起来像一块平塑料。湿痕环按它所在表面取平铺：
 * 石阶上 1.2 m（= stone-steps.js 的 UV_TILE）、泥地上 5 m（= terrain.js 的 soilPath），
 * 让那条暗边和它底下的石头/泥土纹理对齐。水面材质本身的水流 shader 是世界坐标驱动的
 * （toon.applyWaterFlow 注入 vStationWorldPos），与 uv 无关，uv 只驱动 roughnessMap。
 *
 * —— 描边与阴影
 * 水面材质名 puddleWater 命中 NO_OUTLINE_PREFIXES（'puddle' 之后紧跟大写）⇒ 自动不描边；
 * 湿痕环在石阶上用 stoneStepWet，它不在前缀表里 ⇒ 显式 userData.noOutline（给一张共面的
 * 薄片套反向壳体，等于在水边压出一块黑盘子）。全部 noCast、全部 receiveShadow：
 * 积水不投影，但要接住树与鸟居的阴影。水面**不带** userData.waterSurface，否则
 * animations/stream-flow.js 会把积水当成溪面、按默认 2 列水柱权重去扰动它。
 *
 * —— 校验
 * puddle 只属于 PATH_SYSTEM（不属于 WATER_SYSTEM）⇒ R2 走廊 / R4 鸟居净空跳过、
 * R3 溪谷净空照常判定（18 处落点离溪心最近也有 2.4 m，全部通过）、R6 宿主包含生效。
 * 宿主盒由 layout 表推出：台阶宿主 = stepBox(k) 顶面再抬 20 mm；坡地宿主 = 落点
 * ±1.45·max(r, rz)（1.45 > 湿痕外沿系数 1.34）× 足迹内地形标高 ±60 mm。
 * 取所有宿主的并集，因为每个洼地都落在自己的宿主内 ⇒ 整组包围盒必然落在并集内。
 *
 * —— 已知并被接受的穿模
 * stone-steps.js 的踏面碎裂石片（stepChip-*）顶面最高到 top + 66 mm，可能刺穿水面圆盘。
 * 刺穿处是一个干净的截面而不是共面重叠，且水面是半透明的 ⇒ 读作「水里的一颗石子」，
 * 正是想要的效果；不为此建立避碰机制。
 */
import * as THREE from 'three';
import { ANIM } from '../config.js';
import { PUDDLES, PATH, stepBox, stepTopY, terrainHeight, clamp, lerp } from '../layout.js';
import { group, rng } from '../primitives.js';
import { stepSlabSpans } from './stone-steps.js';

export const PUDDLE_MODEL = { radius: 0.4, rz: 0.22, waterLift: 0.016 };

const TAU = Math.PI * 2;
const SECTORS = 28;

const WATER_LIFT = 0.016;
const HALO_LIFT = 0.009;
const MIN_LIFT = 0.006;

const INSET_X = 0.03;
const INSET_Z = 0.02;
const HALO_INSET = 0.005;
const HALO_FACTOR = 1.34;
const HALO_EXTRA = 0.015;
const HALO_MIN_WIDTH = 0.018;

const PLANE_AXIS_SAMPLES = 13;
const FOOT_SAMPLES = 9;

const WATER_TILE = 0.85;
const HALO_TILE_STEP = 1.2;
const HALO_TILE_GROUND = 5;

const HOST_FOOT_FACTOR = 1.45;
const HOST_Y_MARGIN = 0.06;

const SEED_BASE = 6107;
const SEED_STRIDE = 149;

/** 椭圆半径：沿 X 半轴 r、沿 Z 半轴 rz 的极坐标解析式 */
function ellipseRadius(theta, r, rz) {
  return 1 / Math.hypot(Math.cos(theta) / r, Math.sin(theta) / rz);
}

/**
 * 从中心沿 θ 方向到「局部矩形盒」边界的距离。盒的边界已经预先内缩好，
 * 所以这里 inset 恒为 0；某条轴方向几乎平行于边界时该轴不构成限制。
 */
function boxRadius(box, cos, sin) {
  const dx = cos > 1e-9 ? box.x1 / cos : cos < -1e-9 ? box.x0 / cos : Infinity;
  const dz = sin > 1e-9 ? box.z1 / sin : sin < -1e-9 ? box.z0 / sin : Infinity;
  return Math.min(dx, dz);
}

/** 平铺 uv：世界米 / 平铺尺寸，与 stream.js / terrain.js 同一约定 */
function addPlanarUv(geo, tileMeters) {
  const position = geo.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / tileMeters;
    uv[i * 2 + 1] = position.getZ(i) / tileMeters;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function finishGeometry(geo, tile) {
  geo.computeVertexNormals();
  addPlanarUv(geo, tile);
  return geo;
}

/**
 * 椭圆足迹内的最小二乘平面（对称采样 ⇒ Σdx = Σdz = Σdx·dz = 0，正规方程解耦）。
 * 返回 planeAt(x, z)：该洼地「当地平均地面」的连续近似。
 */
function fitPlane(cx, cz, r, rz) {
  const half = (PLANE_AXIS_SAMPLES - 1) / 2;
  let sxx = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  let sy = 0;
  let count = 0;
  for (let i = 0; i < PLANE_AXIS_SAMPLES; i++) {
    const u = (i - half) / half;
    const dx = u * r;
    for (let j = 0; j < PLANE_AXIS_SAMPLES; j++) {
      const v = (j - half) / half;
      if (u * u + v * v > 1) continue;
      const dz = v * rz;
      const y = terrainHeight(cx + dx, cz + dz);
      sxx += dx * dx;
      szz += dz * dz;
      sxy += dx * y;
      szy += dz * y;
      sy += y;
      count += 1;
    }
  }
  const a = sxx > 0 ? sxy / sxx : 0;
  const b = szz > 0 ? szy / szz : 0;
  const c = count > 0 ? sy / count : 0;
  return (x, z) => a * (x - cx) + b * (z - cz) + c;
}

/** 洼地足迹内的地形标高区间（用于宿主盒的 y 范围） */
function footRelief(cx, cz, rx, rz) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < FOOT_SAMPLES; i++) {
    const x = cx + lerp(-rx, rx, i / (FOOT_SAMPLES - 1));
    for (let j = 0; j < FOOT_SAMPLES; j++) {
      const z = cz + lerp(-rz, rz, j / (FOOT_SAMPLES - 1));
      const y = terrainHeight(x, z);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return { min: lo, max: hi };
}

/** 非索引圆盘：中心 + 周长，(C, P(b), P(a)) 缠绕给出 +Y 法向 */
function discGeometry(cx, cz, radiusOf, yOf) {
  const px = [];
  const py = [];
  const pz = [];
  for (let i = 0; i < SECTORS; i++) {
    const theta = (i / SECTORS) * TAU;
    const R = radiusOf(theta);
    const x = cx + Math.cos(theta) * R;
    const z = cz + Math.sin(theta) * R;
    px.push(x);
    pz.push(z);
    py.push(yOf(x, z));
  }
  const position = [];
  const cy = yOf(cx, cz);
  for (let i = 0; i < SECTORS; i++) {
    const j = (i + 1) % SECTORS;
    position.push(cx, cy, cz, px[j], py[j], pz[j], px[i], py[i], pz[i]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  return geo;
}

/** 非索引环：内圈 + 外圈，(Ia,Ib,Ob) 与 (Ia,Ob,Oa) 两片三角拼出一圈 +Y 面 */
function ringGeometry(cx, cz, innerOf, outerOf, yOf) {
  const inner = [];
  const outer = [];
  for (let i = 0; i < SECTORS; i++) {
    const theta = (i / SECTORS) * TAU;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const ri = innerOf(theta);
    const ro = outerOf(theta);
    const xi = cx + cos * ri;
    const zi = cz + sin * ri;
    const xo = cx + cos * ro;
    const zo = cz + sin * ro;
    inner.push([xi, yOf(xi, zi), zi]);
    outer.push([xo, yOf(xo, zo), zo]);
  }
  const position = [];
  for (let i = 0; i < SECTORS; i++) {
    const j = (i + 1) % SECTORS;
    const ia = inner[i];
    const ib = inner[j];
    const oa = outer[i];
    const ob = outer[j];
    position.push(ia[0], ia[1], ia[2], ib[0], ib[1], ib[2], ob[0], ob[1], ob[2]);
    position.push(ia[0], ia[1], ia[2], ob[0], ob[1], ob[2], oa[0], oa[1], oa[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  return geo;
}

/* ------------------------------------------------------------------ 台阶宿主 */

/** 承载这块积水的石板区间；layout 的落点必然落在其中一块内，找不到就就近吸附 */
function hostSpan(step, x) {
  const spans = stepSlabSpans(step);
  const hit = spans.find(([lo, hi]) => x >= lo && x <= hi);
  if (hit) return { span: hit, x };
  const nearest = spans.reduce(
    (best, s) => (Math.abs(x - (s[0] + s[1]) / 2) < Math.abs(x - (best[0] + best[1]) / 2) ? s : best),
    spans[0]
  );
  return { span: nearest, x: clamp(x, nearest[0] + INSET_X, nearest[1] - INSET_X) };
}

function buildStepPuddle(root, M, p, index) {
  const top = stepTopY(p.step);
  const { span, x } = hostSpan(p.step, p.x);
  const z = p.z;
  const halfTread = PATH.tread / 2;
  const waterBox = {
    x0: span[0] + INSET_X - x,
    x1: span[1] - INSET_X - x,
    z0: -halfTread + INSET_Z,
    z1: halfTread - INSET_Z
  };
  const haloBox = {
    x0: span[0] + HALO_INSET - x,
    x1: span[1] - HALO_INSET - x,
    z0: -halfTread + HALO_INSET,
    z1: halfTread - HALO_INSET
  };

  const radiusOf = (theta) => {
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    return Math.min(ellipseRadius(theta, p.r, p.rz), boxRadius(waterBox, cos, sin));
  };
  const haloOf = (theta) => {
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const R = radiusOf(theta);
    const outer = Math.min(R * HALO_FACTOR + HALO_EXTRA, boxRadius(haloBox, cos, sin));
    return { inner: Math.min(R, outer - HALO_MIN_WIDTH), outer };
  };

  const waterY = () => top + WATER_LIFT;
  const haloY = () => top + HALO_LIFT;

  const water = mesh(
    finishGeometry(discGeometry(x, z, radiusOf, waterY), WATER_TILE),
    M.puddleWater,
    `puddleWater-${index + 1}`
  );
  const halo = mesh(
    finishGeometry(
      ringGeometry(x, z, (t) => haloOf(t).inner, (t) => haloOf(t).outer, haloY),
      HALO_TILE_STEP
    ),
    M.stoneStepWet,
    `puddleHalo-${index + 1}`
  );

  water.userData.puddleRipple = {
    host: 'step',
    r: p.r,
    rz: p.rz,
    level: waterY(),
    phase: 0,
    period: 0
  };
  return { water, halo, x, z, host: stepBox(p.step), top };
}

/* ------------------------------------------------------------------ 路肩宿主 */

function buildGroundPuddle(root, M, p, index) {
  const x = p.x;
  const z = p.z;
  const plane = fitPlane(x, z, p.r, p.rz);
  const waterY = (wx, wz) => Math.max(plane(wx, wz) + WATER_LIFT, terrainHeight(wx, wz) + MIN_LIFT);
  const haloY = (wx, wz) => Math.max(plane(wx, wz) + HALO_LIFT, terrainHeight(wx, wz) + MIN_LIFT);

  const radiusOf = (theta) => ellipseRadius(theta, p.r, p.rz);
  const water = mesh(
    finishGeometry(discGeometry(x, z, radiusOf, waterY), WATER_TILE),
    M.puddleWater,
    `puddleWater-${index + 1}`
  );
  const halo = mesh(
    finishGeometry(
      ringGeometry(x, z, (t) => radiusOf(t), (t) => radiusOf(t) * HALO_FACTOR, haloY),
      HALO_TILE_GROUND
    ),
    M.soilPathWet,
    `puddleHalo-${index + 1}`
  );

  water.userData.puddleRipple = {
    host: 'ground',
    r: p.r,
    rz: p.rz,
    level: waterY(x, z),
    phase: 0,
    period: 0
  };
  return { water, halo, x, z, host: null };
}

/* ------------------------------------------------------------------ 组装 */

function mesh(node, material, name) {
  const mesh = new THREE.Mesh(node, material);
  mesh.name = name;
  return mesh;
}

export function createPuddle(M) {
  const root = group('puddle');
  const samples = [];
  const ripple = ANIM.puddleRipple;
  let meshCount = 0;
  let hostX0 = Infinity;
  let hostX1 = -Infinity;
  let hostY0 = Infinity;
  let hostY1 = -Infinity;
  let hostZ0 = Infinity;
  let hostZ1 = -Infinity;

  PUDDLES.forEach((p, index) => {
    const rand = rng(SEED_BASE + index * SEED_STRIDE);
    const built = p.host === 'step' ? buildStepPuddle(root, M, p, index) : buildGroundPuddle(root, M, p, index);

    built.water.castShadow = false;
    built.water.receiveShadow = true;
    built.water.userData.noCast = true;
    built.halo.castShadow = false;
    built.halo.receiveShadow = true;
    built.halo.userData.noCast = true;
    // stoneStepWet 不在不描边前缀表里：共面薄片的反向壳体会在积水边压出一块黑盘子
    built.halo.userData.noOutline = true;

    built.water.userData.puddleRipple.period = lerp(ripple.periodMin, ripple.periodMax, rand());
    built.water.userData.puddleRipple.phase = rand() * TAU;

    // 宿主盒：台阶取整块石板（顶面再抬 20 mm 容纳 16 mm 水面），
    // 路肩取落点 ±1.45·max(r,rz)（> 湿痕外沿系数 1.34）× 足迹内地形标高 ±60 mm
    let host;
    if (built.host) {
      host = {
        x: [built.host.min.x, built.host.max.x],
        y: [built.host.min.y, built.host.max.y + 0.02],
        z: [built.host.min.z, built.host.max.z]
      };
    } else {
      const reach = Math.max(p.r, p.rz);
      const relief = footRelief(built.x, built.z, p.r * HALO_FACTOR, p.rz * HALO_FACTOR);
      host = {
        x: [built.x - reach * HOST_FOOT_FACTOR, built.x + reach * HOST_FOOT_FACTOR],
        y: [relief.min - HOST_Y_MARGIN, relief.max + HOST_Y_MARGIN],
        z: [built.z - reach * HOST_FOOT_FACTOR, built.z + reach * HOST_FOOT_FACTOR]
      };
    }
    if (host.x[0] < hostX0) hostX0 = host.x[0];
    if (host.x[1] > hostX1) hostX1 = host.x[1];
    if (host.y[0] < hostY0) hostY0 = host.y[0];
    if (host.y[1] > hostY1) hostY1 = host.y[1];
    if (host.z[0] < hostZ0) hostZ0 = host.z[0];
    if (host.z[1] > hostZ1) hostZ1 = host.z[1];

    root.add(built.water);
    root.add(built.halo);
    meshCount += 2;
    samples.push({ x: built.x, z: built.z });
  });

  root.userData.samples = samples;
  root.userData.puddleCount = PUDDLES.length;
  root.userData.support = {
    host: { x: [hostX0, hostX1], y: [hostY0, hostY1], z: [hostZ0, hostZ1] }
  };
  root.userData.meshCount = meshCount;
  root.updateMatrixWorld(true);
  return root;
}

export default createPuddle;
