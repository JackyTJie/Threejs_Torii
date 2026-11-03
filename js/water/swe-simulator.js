// 四阶段二维浅水方程（2D Shallow Water Equations / Wave PDE on GPU Texture）+ 斯涅尔折射深度通道 + 实时平面/光追反射通道
//
// 阶段一：搭建物理模拟管线（SWE on GPU Ping-Pong FBO Texture）
//   - 双缓冲浮点纹理（WebGLRenderTarget HalfFloatType, 128x256）：
//     * R 通道 = 当前水高扰动 h(x, z, t)
//     * G 通道 = 旧水高 h(x, z, t - dt)
//     * B 通道 = 地形/溪石障碍物掩码（0 = 水域，1 = 石块/岸壁障碍物）
//     * A 通道 = 流速/动量变化率与绕石尾流涡度能量
//   - 模拟着色器（SWE_SIM_FS）：基于拉普拉斯算子与顺流平流项求解浅水波动方程；
//     遇障碍物（B > 0.5）强制反射波能并在迎水侧抬升真实三维驻波（Bow Wave），背水侧生成涡街凹槽；
//   - 交互输入机制：接收射线命中点，在纹理上写入瞬时高斯水高增量激起动态交互波纹。
//
// 阶段三：水底折射深度通道（Refraction & Depth Pass）与实时倒影反射通道（Planar Reflection Pass）
//   - 折射通道（refractionTarget）：隐藏水面，将河床泥沙（streamBed）、水中鹅卵石、沉叶与溪石（streamStones）
//     连同真实树冠阴影渲染到带 THREE.DepthTexture 的离屏缓冲，供水面按波浪法线进行斯涅尔折射采样，清澈见底；
//   - 反射通道（reflectionTarget）：构建关于山涧斜面镜像对称的反射相机（reflectionCamera），实时渲染上方的
//     翠绿树冠与远处的朱红色明神鸟居到离屏纹理，供水面结合波浪法线与 3D 光追产生波光粼粼的真实倒影。
import * as THREE from 'three';
import {
  CONTENT_HALF,
  STREAM_CASCADES,
  streamBankHalf,
  streamCenterX,
  terrainHeight,
  waterY
} from '../layout.js';
import { getStreamObstacles } from '../assets/stream.js';

export const SWE_TEX_WIDTH = 128;
export const SWE_TEX_HEIGHT = 256;

export const SWE_DOMAIN = {
  xMin: -6.2,
  xMax: -0.8,
  zMin: -CONTENT_HALF,
  zMax: CONTENT_HALF
};

const QUAD_VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`;

export const SWE_SIM_FS = /* glsl */ `
  precision highp float;

  uniform sampler2D uStateTex;
  uniform sampler2D uObstacleTex;
  uniform vec2 uTexelSize;
  uniform vec2 uDomainMin;
  uniform vec2 uDomainMax;
  uniform float uTime;
  uniform float uDamping;
  uniform float uWaveSpeed;
  uniform vec3 uImpulse;
  uniform float uImpulseRadius;

  varying vec2 vUv;

  vec2 uvToWorld( vec2 uv ) {
    return mix( uDomainMin, uDomainMax, uv );
  }

  void main() {
    vec4 obsInfo = texture2D( uObstacleTex, vUv );
    float obstacle = obsInfo.b;
    float cascadeSource = obsInfo.a;

    // 障碍物边界约束：石头内部水高与速度严格置 0
    if ( obstacle > 0.5 ) {
      gl_FragColor = vec4( 0.0, 0.0, obstacle, 0.0 );
      return;
    }

    // 顺流平流采样（沿溪流切向推进）
    vec2 advectUv = vUv - vec2( 0.0, uTexelSize.y * 0.42 );
    vec4 center = texture2D( uStateTex, advectUv );
    float hCurr = center.r;
    float hPrev = center.g;

    vec2 dx = vec2( uTexelSize.x, 0.0 );
    vec2 dy = vec2( 0.0, uTexelSize.y );

    vec4 nSample = texture2D( uStateTex, advectUv + dy );
    vec4 sSample = texture2D( uStateTex, advectUv - dy );
    vec4 eSample = texture2D( uStateTex, advectUv + dx );
    vec4 wSample = texture2D( uStateTex, advectUv - dx );

    float oN = texture2D( uObstacleTex, vUv + dy ).b;
    float oS = texture2D( uObstacleTex, vUv - dy ).b;
    float oE = texture2D( uObstacleTex, vUv + dx ).b;
    float oW = texture2D( uObstacleTex, vUv - dx ).b;

    // 诺伊曼障碍物反射边界：碰撞石头（B > 0.5）时波浪反射并在迎水侧抬升真实涌浪，背水侧下陷
    float hN = oN > 0.5 ? hCurr * 0.96 + 0.0055 : nSample.r;
    float hS = oS > 0.5 ? hCurr * 0.92 - 0.0042 : sSample.r;
    float hE = oE > 0.5 ? hCurr * 0.94 + 0.0020 : eSample.r;
    float hW = oW > 0.5 ? hCurr * 0.94 + 0.0020 : wSample.r;

    float neighborAvg = ( hN + hS + hE + hW ) * 0.25;
    float velocity = ( hCurr - hPrev ) * uDamping + ( neighborAvg - hCurr ) * uWaveSpeed;
    float hNext = ( hCurr + velocity ) * uDamping;

    // 瀑布跌水与石块背水侧卡门涡街持续三维波浪激励
    vec2 worldXZ = uvToWorld( vUv );
    float nearObstacle = clamp( oN + oS + oE + oW, 0.0, 1.0 );
    float wakeSource = (
      sin( worldXZ.y * 8.5 - uTime * 5.8 + worldXZ.x * 6.2 ) * 0.65 +
      cos( worldXZ.y * 13.4 - uTime * 8.1 - worldXZ.x * 9.1 ) * 0.35
    ) * 0.0042 * nearObstacle;
    float cascadeWave = (
      sin( worldXZ.x * 9.5 + worldXZ.y * 5.4 - uTime * 7.6 ) * 0.6 +
      cos( worldXZ.x * 14.8 - worldXZ.y * 7.2 - uTime * 10.2 ) * 0.4
    ) * 0.0058 * cascadeSource;

    // 连续山涧行波注入（保证全流域具备自然高低起伏的波峰与波谷）
    float streamWave = (
      sin( worldXZ.y * 4.2 - uTime * 4.6 + sin( worldXZ.x * 2.8 ) * 0.9 ) * 0.0018 +
      cos( worldXZ.x * 5.6 + worldXZ.y * 3.1 - uTime * 3.8 ) * 0.0012
    );

    hNext += wakeSource + cascadeWave + streamWave;

    // 指针射线交互波纹注入
    if ( uImpulse.z > 0.0001 ) {
      float dist = length( worldXZ - uImpulse.xy );
      if ( dist < uImpulseRadius ) {
        float phase = clamp( dist * 3.14159265 / uImpulseRadius, 0.0, 3.14159265 );
        hNext -= ( cos( phase ) + 1.0 ) * 0.5 * uImpulse.z;
      }
    }

    hNext = clamp( hNext, -0.065, 0.065 );

    // A 通道：仅在紧贴石头接触圈（nearObstacle）与瀑布落水口记录激荡强度，绝不涂抹全河道
    float gradMag = length( vec2( hE - hW, hN - hS ) ) * 16.0;
    float agitation = clamp(
      nearObstacle * 0.72 + cascadeSource * 0.68 + gradMag * 0.35,
      0.0,
      1.0
    );

    gl_FragColor = vec4( hNext, hCurr, obstacle, agitation );
  }
`;

export function buildSweInitialTextures() {
  const size = SWE_TEX_WIDTH * SWE_TEX_HEIGHT;
  const stateData = new Float32Array(size * 4);
  const obstacleData = new Float32Array(size * 4);
  const obstacles = getStreamObstacles();

  for (let iy = 0; iy < SWE_TEX_HEIGHT; iy++) {
    const v = (iy + 0.5) / SWE_TEX_HEIGHT;
    const z = SWE_DOMAIN.zMin + (SWE_DOMAIN.zMax - SWE_DOMAIN.zMin) * v;
    const wy = waterY(z);
    const cx = streamCenterX(z);
    const half = streamBankHalf(z);

    let casFactor = 0;
    for (const cas of STREAM_CASCADES) {
      const dz = Math.abs(z - cas.z);
      if (dz < cas.halfSpan * 1.35) {
        const w = 1 - dz / (cas.halfSpan * 1.35);
        casFactor = Math.max(casFactor, w * w);
      }
    }

    for (let ix = 0; ix < SWE_TEX_WIDTH; ix++) {
      const u = (ix + 0.5) / SWE_TEX_WIDTH;
      const x = SWE_DOMAIN.xMin + (SWE_DOMAIN.xMax - SWE_DOMAIN.xMin) * u;
      const idx = (iy * SWE_TEX_WIDTH + ix) * 4;

      const ground = terrainHeight(x, z);
      let isObstacle = ground >= wy + 0.015 || Math.abs(x - cx) > half + 0.35 ? 1.0 : 0.0;

      let stoneProx = 0;
      for (const ob of obstacles) {
        const d = Math.hypot(x - ob.x, z - ob.z);
        if (d < ob.r * 0.92) {
          isObstacle = 1.0;
        } else if (d < ob.r * 1.45) {
          stoneProx = Math.max(stoneProx, 1 - (d - ob.r * 0.92) / (ob.r * 0.53));
        }
      }

      const initWave = isObstacle > 0.5
        ? 0
        : (Math.sin(z * 4.2 + x * 3.1) * 0.012 + Math.cos(z * 7.5 - x * 5.2) * 0.008) * (1 + casFactor * 0.8);

      stateData[idx] = initWave;
      stateData[idx + 1] = initWave * 0.92;
      stateData[idx + 2] = isObstacle;
      stateData[idx + 3] = isObstacle > 0.5 ? 0 : Math.min(1, casFactor * 0.65 + stoneProx * 0.55);

      obstacleData[idx] = 0;
      obstacleData[idx + 1] = 0;
      obstacleData[idx + 2] = isObstacle;
      obstacleData[idx + 3] = Math.min(1, casFactor * 0.75 + stoneProx * 0.45);
    }
  }

  const makeTex = (arr) => {
    const tex = new THREE.DataTexture(arr, SWE_TEX_WIDTH, SWE_TEX_HEIGHT, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    stateTex: makeTex(stateData),
    obstacleTex: makeTex(obstacleData),
    stateData,
    obstacleData
  };
}

let sharedSimulator = null;

export function getSweSimulator() {
  if (sharedSimulator) return sharedSimulator;

  const { stateTex, obstacleTex, stateData, obstacleData } = buildSweInitialTextures();
  const domainMin = new THREE.Vector2(SWE_DOMAIN.xMin, SWE_DOMAIN.zMin);
  const domainMax = new THREE.Vector2(SWE_DOMAIN.xMax, SWE_DOMAIN.zMax);

  const rtOpts = {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false
  };

  let rtA = new THREE.WebGLRenderTarget(SWE_TEX_WIDTH, SWE_TEX_HEIGHT, rtOpts);
  let rtB = new THREE.WebGLRenderTarget(SWE_TEX_WIDTH, SWE_TEX_HEIGHT, rtOpts);
  let initializedOnGpu = false;

  // 1) 河床深度与折射离屏缓冲（Refraction & Depth Capture Target）
  let refractionTarget = new THREE.WebGLRenderTarget(512, 512, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true
  });
  refractionTarget.depthTexture = new THREE.DepthTexture(512, 512);
  refractionTarget.depthTexture.format = THREE.DepthFormat;
  refractionTarget.depthTexture.type = THREE.UnsignedIntType;

  // 2) 实时水面镜面反射离屏缓冲（Planar Reflection Capture Target：捕捉上方翠绿树冠与朱红鸟居倒影）
  let reflectionTarget = new THREE.WebGLRenderTarget(512, 512, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true
  });
  const reflectionCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 420);
  const planePoint = new THREE.Vector3(-3.1, 1.45, 2.5);
  const planeNormal = new THREE.Vector3(0.06, 0.985, 0.16).normalize();
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const reflPos = new THREE.Vector3();
  const reflTarget = new THREE.Vector3();
  const reflUp = new THREE.Vector3();

  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simGeo = new THREE.PlaneGeometry(2, 2);
  const simUniforms = {
    uStateTex: { value: stateTex },
    uObstacleTex: { value: obstacleTex },
    uTexelSize: { value: new THREE.Vector2(1 / SWE_TEX_WIDTH, 1 / SWE_TEX_HEIGHT) },
    uDomainMin: { value: domainMin },
    uDomainMax: { value: domainMax },
    uTime: { value: 0 },
    uDamping: { value: 0.986 },
    uWaveSpeed: { value: 1.72 },
    uImpulse: { value: new THREE.Vector3(0, 0, 0) },
    uImpulseRadius: { value: 0.45 }
  };

  const simMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VS,
    fragmentShader: SWE_SIM_FS,
    uniforms: simUniforms,
    depthTest: false,
    depthWrite: false
  });
  const simScene = new THREE.Scene();
  const simMesh = new THREE.Mesh(simGeo, simMat);
  simMesh.frustumCulled = false;
  simScene.add(simMesh);

  let currentTexture = stateTex;
  let refractionReady = false;
  let reflectionReady = false;

  function addDrop(worldX, worldZ, strength = 0.024, radius = 0.45) {
    simUniforms.uImpulse.value.set(worldX, worldZ, strength);
    simUniforms.uImpulseRadius.value = radius;
  }

  function resizeRefraction(w, h) {
    const rw = Math.max(128, Math.floor(w * 0.75));
    const rh = Math.max(128, Math.floor(h * 0.75));
    if (refractionTarget.width !== rw || refractionTarget.height !== rh) {
      refractionTarget.dispose();
      refractionTarget = new THREE.WebGLRenderTarget(rw, rh, {
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true
      });
      refractionTarget.depthTexture = new THREE.DepthTexture(rw, rh);
      refractionTarget.depthTexture.format = THREE.DepthFormat;
      refractionTarget.depthTexture.type = THREE.UnsignedIntType;
    }
    const refW = Math.max(128, Math.floor(w * 0.5));
    const refH = Math.max(128, Math.floor(h * 0.5));
    if (reflectionTarget.width !== refW || reflectionTarget.height !== refH) {
      reflectionTarget.dispose();
      reflectionTarget = new THREE.WebGLRenderTarget(refW, refH, {
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true
      });
    }
  }

  function step(renderer, time) {
    simUniforms.uTime.value = time;
    if (!renderer || typeof renderer.setRenderTarget !== 'function') {
      return currentTexture;
    }

    const prevTarget = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
    try {
      for (let sub = 0; sub < 2; sub++) {
        simUniforms.uStateTex.value = initializedOnGpu ? rtA.texture : stateTex;
        renderer.setRenderTarget(rtB);
        renderer.render(simScene, simCamera);

        const tmp = rtA;
        rtA = rtB;
        rtB = tmp;
        initializedOnGpu = true;
        simUniforms.uImpulse.value.z *= 0.35;
      }
      currentTexture = rtA.texture;
    } catch (_e) {
      currentTexture = stateTex;
    } finally {
      renderer.setRenderTarget(prevTarget);
    }
    return currentTexture;
  }

  function captureRefraction(renderer, scene, camera) {
    if (!renderer || !scene || !camera) return false;
    const waterRoot = scene.getObjectByName('streamWater');
    const puddleRoot = scene.getObjectByName('puddle');
    const terrainRoot = scene.getObjectByName('terrain');
    const padRoot = scene.getObjectByName('basePad');
    const wasWaterVis = waterRoot ? waterRoot.visible : true;
    const wasPuddleVis = puddleRoot ? puddleRoot.visible : true;
    const prevTarget = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
    try {
      // 1) 渲染水下河床、卵石、沉叶与溪石折射及真实深度纹理（隐藏水面本身）
      if (waterRoot) waterRoot.visible = false;
      if (puddleRoot) puddleRoot.visible = false;
      renderer.setRenderTarget(refractionTarget);
      renderer.clear();
      renderer.render(scene, camera);
      refractionReady = true;

      // 2) 渲染溪流斜面镜面反射缓冲（捕捉上方树冠与朱红鸟居倒影）
      camPos.setFromMatrixPosition(camera.matrixWorld);
      const e = camera.matrixWorld.elements;
      camFwd.set(-e[8], -e[9], -e[10]).normalize();
      camUp.set(e[4], e[5], e[6]).normalize();
      camTarget.copy(camPos).addScaledVector(camFwd, 12.0);

      // 以当前视角注视段的水面高度作为反射基准面
      const midZ = THREE.MathUtils.clamp(camPos.z * 0.45, -6.0, 10.5);
      planePoint.set(streamCenterX(midZ), waterY(midZ), midZ);

      const dPos = reflPos.copy(camPos).sub(planePoint).dot(planeNormal);
      reflPos.copy(camPos).addScaledVector(planeNormal, -2 * dPos);

      const dTgt = reflTarget.copy(camTarget).sub(planePoint).dot(planeNormal);
      reflTarget.copy(camTarget).addScaledVector(planeNormal, -2 * dTgt);

      const dUp = camUp.dot(planeNormal);
      reflUp.copy(camUp).addScaledVector(planeNormal, -2 * dUp).normalize();

      reflectionCamera.fov = camera.fov;
      reflectionCamera.aspect = camera.aspect || 1.77;
      reflectionCamera.near = camera.near;
      reflectionCamera.far = camera.far;
      reflectionCamera.position.copy(reflPos);
      reflectionCamera.up.copy(reflUp);
      reflectionCamera.lookAt(reflTarget);
      reflectionCamera.updateMatrixWorld(true);
      reflectionCamera.updateProjectionMatrix();

      // 隐藏地形底壳与底座，防止水下背面遮挡反射相机视线，让反射相机直接拍到上方树木与朱红鸟居
      const wasTerrainVis = terrainRoot ? terrainRoot.visible : true;
      const wasPadVis = padRoot ? padRoot.visible : true;
      if (terrainRoot) terrainRoot.visible = false;
      if (padRoot) padRoot.visible = false;

      renderer.setRenderTarget(reflectionTarget);
      renderer.clear();
      renderer.render(scene, reflectionCamera);
      reflectionReady = true;

      if (terrainRoot) terrainRoot.visible = wasTerrainVis;
      if (padRoot) padRoot.visible = wasPadVis;
    } catch (_e) {
      refractionReady = false;
      reflectionReady = false;
    } finally {
      if (waterRoot) waterRoot.visible = wasWaterVis;
      if (puddleRoot) puddleRoot.visible = wasPuddleVis;
      renderer.setRenderTarget(prevTarget);
    }
    return refractionReady;
  }

  sharedSimulator = {
    get texture() {
      return currentTexture;
    },
    get refractionColorTex() {
      return refractionTarget.texture;
    },
    get refractionDepthTex() {
      return refractionTarget.depthTexture;
    },
    get reflectionColorTex() {
      return reflectionTarget.texture;
    },
    get hasRefraction() {
      return refractionReady;
    },
    get hasReflection() {
      return reflectionReady;
    },
    obstacleTex,
    domainMin,
    domainMax,
    stateData,
    obstacleData,
    addDrop,
    resizeRefraction,
    step,
    captureRefraction
  };
  return sharedSimulator;
}
