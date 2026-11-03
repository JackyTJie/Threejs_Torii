// 入口（S9.2）：全工程唯一使用 requestAnimationFrame 的模块。
//
// 这里只做四件事：建渲染器 / 场景 / 相机 / 灯光，把资产交给 scene-assembly 组装，
// 然后每帧按固定顺序推进：相机 → 动画 → 后处理。任何建模、材质、动画参数都不在此处定义。
// 画面里没有任何界面元素：不创建 DOM、不写文字、不加控件。
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

/** 单帧最大步长：切后台 / 断点回来不补算大跳帧（落叶会瞬移、水面会跳波） */
const MAX_FRAME_DELTA = 1 / 20;

/**
 * 建立整个应用。与浏览器解耦：canvas 由调用方给，方便离线复现同一帧构图。
 * @param {HTMLCanvasElement} canvas
 * @param {{animations?:boolean}} options
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

  const viewDirection = new THREE.Vector3();
  let rafId = 0;
  let lastTime = 0;
  let running = false;
  let frames = 0;

  /**
   * 描边的屏幕线宽依赖画面高度（world = px × dist / uPxScale）。
   * 换窗口尺寸不刷新 = 换分辨率换线宽（AGENT.md：描边不能抖动、断裂）。
   */
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
    // 1) 相机（阻尼 / 键盘平移 / 静置缓慢环绕都在 camera.js 内）
    rig.update(seconds);

    // 2) 动画：尘埃需要视线方向才谈得上「逆光可见」
    if (assembly.animations.dustMotes) {
      camera.getWorldDirection(viewDirection);
      if (Number.isFinite(viewDirection.x)) assembly.animations.dustMotes.setViewDirection(viewDirection);
    }
    const stepped = stepAnimations(seconds);
    if (stepped.errors.length) console.error('[animations]', stepped.errors.join(' | '));

    // 3) 后处理：描边深度边缘 → 景深 → 辉光 → 合成 → 暖秋日调色
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
    /** 手动推进一帧（离线复现 / 审计用） */
    step,
    /** 固定构图（审计 / 复现某一帧） */
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
