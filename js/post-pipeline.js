// 后处理管线：瑞利大气天空 + 5层视差远山 + SSAO 环境光遮蔽 + 3D 体积雾 + 林间丁达尔体积光（God Ray）
// → 描边（反向壳体 + 深度边缘）→ 鸟居焦点景深 DOF → Bloom 辉光 → 合成 → 电影级调色
import * as THREE from 'three';
import { POST, PALETTE, OUTLINE, LIGHT } from './config.js';
import { configuredToneMapping } from './renderer.js';
import { DOF_FOCUS } from './layout.js';
import { getShrineLanternWorldPositions } from './assets/torii.js';
import { sunDirection } from './lighting.js';
import { QUAD_VS, EDGE_FS } from './shaders/outline-shader.js';
import { setOutlineDistanceRange } from './outline.js';
import { SSAO_FOG_FS } from './shaders/ssao-shader.js';
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

  const focusPoint = new THREE.Vector3(DOF_FOCUS.x, DOF_FOCUS.y, DOF_FOCUS.z);
  const lanternPositions = getShrineLanternWorldPositions();
  const lanternPosL = lanternPositions[0]
    ? new THREE.Vector3(lanternPositions[0].x, lanternPositions[0].y, lanternPositions[0].z)
    : new THREE.Vector3(-1.35, 5.42, -0.02);
  const lanternPosR = lanternPositions[1]
    ? new THREE.Vector3(lanternPositions[1].x, lanternPositions[1].y, lanternPositions[1].z)
    : new THREE.Vector3(1.89, 5.42, -0.02);

  function dofMaxBlurPx() {
    return Math.max(0, POST.dof.maxBlurPx * state.dofScale * (height / 1080));
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

  const state = {
    focusDistance: POST.dof.focusDistance,
    followFocusTarget: POST.dof.followFocusTarget,
    dofScale: 1.0,
    godRayStrength: 1.0,
    weatherMode: 0.0,
    dayHour: 10.5,
    moonPhase: 0.88,
    lanternIntensity: 0.42,
    sunDir: sunDirection(),
    sunColor: new THREE.Color(LIGHT.sunColor),
    sunIntensity: LIGHT.sunIntensity,
    enabled: POST.enabled,
    frames: 0
  };

  function buildTargets() {
    for (const key of Object.keys(targets)) targets[key].dispose();
    const halfW = POST.halfResolution ? Math.max(1, Math.floor(width / 2)) : width;
    const halfH = POST.halfResolution ? Math.max(1, Math.floor(height / 2)) : height;

    targets.scene = makeTarget(width, height, true);
    targets.ssaoFog = makeTarget(width, height, false);
    targets.edge = makeTarget(width, height, false);
    targets.dof = makeTarget(width, height, false);
    targets.dofA = makeTarget(width, height, false);
    targets.dofB = makeTarget(width, height, false);
    targets.bright = makeTarget(halfW, halfH, false);
    targets.blurA = makeTarget(halfW, halfH, false);
    targets.blurB = makeTarget(halfW, halfH, false);
    targets.composite = makeTarget(width, height, false);

    // 1) 瑞利大气天空 + 5层视差远山 + SSAO + 3D 体积雾 + 林间丁达尔体积光束
    passes.ssaoFog = makePass(SSAO_FOG_FS, {
      tScene: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
      uResolution: { value: new THREE.Vector2(width, height) },
      uCameraNear: { value: camera.near },
      uCameraFar: { value: camera.far },
      uProjScale: { value: 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) },
      uAspect: { value: width / Math.max(1, height) },
      uInvViewMatrix: { value: new THREE.Matrix4() },
      uCameraPos: { value: new THREE.Vector3() },
      uSsaoEnabled: { value: POST.ssao.enabled ? 1.0 : 0.0 },
      uSsaoStrength: { value: POST.ssao.strength },
      uSsaoRadius: { value: POST.ssao.radius },
      uSsaoBias: { value: POST.ssao.bias },
      uSsaoColor: { value: new THREE.Color(POST.ssao.color) },
      uFogEnabled: { value: POST.heightFog.enabled ? 1.0 : 0.0 },
      uFogColor: { value: new THREE.Color(POST.heightFog.color) },
      uFogSunTint: { value: new THREE.Color(POST.heightFog.sunTint) },
      uFogDensity: { value: POST.heightFog.density },
      uFogBaseY: { value: POST.heightFog.baseY },
      uFogHeightFalloff: { value: POST.heightFog.heightFalloff },
      uFogSpeed: { value: POST.heightFog.speed },
      uFogNoiseAmp: { value: POST.heightFog.noiseAmp },
      uTime: { value: 0 },
      uDayHour: { value: state.dayHour },
      uSunDir: { value: state.sunDir.clone() },
      uSunColor: { value: state.sunColor.clone() },
      uSunIntensity: { value: state.sunIntensity },
      uGodRayStrength: { value: state.godRayStrength },
      uLanternIntensity: { value: state.lanternIntensity },
      uLanternPosL: { value: lanternPosL.clone() },
      uLanternPosR: { value: lanternPosR.clone() },
      uWeatherMode: { value: state.weatherMode },
      uMoonPhase: { value: state.moonPhase }
    });

    // 2) 深度边缘描边
    passes.edge = makePass(EDGE_FS, {
      tScene: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 400 },
      uThreshold: { value: POST.outline.edgeThreshold },
      uStrength: { value: POST.outline.edgeStrength },
      uNearDistance: { value: OUTLINE.nearDistance },
      uFarDistance: { value: OUTLINE.farDistance },
      uNearWeight: { value: POST.outline.edgeNearWeight },
      uFarWeight: { value: POST.outline.edgeFarWeight },
      uOutlineColor: { value: new THREE.Color(POST.outline.color) }
    });

    // 3) 景深三趟共用同一批 uniform 句柄（焦点锁定在中心朱红鸟居）
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

  function render(elapsed) {
    if (!state.enabled) {
      renderDirect();
      return;
    }

    try {
      const swe = getSweSimulator();
      swe.resizeRefraction(width, height);
      const sweTex = swe.step(renderer, elapsed);
      const hasRefract = swe.captureRefraction(renderer, scene, camera);
      for (const mat of WATER_FLOW_MATERIALS) {
        tuneMaterial(mat, 'uSweTex', sweTex);
        tuneMaterial(mat, 'uHydroTex', swe.obstacleTex);
        tuneMaterial(mat, 'tRefractionColor', swe.refractionColorTex);
        tuneMaterial(mat, 'tRefractionDepth', swe.refractionDepthTex);
        tuneMaterial(mat, 'tReflectionColor', swe.reflectionColorTex);
        tuneMaterial(mat, 'uHasRefraction', hasRefract ? 1.0 : 0.0);
        tuneMaterial(mat, 'uHasReflection', swe.hasReflection ? 1.0 : 0.0);
        tuneMaterial(mat, 'uCameraNear', camera.near);
        tuneMaterial(mat, 'uCameraFar', camera.far);
      }
      for (const mat of RIVERBED_CAUSTIC_MATERIALS) {
        tuneMaterial(mat, 'uSweTex', sweTex);
      }

      renderer.setRenderTarget(targets.scene);
      renderer.clear();
      renderer.render(scene, camera);

      const near = camera.near;
      const far = camera.far;

      camera.updateMatrixWorld();
      const sfU = passes.ssaoFog.material.uniforms;
      sfU.tScene.value = targets.scene.texture;
      sfU.tDepth.value = targets.scene.depthTexture;
      sfU.uCameraNear.value = near;
      sfU.uCameraFar.value = far;
      sfU.uProjScale.value = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
      sfU.uAspect.value = width / Math.max(1, height);
      sfU.uInvViewMatrix.value.copy(camera.matrixWorld);
      sfU.uCameraPos.value.setFromMatrixPosition(camera.matrixWorld);
      sfU.uTime.value = elapsed;
      blit(passes.ssaoFog, targets.ssaoFog);

      if (POST.outline.enabled) {
        passes.edge.material.uniforms.tScene.value = targets.ssaoFog.texture;
        passes.edge.material.uniforms.tDepth.value = targets.scene.depthTexture;
        passes.edge.material.uniforms.uCameraNear.value = near;
        passes.edge.material.uniforms.uCameraFar.value = far;
        blit(passes.edge, targets.edge);
      }

      const sharpSource = POST.outline.enabled ? targets.edge.texture : targets.ssaoFog.texture;

      const dofActive = POST.dof.enabled && state.dofScale > 0.01;
      if (dofActive) {
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

      const preBloomTex = dofActive ? targets.dof.texture : sharpSource;

      if (POST.bloom.enabled) {
        passes.bright.material.uniforms.tScene.value = preBloomTex;
        blit(passes.bright, targets.bright);

        passes.blurA.material.uniforms.tScene.value = targets.bright.texture;
        blit(passes.blurA, targets.blurA);

        passes.blurB.material.uniforms.tScene.value = targets.blurA.texture;
        blit(passes.blurB, targets.blurB);
      }

      passes.composite.material.uniforms.tScene.value = preBloomTex;
      passes.composite.material.uniforms.tBloom.value = POST.bloom.enabled ? targets.blurB.texture : null;
      passes.composite.material.uniforms.uBloomStrength.value = POST.bloom.enabled ? POST.bloom.strength : 0;
      blit(passes.composite, targets.composite);

      passes.grade.material.uniforms.tScene.value = targets.composite.texture;
      passes.grade.material.uniforms.uTime.value = elapsed;
      blit(passes.grade, null);

      state.frames++;
    } catch (_err) {
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
    setSsaoEnabled(v) {
      POST.ssao.enabled = !!v;
      passes.ssaoFog.material.uniforms.uSsaoEnabled.value = v ? 1.0 : 0.0;
    },
    setSsaoStrength(v) {
      POST.ssao.strength = Math.max(0, v);
      passes.ssaoFog.material.uniforms.uSsaoStrength.value = POST.ssao.strength;
    },
    setSsaoRadius(v) {
      POST.ssao.radius = Math.max(0.05, v);
      passes.ssaoFog.material.uniforms.uSsaoRadius.value = POST.ssao.radius;
    },
    setFogEnabled(v) {
      POST.heightFog.enabled = !!v;
      passes.ssaoFog.material.uniforms.uFogEnabled.value = v ? 1.0 : 0.0;
    },
    setHeightFogDensity(v) {
      POST.heightFog.density = Math.max(0, v);
      passes.ssaoFog.material.uniforms.uFogDensity.value = POST.heightFog.density;
    },
    setFogSpeed(v) {
      POST.heightFog.speed = Math.max(0, v);
      passes.ssaoFog.material.uniforms.uFogSpeed.value = POST.heightFog.speed;
    },
    setFogHeightFalloff(v) {
      POST.heightFog.heightFalloff = Math.max(0.05, v);
      passes.ssaoFog.material.uniforms.uFogHeightFalloff.value = POST.heightFog.heightFalloff;
    },
    setFogColors(baseColor, sunTint) {
      if (baseColor !== undefined) {
        POST.heightFog.color = baseColor;
        passes.ssaoFog.material.uniforms.uFogColor.value.set(baseColor);
      }
      if (sunTint !== undefined) {
        POST.heightFog.sunTint = sunTint;
        passes.ssaoFog.material.uniforms.uFogSunTint.value.set(sunTint);
      }
    },
    setAtmosphereState({ hour, sunDir, sunColor, sunIntensity, moonPhase, lanternIntensity }) {
      const sfU = passes.ssaoFog.material.uniforms;
      if (hour !== undefined) {
        state.dayHour = hour;
        sfU.uDayHour.value = hour;
      }
      if (sunDir) {
        state.sunDir.copy(sunDir);
        sfU.uSunDir.value.copy(sunDir);
      }
      if (sunColor !== undefined) {
        state.sunColor.set(sunColor);
        sfU.uSunColor.value.set(sunColor);
      }
      if (sunIntensity !== undefined) {
        state.sunIntensity = sunIntensity;
        sfU.uSunIntensity.value = sunIntensity;
      }
      if (moonPhase !== undefined) {
        state.moonPhase = moonPhase;
        sfU.uMoonPhase.value = moonPhase;
      }
      if (lanternIntensity !== undefined) {
        state.lanternIntensity = lanternIntensity;
        sfU.uLanternIntensity.value = lanternIntensity;
      }
    },
    setGodRayStrength(v) {
      state.godRayStrength = Math.max(0, v);
      passes.ssaoFog.material.uniforms.uGodRayStrength.value = state.godRayStrength;
    },
    getGodRayStrength() {
      return state.godRayStrength;
    },
    setWeatherMode(code) {
      state.weatherMode = Number(code) || 0;
      passes.ssaoFog.material.uniforms.uWeatherMode.value = state.weatherMode;
    },
    setDofScale(v) {
      state.dofScale = Math.max(0, v);
      dofUniforms.uMaxBlurPx.value = dofMaxBlurPx();
    },
    setFocusDistance(d) {
      state.focusDistance = Math.max(0.1, d);
      dofUniforms.uFocusDistance.value = state.focusDistance;
    },
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
    setEdgeDistanceRange(nearDistance, farDistance) {
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
