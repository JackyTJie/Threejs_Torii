// 分区水动力学山涧浅溪模拟系统（Zoned Mountain Stream Hydrodynamics & SWE on GPU Texture）
//
// 针对山涧溪流地形落差（z: -14.5 → +14.5，总落差 4.23m）、6 级小瀑布跌水（STREAM_CASCADES）与
// 溪内乱石（STREAM_STONES + 叠石堰）的精确空间坐标，先离线解算全流域水动力学分区场（uObstacleTex），
// 再在 GPU Ping-Pong FBO 中按分区物理规律迭代求解水面波场，彻底消除「大海长波浪」感：
//
// 【五类水文分区场编码（uObstacleTex 128×256 FloatTexture）】
//   - R 通道 (flowDirX)：含绕石势流偏转（Potential Flow Dipole Deflection）的局部单位流向 X 分量（范围映射到 [0, 1]）；
//   - G 通道 (regimeSpeed)：局部水动力流速与湍急度（0.15 = 平缓深潭区，0.55 = 束水湍急段/分流加速区，0.95 = 瀑布跌水/迎石激荡区）；
//   - B 通道 (obstacleAndSplash)：
//       * B > 0.75：出水岩石与岸壁实体障碍物（严格反射边界）；
//       * B ∈ (0.05, 0.70]：石头迎水驻点激荡区（Bow Splash Cushion）与小瀑布落水潭冲击水跃区（Plunge Pool Hydraulic Jump）；
//   - A 通道 (vortexAndSplit)：
//       * 石头背水侧卡门涡街漩涡区（Kármán Vortex Street / Recirculation Eddy）与两侧八字绕流剪切带（Bifurcation Shear）。
import * as THREE from 'three';
import {
  CONTENT_HALF,
  STREAM_CASCADES,
  streamBankHalf,
  streamCenterX,
  terrainHeight,
  valleyLevel,
  waterY
} from '../layout.js';
import { getStreamObstacles } from '../assets/stream.js';

export const SWE_TEX_WIDTH = 128;
export const SWE_TEX_HEIGHT = 256;

export const SWE_DOMAIN = {
  xMin: -7.2,
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
    vec4 hydro = texture2D( uObstacleTex, vUv );
    float flowDirX = hydro.r * 2.0 - 1.0;
    float flowDirZ = sqrt( max( 0.05, 1.0 - flowDirX * flowDirX ) );
    vec2 flowDir = normalize( vec2( flowDirX, flowDirZ ) );
    float regimeSpeed = hydro.g; // 0.15=平缓深潭, 0.55=湍急/分流, 0.95=瀑布/激荡
    float obsSplash = hydro.b;   // >0.75=岩石实体, 0.05~0.70=迎水激荡与瀑布水跃
    float vortexIntensity = hydro.a; // 石后卡门涡街与回流漩涡强度

    // 1) 障碍物硬边界约束：石头内部水高置 0
    if ( obsSplash > 0.75 ) {
      gl_FragColor = vec4( 0.0, 0.0, 1.0, 0.0 );
      return;
    }

    float splashMask = clamp( obsSplash / 0.65, 0.0, 1.0 );

    // 2) 沿局部真实流线方向（含绕石分流偏转角）进行半拉格朗日平流采样
    vec2 advectStep = vec2( flowDir.x * uTexelSize.x, flowDir.y * uTexelSize.y ) * ( 0.22 + 0.65 * regimeSpeed );
    vec2 advectUv = vUv - advectStep;
    vec4 center = texture2D( uStateTex, advectUv );
    float hCurr = center.r;
    float hPrev = center.g;

    vec2 dx = vec2( uTexelSize.x, 0.0 );
    vec2 dy = vec2( 0.0, uTexelSize.y );

    vec4 nSample = texture2D( uStateTex, advectUv + dy );
    vec4 sSample = texture2D( uStateTex, advectUv - dy );
    vec4 eSample = texture2D( uStateTex, advectUv + dx );
    vec4 wSample = texture2D( uStateTex, advectUv - dx );

    float oN = step( 0.75, texture2D( uObstacleTex, vUv + dy ).b );
    float oS = step( 0.75, texture2D( uObstacleTex, vUv - dy ).b );
    float oE = step( 0.75, texture2D( uObstacleTex, vUv + dx ).b );
    float oW = step( 0.75, texture2D( uObstacleTex, vUv - dx ).b );

    // 诺伊曼障碍物反射边界：碰撞石头迎水面抬升驻波水枕（Bow Wave），背水面微凹下陷
    float hN = oN > 0.5 ? hCurr * 0.95 + 0.0048 : nSample.r;
    float hS = oS > 0.5 ? hCurr * 0.90 - 0.0038 : sSample.r;
    float hE = oE > 0.5 ? hCurr * 0.94 + 0.0022 : eSample.r;
    float hW = oW > 0.5 ? hCurr * 0.94 + 0.0022 : wSample.r;

    float neighborAvg = ( hN + hS + hE + hW ) * 0.25;
    // 平缓深潭阻尼高（水面如明镜微澜），湍急段波速快
    float localDamping = mix( 0.992, 0.978, regimeSpeed );
    float velocity = ( hCurr - hPrev ) * localDamping + ( neighborAvg - hCurr ) * uWaveSpeed * ( 0.75 + 0.45 * regimeSpeed );
    float hNext = ( hCurr + velocity ) * localDamping;

    vec2 worldXZ = uvToWorld( vUv );
    float along = dot( worldXZ, flowDir );
    float crossCoord = dot( worldXZ, vec2( -flowDir.y, flowDir.x ) );

    // 3) 分区差异化波源激励（彻底摒弃全流域大振幅正弦海浪）：
    // (a) 迎水驻点与瀑布跌水激荡区：高频水跃震荡与迎石水枕隆起
    float splashSource = (
      sin( crossCoord * 18.0 + along * 12.0 - uTime * 11.5 ) * 0.55 +
      cos( crossCoord * 25.0 - along * 16.0 - uTime * 14.2 ) * 0.45 +
      0.38
    ) * 0.0052 * splashMask;

    // (b) 石后卡门涡街与潭侧回流漩涡区：交替脱落的旋转凹陷涡核（Vortex Dimples）
    float vortexAngle = atan( crossCoord, along ) * 2.0 - uTime * 6.4 + length( worldXZ ) * 9.5;
    float vortexSource = (
      sin( vortexAngle ) * 0.65 - 0.35
    ) * 0.0038 * vortexIntensity;

    // (c) 束水湍急段与绕石分流加速区：细密鱼鳞状急流斜波（Chevron Riffles）
    float rapidMask = smoothstep( 0.32, 0.78, regimeSpeed ) * ( 1.0 - splashMask * 0.6 );
    float rapidRiffle = (
      sin( along * 11.5 + abs( crossCoord ) * 9.2 - uTime * 8.4 ) * 0.6 +
      cos( along * 16.2 - crossCoord * 12.4 - uTime * 10.6 ) * 0.4
    ) * 0.0022 * rapidMask;

    // (d) 平缓深潭区：极微弱的林间清风细纹（振幅仅 0.3mm，绝无大海浪感）
    float poolCalmMask = 1.0 - smoothstep( 0.18, 0.48, regimeSpeed );
    float poolWhisper = sin( along * 6.5 - uTime * 2.8 + crossCoord * 4.2 ) * 0.00035 * poolCalmMask;

    hNext += splashSource + vortexSource + rapidRiffle + poolWhisper;

    // 指针射线交互波纹注入
    if ( uImpulse.z > 0.0001 ) {
      float dist = length( worldXZ - uImpulse.xy );
      if ( dist < uImpulseRadius ) {
        float phase = clamp( dist * 3.14159265 / uImpulseRadius, 0.0, 3.14159265 );
        hNext -= ( cos( phase ) + 1.0 ) * 0.5 * uImpulse.z;
      }
    }

    hNext = clamp( hNext, -0.048, 0.048 );

    // A 通道输出综合激荡/水花/涡旋强度供片元着色器精细渲染
    float gradMag = length( vec2( hE - hW, hN - hS ) ) * 14.0;
    float agitation = clamp(
      splashMask * 0.85 + vortexIntensity * 0.45 + rapidMask * 0.25 + gradMag * 0.25,
      0.0,
      1.0
    );

    gl_FragColor = vec4( hNext, hCurr, 0.0, agitation );
  }
`;

/**
 * 离线精确计算小溪全流域每个网格点的：
 * 1) 地形落差坡度（dValley/dz）与河宽束水比；
 * 2) 6 级小瀑布跌水口加速区与落水潭水跃激荡区；
 * 3) 每块溪石（STREAM_STONES）与叠石堰的相对流向坐标 (s_parallel, s_perp)：
 *    - 迎水驻点水花区（s_parallel < 0）
 *    - 左右两侧势流绕石分流偏转角（Potential Flow Dipole Deflection）
 *    - 背水侧卡门涡街漩涡区（s_parallel > 0）
 */
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

    // 计算当前断面中心线的切线流向 (txBase, tzBase) 与河床坡降落差率 slope
    const dzEps = 0.15;
    const dxCenter = (streamCenterX(z + dzEps) - streamCenterX(z - dzEps)) / (2 * dzEps);
    const invLen = 1 / Math.hypot(dxCenter, 1);
    const txBase = dxCenter * invLen;
    const tzBase = invLen;
    const nxBase = tzBase;
    const nzBase = -txBase;

    const localDropSlope = Math.max(0, (valleyLevel(z - dzEps) - valleyLevel(z + dzEps)) / (2 * dzEps));
    // 河道越窄（half 小）、坡降越大（localDropSlope 大），基础流速越高
    const widthConstrict = Math.max(0, Math.min(1, (0.92 - half) / 0.28));
    const slopeFactor = Math.max(0, Math.min(1, (localDropSlope - 0.085) / 0.45));

    // 小瀑布跌水与落水潭水跃激荡区计算
    let cascadeRapid = 0;
    let cascadePlungeSplash = 0;
    let cascadePoolVortex = 0;
    for (const cas of STREAM_CASCADES) {
      const relZ = z - cas.z; // <0 为瀑布唇口上游，>0 为落水潭下游
      if (relZ >= -cas.halfSpan * 1.1 && relZ <= cas.halfSpan * 0.9) {
        const w = 1 - Math.abs(relZ) / (cas.halfSpan * 1.1);
        cascadeRapid = Math.max(cascadeRapid, w);
      }
      // 瀑布正下方落水冲击点（z ∈ [cas.z - 0.08, cas.z + 0.48]）：强烈激荡水花
      if (relZ >= -0.10 && relZ <= 0.52) {
        const p = 1 - Math.abs(relZ - 0.18) / 0.34;
        if (p > 0) cascadePlungeSplash = Math.max(cascadePlungeSplash, p * p);
      }
      // 瀑布落水潭两侧（z ∈ [cas.z + 0.20, cas.z + 0.95]）：回流漩涡区
      if (relZ >= 0.18 && relZ <= 0.98) {
        const e = 1 - Math.abs(relZ - 0.55) / 0.42;
        if (e > 0) cascadePoolVortex = Math.max(cascadePoolVortex, e);
      }
    }

    for (let ix = 0; ix < SWE_TEX_WIDTH; ix++) {
      const u = (ix + 0.5) / SWE_TEX_WIDTH;
      const x = SWE_DOMAIN.xMin + (SWE_DOMAIN.xMax - SWE_DOMAIN.xMin) * u;
      const idx = (iy * SWE_TEX_WIDTH + ix) * 4;

      const ground = terrainHeight(x, z);
      let isSolidObstacle = ground >= wy + 0.015 || Math.abs(x - cx) > half + 0.35;

      let flowX = txBase;
      let flowZ = tzBase;
      let bowSplash = 0;
      let splitSpeedBoost = 0;
      let wakeVortex = 0;

      // 遍历每块溪石与叠石堰，解算局部势流绕流分流场、迎水激荡水花与背水卡门涡街
      for (const ob of obstacles) {
        const rx = x - ob.x;
        const rz = z - ob.z;
        const dist = Math.hypot(rx, rz);
        const R = ob.r * 0.92;
        if (dist < R) {
          isSolidObstacle = true;
          break;
        }
        if (dist < R * 3.8) {
          // 投影到局部流向坐标系：sPar 沿水流方向（<0 迎水，>0 背水），sPerp 垂直水流方向（左右两翼）
          const sPar = rx * txBase + rz * tzBase;
          const sPerp = rx * nxBase + rz * nzBase;

          // 1) 迎水驻点与激荡水花区（sPar ∈ [-1.65R, -0.75R]，|sPerp| < 1.15R）
          if (sPar < -R * 0.65 && sPar > -R * 1.85 && Math.abs(sPerp) < R * 1.25) {
            const kFront = (1 - Math.abs(sPar + R * 1.15) / (R * 0.72)) * (1 - Math.abs(sPerp) / (R * 1.25));
            if (kFront > 0) bowSplash = Math.max(bowSplash, kFront * (ob.isWeir ? 0.75 : 1.0));
          }

          // 2) 石头两侧八字分流加速区（圆柱势流偶极子偏转：水流遇石自动向左右两侧分流绕行）
          const r2 = Math.max(R * R, dist * dist);
          const dipoleFactor = (R * R) / r2;
          const sideSign = sPerp >= 0 ? 1 : -1;
          // 迎水与侧翼（sPar < 1.2R）向外偏转分流，背水侧（sPar > 1.2R）向中心回流卷入涡街
          const deflectLat = sPar < R * 1.1
            ? sideSign * dipoleFactor * 0.95 * Math.exp(-Math.max(0, -sPar - R) * 1.8)
            : -sideSign * dipoleFactor * 0.45 * Math.exp(-(sPar - R) * 1.2);
          flowX += nxBase * deflectLat;
          flowZ += nzBase * deflectLat;

          if (Math.abs(sPar) < R * 1.35 && Math.abs(sPerp) >= R * 0.85 && Math.abs(sPerp) <= R * 2.1) {
            const kSplit = 1 - Math.abs(Math.abs(sPerp) - R * 1.35) / (R * 0.75);
            if (kSplit > 0) splitSpeedBoost = Math.max(splitSpeedBoost, kSplit * 0.42);
          }

          // 3) 石头背水侧卡门涡街漩涡区（sPar ∈ [0.75R, 3.4R]，|sPerp| < 1.35R）
          if (sPar > R * 0.75 && sPar < R * 3.5 && Math.abs(sPerp) < R * 1.35) {
            const kWake = (1 - (sPar - R * 0.75) / (R * 2.75)) * (1 - Math.abs(sPerp) / (R * 1.35));
            if (kWake > 0) wakeVortex = Math.max(wakeVortex, kWake * 0.92);
          }
        }
      }

      const fLen = Math.hypot(flowX, flowZ) || 1;
      flowX /= fLen;
      flowZ /= fLen;

      // 岸边弯道凹岸/石湾回流漩涡补充
      const bankRatio = Math.abs(x - cx) / Math.max(0.25, half);
      const poolEdgeEddy = cascadePoolVortex * Math.max(0, Math.min(1, (bankRatio - 0.35) / 0.55)) * 0.65;

      // 综合流速分区 regimeSpeed：
      // 平缓深潭 ≈ 0.16~0.28，束水急流/石头分流 ≈ 0.48~0.72，小瀑布与迎水激荡 ≈ 0.82~0.98
      const regimeSpeed = isSolidObstacle
        ? 0
        : Math.min(
          0.98,
          0.16 +
            slopeFactor * 0.38 +
            widthConstrict * 0.18 +
            cascadeRapid * 0.42 +
            splitSpeedBoost +
            bowSplash * 0.25
        );

      const splashAndObstacle = isSolidObstacle
        ? 1.0
        : Math.min(0.68, Math.max(bowSplash * 0.64, cascadePlungeSplash * 0.66));

      const vortexAndSplit = isSolidObstacle
        ? 0.0
        : Math.min(1.0, Math.max(wakeVortex, poolEdgeEddy, splitSpeedBoost * 0.85));

      const initWave = isSolidObstacle
        ? 0
        : (Math.sin(z * 8.5 + x * 6.2) * 0.004 * regimeSpeed + bowSplash * 0.008);

      stateData[idx] = initWave;
      stateData[idx + 1] = initWave * 0.95;
      stateData[idx + 2] = isSolidObstacle ? 1.0 : 0.0;
      stateData[idx + 3] = isSolidObstacle ? 0.0 : Math.min(1, splashAndObstacle + vortexAndSplit * 0.5);

      obstacleData[idx] = Math.max(0, Math.min(1, flowX * 0.5 + 0.5));
      obstacleData[idx + 1] = regimeSpeed;
      obstacleData[idx + 2] = splashAndObstacle;
      obstacleData[idx + 3] = vortexAndSplit;
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

  // 1) 河床深度与折射离屏缓冲
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

  // 2) 实时水面镜面反射离屏缓冲
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
    uWaveSpeed: { value: 1.68 },
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
  let reflectionReady = false;

  function addDrop(worldX, worldZ, strength = 0.022, radius = 0.42) {
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
      if (waterRoot) waterRoot.visible = false;
      if (puddleRoot) puddleRoot.visible = false;
      renderer.setRenderTarget(refractionTarget);
      renderer.clear();
      renderer.render(scene, camera);
      refractionReady = true;

      camPos.setFromMatrixPosition(camera.matrixWorld);
      const e = camera.matrixWorld.elements;
      camFwd.set(-e[8], -e[9], -e[10]).normalize();
      camUp.set(e[4], e[5], e[6]).normalize();
      camTarget.copy(camPos).addScaledVector(camFwd, 12.0);

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
    get hydroMap() {
      return obstacleTex;
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
