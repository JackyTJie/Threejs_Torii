// 轮廓描边：反向壳体（逐网格独立）+ 屏幕线宽距离自适应
// 壳体沿用源网格的几何（同一资产的外扩副本），不做任何网格合并。
//
// 自适应规则（AGENT.md 二级：近处略粗、远处自然收细，不能抖动、断裂）：
//   目标屏幕线宽 1.6 px（≤14 m）→ 0.7 px（≥60 m）。
//   壳体世界厚度 = 线宽 × 距离 / 像素尺度，所以「收细」发生在屏幕上，
//   世界厚度反而随距离变厚 —— 透视本身已经把 60 m 处的轮廓缩到 14 m 处的 1/4.3，
//   固定世界厚度等于远处描边缩进一个像素里看不见，那就是「断裂」。
import * as THREE from 'three';
import { OUTLINE, CAMERA, NO_OUTLINE_PREFIXES } from './config.js';
import { SHELL_VS, SHELL_FS } from './shaders/outline-shader.js';

const materialCache = new Map();

/**
 * 屏幕像素尺度：1 像素在 1 m 处对应的世界长度的倒数。
 * scale = height / (2·tan(fov/2))，1080p @ fov 46° ≈ 1272。
 * 没有它就没法把「目标线宽（px）」换算成「壳体世界厚度（m）」。
 */
export function outlinePixelScale(height, fovDeg) {
  const halfAngle = THREE.MathUtils.degToRad(fovDeg) / 2;
  return height / (2 * Math.max(1e-4, Math.tan(halfAngle)));
}

// 起算值按 1080p + 默认 fov；main.js 在初始化与 resize 时用真实画面尺寸覆盖
let pixelScale = outlinePixelScale(1080, CAMERA.fov);

/** 世界厚度上限分桶：同桶共用一个材质，避免每个网格编译一套 program（桶间距 1.35×） */
const CAP_BASE = 0.001;
const CAP_RATIO = 1.35;

export function outlineCapBucket(cap) {
  const steps = Math.round(Math.log(Math.max(cap, CAP_BASE) / CAP_BASE) / Math.log(CAP_RATIO));
  return CAP_BASE * Math.pow(CAP_RATIO, steps);
}

/**
 * 取（缓存的）描边材质。key 区分颜色 / 粗细分组，厚度上限按桶合并。
 * @param {string} key
 * @param {object} options { color, opacity, capThickness }
 */
export function outlineMaterial(key = 'default', options = {}) {
  const color = options.color !== undefined ? options.color : OUTLINE.color;
  const opacity = options.opacity !== undefined ? options.opacity : OUTLINE.opacity;
  const requested = options.capThickness !== undefined
    ? options.capThickness
    : OUTLINE.thickness * OUTLINE.capFactor;
  const cap = outlineCapBucket(requested);
  const cacheKey = `${key}|${color}|${opacity}|${cap.toFixed(6)}`;
  if (materialCache.has(cacheKey)) return materialCache.get(cacheKey);

  const material = new THREE.ShaderMaterial({
    vertexShader: SHELL_VS,
    fragmentShader: SHELL_FS,
    uniforms: {
      uNearPx: { value: OUTLINE.nearPx },
      uFarPx: { value: OUTLINE.farPx },
      uNearDistance: { value: OUTLINE.nearDistance },
      uFarDistance: { value: OUTLINE.farDistance },
      uPxScale: { value: pixelScale },
      uCapThickness: { value: cap },
      uFarKeep: { value: OUTLINE.farKeep },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity }
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: true
  });
  material.name = `outline-${key}-${cap.toFixed(5)}`;
  materialCache.set(cacheKey, material);
  return material;
}

/** 标记某对象（及其子树）不参与描边 */
export function markNoOutline(object) {
  object.traverse((o) => {
    o.userData.noOutline = true;
  });
  return object;
}

export function isNoOutline(object) {
  return !!object.userData.noOutline;
}

/**
 * 材质名是否落在不描边前缀表内。
 * 精确匹配（Set.has）会漏掉派生名：sun-flicker 克隆出的 sunPatch_valleyMid_1、
 * M.variant('lampGlow', color) 得到的 lampGlow_ffc27a —— 名字带后缀，
 * 旧写法静默不匹配，于是加色光斑面片被描上一圈黑边。
 * 规则：全等，或前缀之后紧跟大写 / '_' / '-'（'pad' 因此不会误伤 'paper'）。
 */
export function matchesNoOutlinePrefix(name) {
  if (!name) return false;
  for (const prefix of NO_OUTLINE_PREFIXES) {
    if (name === prefix) return true;
    if (!name.startsWith(prefix)) continue;
    const next = name.charAt(prefix.length);
    if (next === '_' || next === '-' || (next >= 'A' && next <= 'Z')) return true;
  }
  return false;
}

/** 材质本身是否不描边（反向壳体与阴影策略共用这一条判据） */
export function shouldSkipOutline(material) {
  if (!material) return true;
  if (matchesNoOutlinePrefix(material.name)) return true;
  if (material.transparent && material.opacity < 0.35) return true;
  return false;
}

/** 网格自身是否应跳过描边（面片、玻璃、水体、粒子、光斑等） */
function shouldSkipMesh(mesh) {
  if (!mesh.isMesh) return true;
  if (mesh.userData.isOutline) return true;
  if (mesh.userData.noOutline) return true;
  return shouldSkipOutline(mesh.material);
}

/**
 * 网格自身尺度 → 描边基准厚度与世界厚度上限（均在网格局部空间）。
 * 上限受两个约束：构件自身描边厚度的 capFactor 倍，以及构件最薄方向的一半 ——
 * 后者保证 3 cm 木板、2 mm 铁丝不会被壳体整个吞掉。
 */
function shellMetrics(geometry, thickness, options) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const dz = box.max.z - box.min.z;
  const span = Math.max(dx, dy, dz);
  const minExtent = Math.min(dx, dy, dz);
  const authored = options.auto === false
    ? thickness
    : THREE.MathUtils.clamp(span * 0.006, thickness * 0.55, options.maxThickness || OUTLINE.maxThickness);
  const cap = THREE.MathUtils.clamp(minExtent * 0.5, authored, authored * OUTLINE.capFactor);
  return { authored, cap, span, minExtent };
}

/**
 * 给单个网格加描边壳体。
 * @param {THREE.Mesh} mesh
 * @param {number} thickness 世界单位厚度（auto 时作为下限基准）
 * @param {object} options { auto, maxThickness, color, key, opacity }
 */
export function addOutline(mesh, thickness = OUTLINE.thickness, options = {}) {
  if (shouldSkipMesh(mesh)) return null;
  const geometry = mesh.geometry;
  if (!geometry || !geometry.attributes || !geometry.attributes.normal) return null;

  const metrics = shellMetrics(geometry, thickness, options);
  const key = options.key || 'default';
  const material = outlineMaterial(key, {
    color: options.color,
    opacity: options.opacity,
    capThickness: metrics.cap
  });

  const shell = new THREE.Mesh(geometry, material);
  shell.name = `${mesh.name || 'mesh'}__outline`;
  shell.userData.isOutline = true;
  shell.userData.sourceMesh = mesh.uuid;
  shell.userData.thickness = metrics.authored;
  shell.userData.capThickness = material.uniforms.uCapThickness.value;
  shell.userData.outlineSpan = metrics.span;
  shell.userData.outlineMinExtent = metrics.minExtent;
  shell.userData.thicknessKey = key;
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.frustumCulled = mesh.frustumCulled;

  mesh.add(shell);
  return shell;
}

/**
 * 对整个资产组逐网格加描边。
 * @param {THREE.Object3D} root
 * @param {object} options { thickness, auto, maxThickness, color, key, opacity }
 */
export function outlineGroup(root, options = {}) {
  const added = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    const shell = addOutline(node, options.thickness || OUTLINE.thickness, options);
    if (shell) added.push(shell);
  });
  return added;
}

/** 与 SHELL_VS 完全同式的换算：某材质在给定距离处的世界厚度（米） */
export function shellWorldThickness(material, distance) {
  const u = material.uniforms;
  const k = THREE.MathUtils.clamp(
    (distance - u.uNearDistance.value) / Math.max(u.uFarDistance.value - u.uNearDistance.value, 0.001),
    0, 1
  );
  const px = THREE.MathUtils.lerp(u.uNearPx.value, u.uFarPx.value, k);
  return Math.min((px * distance) / Math.max(u.uPxScale.value, 1), u.uCapThickness.value);
}

/** 反过来看：该世界厚度在该距离上实际呈现多少屏幕像素（用来核对 1.6 → 0.7） */
export function shellScreenPixels(material, distance) {
  const u = material.uniforms;
  return (shellWorldThickness(material, distance) * Math.max(u.uPxScale.value, 1)) / Math.max(distance, 0.01);
}

/** 远处描边的淡出系数（不低于 uFarKeep，保证不断裂） */
export function shellFade(material, distance) {
  const u = material.uniforms;
  const k = THREE.MathUtils.clamp(
    (distance - u.uNearDistance.value) / Math.max(u.uFarDistance.value - u.uNearDistance.value, 0.001),
    0, 1
  );
  return THREE.MathUtils.lerp(1, u.uFarKeep.value, k);
}

/** 画面尺寸 / fov 变了就刷新全部壳体（否则换分辨率等于换线宽） */
export function setOutlinePixelScale(value) {
  pixelScale = Math.max(1, value);
  for (const material of materialCache.values()) material.uniforms.uPxScale.value = pixelScale;
  return pixelScale;
}

export function getOutlinePixelScale() {
  return pixelScale;
}

/** 近 / 远目标线宽（px） */
export function setOutlinePixels(nearPx, farPx) {
  OUTLINE.nearPx = nearPx;
  OUTLINE.farPx = farPx;
  for (const material of materialCache.values()) {
    material.uniforms.uNearPx.value = nearPx;
    material.uniforms.uFarPx.value = farPx;
  }
}

/** 距离拐点（米）：壳体与深度边缘两路共用同一组拐点 */
export function setOutlineDistanceRange(nearDistance, farDistance) {
  OUTLINE.nearDistance = nearDistance;
  OUTLINE.farDistance = farDistance;
  for (const material of materialCache.values()) {
    material.uniforms.uNearDistance.value = nearDistance;
    material.uniforms.uFarDistance.value = farDistance;
  }
}

export function forEachOutlineMaterial(fn) {
  for (const material of materialCache.values()) fn(material);
}

export function outlineMaterialCount() {
  return materialCache.size;
}

export { shouldSkipMesh };
