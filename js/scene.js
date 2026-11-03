// 场景容器：暖灰雾 + 程序化渐变天空 + PMREM 环境贴图（供玻璃 / 金属 / 水面反射）
import * as THREE from 'three';
import { LIGHT, PALETTE } from './config.js';
import { skyCanvas } from './textures.js';

/**
 * 构建场景对象。
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer 用于 PMREM 预滤波
 * @param {boolean} [options.environment=true] 是否生成环境贴图
 */
export function createScene(options = {}) {
  const { renderer = null, environment = true } = options;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(LIGHT.fogColor, LIGHT.fogDensity);

  const sky = skyCanvas(1024);
  const skyTexture = new THREE.CanvasTexture(sky);
  skyTexture.mapping = THREE.EquirectangularReflectionMapping;
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTexture;

  if (environment && renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromEquirectangular(skyTexture);
    scene.environment = env.texture;
    pmrem.dispose();
  }

  return scene;
}

/** 雾密度微调（Step 5 整体调校用） */
export function setFogDensity(scene, density) {
  if (scene.fog) scene.fog.density = density;
}

/** 天空渐变替换（供调校时重建背景） */
export function rebuildSky(scene, size = 1024) {
  const texture = new THREE.CanvasTexture(skyCanvas(size));
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  if (scene.background && scene.background.isTexture) scene.background.dispose();
  scene.background = texture;
  return texture;
}
