// 后处理管线：描边（反向壳体 + 深度边缘）→ 景深 → 辉光 → 合成 → 暖秋日调色
// 全部为离屏 pass，不产生任何界面元素。
import * as THREE from 'three';
import { POST, PALETTE, RENDER, OUTLINE } from './config.js';
import { configuredToneMapping } from './renderer.js';
import { DOF_FOCUS } from './layout.js';
import { QUAD_VS, EDGE_FS } from './shaders/outline-shader.js';
import { setOutlineDistanceRange } from './outline.js';
import { DOF_GATHER_FS, DOF_COMPOSITE_FS } from './shaders/dof-shader.js';
import { GRADE_FS } from './shaders/grade-shader.js';
import { BRIGHT_FS, BLUR_FS, COMPOSITE_FS } from './shaders/bloom-shader.js';
import { getSweSimulator } from './water/swe-simulator.js';
import { RIVERBED_CAUSTIC_MATERIALS, WATER_FLOW_MATERIALS, tuneMaterial } from './toon.js';

/**
 * 创建后处理管线。
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.PerspectiveCamera} camera
 */
export function createPostPipeline(renderer, scene, camera) {
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);

  let width = 1;
  let height = 1;

  const targets = {};
  const passes = {};
  let dofUniforms = null;

  /** 景深焦点：站房南立面中心（相机环绕 / 拉进 / 平移观察点都不会把焦点带走） */
  const focusPoint = new THREE.Vector3(DOF_FOCUS.x, DOF_FOCUS.y, DOF_FOCUS.z);

  /** 最大弥散半径按实际画面高度缩放，保证 1080p 与 4K 得到同样的观感 */
  function dofMaxBlurPx() {
    return Math.max(1, POST.dof.maxBlurPx * (height / 1080));
  }

  function makeTarget(w, h, withDepth) {
    const opts = {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: !!withDepth
    };
    if (withDepth) {
      opts.depthTexture = new THREE.DepthTexture(Math.max(1, w), Math.max(1, h));
      opts.depthTexture.format = THREE.DepthFormat;
      opts.depthTexture.type = THREE.UnsignedIntType;
    }
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), opts);
  }

  function makePass(fragmentShader, uniforms) {
    const material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(quadGeo, material);
    mesh.frustumCulled = false;
    const passScene = new THREE.Scene();
    passScene.add(mesh);
    return { scene: passScene, material };
  }

  function buildTargets() {
    for (const key of Object.keys(targets)) targets[key].dispose();
    const halfW = POST.halfResolution ? Math.max(1, Math.floor(width / 2)) : width;
    const halfH = POST.halfResolution ? Math.max(1, Math.floor(height / 2)) : height;

    targets.scene = makeTarget(width, height, true);
    targets.edge = makeTarget(width, height, false);
    targets.dof = makeTarget(width, height, false);
    targets.dofA = makeTarget(width, height, false);
    targets.dofB = makeTarget(width, height, false);
    targets.bright = makeTarget(halfW, halfH, false);
    targets.blurA = makeTarget(halfW, halfH, false);
    targets.blurB = makeTarget(halfW, halfH, false);
    targets.composite = makeTarget(width, height, false);

    passes.edge = makePass(EDGE_FS, {
      tScene: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 400 },
      uThreshold: { value: POST.outline.edgeThreshold },
      uStrength: { value: POST.outline.edgeStrength },
      // 距离拐点与反向壳体同源（OUTLINE）：两路不同步就会出现「壳体还在、
      // 边缘检测先掉线」的半截描边
      uNearDistance: { value: OUTLINE.nearDistance },
      uFarDistance: { value: OUTLINE.farDistance },
      uNearWeight: { value: POST.outline.edgeNearWeight },
      uFarWeight: { value: POST.outline.edgeFarWeight },
      uOutlineColor: { value: new THREE.Color(POST.outline.color) }
    });

    // 景深三趟共用同一批 uniform 句柄：改一次三趟一起变，不会出现某趟留在旧值上。
    dofUniforms = {
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
      uResolution: { value: new THREE.Vector2(width, height) },
      uCameraNear: { value: camera.near },
      uCameraFar: { value: camera.far },
      uFocusDistance: { value: state.focusDistance },
      uFocusRange: { value: POST.dof.focusRange },
      uMaxBlurPx: { value: dofMaxBlurPx() },
      uNearWeight: { value: POST.dof.nearWeight },
      uFarWeight: { value: POST.dof.farWeight },
      uDepthFalloff: { value: POST.dof.depthFalloff }
    };
    passes.dofH = makePass(DOF_GATHER_FS, Object.assign({ tScene: { value: null }, uAxis: { value: 0 } }, dofUniforms));
    passes.dofV = makePass(DOF_GATHER_FS, Object.assign({ tScene: { value: null }, uAxis: { value: 1 } }, dofUniforms));
    passes.dofMix = makePass(DOF_COMPOSITE_FS, Object.assign({ tSharp: { value: null }, tBlurred: { value: null } }, dofUniforms));
    // 合成趟不采样方向，但共用同一批 uniform，uAxis 给 0 保持声明完整
    passes.dofMix.material.uniforms.uAxis = { value: 0 };

    passes.bright = makePass(BRIGHT_FS, {
      tScene: { value: null },
      uThreshold: { value: POST.bloom.threshold },
      uKnee: { value: POST.bloom.knee }
    });

    const halfTexel = new THREE.Vector2(1 / (POST.halfResolution ? width / 2 : width), 1 / (POST.halfResolution ? height / 2 : height));
    passes.blurA = makePass(BLUR_FS, {
      tScene: { value: null },
      uTexel: { value: halfTexel.clone() },
      uRadius: { value: POST.bloom.radius }
    });
    passes.blurB = makePass(BLUR_FS, {
      tScene: { value: null },
      uTexel: { value: halfTexel.clone() },
      uRadius: { value: POST.bloom.radius * 2.1 }
    });

    passes.composite = makePass(COMPOSITE_FS, {
      tScene: { value: null },
      tBloom: { value: null },
      uBloomStrength: { value: POST.bloom.strength }
    });

    passes.grade = makePass(GRADE_FS, {
      tScene: { value: null },
      uExposure: { value: POST.grade.exposure },
      uContrast: { value: POST.grade.contrast },
      uSaturation: { value: POST.grade.saturation },
      uLift: { value: POST.grade.lift },
      uGain: { value: POST.grade.gain },
      uWarmth: { value: POST.grade.warmth },
      uLutStrength: { value: POST.grade.lutStrength },
      uHighlightSoftening: { value: POST.grade.highlightSoftening },
      uVignette: { value: POST.grade.vignette },
      uVignetteSoftness: { value: POST.grade.vignetteSoftness },
      uGrain: { value: POST.grade.grain },
      uTime: { value: 0 }
    });
  }

  function measure() {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    const pr = renderer.getPixelRatio();
    width = Math.max(1, Math.floor(size.x * pr));
    height = Math.max(1, Math.floor(size.y * pr));
  }

  const state = {
    focusDistance: POST.dof.focusDistance,
    followFocusTarget: POST.dof.followFocusTarget,
    enabled: POST.enabled,
    frames: 0
  };

  /** 焦平面到相机的距离：默认锁站房南立面；关掉跟随时用手动值 */
  function focusDistanceFor(cam) {
    if (!state.followFocusTarget) return state.focusDistance;
    return Math.max(0.1, cam.position.distanceTo(focusPoint));
  }

  measure();
  buildTargets();

  function blit(pass, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(pass.scene, quadCamera);
  }

  /**
   * 退回直接渲染（后处理关闭或不可用时）。
   * 此时必须临时把色调映射交回渲染器 —— 否则内置材质直接画到屏幕，
   * 线性 HDR 被原样 clamp 进 0..1，画面发暗且高光削平。
   */
  function renderDirect() {
    const previous = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    renderer.toneMapping = configuredToneMapping();
    renderer.toneMappingExposure = POST.grade.exposure;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    renderer.toneMapping = previous;
    renderer.toneMappingExposure = previousExposure;
  }

  /**
   * 渲染一帧。
   * @param {number} elapsed 累计时间（秒），用于调色颗粒动画
   */
  function render(elapsed) {
    if (!state.enabled) {
      renderDirect();
      return;
    }

    try {
      // 0) 阶段一 & 阶段三：推进 GPU 浅水方程（SWE）Ping-Pong 迭代 + 捕获水下河床深度与折射缓冲
      const swe = getSweSimulator();
      swe.resizeRefraction(width, height);
      const sweTex = swe.step(renderer, elapsed);
      const hasRefract = swe.captureRefraction(renderer, scene, camera);
      for (const mat of WATER_FLOW_MATERIALS) {
        tuneMaterial(mat, 'uSweTex', sweTex);
        tuneMaterial(mat, 'tRefractionColor', swe.refractionColorTex);
        tuneMaterial(mat, 'tRefractionDepth', swe.refractionDepthTex);
        tuneMaterial(mat, 'uHasRefraction', hasRefract ? 1.0 : 0.0);
        tuneMaterial(mat, 'uCameraNear', camera.near);
        tuneMaterial(mat, 'uCameraFar', camera.far);
      }
      for (const mat of RIVERBED_CAUSTIC_MATERIALS) {
        tuneMaterial(mat, 'uSweTex', sweTex);
      }

      // 1) 场景 → 带深度的离屏缓冲
      renderer.setRenderTarget(targets.scene);
      renderer.clear();
      renderer.render(scene, camera);

      const near = camera.near;
      const far = camera.far;

      // 2) 深度边缘描边
      if (POST.outline.enabled) {
        passes.edge.material.uniforms.tScene.value = targets.scene.texture;
        passes.edge.material.uniforms.tDepth.value = targets.scene.depthTexture;
        passes.edge.material.uniforms.uCameraNear.value = near;
        passes.edge.material.uniforms.uCameraFar.value = far;
        blit(passes.edge, targets.edge);
      }

      // 3) 景深：横向 gather → 纵向 gather → 锐 / 糊按 CoC 混合
      if (POST.dof.enabled) {
        const sharpSource = POST.outline.enabled ? targets.edge.texture : targets.scene.texture;
        const u = dofUniforms;
        u.tDepth.value = targets.scene.depthTexture;
        u.uCameraNear.value = near;
        u.uCameraFar.value = far;
        u.uFocusDistance.value = focusDistanceFor(camera);
        u.uMaxBlurPx.value = dofMaxBlurPx();
        state.focusDistance = u.uFocusDistance.value;

        passes.dofH.material.uniforms.tScene.value = sharpSource;
        blit(passes.dofH, targets.dofA);

        passes.dofV.material.uniforms.tScene.value = targets.dofA.texture;
        blit(passes.dofV, targets.dofB);

        passes.dofMix.material.uniforms.tSharp.value = sharpSource;
        passes.dofMix.material.uniforms.tBlurred.value = targets.dofB.texture;
        blit(passes.dofMix, targets.dof);
      }

      // 4) 辉光
      if (POST.bloom.enabled) {
        passes.bright.material.uniforms.tScene.value = POST.dof.enabled ? targets.dof.texture : targets.scene.texture;
        blit(passes.bright, targets.bright);

        passes.blurA.material.uniforms.tScene.value = targets.bright.texture;
        blit(passes.blurA, targets.blurA);

        passes.blurB.material.uniforms.tScene.value = targets.blurA.texture;
        blit(passes.blurB, targets.blurB);
      }

      // 5) 合成
      passes.composite.material.uniforms.tScene.value = POST.dof.enabled
        ? targets.dof.texture
        : POST.outline.enabled
          ? targets.edge.texture
          : targets.scene.texture;
      passes.composite.material.uniforms.tBloom.value = POST.bloom.enabled ? targets.blurB.texture : null;
      passes.composite.material.uniforms.uBloomStrength.value = POST.bloom.enabled ? POST.bloom.strength : 0;
      blit(passes.composite, targets.composite);

      // 6) 调色 → 屏幕
      passes.grade.material.uniforms.tScene.value = targets.composite.texture;
      passes.grade.material.uniforms.uTime.value = elapsed;
      blit(passes.grade, null);

      state.frames++;
    } catch (err) {
      // 后处理不可用时退回直接渲染，保证画面始终可见
      state.enabled = false;
      renderDirect();
    }
  }

  function resize() {
    measure();
    buildTargets();
  }

  return {
    targets,
    passes,
    render,
    resize,
    setEnabled(v) {
      state.enabled = v;
    },
    /** 焦点距离由相机模块或调校脚本提供（默认锁定站房南立面） */
    setFocusDistance(d) {
      state.focusDistance = Math.max(0.1, d);
      dofUniforms.uFocusDistance.value = state.focusDistance;
    },
    /** 关掉「焦点锁站房」时用手动焦平面（调校 / 复现特定构图） */
    setFollowFocusTarget(v) {
      state.followFocusTarget = !!v;
    },
    setFocusRange(v) {
      POST.dof.focusRange = v;
      dofUniforms.uFocusRange.value = v;
    },
    setMaxBlurPx(v) {
      POST.dof.maxBlurPx = v;
      dofUniforms.uMaxBlurPx.value = dofMaxBlurPx();
    },
    /** 前景 / 远景虚化强度分别可调（AGENT.md：前景「微失焦」、远景「轻微虚化」） */
    setDofWeights(nearWeight, farWeight) {
      POST.dof.nearWeight = nearWeight;
      POST.dof.farWeight = farWeight;
      dofUniforms.uNearWeight.value = nearWeight;
      dofUniforms.uFarWeight.value = farWeight;
    },
    setGrade(key, value) {
      if (key in POST.grade) {
        POST.grade[key] = value;
        const u = passes.grade.material.uniforms;
        const map = {
          exposure: 'uExposure',
          contrast: 'uContrast',
          saturation: 'uSaturation',
          lift: 'uLift',
          gain: 'uGain',
          warmth: 'uWarmth',
          lutStrength: 'uLutStrength',
          highlightSoftening: 'uHighlightSoftening',
          vignette: 'uVignette',
          vignetteSoftness: 'uVignetteSoftness',
          grain: 'uGrain'
        };
        if (map[key]) u[map[key]].value = value;
      }
    },
    setBloomThreshold(v) {
      POST.bloom.threshold = v;
      passes.bright.material.uniforms.uThreshold.value = v;
    },
    setBloomKnee(v) {
      POST.bloom.knee = v;
      passes.bright.material.uniforms.uKnee.value = v;
    },
    setBloomStrength(v) {
      POST.bloom.strength = v;
      passes.composite.material.uniforms.uBloomStrength.value = v;
    },
    setOutlineStrength(v) {
      POST.outline.edgeStrength = v;
      passes.edge.material.uniforms.uStrength.value = v;
    },
    /** 深度边缘这一路的近 / 远权重（远处只收细不关掉） */
    setEdgeWeights(nearWeight, farWeight) {
      POST.outline.edgeNearWeight = nearWeight;
      POST.outline.edgeFarWeight = farWeight;
      passes.edge.material.uniforms.uNearWeight.value = nearWeight;
      passes.edge.material.uniforms.uFarWeight.value = farWeight;
    },
    setEdgeThreshold(v) {
      POST.outline.edgeThreshold = v;
      passes.edge.material.uniforms.uThreshold.value = v;
    },
    /** 距离拐点与反向壳体同步（OUTLINE 是单一来源） */
    setEdgeDistanceRange(nearDistance, farDistance) {
      // 必须同时改反向壳体：只改这一路会出现「壳体还在、边缘检测先掉线」的半截描边
      setOutlineDistanceRange(nearDistance, farDistance);
      passes.edge.material.uniforms.uNearDistance.value = nearDistance;
      passes.edge.material.uniforms.uFarDistance.value = farDistance;
    },
    dispose() {
      for (const key of Object.keys(targets)) targets[key].dispose();
      quadGeo.dispose();
      for (const key of Object.keys(passes)) passes[key].material.dispose();
    },
    outlineColor: new THREE.Color(PALETTE.outline)
  };
}
