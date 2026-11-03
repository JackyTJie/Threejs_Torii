// 场景总组装：按 js/layout.js 的落点把全部资产放进场景，逐资产收尾
// （阴影策略 + 逐网格独立描边），再把四个静谧动态模块接到已建好的资产根上。
import * as THREE from 'three';
import assetMap from './asset-map.js';
import { finishAsset } from './toon.js';
import { CONTENT_HALF, DOF_FOCUS, TORII } from './layout.js';
import { clearAnimations } from './animations/registry.js';
import { createTreeSway } from './animations/tree-sway.js';
import { createStreamFlow } from './animations/stream-flow.js';
import { createPuddleRipple } from './animations/puddle-ripple.js';
import { createMistDrift } from './animations/mist-drift.js';

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

const assets = new Map();

export function buildAsset(name, M, options = {}) {
  const factory = assetMap[name];
  if (!factory) throw new Error(`scene-assembly: asset-map 里没有资产 ${name}`);
  const root = factory(M, options);
  if (!root || !root.isObject3D) throw new Error(`scene-assembly: ${name} 的工厂没有返回 Object3D`);
  root.name = root.name || name;
  const shells = finishAsset(root, { shadowPolicy: SHADOW_POLICY[name] || 'fill' });
  return { root, shells };
}

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
    // 乔木枝叶、灌丛、蕨类、以及鸟居横梁注连绳纸垂随微风小幅度异步缓慢摇曳
    animations.treeSway = createTreeSway([
      built.treeKusunoki,
      built.treeSakaki,
      built.treeKaede,
      built.shrub,
      built.fern,
      built.groundCover,
      built.toriiFront,
      built.toriiRear
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

export function assembledAssets() {
  return assets;
}

export { ASSEMBLY_ORDER, SHADOW_POLICY };
