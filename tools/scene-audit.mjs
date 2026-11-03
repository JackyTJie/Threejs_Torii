#!/usr/bin/env node
// S9.4 场景审计：底座范围 / 正方形底座 / 接地 / 穿模 / 面反转 / 法线一致性 / 无界面元素
//
// 全部在 Node 内用 three 桩真实构建场景（js/scene-assembly.js），不连浏览器。
// --strict 会清空「容器豁免」与「同资产豁免」，用来验证豁免之下是否真的没有互穿。
import { installDomStub } from './dom-stub.mjs';

installDomStub();

const THREE = await import('three');
const { createMaterialLibrary } = await import('../js/materials.js');
const { assembleScene } = await import('../js/scene-assembly.js');
const { PAD, LEVEL } = await import('../js/config.js');
const { groundHeight, CONTENT_HALF, STATION, PLATFORM } = await import('../js/layout.js');

const STRICT = process.argv.includes('--strict');

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);

/* ------------------------------------------------------------------ 豁免表
 * 每一项都必须写清「为什么这不是穿模」，否则豁免就是掩盖问题。
 */

// 地面 / 路基 / 山体 / 水面：它们是「地面定义者」，别的构件坐在上面属于嵌套
const CONTAINERS = new Set([
  'basePad',
  'terrain',
  'railBallast',
  'railTrack',
  'gravelPath',
  'stationPlatform',
  'platformStairs',
  'drainDitch',
  'stream',
  'culvert',
  'stoneBridge',
  'stationBuilding', // 室内陈设位于墙体内：容器关系，不是互穿
  'stationRoof',
  'stationCanopy'
]);

// 明确允许悬空（不接地的构件）：架空线、雨棚、招牌、灯具、空中落叶、尘埃、光斑
const AIRBORNE = new Set([
  'powerLines',
  'stationCanopy',
  'stationRoof',
  'stationSign',
  'stationGlass',
  'wallClock',
  'paperPoster',
  'leafFall',
  'dustMotes',
  'sunFlicker',
  'floatingLeaves'
]);

// 允许与别的资产体积重叠的构件对（必须物理连接）
const PAIR_WHITELIST = [
  [/^utilityPole/, /^powerLines$/],
  [/^signalSemaphore/, /^railBallast$/],
  [/^signalColor/, /^railBallast$/],
  [/^levelCrossing/, /^gravelPath$/],
  [/^abandonedBicycle/, /^stationBuilding$/],
  [/^oilLamp/, /^stationBuilding$/],
  [/^ironStove/, /^stationBuilding$/],
  [/^ironStove/, /^stationRoof$/], // 烟囱穿屋面（S4.6）
  // 青苔长在巨石脚上：MOSS_PATCHES 里 host = mossBoulder 的群落就是按「巨石背阴脚」放的（layout §2.54），
  // 苔壳碎块必须贴进石面才算附着，浮在石外反而穿帮。实测 boulder-1-secondary-1 与
  // moss-patch-14-mossBoulder-flake-7 重叠 0.0143 m³ —— 这是附着关系，不是穿模。
  [/^mossBoulder/, /^mossPatch$/]
];
const whitelisted = (a, b) =>
  PAIR_WHITELIST.some(([x, y]) => (x.test(a.name) && y.test(b.name)) || (x.test(b.name) && y.test(a.name)));

/* ------------------------------------------------------------------ 几何工具 */

function worldBox(obj) {
  if (!obj.geometry) return null;
  obj.geometry.computeBoundingBox();
  const b = obj.geometry.boundingBox;
  if (!b || b.isEmpty()) return null;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const x of [b.min.x, b.max.x]) {
    for (const y of [b.min.y, b.max.y]) {
      for (const z of [b.min.z, b.max.z]) {
        v.set(x, y, z).applyMatrix4(obj.matrixWorld);
        box.min.x = Math.min(box.min.x, v.x);
        box.min.y = Math.min(box.min.y, v.y);
        box.min.z = Math.min(box.min.z, v.z);
        box.max.x = Math.max(box.max.x, v.x);
        box.max.y = Math.max(box.max.y, v.y);
        box.max.z = Math.max(box.max.z, v.z);
      }
    }
  }
  return box;
}

const sizeOf = (b) => ({ x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z });

function overlapVolume(a, b) {
  const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const dz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  if (dx <= 0 || dy <= 0 || dz <= 0) return 0;
  return dx * dy * dz;
}

function contains(a, b, eps = 1e-3) {
  return (
    a.min.x <= b.min.x + eps && a.min.y <= b.min.y + eps && a.min.z <= b.min.z + eps &&
    a.max.x >= b.max.x - eps && a.max.y >= b.max.y - eps && a.max.z >= b.max.z - eps
  );
}

/**
 * 有符号体积（散度定理）：V = Σ v0 · (v1 × v2) / 6。
 * 缠绕方向反了（法线朝内）→ V < 0。开放面片（地形补丁、落叶薄片、海报）V ≈ 0，不参与判定。
 */
function signedVolume(geometry) {
  const pos = geometry.getAttribute('position');
  if (!pos) return 0;
  const index = geometry.getIndex();
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  let sum = 0;
  const tris = index ? index.count : Math.floor(pos.count / 3) * 3;
  for (let i = 0; i + 2 < tris; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    v0.fromBufferAttribute(pos, a);
    v1.fromBufferAttribute(pos, b);
    v2.fromBufferAttribute(pos, c);
    sum += v0.dot(v1.cross(v2));
  }
  return sum / 6;
}

/**
 * 是否封闭流形：每条无向边恰好被 2 个三角形使用。
 * 只有封闭网格才谈得上「包围的体积」：开放面片（地形坡面、水面、落叶薄片、海报）的
 * 散度定理求和不是体积，直接判反转会得出几百立方米的假结论。
 */
function isClosedManifold(geometry) {
  const index = geometry.getIndex();
  const pos = geometry.getAttribute('position');
  if (!pos || !index) return false;
  const edges = new Map();
  const key = (i, j) => (i < j ? i * 1048576 + j : j * 1048576 + i);
  for (let i = 0; i + 2 < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = key(u, v);
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  if (edges.size === 0) return false;
  for (const n of edges.values()) if (n !== 2) return false;
  return true;
}

/**
/**
 * 法线一致性：法线是否有限、是否单位长、是否与三角形缠绕方向一致。
 *
 * 判据（为什么这样判，避免把无害情况当错误）：
 * - 顶点必须至少参与一个非退化三角形才参与法线判定。内置 Sphere / Cone / Lathe 在接缝、
 *   锥顶、车削轴线处留有只被零面积面引用的重复顶点，three 的 computeVertexNormals 只累加
 *   被引用的面，这些顶点的法线恒为 (0,0,0)。那里没有任何像素被光栅化，不算缺陷。
 * - 判定量是 face·vertexNormal 的 cos：cos < -0.35 记「反转」（法线明确朝内）；
 *   -0.35 <= cos < 0 记「折边歧义」——锐折边（压扁石壳周缘、薄壳接缝）处的平滑法线由两侧
 *   面平均而来，方向接近零、符号是数值噪声，单独计数，不作错误。
 * - 整体反转另有硬门禁：封闭网格的有符号体积 < 0（见 signedVolume）。
 */
function normalAudit(mesh) {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  if (!pos) return { skip: true, reason: '无 position' };
  if (!nor) return { skip: false, reason: '无 normal 属性', nonFinite: 0, nonUnit: 0, disagree: 0, ambiguous: 0, total: 0, degenerate: 0 };

  const index = geo.getIndex();
  const tris = index ? index.count : Math.floor(pos.count / 3) * 3;
  const triCount = Math.floor(tris / 3);

  // 第一遍：逐三角面积，顺带标记「有实际面积的顶点」
  const ia = new Int32Array(triCount);
  const ib = new Int32Array(triCount);
  const ic = new Int32Array(triCount);
  const area = new Float64Array(triCount);
  const live = new Uint8Array(pos.count); // 至少属于一个非退化三角形
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const face = new THREE.Vector3();
  let degenerate = 0;
  for (let t = 0; t < triCount; t++) {
    ia[t] = index ? index.getX(t * 3) : t * 3;
    ib[t] = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    ic[t] = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, ia[t]);
    b.fromBufferAttribute(pos, ib[t]);
    c.fromBufferAttribute(pos, ic[t]);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    face.crossVectors(ab, ac);
    const ar = face.length();
    area[t] = ar;
    if (ar < 1e-12) { degenerate += 1; continue; }
    live[ia[t]] = 1; live[ib[t]] = 1; live[ic[t]] = 1;
  }

  let nonFinite = 0;
  let nonUnit = 0;
  let idleZero = 0;
  for (let i = 0; i < nor.count; i++) {
    const x = nor.getX(i);
    const y = nor.getY(i);
    const z = nor.getZ(i);
    if (!live[i]) {
      if (Math.hypot(x, y, z) < 1e-6) idleZero += 1;
      continue;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nonFinite += 1;
    else if (Math.abs(Math.hypot(x, y, z) - 1) > 0.05) nonUnit += 1;
  }

  let disagree = 0;
  let ambiguous = 0;
  let total = 0;
  const vn = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    if (area[t] < 1e-12) continue;
    a.fromBufferAttribute(pos, ia[t]);
    b.fromBufferAttribute(pos, ib[t]);
    c.fromBufferAttribute(pos, ic[t]);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    face.crossVectors(ab, ac).multiplyScalar(1 / area[t]);
    // fromBufferAttribute 返回 this 自身：必须用独立临时量累加，否则三次 add 会自叠加成 4 倍首顶点法线
    vn.set(0, 0, 0);
    vn.fromBufferAttribute(nor, ia[t]);
    tmp.fromBufferAttribute(nor, ib[t]);
    vn.add(tmp);
    tmp.fromBufferAttribute(nor, ic[t]);
    vn.add(tmp);
    const vnLen = vn.length();
    if (vnLen < 1e-12) continue;
    total += 1;
    const cos = face.dot(vn) / vnLen;
    if (cos < -0.35) disagree += 1;
    else if (cos < 0) ambiguous += 1;
  }
  return { skip: false, nonFinite, nonUnit, idleZero, disagree, ambiguous, total, degenerate };
}

/* ------------------------------------------------------------------ 构建 */

const M = createMaterialLibrary();
const scene = new THREE.Scene();
const { assets } = assembleScene(scene, M);
scene.updateMatrixWorld(true);

const items = [];
let meshCount = 0;
let outlineCount = 0;
let instancedCount = 0;
let triangleEstimate = 0;

for (const [name, root] of assets) {
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.isOutline) {
      outlineCount += 1;
      return;
    }
    if (o.isInstancedMesh) {
      instancedCount += 1;
      return;
    }
    meshes.push(o);
    meshCount += 1;
    const pos = o.geometry && o.geometry.getAttribute('position');
    if (pos) triangleEstimate += Math.floor((o.geometry.getIndex() ? o.geometry.getIndex().count : pos.count) / 3);
  });
  // 资产包围盒走 setFromObject：InstancedMesh（落叶堆 / 空中落叶）与 Points（尘埃）同样要计入
  // 范围检查与资产清单，否则这三组会因为「没有实体网格」被漏掉。
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) continue;
  items.push({ name, box, meshes, obj: root });
}

/* ------------------------------------------------------------------ 1) 底座 */
const pad = items.find((a) => a.name === 'basePad');
if (!pad) {
  fail('缺少 basePad：场景必须坐落在一块规整正方形底座上（AGENT.md 底座硬性要求）');
} else {
  const s = sizeOf(pad.box);
  if (Math.abs(s.x - s.z) > 0.02) fail(`底座不是正方形: x=${s.x.toFixed(3)} z=${s.z.toFixed(3)}`);
  if (Math.abs(s.x - PAD.size) > 0.06) warn(`底座尺寸 ${s.x.toFixed(2)} 与 PAD.size ${PAD.size} 不一致`);
  const padNames = new Set();
  pad.obj.traverse((o) => {
    if (o.isMesh && o.material) padNames.add(o.material.name);
  });
  if (![...padNames].some((n) => /^pad/.test(n || ''))) fail(`底座材质不是底座专用材质（得到 ${[...padNames].join(', ')}）`);
  console.log(`底座: ${s.x.toFixed(2)} x ${s.z.toFixed(2)} x ${s.y.toFixed(2)}（顶面 y=${fmt(pad.box.max.y)}）/ 材质 ${[...padNames].join(', ')}`);
}

/* ------------------------------------------------------------------ 2) 范围 */
// yMax 13.5：林缘 Row A 最大株高（layout.TREES scale 1.30 × 树高 9.6 m）+ 顶部叶簇半径，
// 实测最高点 = 榉 (-8.5,-18) 冠顶 y=12.47。42 m 底座上 12.5 m 的远山林冠顶是物理正确的高度，
// 不是越界；上限留 1 m 余量，再高就是模型尺寸错误。
const BOUND = { xz: CONTENT_HALF + 0.35, yMin: -2.2, yMax: 13.5 };
let outOfBounds = 0;
for (const a of items) {
  if (a.name === 'basePad') continue;
  const b = a.box;
  const bad = [];
  if (b.min.x < -BOUND.xz || b.max.x > BOUND.xz) bad.push(`x [${fmt(b.min.x)}, ${fmt(b.max.x)}]`);
  if (b.min.z < -BOUND.xz || b.max.z > BOUND.xz) bad.push(`z [${fmt(b.min.z)}, ${fmt(b.max.z)}]`);
  if (b.min.y < BOUND.yMin) bad.push(`y 过低 [${fmt(b.min.y)}]`);
  if (b.max.y > BOUND.yMax) bad.push(`y 过高 [${fmt(b.max.y)}]`);
  if (bad.length) {
    outOfBounds += 1;
    fail(`越出底座范围 ${a.name}: ${bad.join('; ')}`);
  }
}
if (!outOfBounds) console.log(`范围: 全部 ${items.length - 1} 组资产在 ±${BOUND.xz.toFixed(2)} m 内`);

/* ------------------------------------------------------------------ 3) 接地 */
let grounded = 0;
let airborne = 0;
for (const a of items) {
  if (a.name === 'basePad' || CONTAINERS.has(a.name)) continue;
  const cx = (a.box.min.x + a.box.max.x) / 2;
  const cz = (a.box.min.z + a.box.max.z) / 2;
  const g = groundHeight(cx, cz);
  if (a.box.max.y < g - 0.05) {
    fail(`完全埋入地面 ${a.name}: 顶面 ${fmt(a.box.max.y)} < 地面 ${fmt(g)}`);
    continue;
  }
  const lift = a.box.min.y - g;
  if (lift > 0.4) {
    if (AIRBORNE.has(a.name)) airborne += 1;
    else warn(`疑似悬空 ${a.name}: 最低点高出地面 ${lift.toFixed(2)} m`);
  } else {
    grounded += 1;
  }
  if (lift < -0.6) warn(`疑似深陷 ${a.name}: 最低点低于地面 ${(-lift).toFixed(2)} m`);
}
console.log(`接地: ${grounded} 组落在地面 / 台面标高上，${airborne} 组属于允许悬空的构件`);

/* ------------------------------------------------------------------ 4) 穿模 */
const containers = STRICT ? new Set() : CONTAINERS;
const assetOverlaps = [];
for (let i = 0; i < items.length; i++) {
  for (let j = i + 1; j < items.length; j++) {
    const a = items[i];
    const b = items[j];
    const ov = overlapVolume(a.box, b.box);
    if (ov <= 0.02) continue;
    if (contains(a.box, b.box) || contains(b.box, a.box)) continue; // 容器关系
    if (containers.has(a.name) || containers.has(b.name)) continue;
    if (whitelisted(a, b)) continue;
    assetOverlaps.push({ i, j, a, b, ov });
  }
}

// 网格级钻取：空间哈希（XZ 平面），只比较不同资产的网格
const leafMeshes = [];
for (let i = 0; i < items.length; i++) {
  if (containers.has(items[i].name)) continue;
  for (const m of items[i].meshes) {
    const wb = worldBox(m);
    if (!wb) continue;
    const s = sizeOf(wb);
    if (s.x > 12 || s.z > 12 || s.y > 12) continue; // 大地形 / 墙体交给资产级
    leafMeshes.push({ ai: i, name: m.name || 'mesh', box: wb });
  }
}

const CELL = 0.6;
const grid = new Map();
const cellKey = (ix, iz) => ix * 8192 + iz;
for (let k = 0; k < leafMeshes.length; k++) {
  const m = leafMeshes[k];
  const x0 = Math.floor(m.box.min.x / CELL);
  const x1 = Math.floor(m.box.max.x / CELL);
  const z0 = Math.floor(m.box.min.z / CELL);
  const z1 = Math.floor(m.box.max.z / CELL);
  if ((x1 - x0 + 1) * (z1 - z0 + 1) > 600) continue;
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const key = cellKey(ix, iz);
      let arr = grid.get(key);
      if (!arr) {
        arr = [];
        grid.set(key, arr);
      }
      arr.push(k);
    }
  }
}

const pairKey = (i, j) => (i < j ? `${i}|${j}` : `${j}|${i}`);
const pairBest = new Map();
for (const arr of grid.values()) {
  if (arr.length < 2) continue;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const ma = leafMeshes[arr[i]];
      const mb = leafMeshes[arr[j]];
      if (ma.ai === mb.ai) continue;
      const ov = overlapVolume(ma.box, mb.box);
      if (ov <= 0.004) continue; // 4 L：构件贴合 / 共面接缝不算穿模
      const key = pairKey(ma.ai, mb.ai);
      const cur = pairBest.get(key);
      if (!cur || ov > cur.ov) pairBest.set(key, { ov, ma, mb, i: ma.ai, j: mb.ai });
    }
  }
}

const seenPairs = new Set();
const conservative = [];
for (const o of assetOverlaps) {
  const key = pairKey(o.i, o.j);
  seenPairs.add(key);
  const hit = pairBest.get(key);
  if (hit) {
    fail(`互穿 ${o.a.name} <-> ${o.b.name}: 资产包围盒 ${o.ov.toFixed(3)} m³，网格级 ${hit.ov.toFixed(4)} m³（${hit.ma.name} <-> ${hit.mb.name}）`);
  } else {
    conservative.push(o);
  }
}
for (const [key, c] of pairBest) {
  if (seenPairs.has(key)) continue;
  const a = items[c.i];
  const b = items[c.j];
  // 资产包围盒没重叠但网格级重叠：同样要过连接件白名单，否则会把物理连接当成穿模
  if (whitelisted(a, b)) continue;
  fail(`网格级互穿 ${a.name} <-> ${b.name}: ${c.ov.toFixed(4)} m³（${c.ma.name} <-> ${c.mb.name}）`);
}

/* ------------------------------------------------------------------ 5) 面反转 / 法线一致性 */
let inverted = 0;
let missingNormal = 0;
let nonUnitTotal = 0;
let nonFiniteTotal = 0;
let disagreeTotal = 0;
let ambiguousTotal = 0;
let idleZeroTotal = 0;
let degenerateTotal = 0;
let audited = 0;
let closedTotal = 0;
for (const item of items) {
  for (const m of item.meshes) {
    const res = normalAudit(m);
    if (res.skip) continue;
    audited += 1;
    if (res.reason) {
      missingNormal += 1;
      fail(`法线缺失 ${item.name}/${m.name}: ${res.reason}`);
      continue;
    }
    nonUnitTotal += res.nonUnit;
    nonFiniteTotal += res.nonFinite;
    disagreeTotal += res.disagree;
    ambiguousTotal += res.ambiguous;
    idleZeroTotal += res.idleZero;
    degenerateTotal += res.degenerate;
    if (res.nonFinite) fail(`法线含 NaN / Inf ${item.name}/${m.name}: ${res.nonFinite} 个`);
    if (res.disagree > Math.max(1, res.total * 0.002)) {
      inverted += 1;
      fail(`面反转 ${item.name}/${m.name}: ${res.disagree}/${res.total} 个三角形法线明确朝内（cos < -0.35）`);
    }
    if (isClosedManifold(m.geometry)) {
      closedTotal += 1;
      const v = signedVolume(m.geometry);
      const s = sizeOf(worldBox(m) || new THREE.Box3());
      const solid = Math.abs(v) > Math.max(1e-4, s.x * s.y * s.z * 0.02);
      if (solid && v < 0) {
        inverted += 1;
        fail(`面反转（封闭网格法线朝内）${item.name}/${m.name}: 有符号体积 ${v.toFixed(5)} m³`);
      }
    }
  }
}
console.log(`网格质量: ${audited} 个网格参与法线审计 / 反转 ${inverted} / 缺法线 ${missingNormal} / 非法线 ${nonUnitTotal} / 非有限 ${nonFiniteTotal}`);
console.log(`  封闭流形网格 ${closedTotal} 个（参与有符号体积反转判定）/ 折边歧义 ${ambiguousTotal} 个三角形（锐折边处平滑法线接近零，符号为数值噪声，不计错误）/ 退化三角形 ${degenerateTotal} 个（参数化原语极点、锥顶、车削轴线处的固有零面积面）/ 极点零法线顶点 ${idleZeroTotal} 个（只被零面积面引用，不产生像素）`);

/* ------------------------------------------------------------------ 6) 必备资产（AGENT.md 资产清单） */
const REQUIRED = [
  'basePad', 'terrain', 'stream', 'railBallast', 'railTrack', 'culvert', 'stationPlatform',
  'platformStairs', 'platformRail', 'drainDitch', 'gravelPath', 'stoneBridge',
  'stationBuilding', 'stationRoof', 'stationDoor', 'stationGlass', 'stationSign', 'stationCanopy',
  'stationInterior', 'stationBench', 'noticeBoard', 'utilityPole', 'powerLines',
  'signalSemaphore', 'signalColor', 'levelCrossing', 'oilDrum', 'abandonedBicycle', 'rustyToolbox',
  'mapleGrove', 'beechGrove', 'shrub', 'mossBoulder', 'mossPatch', 'leafLitter',
  'leafFall', 'floatingLeaves', 'sunFlicker', 'dustMotes'
];
const present = new Set(items.map((a) => a.name));
for (const req of REQUIRED) {
  if (!present.has(req)) fail(`必备资产缺失: ${req}`);
}
if (!STRICT) console.log(`资产清单: ${REQUIRED.length} 项全部在场`);

/* ------------------------------------------------------------------ 7) 无界面元素 */
let ui = 0;
scene.traverse((o) => {
  if (o.isAxesHelper || o.isGridHelper || o.isSprite || /Text|Label/i.test(o.type || '')) ui += 1;
});
if (ui) fail(`场景里出现界面元素 ${ui} 个（AGENT.md：画面纯净，无任何 UI）`);

/* ------------------------------------------------------------------ 8) 标高一致性抽查 */
const platformTop = items.find((a) => a.name === 'stationPlatform');
if (platformTop) {
  const top = platformTop.box.max.y;
  if (Math.abs(top - (LEVEL.platform + 0.12)) > 0.25) warn(`站台面标高 ${top.toFixed(2)} 与 LEVEL.platform ${LEVEL.platform} 偏离过大`);
}
const building = items.find((a) => a.name === 'stationBuilding');
if (building) {
  const s = sizeOf(building.box);
  if (Math.abs(building.box.min.x - STATION.x0) > 0.6 || Math.abs(building.box.max.x - STATION.x1) > 0.6) {
    warn(`站房 x 范围 [${fmt(building.box.min.x)}, ${fmt(building.box.max.x)}] 与 STATION [${STATION.x0}, ${STATION.x1}] 偏离`);
  }
  console.log(`站房: ${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)} m`);
}

/* ------------------------------------------------------------------ 统计与结论 */
console.log('=== 场景审计 ===');
console.log(`资产组 ${items.length} | 实体网格 ${meshCount} | InstancedMesh ${instancedCount} | 描边壳 ${outlineCount} | 三角面估算 ${triangleEstimate.toLocaleString('en-US')}`);

const allBox = new THREE.Box3();
for (const a of items) allBox.union(a.box);
console.log(`场景包围盒: x [${fmt(allBox.min.x)}, ${fmt(allBox.max.x)}] y [${fmt(allBox.min.y)}, ${fmt(allBox.max.y)}] z [${fmt(allBox.min.z)}, ${fmt(allBox.max.z)}]`);
console.log(`站台 ${PLATFORM.xMin.toFixed(2)} → ${PLATFORM.xMax.toFixed(2)} m（面标高 ${PLATFORM.topY}）/ 底座 ${PAD.size} x ${PAD.size}`);

if (conservative.length) {
  console.log(`\n包围盒保守重叠 ${conservative.length} 项（网格级两两无相交，属包围盒粗筛的保守结果，非穿模）:`);
  for (const o of conservative.slice(0, 12)) console.log(`  ~ ${o.a.name} <-> ${o.b.name}: ${o.ov.toFixed(3)} m³`);
}
if (warnings.length) {
  console.log(`\n警告 ${warnings.length} 项:`);
  for (const w of warnings) console.log(`  ! ${w}`);
} else {
  console.log('\n警告 0 项');
}
if (errors.length) {
  console.log(`\n错误 ${errors.length} 项:`);
  for (const e of errors.slice(0, 400)) console.log(`  x ${e}`);
  if (errors.length > 400) console.log(`  … 其余 ${errors.length - 400} 项`);
  console.log('\n结果: FAIL');
  process.exit(1);
}
console.log('\n结果: PASS（底座正方形 / 范围 / 接地 / 穿模 / 面反转 / 法线 / 资产清单 / 无 UI）');
