/**
 * 林间薄雾（ATMOSPHERE_SYSTEM.mist）
 *
 * 雨后深林的静谧水汽与纵深空气层次（LAYOUT_PLAN §11 L8 / §12）：
 * - 在鸟居后方上段参道（z ∈ [-13.5, -5.0]）、左侧山涧溪谷上方（x ∈ [-8.5, -3.2]）、
 *   以及鸟居上方高处林冠采光口（y ∈ [6.2, 10.8], z ∈ [-12.5, -4.2]）布置 8 层柔和半透明薄雾带。
 * - 避开两座鸟居的正前方中心区域，确保朱红鸟居轮廓锐利通透，同时拉出「近景暗绿画框 →
 *   中景鲜明朱红鸟居 → 远景朦胧幽深山林」的三层空间景深。
 * - 每层薄雾独立材质实例（从 M.mistBand 派生独立透明度 uniform），供 animations/mist-drift.js
 *   逐层驱动极缓慢的横向漂移与呼吸感透明度变化。
 */
import * as THREE from 'three';
import { ANIM, PALETTE } from '../config.js';
import { lerp, terrainHeight } from '../layout.js';
import { group, mesh, rng } from '../primitives.js';
import { mistVeilTexture } from '../textures.js';

const SEED_BASE = 9701;

/** 8 层薄雾带的空间配置（全部严格落在 ±15.5 m 内容区内） */
const MIST_LAYERS = [
  // 后方上段参道深林雾幕（强化「石阶继续向上隐没于深林之中」的深邃感）
  { name: 'mist-upper-path-1', x: 0.4, z: -6.8, yLift: 1.8, w: 9.5, h: 3.4, ry: 0.04, opacity: 0.14 },
  { name: 'mist-upper-path-2', x: 0.2, z: -9.6, yLift: 2.3, w: 11.2, h: 4.0, ry: -0.06, opacity: 0.16 },
  { name: 'mist-upper-path-3', x: -0.5, z: -12.4, yLift: 2.8, w: 13.0, h: 4.6, ry: 0.03, opacity: 0.17 },
  // 鸟居上方林间天光水汽（呼应参考图中鸟居正上方透出的明亮湿润林间雾气）
  { name: 'mist-canopy-gap-1', x: -0.6, z: -5.4, yLift: 4.6, w: 8.6, h: 3.6, ry: 0.08, opacity: 0.15 },
  { name: 'mist-canopy-gap-2', x: 0.5, z: -8.2, yLift: 5.2, w: 10.4, h: 4.2, ry: -0.05, opacity: 0.16 },
  // 左侧山涧溪谷低处水雾（贴近溪面升腾的冷调湿气）
  { name: 'mist-valley-low-1', x: -5.6, z: 5.2, yLift: 1.05, w: 6.4, h: 1.9, ry: 0.18, opacity: 0.11 },
  { name: 'mist-valley-mid-2', x: -6.2, z: -0.8, yLift: 1.35, w: 7.2, h: 2.2, ry: 0.14, opacity: 0.12 },
  { name: 'mist-valley-far-3', x: -7.1, z: -6.5, yLift: 1.65, w: 8.0, h: 2.5, ry: 0.1, opacity: 0.13 }
];

function makeMistLayerMaterial(index, baseOpacity) {
  const mat = new THREE.MeshBasicMaterial({
    color: PALETTE.skyMid,
    map: mistVeilTexture({ size: 512, seed: 131 + index * 19 }),
    transparent: true,
    opacity: baseOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  mat.name = `mistBand_${index + 1}`;
  return mat;
}

export function createMist(M) {
  void M;
  const root = group('mist');
  root.userData.assetName = 'mist';
  root.userData.support = { overhead: true };

  const rand = rng(SEED_BASE);
  const cfg = ANIM.mist;
  const samples = [];

  MIST_LAYERS.forEach((spec, index) => {
    const geo = new THREE.PlaneGeometry(spec.w, spec.h, 4, 2);
    const mat = makeMistLayerMaterial(index, spec.opacity);
    const veil = mesh(geo, mat, spec.name);

    const ground = terrainHeight(spec.x, spec.z);
    const baseY = ground + spec.yLift;
    veil.position.set(spec.x, baseY, spec.z);
    veil.rotation.y = spec.ry;
    veil.castShadow = false;
    veil.receiveShadow = false;
    veil.userData.noCast = true;
    veil.userData.noReceive = true;
    veil.userData.noOutline = true;

    const speed = lerp(cfg.driftSpeedMin, cfg.driftSpeedMax, rand());
    const period = lerp(cfg.periodMin, cfg.periodMax, rand());
    veil.userData.mistLayer = {
      baseX: spec.x,
      baseY,
      baseZ: spec.z,
      baseRy: spec.ry,
      speed,
      period,
      phase: rand() * Math.PI * 2,
      driftSpan: 0.45 + rand() * 0.35,
      liftSpan: 0.08 + rand() * 0.06,
      baseOpacity: spec.opacity,
      opacityMin: cfg.opacityMin,
      opacityMax: cfg.opacityMax
    };

    root.add(veil);
    samples.push({ x: spec.x, y: baseY, z: spec.z });
  });

  root.userData.samples = samples;
  root.userData.layerCount = MIST_LAYERS.length;
  root.userData.meshCount = MIST_LAYERS.length;
  root.updateMatrixWorld(true);
  return root;
}

export default createMist;
