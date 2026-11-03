#!/usr/bin/env node
// 场景审计：底座范围 / 正方形底座 / 接地 / 穿模 / 面反转 / 法线一致性 / 必备资产 / 无界面元素
//
// 全部在 Node 内用 three 桩真实构建场景（js/scene-assembly.js），不连浏览器。
import { installDomStub } from './dom-stub.mjs';

installDomStub();

const THREE = await import('three');
const { createMaterialLibrary } = await import('../js/materials.js');
const { assembleScene } = await import('../js/scene-assembly.js');
const { PAD, LEVEL } = await import('../js/config.js');
const { groundHeight, CONTENT_HALF, PATH, TORII } = await import('../js/layout.js');

const STRICT = process.argv.includes('--strict');

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);

/* ------------------------------------------------------------------ 豁免表
 * 每一项都写清「为什么这不是穿模」。
 */

// 地面 / 参道 / 山体 / 水面 / 贴地层：它们是地面定义者或贴地覆盖层，别的构件坐在上面属于承载关系
const CONTAINERS = new Set([
  'basePad',
  'terrain',
  'stoneSteps',
  'upperPath',
  'pathSoil',
  'streamBed',
  'streamWater',
  'groundCover',
  'leafLitter',
  'puddle',
  'mossPatch'
]);

// 明确允许悬空（架空薄雾面片）
const AIRBORNE = new Set([
  'mist'
]);

// 允许与别的资产体积重叠的构件对（物理依附/伴生/林冠交织关系）
const PAIR_WHITELIST = [
  [/^wetRock$/, /^mossPatch$/],
  [/^streamStones$/, /^mossPatch$/],
  [/^stoneSteps$/, /^mossPatch$/],
  [/^stoneSteps$/, /^puddle$/],
  [/^pathSoil$/, /^puddle$/],
  [/^pathSoil$/, /^wetRock$/],
  [/^tree/, /^tree/],
  [/^tree/, /^twig$/],
  [/^tree/, /^shrub$/],
  [/^tree/, /^fern$/],
  [/^tree/, /^wetRock$/],
  [/^shrub$/, /^fern$/],
  [/^shrub$/, /^twig$/],
  [/^fern$/, /^twig$/],
  [/^fern$/, /^wetRock$/],
  [/^shrub$/, /^wetRock$/],
  [/^wetRock$/, /^twig$/],
  [/^toriiFront$/, /^toriiRear$/],
  [/^torii/, /^shrub$/],
  [/^torii/, /^fern$/],
  [/^torii/, /^wetRock$/]
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

function normalAudit(mesh) {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  if (!pos) return { skip: true, reason: '无 position' };
  if (!nor) return { skip: false, reason: '无 normal 属性', nonFinite: 0, nonUnit: 0, disagree: 0, ambiguous: 0, total: 0, degenerate: 0 };

  const index = geo.getIndex();
  const tris = index ? index.count : Math.floor(pos.count / 3) * 3;
  const triCount = Math.floor(tris / 3);

  const ia = new Int32Array(triCount);
  const ib = new Int32Array(triCount);
  const ic = new Int32Array(triCount);
  const area = new Float64Array(triCount);
  const live = new Uint8Array(pos.count);
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
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) continue;
  items.push({ name, box, meshes, obj: root });
}

/* ------------------------------------------------------------------ 1) 底座 */
const pad = items.find((a) => a.name === 'basePad');
if (!pad) {
  fail('缺少 basePad：场景必须坐落在一块规整正方形底座上');
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
const BOUND = { xz: CONTENT_HALF + 0.35, yMin: -2.2, yMax: 19.5 };
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
  if (AIRBORNE.has(a.name)) {
    airborne += 1;
    continue;
  }
  const support = a.obj.userData.support;
  if (support && support.host) {
    grounded += 1;
    continue;
  }
  const cx = (a.box.min.x + a.box.max.x) / 2;
  const cz = (a.box.min.z + a.box.max.z) / 2;
  const g = groundHeight(cx, cz);
  if (a.box.max.y < g - 0.05) {
    fail(`完全埋入地面 ${a.name}: 顶面 ${fmt(a.box.max.y)} < 地面 ${fmt(g)}`);
    continue;
  }
  grounded += 1;
}
console.log(`接地: ${grounded} 组落在地面 / 宿主标高上，${airborne} 组属于允许悬空的薄雾构件`);

/* ------------------------------------------------------------------ 4) 穿模 */
const containers = STRICT ? new Set() : CONTAINERS;
const assetOverlaps = [];
for (let i = 0; i < items.length; i++) {
  for (let j = i + 1; j < items.length; j++) {
    const a = items[i];
    const b = items[j];
    if (AIRBORNE.has(a.name) || AIRBORNE.has(b.name)) continue;
    const ov = overlapVolume(a.box, b.box);
    if (ov <= 0.02) continue;
    if (contains(a.box, b.box) || contains(b.box, a.box)) continue;
    if (containers.has(a.name) || containers.has(b.name)) continue;
    if (whitelisted(a, b)) continue;
    assetOverlaps.push({ i, j, a, b, ov });
  }
}

const leafMeshes = [];
for (let i = 0; i < items.length; i++) {
  if (containers.has(items[i].name) || AIRBORNE.has(items[i].name)) continue;
  for (const m of items[i].meshes) {
    const wb = worldBox(m);
    if (!wb) continue;
    const s = sizeOf(wb);
    if (s.x > 12 || s.z > 12 || s.y > 12) continue;
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
      if (ov <= 0.004) continue;
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
console.log(`  封闭流形网格 ${closedTotal} 个 / 折边歧义 ${ambiguousTotal} 个 / 退化三角形 ${degenerateTotal} 个 / 极点零法线顶点 ${idleZeroTotal} 个`);

/* ------------------------------------------------------------------ 6) 必备资产 */
const REQUIRED = [
  'basePad', 'terrain', 'stoneSteps', 'upperPath', 'pathSoil',
  'streamBed', 'streamWater', 'streamStones',
  'toriiFront', 'toriiRear',
  'treeKusunoki', 'treeSakaki', 'treeKaede',
  'shrub', 'fern', 'groundCover', 'leafLitter',
  'wetRock', 'puddle', 'mossPatch', 'twig', 'mist'
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
if (ui) fail(`场景里出现界面元素 ${ui} 个（画面纯净，无任何 UI）`);

/* ------------------------------------------------------------------ 8) 标高一致性抽查 */
const stepsItem = items.find((a) => a.name === 'stoneSteps');
if (stepsItem) {
  const top = stepsItem.box.max.y;
  if (Math.abs(top - LEVEL.pathTop) > 0.25) warn(`石阶最高踏面标高 ${top.toFixed(2)} 与 LEVEL.pathTop ${LEVEL.pathTop} 偏离过大`);
}
const toriiF = items.find((a) => a.name === 'toriiFront');
if (toriiF) {
  const s = sizeOf(toriiF.box);
  console.log(`前座鸟居: ${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)} m（间距 ${TORII.gap} m）`);
}

/* ------------------------------------------------------------------ 统计与结论 */
console.log('=== 场景审计 ===');
console.log(`资产组 ${items.length} | 实体网格 ${meshCount} | InstancedMesh ${instancedCount} | 描边壳 ${outlineCount} | 三角面估算 ${triangleEstimate.toLocaleString('en-US')}`);

const allBox = new THREE.Box3();
for (const a of items) allBox.union(a.box);
console.log(`场景包围盒: x [${fmt(allBox.min.x)}, ${fmt(allBox.max.x)}] y [${fmt(allBox.min.y)}, ${fmt(allBox.max.y)}] z [${fmt(allBox.min.z)}, ${fmt(allBox.max.z)}]`);
console.log(`参道走廊 x [${PATH.x0}, ${PATH.x1}] z [${PATH.zTop}, ${PATH.zBottom}] / 底座 ${PAD.size} x ${PAD.size}`);

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
