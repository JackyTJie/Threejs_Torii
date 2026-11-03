#!/usr/bin/env node
// 单资产体检：构建资产 -> 统计网格 / 包围盒 / 有向体积（面反转）/ layout 放置判据
// 用法: node tools/asset-check.mjs railTrack culvert ...
import { installDomStub } from './dom-stub.mjs';
installDomStub();

const THREE = await import('three');
const { createMaterialLibrary } = await import('../js/materials.js');
const layout = await import('../js/layout.js');
const assetMap = (await import('../js/asset-map.js')).default;

/**
 * 边流形判定：每条边被两个三角形共用才算封闭壳体（开口面片不做有向体积判据）。
 * 关键：边按「顶点空间坐标」而不是顶点索引去重 —— 绝大多数生成器（Box / Cylinder /
 * 扫掠 / 车削）每个面都复制一份顶点，索引互不相同，若按索引判边会把所有封闭实体
 * 误判成开口面片，面反转判据就完全失效。
 */
function isClosed(geometry) {
  const idx = geometry.getIndex();
  if (!idx) return false;
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count < 4) return false;
  const scale = 1e4;
  const vk = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    vk[i] = `${Math.round(pos.getX(i) * scale)},${Math.round(pos.getY(i) * scale)},${Math.round(pos.getZ(i) * scale)}`;
  }
  const seen = new Map();
  for (let i = 0; i + 2 < idx.count; i += 3) {
    const tri = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) return false; // 退化三角
    for (let k = 0; k < 3; k++) {
      const a = vk[tri[k]];
      const b = vk[tri[(k + 1) % 3]];
      if (a === b) return false; // 零长度边
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
  }
  for (const c of seen.values()) if (c !== 2) return false;
  return true;
}

/** 有向体积（>0 表示外向缠绕）；对开口/平面几何返回 0 */
function signedVolume(geometry) {
  const pos = geometry.getAttribute('position');
  if (!pos) return 0;
  const idx = geometry.getIndex();
  const n = idx ? idx.count : pos.count;
  let vol = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
    vol += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - by * az)) / 6;
  }
  return vol;
}

const M = createMaterialLibrary();
const names = process.argv.slice(2);
if (!names.length) {
  console.error('用法: node tools/asset-check.mjs <assetName> [...]');
  process.exit(2);
}

let bad = 0;
for (const name of names) {
  const factory = assetMap[name];
  if (typeof factory !== 'function') {
    console.error(`未知资产: ${name}`);
    bad++;
    continue;
  }
  const root = factory(M);
  root.updateMatrixWorld(true);

  let meshes = 0;
  let tris = 0;
  let nan = 0;
  const inverted = [];
  const open = [];
  const empty = [];
  const emptyIndex = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    meshes++;
    const geo = node.geometry;
    const pos = geo.getAttribute('position');
    const idx = geo.getIndex();
    tris += (idx ? idx.count : pos.count) / 3;
    if (!pos.count) { empty.push(node.name || node.uuid); } // 空 position 缓冲：网格不会渲染，索引也无意义
    if (idx && idx.count > 0 && pos.count === 0) emptyIndex.push(node.name || node.uuid);
    for (let i = 0; i < pos.count * 3; i++) if (!Number.isFinite(pos.array[i])) nan++;
    if (!pos.count || !isClosed(geo)) { open.push(node.name || node.uuid); return; } // 开口面片不做体积判据
    const v = signedVolume(geo);
    if (v < -1e-6) inverted.push(`${node.name || node.uuid} (${v.toFixed(4)})`);
  });

  const box = new THREE.Box3().setFromObject(root);
  const support = root.userData.support ?? root.userData.supportTop ?? null;
  const issues = layout.validatePlacement(box, root.name, support, root.userData.samples ?? null);

  console.log(`\n=== ${root.name} ===`);
  console.log(`网格 ${meshes}  三角面 ${Math.round(tris)}`);
  console.log(`包围盒 x[${box.min.x.toFixed(2)}, ${box.max.x.toFixed(2)}] ` +
    `y[${box.min.y.toFixed(2)}, ${box.max.y.toFixed(2)}] ` +
    `z[${box.min.z.toFixed(2)}, ${box.max.z.toFixed(2)}]`);
  if (nan) { bad++; console.log(`NaN 顶点: ${nan} 个分量`); }
  if (inverted.length) { bad++; console.log(`面反转: ${inverted.join(', ')}`); }
  if (empty.length) { bad++; console.log(`空 position 缓冲: ${empty.length} 个 -> ${empty.slice(0, 8).join(', ')}${empty.length > 8 ? ' …' : ''}`); }
  if (emptyIndex.length) { bad++; console.log(`有索引但无顶点: ${emptyIndex.join(', ')}`); }
  if (open.length) console.log(`开口面片（不做体积判据）: ${open.length} 个 -> ${open.slice(0, 8).join(', ')}${open.length > 8 ? ' …' : ''}`);
  if (issues.length) { bad++; console.log(`放置判据: ${issues.join(' | ')}`); }
  else console.log('放置判据: 通过');
}

console.log(bad ? '\n结果: FAIL' : '\n结果: PASS');
process.exit(bad ? 1 : 0);
