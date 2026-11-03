// 入口：全工程唯一使用 requestAnimationFrame 的模块。
//
// 这里负责：建渲染器 / 场景 / 相机 / 灯光，把资产交给 scene-assembly 组装，
// 挂载水面屏幕射线实时物理交互波纹、全天时瑞利大气昼夜系统、可切换气象系统彩蛋与右下角青绿色圆球形控制面板，
// 然后每帧按固定顺序推进：相机 → 昼夜与气象系统 → 动态效果 → 后处理（含 SWE GPU Ping-Pong、瑞利天空与5层远山、SSAO、3D体积雾、丁达尔体积光、鸟居景深 DOF 与辉光）。
import * as THREE from 'three';
import { createRenderer, resizeRenderer, drawingBufferSize } from './renderer.js';
import { createScene } from './scene.js';
import { createCameraRig } from './camera.js';
import { createLighting } from './lighting.js';
import { createMaterialLibrary } from './materials.js';
import { assembleScene } from './scene-assembly.js';
import { createPostPipeline } from './post-pipeline.js';
import { outlinePixelScale, setOutlinePixelScale } from './outline.js';
import { animationElapsed, stepAnimations } from './animations/registry.js';
import { streamBankHalf, streamCenterX, waterY } from './layout.js';
import { getSweSimulator } from './water/swe-simulator.js';
import { createDayNightSystem } from './day-night.js';
import { createWeatherSystem } from './weather.js';
import { createSettingsPanel } from './ui-panel.js';

/** 单帧最大步长：切后台 / 断点回来不补算大跳帧 */
const MAX_FRAME_DELTA = 1 / 20;

/**
 * 建立整个应用。与浏览器解耦：canvas 由调用方给，方便离线复现同一帧构图。
 * @param {HTMLCanvasElement} canvas
 * @param {{animations?:boolean, ui?:boolean}} options
 */
export function createApp(canvas, options = {}) {
  const renderer = createRenderer(canvas);
  const scene = createScene({ renderer });
  const rig = createCameraRig(canvas);
  const camera = rig.camera;
  const lighting = createLighting(scene);
  const materials = createMaterialLibrary();
  const assembly = assembleScene(scene, materials, { animations: options.animations !== false });
  const post = createPostPipeline(renderer, scene, camera);
  const swe = getSweSimulator();
  const dayNight = createDayNightSystem({ scene, lighting, post });
  const weather = createWeatherSystem({ scene, post, swe });
  const ui = options.ui === false ? null : createSettingsPanel({
    post,
    lighting,
    dayNight,
    weather,
    animations: assembly.animations
  });

  // 屏幕射线步进（Raycasting）交互输入机制 —— 将指针位置反投影为三维视线并与山涧曲面求交，写入 SWE 高度增量
  const rayDir = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camFwd = new THREE.Vector3();

  function triggerWaterRipple(clientX, clientY, strength) {
    if (!canvas) return;
    const w = canvas.clientWidth || window.innerWidth || 1;
    const h = canvas.clientHeight || window.innerHeight || 1;
    const ndcX = (clientX / w) * 2 - 1;
    const ndcY = -(clientY / h) * 2 + 1;

    const e = camera.matrixWorld.elements;
    camRight.set(e[0], e[1], e[2]).normalize();
    camUp.set(e[4], e[5], e[6]).normalize();
    camFwd.set(-e[8], -e[9], -e[10]).normalize();

    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = w / Math.max(1, h);
    rayDir
      .copy(camFwd)
      .addScaledVector(camRight, ndcX * aspect * tanHalfFov)
      .addScaledVector(camUp, ndcY * tanHalfFov)
      .normalize();

    if (rayDir.y >= -0.01) return;
    const ox = camera.position.x;
    const oy = camera.position.y;
    const oz = camera.position.z;

    let t = (1.2 - oy) / rayDir.y;
    for (let iter = 0; iter < 5; iter++) {
      const hz = oz + rayDir.z * t;
      const wy = waterY(hz);
      t = (wy - oy) / rayDir.y;
    }
    if (t <= 0 || t > 45) return;
    const hx = ox + rayDir.x * t;
    const hz = oz + rayDir.z * t;
    if (Math.abs(hx - streamCenterX(hz)) <= streamBankHalf(hz) + 0.35) {
      swe.addDrop(hx, hz, strength, 0.45);
    }
  }

  const onWaterPointerMove = (e) => {
    triggerWaterRipple(e.clientX, e.clientY, 0.012);
  };
  const onWaterPointerDown = (e) => {
    triggerWaterRipple(e.clientX, e.clientY, 0.026);
  };
  canvas.addEventListener('pointermove', onWaterPointerMove);
  canvas.addEventListener('pointerdown', onWaterPointerDown);

  let rafId = 0;
  let lastTime = 0;
  let running = false;
  let frames = 0;

  function syncOutlinePixelScale() {
    const { height } = drawingBufferSize(renderer);
    setOutlinePixelScale(outlinePixelScale(height, camera.fov));
  }
  syncOutlinePixelScale();

  function onResize() {
    resizeRenderer(renderer);
    rig.resize();
    post.resize();
    syncOutlinePixelScale();
  }
  window.addEventListener('resize', onResize);

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(MAX_FRAME_DELTA, (now - lastTime) / 1000 || 0));
    lastTime = now;
    step(dt);
  }

  /** 推进一帧（离线工具 / 审计可直接调用，不必依赖 requestAnimationFrame） */
  function step(dt) {
    const seconds = Math.max(0, Math.min(MAX_FRAME_DELTA, Number.isFinite(dt) ? dt : 0));
    // 1) 受限观景相机（阻尼 / 缩放耦合注视点 / 后退防超模硬锁 / 防穿地保护）
    rig.update(seconds);

    // 2) 动态昼夜流转、气象系统（细雨粒子/地面涟漪/湿润度）与场景动画推进
    dayNight.step(seconds);
    const stepped = stepAnimations(seconds);
    if (stepped.errors.length) console.error('[animations]', stepped.errors.join(' | '));
    weather.step(seconds, animationElapsed());

    // 3) 后处理：SWE 物理迭代 → 河床深度折射通道 → 瑞利天空/5层远山/SSAO/3D体积雾/丁达尔体积光 → 描边 → 景深 DOF → 辉光 → 合成 → 调色
    post.render(animationElapsed());
    frames += 1;
  }

  function start() {
    if (running) return app;
    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(frame);
    return app;
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    return app;
  }

  function dispose() {
    stop();
    window.removeEventListener('resize', onResize);
    canvas.removeEventListener('pointermove', onWaterPointerMove);
    canvas.removeEventListener('pointerdown', onWaterPointerDown);
    if (ui) ui.dispose();
    rig.dispose();
    post.dispose();
    renderer.dispose();
  }

  const app = {
    renderer,
    scene,
    camera,
    rig,
    lighting,
    materials,
    post,
    swe,
    dayNight,
    weather,
    ui,
    assets: assembly.assets,
    animations: assembly.animations,
    stats: assembly.stats,
    get frames() {
      return frames;
    },
    get running() {
      return running;
    },
    start,
    stop,
    dispose,
    resize: onResize,
    step,
    setView({ azimuthDeg, elevationDeg, radius }) {
      rig.setView({ azimuthDeg, elevationDeg, radius });
      rig.update(1);
    }
  };
  return app;
}

/** 浏览器入口：index.html 只提供 <canvas id="stage"> */
function boot() {
  const canvas = document.getElementById('stage');
  if (!canvas) return null;
  const app = createApp(canvas);
  app.start();
  return app;
}

const app = boot();

export { boot };
export default app;
