// 四阶段二维浅水方程（2D Shallow Water Equations / Wave PDE on GPU Texture）与深度折射管线
//
// 阶段一：搭建物理模拟管线（SWE on GPU Ping-Pong FBO Texture）
//   - 双缓冲浮点纹理（WebGLRenderTarget HalfFloatType, 128x256）：
//     * R 通道 = 当前水高扰动 h(x, z, t)
//     * G 通道 = 旧水高 h(x, z, t - dt)
//     * B 通道 = 地形/溪石障碍物掩码（0 = 水域，1 = 石块/岸壁障碍物）
//     * A 通道 = 流速/动量变化率与湍流涡度能量
//   - 模拟着色器（SWE_SIM_FS）：基于拉普拉斯算子与顺流平流项求解浅水波动方程；
//     遇障碍物（B > 0.5）强制反射波能并将法向速度置零，实现水流绕石碰撞、弓形激波与背水尾流；
//   - 交互输入机制：接收 Raycaster 射线命中点，在纹理上写入瞬时高斯水高增量激起动态交互波纹。
//
// 阶段三：深度图与折射缓冲通道（Depth Buffer & Refraction Pass）
//   - 在渲染水面之前，先隐藏水面网格，将河床（streamBed）、水中鹅卵石、沉叶与溪石（streamStones）
//     渲染到带 THREE.DepthTexture 的离屏缓冲（refractionTarget），供水面片元着色器计算真实水深
//     waterDepth = sceneDepth - waterSurfaceDepth、屏幕空间折射采样与岸边撞石泡沫。
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
  uniform vec4 uDomain;
  uniform float uTime;
  uniform float uDamping;
  uniform float uWaveSpeed;
  uniform vec3 uImpulse;
  uniform float uImpulseRadius;

  varying vec2 vUv;

  vec2 uvToWorld( vec2 uv ) {
    return vec2(
      mix( uDomain.x, uDomain.y, uv.x ),
      mix( uDomain.z, uDomain.w, uv.y )
    );
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
    vec2 advectUv = vUv - vec2( 0.0, uTexelSize.y * 0.36 );
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

    // 诺伊曼障碍物反射边界：碰撞石头（B > 0.5）时波浪反射并在迎水侧抬升弓形波
    float hN = oN > 0.5 ? hCurr * 0.96 + 0.0032 : nSample.r;
    float hS = oS > 0.5 ? hCurr * 0.92 - 0.0024 : sSample.r;
    float hE = oE > 0.5 ? hCurr * 0.94 : eSample.r;
    float hW = oW > 0.5 ? hCurr * 0.94 : wSample.r;

    float neighborAvg = ( hN + hS + hE + hW ) * 0.25;
    float velocity = ( hCurr - hPrev ) * uDamping + ( neighborAvg - hCurr ) * uWaveSpeed;
    float hNext = ( hCurr + velocity ) * uDamping;

    // 瀑布跌水与石块背水侧卡门涡街持续激励
    vec2 worldXZ = uvToWorld( vUv );
    float nearObstacle = clamp( oN + oS + oE + oW, 0.0, 1.0 );
    float wakeSource = sin( worldXZ.y * 9.2 - uTime * 6.4 + worldXZ.x * 6.8 ) * 0.0020 * nearObstacle;
    float cascadeWave = (
      sin( worldXZ.x * 10.5 + worldXZ.y * 5.8 - uTime * 8.2 ) * 0.6 +
      cos( worldXZ.x * 16.0 - worldXZ.y * 7.6 - uTime * 10.8 ) * 0.4
    ) * 0.0036 * cascadeSource;

    hNext += wakeSource + cascadeWave;

    // Raycast 实时交互波纹注入
    if ( uImpulse.z > 0.0001 ) {
      float dist = length( worldXZ - uImpulse.xy );
      if ( dist < uImpulseRadius ) {
        float phase = clamp( dist * 3.14159265 / uImpulseRadius, 0.0, 3.14159265 );
        hNext -= ( cos( phase ) + 1.0 ) * 0.5 * uImpulse.z;
      }
    }

    hNext = clamp( hNext, -0.042, 0.042 );

    // A 通道：记录流速变化率与障碍物激荡强度，驱动岸边与撞石泡沫
    float gradMag = length( vec2( hE - hW, hN - hS ) ) * 18.0;
    float agitation = clamp(
      abs( hNext - hCurr ) * 40.0 + gradMag * 0.62 + nearObstacle * 0.52 + cascadeSource * 0.58,
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
      if (dz < cas.halfSpan * 1.45) {
        const w = 1 - dz / (cas.halfSpan * 1.45);
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
        } else if (d < ob.r * 1.65) {
          stoneProx = Math.max(stoneProx, 1 - (d - ob.r * 0.92) / (ob.r * 0.73));
        }
      }

      const initWave = isObstacle > 0.5
        ? 0
        : (Math.sin(z * 4.2 + x * 3.1) * 0.003 + Math.cos(z * 7.5 - x * 5.2) * 0.002) * (1 + casFactor * 0.8);

      stateData[idx] = initWave;
      stateData[idx + 1] = initWave * 0.96;
      stateData[idx + 2] = isObstacle;
      stateData[idx + 3] = isObstacle > 0.5 ? 0 : Math.min(1, casFactor * 0.65 + stoneProx * 0.55);

      obstacleData[idx] = 0;
      obstacleData[idx + 1] = 0;
      obstacleData[idx + 2] = isObstacle;
      obstacleData[idx + 3] = Math.min(1, casFactor * 0.85 + stoneProx * 0.45);
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
  const domainVec = new THREE.Vector4(SWE_DOMAIN.xMin, SWE_DOMAIN.xMax, SWE_DOMAIN.zMin, SWE_DOMAIN.zMax);

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

  // 阶段三：河床深度与折射离屏缓冲（Depth Buffer & Refraction Capture Target）
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

  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simGeo = new THREE.PlaneGeometry(2, 2);
  const simUniforms = {
    uStateTex: { value: stateTex },
    uObstacleTex: { value: obstacleTex },
    uTexelSize: { value: new THREE.Vector2(1 / SWE_TEX_WIDTH, 1 / SWE_TEX_HEIGHT) },
    uDomain: { value: domainVec },
    uTime: { value: 0 },
    uDamping: { value: 0.985 },
    uWaveSpeed: { value: 1.65 },
    uImpulse: { value: new THREE.Vector3(0, 0, 0) },
    uImpulseRadius: { value: 0.42 }
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

  function addDrop(worldX, worldZ, strength = 0.018, radius = 0.42) {
    simUniforms.uImpulse.value.set(worldX, worldZ, strength);
    simUniforms.uImpulseRadius.value = radius;
  }

  function resizeRefraction(w, h) {
    const rw = Math.max(64, Math.floor(w * 0.5));
    const rh = Math.max(64, Math.floor(h * 0.5));
    if (refractionTarget.width === rw && refractionTarget.height === rh) return;
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

  /**
   * 阶段三：渲染河床深度与水下场景折射图（隐藏水面网格后渲染一次河床与溪石）
   */
  function captureRefraction(renderer, scene, camera) {
    if (!renderer || !scene || !camera) return false;
    const waterRoot = scene.getObjectByName('streamWater');
    const wasVisible = waterRoot ? waterRoot.visible : true;
    const prevTarget = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
    try {
      if (waterRoot) waterRoot.visible = false;
      renderer.setRenderTarget(refractionTarget);
      renderer.clear();
      renderer.render(scene, camera);
      refractionReady = true;
    } catch (_e) {
      refractionReady = false;
    } finally {
      if (waterRoot) waterRoot.visible = wasVisible;
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
    get hasRefraction() {
      return refractionReady;
    },
    obstacleTex,
    domain: domainVec,
    stateData,
    obstacleData,
    addDrop,
    resizeRefraction,
    step,
    captureRefraction
  };
  return sharedSimulator;
}
