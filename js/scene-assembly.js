// 场景总组装：按 js/layout.js 的落点把全部资产放进场景，逐资产收尾
// （阴影策略 + 逐网格独立描边），再把四个静谧动态模块接到已建好的资产根上。
//
// 分工约定：
// - 资产模块（js/assets/**）负责「这个构件长什么样、放在哪、投影不投影」；
// - 本模块负责「谁在场景里、阴影策略的组级默认、描边壳体、动画接线」；
// - 动画模块只接已建好的根，不重新建模、不合并网格。
//
// 本模块不创建任何界面元素，也不调用 requestAnimationFrame（见 js/main.js）。
import * as THREE from 'three';
import assetMap from './asset-map.js';
import { finishAsset } from './toon.js';
import { CONTENT_HALF, DOF_FOCUS, TORII } from './layout.js';
import { clearAnimations } from './animations/registry.js';
import { createTreeSway } from './animations/tree-sway.js';
import { createStreamFlow } from './animations/stream-flow.js';
import { createPuddleRipple } from './animations/puddle-ripple.js';
import { createMistDrift } from './animations/mist-drift.js';

/**
 * 组级阴影策略。默认 'fill'：资产层写了 userData.noCast / noReceive 的构件保持不投影 /
 * 不受影，其余构件一律投影 + 受光。
 *
 * terrain 用 'keep'：它自己写了「山带投影、裙墙 / 溪床壁只受光」的不对称决定，
 * 'fill' 会把裙墙也点亮，在底座边缘多出一道不该有的影带。
 */
const SHADOW_POLICY = {
  terrain: 'keep',
  mist: 'none'
};

/** 组装顺序：L0 底座 → L1 地形 → L2 参道 → L3 水体 → L4 鸟居 → L5 乔木 → L6 中下层植被 → L7 细节道具 → L8 薄雾 */
const ASSEMBLY_ORDER = [
  'basePad',
  'terrain',
  'stoneSteps',
  'upperPath',
  'pathSoil',
  'streamBed',
  'streamWater',
  'streamStones',
  'toriiFront',
  'toriiRear',
  'treeKusunoki',
  'treeSakaki',
  'treeKaede',
  'shrub',
  'fern',
  'groundCover',
  'leafLitter',
  'wetRock',
  'puddle',
  'mossPatch',
  'twig',
  'mist'
];

/** 资产名 -> 场景里的 Group（供审计、单独调位置、动画接线） */
const assets = new Map();

/**
 * 单独建一个资产并收尾。
 * @param {string} name asset-map 里的资产名
 * @param {object} M 材质库
 * @param {object} options 透传给资产工厂
 * @returns {{root:THREE.Group, shells:THREE.Mesh[]}}
 */
export function buildAsset(name, M, options = {}) {
  const factory = assetMap[name];
  if (!factory) throw new Error(`scene-assembly: asset-map 里没有资产 ${name}`);
  const root = factory(M, options);
  if (!root || !root.isObject3D) throw new Error(`scene-assembly: ${name} 的工厂没有返回 Object3D`);
  root.name = root.name || name;
  const shells = finishAsset(root, { shadowPolicy: SHADOW_POLICY[name] || 'fill' });
  return { root, shells };
}

/**
 * 组装整个场景。
 * @param {THREE.Scene} scene
 * @param {object} M 材质库（js/materials.js 的 createMaterialLibrary()）
 * @param {{animations?:boolean}} options
 * @returns {{assets:Map, animations:object, stats:object}}
 */
export function assembleScene(scene, M, options = {}) {
  if (!scene || !scene.isScene) throw new Error('scene-assembly: assembleScene 需要一个 Scene');
  assets.clear();
  clearAnimations();

  const stats = { assets: 0, meshes: 0, instanced: 0, points: 0, shells: 0, lights: 0 };
  const add = (name, root) => {
    scene.add(root);
    assets.set(name, root);
    stats.assets += 1;
    root.traverse((node) => {
      if (node.isInstancedMesh) stats.instanced += 1;
      else if (node.isMesh) stats.meshes += 1;
      else if (node.isPoints) stats.points += 1;
      else if (node.isLight) stats.lights += 1;
    });
    if (root.userData.outlineShells) stats.shells += root.userData.outlineShells.length;
    return root;
  };

  /* ---------------- 1. 静态资产（按 ASSEMBLY_ORDER） ---------------- */
  const built = {};
  for (const name of ASSEMBLY_ORDER) {
    const { root, shells } = buildAsset(name, M);
    root.userData.outlineShells = shells;
    built[name] = add(name, root);
  }

  /* ---------------- 2. 动画接线（柔和克制，不破坏静谧感） ---------------- */
  const animations = {};
  if (options.animations !== false) {
    // 乔木枝叶、灌丛、蕨类随微风小幅度缓慢晃动
    animations.treeSway = createTreeSway([
      built.treeKusunoki,
      built.treeSakaki,
      built.treeKaede,
      built.shrub,
      built.fern,
      built.groundCover
    ]);

    // 溪流水面缓慢流动，带细碎涟漪
    animations.streamFlow = createStreamFlow([built.streamWater]);

    // 地面积水轻微波纹扰动
    animations.puddleRipple = createPuddleRipple([built.puddle]);

    // 林间薄雾缓慢流动漂移
    animations.mistDrift = createMistDrift([built.mist]);
  }

  /* ---------------- 3. 组装自检 ---------------- */
  const outOfBounds = [];
  const box = new THREE.Box3();
  for (const [name, root] of assets) {
    if (name === 'basePad') continue;
    box.setFromObject(root);
    if (!Number.isFinite(box.min.x)) continue;
    if (box.min.x < -CONTENT_HALF - 0.6 || box.max.x > CONTENT_HALF + 0.6) outOfBounds.push(`${name} x`);
    if (box.min.z < -CONTENT_HALF - 0.6 || box.max.z > CONTENT_HALF + 0.6) outOfBounds.push(`${name} z`);
  }
  if (outOfBounds.length) {
    throw new Error(`scene-assembly: 资产越出底座范围：${outOfBounds.join(', ')}`);
  }

  stats.dofFocus = { ...DOF_FOCUS };
  stats.torii = { ...TORII };
  return { assets, animations, stats };
}

/** 当前场景里已组装的资产表 */
export function assembledAssets() {
  return assets;
}

export { ASSEMBLY_ORDER, SHADOW_POLICY };
