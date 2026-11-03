// 渲染器：WebGL2 + MSAA 抗锯齿 + PCF 软阴影 + 电影级色调映射
import * as THREE from 'three';
import { RENDER } from './config.js';

const TONE_MAP = {
  NoToneMapping: THREE.NoToneMapping,
  ReinhardToneMapping: THREE.ReinhardToneMapping,
  ACESFilmicToneMapping: THREE.ACESFilmicToneMapping
};

const SHADOW_MAP = {
  BasicShadowMap: THREE.BasicShadowMap,
  PCFShadowMap: THREE.PCFShadowMap,
  PCFSoftShadowMap: THREE.PCFSoftShadowMap
};

/**
 * 创建渲染器。canvas 由 index.html 提供，本模块不生成任何界面元素。
 * @param {HTMLCanvasElement} canvas
 */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: RENDER.antialias,
    alpha: RENDER.alpha,
    stencil: RENDER.stencil,
    depth: RENDER.depth,
    powerPreference: 'high-performance'
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.pixelRatioMax));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  renderer.shadowMap.enabled = RENDER.shadowMapEnabled;
  renderer.shadowMap.type = SHADOW_MAP[RENDER.shadowType] || THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;

  // 色调映射与 sRGB 编码由后处理输出级独占（见 js/shaders/grade-shader.js 顶部说明）：
  // three.js 渲染进离屏缓冲时两者都跳过，而 ShaderMaterial 不含 <tonemapping_fragment> /
  // <colorspace_fragment>。渲染器若仍开启 toneMapping，线性值会被映射两次（画面发灰、高光削平）。
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  return renderer;
}

/** 配置里声明的色调映射（后处理不可用、退回直接渲染时由管线临时启用） */
export function configuredToneMapping() {
  return TONE_MAP[RENDER.toneMapping] || THREE.ACESFilmicToneMapping;
}

/** 视口自适应：保持像素比上限，避免高 DPI 设备过度渲染 */
export function resizeRenderer(renderer) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.pixelRatioMax));
  renderer.setSize(w, h, false);
  return { width: w, height: h };
}

/** 供后处理使用的有效绘制尺寸（含像素比） */
export function drawingBufferSize(renderer) {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const pr = renderer.getPixelRatio();
  return { width: Math.max(1, Math.floor(size.x * pr)), height: Math.max(1, Math.floor(size.y * pr)) };
}
