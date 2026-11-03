// 场景总组装（S9.1）：按 js/layout.js 的落点把全部资产放进场景，逐资产收尾
// （阴影策略 + 逐网格独立描边），再把七个动画模块接到已建好的资产根上。
//
// 分工约定：
// - 资产模块（js/assets/**）负责「这个构件长什么样、放在哪、投影不投影」；
// - 本模块负责「谁在场景里、阴影策略的组级默认、描边壳体、动画接线」；
// - 动画模块只接已建好的根，不重新建模、不合并网格。
//
// 本模块不创建任何界面元素，也不调用 requestAnimationFrame（见 js/main.js）。
import * as THREE from 'three';
import assetMap from './asset-map.js';
import { createStationInterior } from './assets/station-interior/interior-layout.js';
import { finishAsset } from './toon.js';
import { CONTENT_HALF, STATION, DOF_FOCUS } from './layout.js';
import { collectTreeCanopies, createLeafFall } from './animations/leaf-fall.js';
import { createTreeSway } from './animations/tree-sway.js';
import { createStreamFlow } from './animations/stream-flow.js';
import { createFloatingLeaves } from './animations/floating-leaves.js';
import { createSunFlicker } from './animations/sun-flicker.js';
import { createDustMotes } from './animations/dust-motes.js';
import { createSignalBreathe } from './animations/signal-breathe.js';

/**
 * 站房内部七件由 createStationInterior 一次性组装（interior-layout.js 的约定：
 * asset-map 登记各构件是为了逐件校验，组装时只调用一次，避免同一件家具被实例化两次）。
 */
const INTERIOR_KEYS = [
  'interiorTicketWindow',
  'interiorBench',
  'wallClock',
  'paperPoster',
  'ironStove',
  'shelfUnit',
  'oilLamp'
];

/**
 * 组级阴影策略。默认 'fill'：资产层写了 userData.noCast / noReceive 的构件保持不投影 /
 * 不受影，其余构件一律投影 + 受光（树干、枝条、灌木茎、道具主体这些模块里没逐条写的
 * 实体构件因此能得到阴影，而落叶薄片、苔壳、锈斑、玻璃、水面、加色光斑不会被强行打开）。
 *
 * 只有 terrain 用 'keep'：它自己写了「山带投影、裙墙 / 溪床壁只受光」的不对称决定
 * （未写 castShadow 即表示不投影），'fill' 会把裙墙也点亮，在底座边缘多出一道不该有的影带。
 */
const SHADOW_POLICY = {
  terrain: 'keep'
};

/** 组装顺序：先地面与路基，再站房与室内，再道具，最后植被（植被要避开已放好的硬构件） */
const ASSEMBLY_ORDER = [
  'basePad',
  'terrain',
  'stream',
  'railBallast',
  'railTrack',
  'culvert',
  'stationPlatform',
  'platformStairs',
  'platformRail',
  'drainDitch',
  'gravelPath',
  'stoneBridge',
  'stationBuilding',
  'stationRoof',
  'stationDoor',
  'stationGlass',
  'stationSign',
  'stationCanopy',
  'stationBench',
  'noticeBoard',
  'utilityPole',
  'powerLines',
  'signalSemaphore',
  'signalColor',
  'levelCrossing',
  'oilDrum',
  'abandonedBicycle',
  'rustyToolbox',
  'mapleGrove',
  'beechGrove',
  'shrub',
  'mossBoulder',
  'mossPatch',
  'leafLitter'
];

/** 资产名 -> 场景里的 Group（供审计、单独调位置、动画接线） */
const assets = new Map();

/**
 * 单独建一个资产并收尾（可独立实例化：AGENT.md 六级.2）。
 * @param {string} name asset-map 里的资产名
 * @param {object} M 材质库
 * @param {object} options 透传给资产工厂（x / z / scale / tag 等）
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
 * @param {{animations?:boolean, interiorLights?:boolean, outline?:boolean}} options
 *   animations=false 时只摆静态资产（离线审计 / 截图复现用）
 * @returns {{assets:Map, animations:object, stats:object}}
 */
export function assembleScene(scene, M, options = {}) {
  if (!scene || !scene.isScene) throw new Error('scene-assembly: assembleScene 需要一个 Scene');
  assets.clear();

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
    if (INTERIOR_KEYS.includes(name)) continue; // 由 stationInterior 一次组装
    const { root, shells } = buildAsset(name, M);
    root.userData.outlineShells = shells;
    built[name] = add(name, root);
  }

  /* ---------------- 2. 站房内部（七件构件 + 室内柔光） ---------------- */
  const interior = createStationInterior(M, { lights: options.interiorLights !== false });
  const interiorShells = finishAsset(interior, { shadowPolicy: 'fill' });
  interior.userData.outlineShells = interiorShells;
  built.stationInterior = add('stationInterior', interior);

  /* ---------------- 3. 动画接线（只接已建好的根，不重新建模） ---------------- */
  const animations = {};
  if (options.animations !== false) {
    // 落叶：脱离点取自已建好的林株（userData.canopyRadius / treeHeight）
    const canopies = collectTreeCanopies([built.mapleGrove, built.beechGrove]);
    animations.leafFall = createLeafFall(M, { canopies });
    add('leafFall', animations.leafFall.group);

    // 枝叶微风：枫林 / 榉林 / 灌木丛共用同一条阵风曲线（registry.windGustFactor）
    animations.treeSway = createTreeSway([built.mapleGrove, built.beechGrove, built.shrub]);

    // 水流：溪面 + 涵洞水面 + 涵内水板
    animations.streamFlow = createStreamFlow([built.stream, built.culvert]);

    // 顺流漂叶（接在 streamFlow 之后，漂速与流速同源）
    animations.floatingLeaves = createFloatingLeaves(M);
    add('floatingLeaves', animations.floatingLeaves.group);

    // 斑驳光斑：贴地加色面片，随主光方向缓慢移动
    animations.sunFlicker = createSunFlicker(M);
    add('sunFlicker', animations.sunFlicker.group);

    // 空气尘埃：需要每帧的视线方向（逆光可见）
    animations.dustMotes = createDustMotes(M);
    add('dustMotes', animations.dustMotes.group);

    // 信号灯呼吸：臂木式 / 色灯 / 道口灯
    animations.signalBreathe = createSignalBreathe([
      built.signalSemaphore,
      built.signalColor,
      built.levelCrossing
    ]);
  }

  /* ---------------- 4. 组装自检 ---------------- */
  const outOfBounds = [];
  const box = new THREE.Box3();
  for (const [name, root] of assets) {
    if (name === 'basePad') continue; // 底座本身就是边界
    box.setFromObject(root);
    if (!Number.isFinite(box.min.x)) continue;
    if (box.min.x < -CONTENT_HALF - 0.6 || box.max.x > CONTENT_HALF + 0.6) outOfBounds.push(`${name} x`);
    if (box.min.z < -CONTENT_HALF - 0.6 || box.max.z > CONTENT_HALF + 0.6) outOfBounds.push(`${name} z`);
  }
  if (outOfBounds.length) {
    throw new Error(`scene-assembly: 资产越出底座范围：${outOfBounds.join(', ')}`);
  }

  stats.dofFocus = { ...DOF_FOCUS };
  stats.station = { ...STATION };
  return { assets, animations, stats };
}

/** 当前场景里已组装的资产表（审计 / 单独挪动某件资产） */
export function assembledAssets() {
  return assets;
}

export { ASSEMBLY_ORDER, INTERIOR_KEYS, SHADOW_POLICY };
