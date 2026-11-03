// 分区水动力学与粒子化飞沫山涧溪流着色器系统（Particle-ized Mountain Stream & Cascade Shader System）：
//
// 复现参考图 1/3/4/5 的「清潭透底 + 叠瀑分股水帘 + 落水潭翻涌气泡粒子 + 乱石急流飞沫」视觉效果：
//   1. 平缓深潭区（Calm Clear Pools）：
//      水质澄澈透底（清晰展现水底卵石、砂洲与沉叶），表面叠加 5 组非共线方向动态微水波，
//      波峰相长干涉处泛起细碎晶莹的菱形粼粼波光，彻底消除生硬的平行白色长条带；
//   2. 6 级叠瀑水帘（Cascade Water Curtains, uOverlayMode == 1）：
//      模拟图 1 中水流翻越石堰时分裂出的多股下坠水柱丝缕（waterStrands）与飞溅水珠颗粒（dropletBeads）；
//   3. 落水潭翻滚气泡白沫与乱石激流飞沫（Plunge-Pool Cellular Foam & Boulder Spray）：
//      在瀑布落水口、岩石迎水面与束水急流槽处，采用双层对流蜂窝气泡簇（cellularFoam）与高频飞沫粒子点阵（sprayParticles），
//      与三维空间中的 2,160 颗 InstancedMesh 水珠/白沫粒子无缝融合。

export const WATER_SWE_VERT_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uSweTex;
  uniform sampler2D uHydroTex;
  uniform vec2 uSweDomainMin;
  uniform vec2 uSweDomainMax;
  uniform vec2 uSweTexel;
  uniform float uSweDisplaceScale;
  varying vec3 vSweNormal;
  varying float vSweAgitation;
  varying float vSweObstacle;
  varying vec4 vWaterClipPos;
  varying float vWaveCrest;
  varying vec4 vHydroData;
`;

export const WATER_SWE_VERT_DISPLACE = /* glsl */ `
  vec4 sweWorldTmp = modelMatrix * vec4( transformed, 1.0 );
  vec2 sweSpan = max( vec2( 0.001 ), uSweDomainMax - uSweDomainMin );
  vec2 sweUv = clamp( ( sweWorldTmp.xz - uSweDomainMin ) / sweSpan, 0.0, 1.0 );
  vec4 sweSample = texture2D( uSweTex, sweUv );
  vec4 hydroSample = texture2D( uHydroTex, sweUv );
  vHydroData = hydroSample;

  float sweHL = texture2D( uSweTex, sweUv - vec2( uSweTexel.x, 0.0 ) ).r;
  float sweHR = texture2D( uSweTex, sweUv + vec2( uSweTexel.x, 0.0 ) ).r;
  float sweHD = texture2D( uSweTex, sweUv - vec2( 0.0, uSweTexel.y ) ).r;
  float sweHU = texture2D( uSweTex, sweUv + vec2( 0.0, uSweTexel.y ) ).r;

  float flowDirX = hydroSample.r * 2.0 - 1.0;
  float flowDirZ = sqrt( max( 0.05, 1.0 - flowDirX * flowDirX ) );
  vec2 localFlowDir = normalize( vec2( flowDirX, flowDirZ ) );
  vec2 localCrossDir = vec2( -localFlowDir.y, localFlowDir.x );
  float regimeSpeed = hydroSample.g;
  float isSolidObs = step( 0.75, hydroSample.b );
  float splashZone = clamp( hydroSample.b / 0.65, 0.0, 1.0 ) * ( 1.0 - isSolidObs );
  float vortexZone = hydroSample.a * ( 1.0 - isSolidObs );

  vec2 wp = sweWorldTmp.xz;
  float sAlong = dot( wp, localFlowDir );
  float sCross = dot( wp, localCrossDir );

  float approxCx = -3.25 + 0.58 * sin( wp.y * 0.36 + 0.5 ) + 0.28 * cos( wp.y * 0.21 - 0.8 );
  float bankDistV = abs( wp.x - approxCx );
  float bankWaveMask = smoothstep( 0.32, 0.88, bankDistV );
  float stoneWaveMask = clamp( splashZone * 1.35 + vortexZone * 1.15 + smoothstep( 0.38, 0.78, regimeSpeed ) * 0.65, 0.0, 1.0 );
  float activeWaveletZone = clamp( max( bankWaveMask * 0.85, stoneWaveMask ), 0.0, 1.0 );

  // 1) 湍急段与八字分流区的细密交织急流波
  float rapidWeight = smoothstep( 0.26, 0.74, regimeSpeed );
  float chevronPhase1 = sAlong * 18.5 + abs( sCross ) * 14.0 - uTime * ( 6.5 + 4.5 * regimeSpeed );
  float chevronPhase2 = sAlong * 26.0 - sCross * 19.5 - uTime * ( 8.8 + 5.2 * regimeSpeed );
  float rapidWaveY = ( sin( chevronPhase1 ) * 0.0052 + cos( chevronPhase2 ) * 0.0036 ) * rapidWeight;

  // 2) 多方向交叉微水波（消除平行条带）
  float bankRipple1 = sin( ( sAlong * 0.85 + sCross * 0.52 ) * 24.0 - uTime * 7.4 );
  float bankRipple2 = cos( ( sAlong * 0.64 - sCross * 0.77 ) * 29.0 - uTime * 8.6 );
  float bankRipple3 = sin( ( -sAlong * 0.42 + sCross * 0.91 ) * 34.0 + uTime * 9.8 );
  float edgeWaveletY = ( bankRipple1 * 0.0032 + bankRipple2 * 0.0028 + bankRipple3 * 0.0022 ) * activeWaveletZone;

  // 3) 石头迎水驻波水枕与小瀑布落水激荡水跃
  float splashChop = sin( wp.x * 24.0 + wp.y * 20.0 - uTime * 11.5 ) * cos( wp.x * 19.0 - wp.y * 25.0 - uTime * 13.0 );
  float bowAndPlungeY = splashZone * ( 0.014 + 0.009 * splashChop );

  // 4) 石后卡门涡街与潭湾漩涡微凹
  float vortexDimpleY = vortexZone * ( -0.0045 + 0.0032 * sin( sAlong * 22.0 + sCross * 22.0 - uTime * 9.5 ) );

  // 5) 中央平缓深潭微澜
  float calmRippleY = sin( sAlong * 9.5 - uTime * 3.2 + sCross * 6.0 ) * 0.0012 * ( 1.0 - activeWaveletZone * 0.65 );

  float sweMask = ( 1.0 - isSolidObs ) * step( 0.01, uSweDisplaceScale );
  float zonedWaveY = rapidWaveY + edgeWaveletY + bowAndPlungeY + vortexDimpleY + calmRippleY;
  float totalDispY = ( sweSample.r * uSweDisplaceScale * 1.15 + zonedWaveY ) * sweMask;

  transformed.y += totalDispY;

  vec2 worldStep = sweSpan * uSweTexel * 2.0;
  float dSweDx = ( sweHR - sweHL ) * uSweDisplaceScale * 1.15 / max( 0.01, worldStep.x );
  float dSweDz = ( sweHU - sweHD ) * uSweDisplaceScale * 1.15 / max( 0.01, worldStep.y );

  float dRapidDAlong = ( cos( chevronPhase1 ) * 18.5 * 0.0052 - sin( chevronPhase2 ) * 26.0 * 0.0036 ) * rapidWeight
                     + ( cos( ( sAlong * 0.85 + sCross * 0.52 ) * 24.0 - uTime * 7.4 ) * 20.0 * 0.0032 ) * activeWaveletZone;
  float dRapidDCross = ( cos( chevronPhase1 ) * 14.0 * sign( sCross ) * 0.0052 + sin( chevronPhase2 ) * 19.5 * 0.0036 ) * rapidWeight
                     - ( sin( ( sAlong * 0.64 - sCross * 0.77 ) * 29.0 - uTime * 8.6 ) * 22.0 * 0.0028 ) * activeWaveletZone;
  float dSplashDx = splashZone * 0.009 * 22.0 * cos( wp.x * 24.0 + wp.y * 20.0 - uTime * 11.5 );
  float dSplashDz = splashZone * 0.009 * 20.0 * sin( wp.x * 19.0 - wp.y * 25.0 - uTime * 13.0 );

  float dZonedDx = localFlowDir.x * dRapidDAlong + localCrossDir.x * dRapidDCross + dSplashDx;
  float dZonedDz = localFlowDir.y * dRapidDAlong + localCrossDir.y * dRapidDCross + dSplashDz;

  vSweNormal = normalize( vec3(
    -( dSweDx + dZonedDx * sweMask ),
    1.0,
    -( dSweDz + dZonedDz * sweMask )
  ) );
  vSweAgitation = max( sweSample.a, splashZone * 0.92 + vortexZone * 0.55 + activeWaveletZone * 0.48 );
  vSweObstacle = isSolidObs;
  vWaveCrest = clamp( totalDispY * 32.0 + 0.5, 0.0, 1.0 );
`;

export const WATER_SWE_VERT_CLIP = /* glsl */ `
  vWaterClipPos = gl_Position;
`;

export const WATER_FLOW_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform vec2 uFlowDir;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform float uFlowScale;
  uniform float uFlowStrength;
  uniform float uOverlayMode;
  uniform vec3 uWaterSunDir;
  uniform float uWaterDayFactor;
  uniform sampler2D uSweTex;
  uniform sampler2D uHydroTex;
  uniform vec2 uSweDomainMin;
  uniform vec2 uSweDomainMax;
  uniform vec2 uSweTexel;
  uniform sampler2D tRefractionColor;
  uniform sampler2D tRefractionDepth;
  uniform sampler2D tReflectionColor;
  uniform float uHasRefraction;
  uniform float uHasReflection;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uExtinctionDensity;
  uniform float uShoreFoamThreshold;
  varying vec3 vSweNormal;
  varying float vSweAgitation;
  varying float vSweObstacle;
  varying vec4 vWaterClipPos;
  varying float vWaveCrest;
  varying vec4 vHydroData;
`;

export const WATER_FLOW_FRAG = /* glsl */ `
  float waterHash21( vec2 p ) {
    p = fract( p * vec2( 123.34, 456.21 ) );
    p += dot( p, p + 45.32 );
    return fract( p.x * p.y );
  }

  float waterNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    float a = waterHash21( i );
    float b = waterHash21( i + vec2( 1.0, 0.0 ) );
    float c = waterHash21( i + vec2( 0.0, 1.0 ) );
    float d = waterHash21( i + vec2( 1.0, 1.0 ) );
    return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
  }

  float waterFbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2( 0.80, -0.60, 0.60, 0.80 );
    for ( int i = 0; i < 4; i++ ) {
      v += a * waterNoise( p );
      p = rot * p * 2.03 + vec2( 13.7, -9.2 );
      a *= 0.5;
    }
    return v;
  }

  /**
   * 粒子化蜂窝气泡与飞溅水珠场（复现参考图 1/3/4/5 中瀑布落水潭与岩石激流的颗粒状翻涌白水）：
   * 结合 Voronoi 气蚀泡孔与高速对流水珠点阵，呈现真实碎珠飞沫质感而非平滑色块。
   */
  float evalParticleFoamField( vec2 flowUv, float time ) {
    // 1) 翻滚气泡团网络（气泡边缘白沫聚集、泡心微透水色，如图 1 落水潭前缘）
    vec2 cellUv1 = flowUv * vec2( 9.5, 6.2 ) + vec2( 0.0, -time * 3.8 );
    vec2 cellUv2 = flowUv * vec2( 18.0, 11.5 ) + vec2( 3.7, -time * 5.6 );
    float n1 = waterNoise( cellUv1 );
    float n2 = waterNoise( cellUv2 );
    float bubbleWeb = 1.0 - abs( n1 * 2.0 - 1.0 );
    float fineBubbles = smoothstep( 0.42, 0.85, bubbleWeb * 0.65 + n2 * 0.35 );

    // 2) 高速飞溅水珠颗粒点阵（Particle Droplet Speckles）
    vec2 dropGrid = flowUv * vec2( 32.0, 16.0 ) + vec2( sin( flowUv.y * 8.0 ) * 0.8, -time * 8.5 );
    vec2 dCell = floor( dropGrid );
    vec2 dFrac = fract( dropGrid ) - 0.5;
    float dSeed = waterHash21( dCell );
    float droplet = step( 0.62, dSeed ) * ( 1.0 - smoothstep( 0.06, 0.36, length( dFrac ) ) );

    return clamp( fineBubbles * 0.72 + droplet * 0.58, 0.0, 1.0 );
  }

  float linearizeDepth( float d, float zNear, float zFar ) {
    float zNdc = d * 2.0 - 1.0;
    return ( 2.0 * zNear * zFar ) / max( 0.0001, zFar + zNear - zNdc * ( zFar - zNear ) );
  }

  float streamApproxCenterX( float z ) {
    return -3.25 + 0.58 * sin( z * 0.36 + 0.5 ) + 0.28 * cos( z * 0.21 - 0.8 );
  }

  float canopySunWindow( vec3 worldPos, vec3 sunDir ) {
    vec3 toSun = normalize( -sunDir );
    float tCanopy = max( 0.0, ( 5.4 - worldPos.y ) / max( 0.25, toSun.y ) );
    vec2 canopyXZ = worldPos.xz + toSun.xz * tCanopy * 0.45;

    vec2 windShift = vec2( sin( uTime * 0.42 ) * 0.14, cos( uTime * 0.36 ) * 0.10 );
    float macroGap = waterFbm( canopyXZ * 0.68 + windShift );
    float leafGap = waterNoise( canopyXZ * 2.35 - windShift * 1.6 );

    float sunBeam1 = exp( -length( worldPos.xz - vec2( -3.1, 6.2 ) ) * 0.48 );
    float sunBeam2 = exp( -length( worldPos.xz - vec2( -3.5, 2.3 ) ) * 0.52 );
    float sunBeam3 = exp( -length( worldPos.xz - vec2( -2.8, -1.8 ) ) * 0.50 );
    float sunBeam4 = exp( -length( worldPos.xz - vec2( -3.3, 9.4 ) ) * 0.55 );
    float beamBoost = max( max( sunBeam1, sunBeam2 ), max( sunBeam3, sunBeam4 ) );

    float rawSun = macroGap * 0.62 + leafGap * 0.38 + beamBoost * 0.38;
    return smoothstep( 0.42, 0.70, rawSun );
  }

  vec2 zonedStreamWaveGradient( vec2 xz, vec2 localFlowDir, float regimeSpeed, float splashMask, float vortexMask, float bankWaveMask, float time ) {
    vec2 crossDir = vec2( -localFlowDir.y, localFlowDir.x );
    float sAlong = dot( xz, localFlowDir );
    float sCross = dot( xz, crossDir );

    if ( vortexMask > 0.05 ) {
      float swirlPhase = time * 3.8 + length( xz ) * 8.0;
      float cSwirl = cos( swirlPhase * vortexMask );
      float sSwirl = sin( swirlPhase * vortexMask );
      vec2 rotCoord = vec2( sCross * cSwirl - sAlong * sSwirl, sCross * sSwirl + sAlong * cSwirl );
      sCross = mix( sCross, rotCoord.x, vortexMask * 0.45 );
      sAlong = mix( sAlong, rotCoord.y, vortexMask * 0.45 );
    }

    float edgeWaveBoost = clamp( bankWaveMask * 0.85 + splashMask * 1.15 + vortexMask * 0.90, 0.0, 1.25 );
    float speedRate = time * ( 2.2 + 3.8 * regimeSpeed );
    vec2 q1 = vec2( sCross * ( 4.5 + 2.5 * regimeSpeed ), sAlong * 3.2 - speedRate );
    vec2 q2 = vec2( sCross * 9.8 - sin( sAlong * 4.2 - time * 2.8 ) * 0.65, sAlong * 7.4 - speedRate * 1.48 );
    vec2 q3 = vec2( sCross * 17.5 + cos( sAlong * 7.8 + time * 3.6 ) * 0.72, sAlong * 14.2 - speedRate * 2.05 );

    float eps = 0.035;
    float w1 = 0.38 * ( 0.45 + 0.55 * regimeSpeed );
    float w2 = 0.36 * ( 0.45 + 0.65 * regimeSpeed + 0.72 * edgeWaveBoost );
    float w3 = 0.28 * ( 0.30 + 1.05 * edgeWaveBoost );

    float h0 = waterFbm( q1 ) * w1 + waterFbm( q2 ) * w2 + waterNoise( q3 ) * w3;
    float hx = waterFbm( q1 + vec2( eps, 0.0 ) ) * w1 + waterFbm( q2 + vec2( eps, 0.0 ) ) * w2 + waterNoise( q3 + vec2( eps, 0.0 ) ) * w3;
    float hz = waterFbm( q1 + vec2( 0.0, eps ) ) * w1 + waterFbm( q2 + vec2( 0.0, eps ) ) * w2 + waterNoise( q3 + vec2( 0.0, eps ) ) * w3;

    vec2 pLocal = vec2( sCross, sAlong );
    float warp = ( h0 - 0.45 ) * 4.2;
    vec2 dA = vec2( 0.88, 0.47 );
    vec2 dB = vec2( -0.74, 0.67 );
    vec2 dC = vec2( 0.36, -0.93 );
    vec2 dD = vec2( -0.95, -0.31 );
    vec2 dE = vec2( 0.53, 0.85 );

    float phA = dot( pLocal, dA ) * 22.0 - time * 6.8 + warp;
    float phB = dot( pLocal, dB ) * 27.5 - time * 8.1 - warp * 0.85;
    float phC = dot( pLocal, dC ) * 33.0 + time * 9.4 + warp * 1.1;
    float phD = dot( pLocal, dD ) * 39.5 - time * 10.7 - warp * 0.9;
    float phE = dot( pLocal, dE ) * 46.0 + time * 12.1 + warp * 0.7;

    vec2 multiDirGrad = (
      dA * cos( phA ) * 0.24 +
      dB * cos( phB ) * 0.22 +
      dC * cos( phC ) * 0.20 +
      dD * cos( phD ) * 0.18 +
      dE * cos( phE ) * 0.16
    ) * ( 0.22 + 0.48 * edgeWaveBoost + 0.25 * regimeSpeed );

    vec2 localGrad = ( vec2( hx - h0, hz - h0 ) / eps ) * ( 0.14 + 0.18 * regimeSpeed + 0.22 * edgeWaveBoost ) + multiDirGrad;
    return crossDir * localGrad.x + localFlowDir * localGrad.y;
  }

  // 三维几何光追反射（严格修正所有 smoothstep 参数顺序）
  vec3 traceSceneReflectionRay( vec3 worldPos, vec3 R, float sunWindow ) {
    vec3 rd = normalize( vec3( R.x, max( 0.08, abs( R.y ) ), R.z ) );

    float tTree = ( 4.2 - worldPos.y ) / max( 0.12, rd.y );
    vec2 treeHitXZ = worldPos.xz + rd.xz * clamp( tTree, 0.5, 18.0 );
    vec2 canopySway = vec2( sin( uTime * 0.7 + treeHitXZ.y * 0.5 ), cos( uTime * 0.6 + treeHitXZ.x * 0.5 ) ) * 0.08;
    float foliage1 = waterFbm( treeHitXZ * 1.15 + canopySway );
    float foliage2 = waterFbm( treeHitXZ * 2.85 - canopySway * 1.4 );
    float skyHole = smoothstep( 0.68, 0.86, foliage1 * 0.65 + foliage2 * 0.35 );
    float trunkWave = pow( max( 0.0, sin( treeHitXZ.x * 2.6 + sin( treeHitXZ.y * 0.8 ) ) ), 8.0 );

    vec3 deepCanopy = vec3( 0.06, 0.15, 0.08 );
    vec3 midCanopy = vec3( 0.13, 0.28, 0.14 );
    vec3 sunlitMaple = vec3( 0.36, 0.58, 0.22 );
    vec3 barkTone = vec3( 0.11, 0.08, 0.06 );
    vec3 skyGapTone = vec3( 0.42, 0.54, 0.52 );

    vec3 envColor = mix( deepCanopy, midCanopy, smoothstep( 0.28, 0.65, foliage1 ) );
    envColor = mix( envColor, sunlitMaple, smoothstep( 0.55, 0.82, foliage2 ) * ( 0.35 + 0.65 * sunWindow ) );
    envColor = mix( envColor, barkTone, trunkWave * 0.45 );
    envColor = mix( envColor, skyGapTone, skyHole * 0.48 );

    vec3 toToriiCenter = normalize( vec3( 0.15 - worldPos.x, 3.85 - worldPos.y, -0.65 - worldPos.z ) );
    vec3 perturbedR = normalize( rd + vec3( R.x - rd.x, 0.0, R.z - rd.z ) * 1.35 );
    float toriiAlign = dot( perturbedR, toToriiCenter );

    float distToTorii = length( vec2( 0.15 - worldPos.x, -0.65 - worldPos.z ) );
    vec3 localRay = perturbedR - toToriiCenter * toriiAlign;
    float uTorii = localRay.x * distToTorii * 0.42 + ( R.x - toToriiCenter.x ) * 2.2;
    float vTorii = ( perturbedR.y - toToriiCenter.y * 0.55 ) * distToTorii * 0.38 + 0.48;

    float inToriiWindow = smoothstep( 0.45, 0.82, toriiAlign ) * ( 1.0 - smoothstep( 5.5, 12.5, abs( worldPos.z - 2.2 ) ) );
    if ( inToriiWindow > 0.001 ) {
      float waveShimmer = sin( worldPos.z * 14.0 - uTime * 5.6 + worldPos.x * 9.0 ) * 0.045;
      float uT = uTorii + waveShimmer;
      float vT = vTorii + cos( worldPos.x * 12.0 - uTime * 4.8 ) * 0.035;

      float postL1 = ( 1.0 - smoothstep( 0.05, 0.13, abs( uT + 0.48 ) ) ) * smoothstep( 0.0, 0.08, vT ) * ( 1.0 - smoothstep( 0.80, 0.88, vT ) );
      float postR1 = ( 1.0 - smoothstep( 0.05, 0.13, abs( uT - 0.48 ) ) ) * smoothstep( 0.0, 0.08, vT ) * ( 1.0 - smoothstep( 0.80, 0.88, vT ) );
      float postL2 = ( 1.0 - smoothstep( 0.04, 0.11, abs( uT + 0.34 ) ) ) * smoothstep( 0.05, 0.12, vT ) * ( 1.0 - smoothstep( 0.74, 0.82, vT ) );
      float postR2 = ( 1.0 - smoothstep( 0.04, 0.11, abs( uT - 0.34 ) ) ) * smoothstep( 0.05, 0.12, vT ) * ( 1.0 - smoothstep( 0.74, 0.82, vT ) );

      float nuki = ( 1.0 - smoothstep( 0.58, 0.72, abs( uT ) ) ) * ( 1.0 - smoothstep( 0.025, 0.07, abs( vT - 0.56 ) ) );
      float shimaki = ( 1.0 - smoothstep( 0.66, 0.82, abs( uT ) ) ) * ( 1.0 - smoothstep( 0.025, 0.065, abs( vT - 0.76 ) ) );
      float gakuzuka = ( 1.0 - smoothstep( 0.025, 0.07, abs( uT ) ) ) * smoothstep( 0.54, 0.58, vT ) * ( 1.0 - smoothstep( 0.74, 0.78, vT ) );

      float curveArch = 0.83 + 0.06 * uT * uT;
      float kasagi = ( 1.0 - smoothstep( 0.72, 0.90, abs( uT ) ) ) * ( 1.0 - smoothstep( 0.02, 0.06, abs( vT - curveArch ) ) );

      float vermilionHit = clamp( max( max( postL1, postR1 ), max( max( postL2, postR2 ), max( nuki, max( shimaki, gakuzuka ) ) ) ), 0.0, 1.0 );
      float blackHit = clamp( kasagi * ( 1.0 - vermilionHit * 0.5 ), 0.0, 1.0 );

      vec3 toriiRed = mix( vec3( 0.72, 0.16, 0.06 ), vec3( 0.92, 0.32, 0.12 ), 0.5 + 0.5 * sunWindow );
      vec3 toriiBlackCol = vec3( 0.08, 0.10, 0.12 );

      envColor = mix( envColor, toriiRed, vermilionHit * inToriiWindow * 0.85 );
      envColor = mix( envColor, toriiBlackCol, blackHit * inToriiWindow * 0.72 );
    }

    return envColor;
  }

  vec4 waterFlow( vec3 color, float baseAlpha, vec3 worldPos, vec3 normal, vec3 viewDir, vec2 localUv, float shadowMask ) {
    vec2 p = worldPos.xz;
    vec2 sweSpan = max( vec2( 0.001 ), uSweDomainMax - uSweDomainMin );
    vec2 sweUv = clamp( ( p - uSweDomainMin ) / sweSpan, 0.0, 1.0 );
    vec4 sweFrag = texture2D( uSweTex, sweUv );
    vec4 hydroFrag = texture2D( uHydroTex, sweUv );

    float flowDirX = hydroFrag.r * 2.0 - 1.0;
    float flowDirZ = sqrt( max( 0.05, 1.0 - flowDirX * flowDirX ) );
    vec2 localFlowDir = normalize( vec2( flowDirX, flowDirZ ) );
    vec2 localLatDir = vec2( -localFlowDir.y, localFlowDir.x );
    float regimeSpeed = hydroFrag.g;
    float isSolidObs = step( 0.75, hydroFrag.b );
    float splashMask = clamp( hydroFrag.b / 0.65, 0.0, 1.0 ) * ( 1.0 - isSolidObs );
    float vortexMask = hydroFrag.a * ( 1.0 - isSolidObs );

    float along = dot( p, localFlowDir );
    float lateral = dot( p, localLatDir );

    float cx = streamApproxCenterX( p.y );
    float bankDist = abs( p.x - cx );
    float isPuddle = step( uFlowSpeed, 0.08 );
    float inStream = ( 1.0 - isPuddle ) * ( 1.0 - smoothstep( 1.08, 1.45, bankDist ) );

    float bankWaveMask = smoothstep( 0.28, 0.84, bankDist ) * inStream;
    float stoneWaveMask = clamp( splashMask * 1.4 + vortexMask * 1.1 + smoothstep( 0.35, 0.75, regimeSpeed ) * 0.65, 0.0, 1.0 ) * inStream;
    float nearBankOrRock = clamp( max( bankWaveMask, stoneWaveMask ), 0.0, 1.0 );

    vec2 microGrad;
    if ( isPuddle > 0.5 ) {
      float pw1 = sin( dot( p, vec2( 16.5, 9.2 ) ) - uTime * 3.4 );
      float pw2 = sin( dot( p, vec2( -13.8, 14.6 ) ) + uTime * 4.1 );
      float pw3 = sin( dot( p, vec2( 7.4, -18.2 ) ) - uTime * 4.8 );
      float pw4 = sin( dot( p, vec2( -17.2, -8.5 ) ) + uTime * 5.3 );
      microGrad = vec2( pw1 * 0.28 - pw2 * 0.26 + pw4 * 0.22, pw2 * 0.26 - pw3 * 0.28 - pw1 * 0.20 ) * 0.085;
    } else {
      microGrad = zonedStreamWaveGradient( p, localFlowDir, regimeSpeed, splashMask, vortexMask, bankWaveMask, uTime );
    }
    vec3 sweN = ( isPuddle < 0.5 && length( vSweNormal ) > 0.1 ) ? vSweNormal : vec3( 0.0, 1.0, 0.0 );
    vec3 nrm = normalize( normal + ( sweN - vec3( 0.0, 1.0, 0.0 ) ) * 1.45 + vec3( -microGrad.x, 0.0, -microGrad.y ) * 1.55 );
    vec3 V = normalize( viewDir );
    float ndv = clamp( abs( dot( nrm, V ) ), 0.02, 1.0 );

    float fresnel = clamp( 0.03 + 0.82 * pow( 1.0 - ndv, 3.4 ), 0.03, 0.86 );

    // 山涧清溪自然水色（参考图 1/3：清亮微带冷翠橄榄调，绝非刺眼荧光青）
    vec3 shallowTone = vec3( 0.19, 0.38, 0.33 );
    vec3 deepTone = vec3( 0.06, 0.17, 0.14 );
    vec3 foamTint = vec3( 0.88, 0.94, 0.92 );

    float sunWindow = canopySunWindow( worldPos, uWaterSunDir );
    float sunElevFactor = clamp( -uWaterSunDir.y * 1.35, 0.12, 1.0 ) * uWaterDayFactor;
    float sunLit = clamp( shadowMask * ( 0.34 + 0.66 * sunWindow ) * sunElevFactor, 0.0, 1.0 );

    // 夜间水色转向深邃月夜蓝灰，杜绝深夜荧光青
    shallowTone = mix( vec3( 0.03, 0.07, 0.12 ), shallowTone, uWaterDayFactor );
    deepTone = mix( vec3( 0.01, 0.03, 0.06 ), deepTone, uWaterDayFactor );
    foamTint = mix( vec3( 0.22, 0.32, 0.42 ), foamTint, uWaterDayFactor );

    // 6 级小瀑布水舌（uOverlayMode == 1）：复现参考图 1 中分股垂落的丝缕水帘 + 飞珠颗粒 + 落水潭翻滚气泡白沫
    if ( uOverlayMode > 0.5 && uOverlayMode < 1.5 ) {
      float edgeX = smoothstep( 0.0, 0.24, localUv.x ) * ( 1.0 - smoothstep( 0.76, 1.0, localUv.x ) );
      float edgeY = smoothstep( 0.0, 0.18, localUv.y ) * ( 1.0 - smoothstep( 0.80, 1.0, localUv.y ) );
      // 分股水柱丝缕（11 股垂落水束 + 高速下落纹理）
      float strandRibs = 0.5 + 0.5 * sin( localUv.x * 38.0 + sin( localUv.y * 9.0 - uTime * 7.5 ) * 1.2 );
      vec2 fallUv = vec2( localUv.x * 11.5 + sin( localUv.y * 7.0 ) * 0.22, localUv.y * 2.8 - uTime * 6.8 );
      float fallThreads = smoothstep( 0.36, 0.78, waterFbm( fallUv ) * ( 0.55 + 0.45 * strandRibs ) );
      // 飞溅水珠颗粒与底部翻涌白沫气泡团
      float dropletSpecks = evalParticleFoamField( vec2( localUv.x * 1.8, localUv.y * 1.4 ), uTime * 1.3 );
      float plungePoolFoam = smoothstep( 0.48, 0.92, localUv.y ) * evalParticleFoamField( localUv * 1.2, uTime );
      float combinedCascade = clamp( fallThreads * 0.55 + dropletSpecks * 0.45 + plungePoolFoam * 0.65, 0.0, 1.0 );
      float alpha = edgeX * edgeY * ( 0.12 + 0.68 * combinedCascade );
      vec3 casCol = mix( shallowTone * 0.85, foamTint, combinedCascade ) * ( ( 0.28 + 0.25 * uWaterDayFactor ) + 0.55 * sunLit );
      return vec4( casCol, alpha );
    }
    if ( uOverlayMode >= 1.5 ) {
      return vec4( shallowTone, 0.0 );
    }

    // 3. 斯涅尔光学折射：平缓潭区澄澈见底（透出水底石头、卵石与金褐泥沙）
    float geomDepth = isPuddle > 0.5
      ? 0.025
      : clamp( 0.22 * ( 1.0 - smoothstep( 0.45, 1.38, bankDist ) ), 0.008, 0.36 );
    float waterDepth = geomDepth;

    vec2 screenUv = ( vWaterClipPos.xy / max( 0.0001, vWaterClipPos.w ) ) * 0.5 + 0.5;
    vec2 refractOffset = nrm.xz * clamp( 0.012 + waterDepth * 0.068, 0.008, 0.042 );
    vec2 refractUv = clamp( screenUv - refractOffset, vec2( 0.002 ), vec2( 0.998 ) );

    if ( uHasRefraction > 0.5 ) {
      float rawSceneD = texture2D( tRefractionDepth, refractUv ).r;
      float surfD = linearizeDepth( gl_FragCoord.z, uCameraNear, uCameraFar );
      if ( rawSceneD < 0.9999 ) {
        float sceneD = linearizeDepth( rawSceneD, uCameraNear, uCameraFar );
        if ( sceneD < surfD - 0.002 ) {
          refractUv = clamp( screenUv, vec2( 0.002 ), vec2( 0.998 ) );
          rawSceneD = texture2D( tRefractionDepth, refractUv ).r;
          sceneD = linearizeDepth( rawSceneD, uCameraNear, uCameraFar );
        }
        float diffD = ( sceneD - surfD ) * max( 0.35, ndv );
        if ( diffD > 0.0 ) {
          waterDepth = clamp( diffD, 0.004, 0.62 );
        }
      }
    }

    vec3 sigma = vec3( 2.35, 0.72, 0.96 ) * ( uExtinctionDensity * 0.36 );
    vec3 transmittance = exp( -sigma * waterDepth );
    float extinction = 1.0 - ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;

    vec3 waterBody = mix( shallowTone, deepTone, extinction );
    if ( uHasRefraction > 0.5 ) {
      vec3 refractedBed = texture2D( tRefractionColor, refractUv ).rgb;
      float bedSunBoost = ( 0.42 + 0.42 * uWaterDayFactor ) + 0.40 * sunLit;
      vec3 clearBed = refractedBed * transmittance * bedSunBoost;
      vec3 scatterWater = mix( shallowTone, deepTone, extinction ) * ( 0.16 + 0.32 * sunLit );
      waterBody = mix( scatterWater, clearBed, clamp( transmittance.g * 0.92 + 0.08, 0.28, 0.96 ) );
    }

    // 4. 真实光追反射与平面镜面反射（树木与朱红鸟居倒影）
    vec3 R = reflect( -V, nrm );
    vec3 rayTracedEnv = traceSceneReflectionRay( worldPos, R, sunLit ) * ( 0.22 + 0.78 * uWaterDayFactor );

    if ( uHasReflection > 0.5 ) {
      vec2 reflUv = clamp( vec2( screenUv.x, 1.0 - screenUv.y ) + nrm.xz * 0.068, vec2( 0.002 ), vec2( 0.998 ) );
      vec3 planarRefl = texture2D( tReflectionColor, reflUv ).rgb;
      float planarLuma = dot( planarRefl, vec3( 0.299, 0.587, 0.114 ) );
      if ( planarLuma > 0.008 ) {
        rayTracedEnv = mix( rayTracedEnv, planarRefl * 1.15, 0.50 );
      }
    }
    if ( uHasRefraction > 0.5 ) {
      vec2 ssrUv = clamp( screenUv + vec2( nrm.x * 0.045, abs( R.y ) * 0.085 + nrm.z * 0.045 ), vec2( 0.002 ), vec2( 0.998 ) );
      float ssrDepth = linearizeDepth( texture2D( tRefractionDepth, ssrUv ).r, uCameraNear, uCameraFar );
      float surfDepth = linearizeDepth( gl_FragCoord.z, uCameraNear, uCameraFar );
      if ( ssrDepth < surfDepth + 1.8 && ssrDepth > surfDepth - 0.6 ) {
        vec3 ssrCol = texture2D( tRefractionColor, ssrUv ).rgb;
        rayTracedEnv = mix( rayTracedEnv, ssrCol * 0.92, 0.34 );
      }
    }

    float waveFacet = smoothstep( 0.22, 0.82, vWaveCrest + dot( nrm.xz, vec2( 0.7, 0.7 ) ) * 1.55 );
    vec3 waveReflection = rayTracedEnv * ( 0.70 + 0.45 * waveFacet ) * ( 0.52 + 0.48 * sunLit );

    // 5. 多向动态波列交叉干涉的粼粼波光（5个不同方向小波相长干涉形成灵动跳跃的菱形波光，无平行条带）
    vec3 L = normalize( -uWaterSunDir );
    vec3 H = normalize( V + L );
    float ndh = max( 0.0, dot( nrm, H ) );

    vec2 pLocal = vec2( lateral, along );
    float flowWarp = ( waterFbm( vec2( lateral * 3.6, along * 2.4 - uTime * 1.6 ) ) - 0.48 ) * 3.8;
    float w1 = sin( dot( pLocal, vec2( 0.88, 0.47 ) ) * 22.0 - uTime * 6.8 + flowWarp );
    float w2 = sin( dot( pLocal, vec2( -0.74, 0.67 ) ) * 27.5 - uTime * 8.1 - flowWarp * 0.85 );
    float w3 = sin( dot( pLocal, vec2( 0.36, -0.93 ) ) * 33.0 + uTime * 9.4 + flowWarp * 1.1 );
    float w4 = sin( dot( pLocal, vec2( -0.95, -0.31 ) ) * 39.5 - uTime * 10.7 - flowWarp * 0.9 );
    float w5 = sin( dot( pLocal, vec2( 0.53, 0.85 ) ) * 46.0 + uTime * 12.1 + flowWarp * 0.7 );

    float multiWaveSum = w1 * 0.24 + w2 * 0.22 + w3 * 0.20 + w4 * 0.18 + w5 * 0.16;
    float diamondSparkle = smoothstep( 0.36, 0.74, multiWaveSum ) * ( 1.0 - isPuddle );

    float bankRockShimmer = nearBankOrRock * diamondSparkle * ( 0.24 + 0.48 * pow( 1.0 - ndv, 1.8 ) );
    float broadSpec = pow( ndh, 46.0 ) * ( 0.20 + 0.42 * nearBankOrRock );
    float crestGlint = pow( ndh, 136.0 ) * ( 0.52 + 1.55 * diamondSparkle * ( 0.35 + 0.65 * nearBankOrRock ) );
    vec3 sunGlitter = vec3( 0.96, 0.95, 0.90 ) * uWaterDayFactor * (
      broadSpec * ( 0.16 + 0.84 * sunLit ) +
      crestGlint * ( 0.20 + 0.80 * sunLit ) +
      bankRockShimmer * vec3( 0.42, 0.60, 0.56 ) * ( 0.22 + 0.78 * sunLit )
    );

    // 6. 粒子化飞沫与落水潭翻滚气泡白水（复现参考图 1/3/4/5：瀑布跌水与乱石狭槽处呈现丰富颗粒状泡沫水花，平缓潭面清澈无白条）：
    float slopeTilt = clamp( ( 1.0 - abs( nrm.y ) ) * 5.2, 0.0, 1.0 ) * inStream;
    float rapidChuteZone = smoothstep( 0.44, 0.82, regimeSpeed ) * inStream;
    float particleFoamPattern = evalParticleFoamField( vec2( lateral, along ), uTime * ( 0.75 + 0.55 * regimeSpeed ) );

    // (a) 瀑布落水潭与溪石迎水激浪的翻涌气泡团 + 飞沫颗粒
    float plungeAndBowFoam = clamp( splashMask * 1.15 + slopeTilt * 0.75, 0.0, 1.0 ) * inStream * ( 0.32 + 0.68 * particleFoamPattern );
    // (b) 乱石之间急流狭槽的碎珠白水丝缕（如图 4/5 乱石间的飞沫急流）
    float chuteSpray = rapidChuteZone * stoneWaveMask * particleFoamPattern * 0.55;
    // (c) 石后漩涡气泡环
    float eddyAngle = atan( nrm.z, nrm.x ) + length( p ) * 10.0 - uTime * 4.2;
    float vortexBubbles = vortexMask * inStream * smoothstep( 0.48, 0.84, sin( eddyAngle * 2.0 ) * 0.5 + 0.5 ) * particleFoamPattern * 0.42;

    float totalFoam = clamp( plungeAndBowFoam * 0.78 + chuteSpray + vortexBubbles, 0.0, 0.76 ) * ( 0.22 + 0.18 * uWaterDayFactor + 0.60 * sunLit );

    // 7. 最终水体光学合成
    float reflectMix = isPuddle > 0.5
      ? clamp( fresnel * 0.72 + 0.18, 0.18, 0.78 )
      : clamp( fresnel * ( 0.62 + 0.40 * waveFacet ) + 0.12 + nearBankOrRock * 0.10, 0.10, 0.82 );
    vec3 surfaceCol = mix( waterBody, waveReflection, reflectMix );
    surfaceCol += sunGlitter;
    surfaceCol = mix( surfaceCol, foamTint * ( ( 0.32 + 0.28 * uWaterDayFactor ) + 0.40 * sunLit ), totalFoam );

    surfaceCol *= ( ( 0.30 + 0.36 * uWaterDayFactor ) + 0.40 * sunLit );

    float edgeFade = isPuddle > 0.5 ? 1.0 : ( 1.0 - smoothstep( 1.18, 1.48, bankDist ) );
    float glintAlpha = clamp( dot( sunGlitter, vec3( 0.333 ) ) * 0.42, 0.0, 0.32 );
    float clearAlpha = isPuddle > 0.5
      ? clamp( baseAlpha * ( 0.72 + fresnel * 0.45 ) + glintAlpha * 0.5, 0.16, 0.62 )
      : ( uHasRefraction > 0.5
          ? clamp( ( 0.42 + extinction * 0.22 + fresnel * 0.30 + totalFoam * 0.42 + glintAlpha ) * edgeFade, 0.16, 0.90 )
          : clamp( ( 0.20 + extinction * 0.22 + fresnel * 0.38 + totalFoam * 0.48 + glintAlpha ) * edgeFade, 0.12, 0.82 ) );

    return vec4( surfaceCol, clearAlpha );
  }
`;

export const RIVERBED_CAUSTICS_UNIFORMS = /* glsl */ `
  uniform float uCausticTime;
  uniform vec3 uCausticLightDir;
  uniform vec3 uWaterAbsorbShallow;
  uniform vec3 uWaterAbsorbDeep;
  uniform sampler2D uSweTex;
  uniform vec2 uSweDomainMin;
  uniform vec2 uSweDomainMax;
  uniform vec2 uSweTexel;
`;

export const RIVERBED_CAUSTICS_FRAG = /* glsl */ `
  float bedHash21( vec2 p ) {
    p = fract( p * vec2( 127.1, 311.7 ) );
    p += dot( p, p + 34.23 );
    return fract( p.x * p.y );
  }

  float bedNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( bedHash21( i ), bedHash21( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( bedHash21( i + vec2( 0.0, 1.0 ) ), bedHash21( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  float bedFbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2( 0.80, -0.60, 0.60, 0.80 );
    for ( int i = 0; i < 3; i++ ) {
      v += a * bedNoise( p );
      p = rot * p * 2.02 + vec2( 9.2, -7.4 );
      a *= 0.5;
    }
    return v;
  }

  float bedCanopySunWindow( vec3 worldPos, vec3 sunDir ) {
    vec3 toSun = normalize( -sunDir );
    float tCanopy = max( 0.0, ( 5.4 - worldPos.y ) / max( 0.25, toSun.y ) );
    vec2 canopyXZ = worldPos.xz + toSun.xz * tCanopy * 0.45;
    vec2 windShift = vec2( sin( uCausticTime * 0.42 ) * 0.14, cos( uCausticTime * 0.36 ) * 0.10 );
    float macroGap = bedFbm( canopyXZ * 0.68 + windShift );
    float leafGap = bedNoise( canopyXZ * 2.35 - windShift * 1.6 );
    float sunBeam1 = exp( -length( worldPos.xz - vec2( -3.1, 6.2 ) ) * 0.48 );
    float sunBeam2 = exp( -length( worldPos.xz - vec2( -3.5, 2.3 ) ) * 0.52 );
    float sunBeam3 = exp( -length( worldPos.xz - vec2( -2.8, -1.8 ) ) * 0.50 );
    float sunBeam4 = exp( -length( worldPos.xz - vec2( -3.3, 9.4 ) ) * 0.55 );
    float beamBoost = max( max( sunBeam1, sunBeam2 ), max( sunBeam3, sunBeam4 ) );
    return smoothstep( 0.46, 0.72, macroGap * 0.62 + leafGap * 0.38 + beamBoost * 0.38 );
  }

  float combinedWaveHeightAt( vec2 xz, float t ) {
    vec2 sweSpan = max( vec2( 0.001 ), uSweDomainMax - uSweDomainMin );
    vec2 sweUv = clamp( ( xz - uSweDomainMin ) / sweSpan, 0.0, 1.0 );
    float sweH = texture2D( uSweTex, sweUv ).r * 1.65;
    vec2 p1 = vec2( xz.x * 2.6, xz.y * 2.1 - t * 2.25 );
    vec2 p2 = vec2( xz.x * 4.2 - 0.7 * xz.y, xz.y * 3.6 - t * 3.15 );
    float microH = ( bedNoise( p1 ) - 0.5 ) * 0.045 + ( bedNoise( p2 ) - 0.5 ) * 0.028;
    return sweH + microH;
  }

  vec3 applyRiverbedCaustics( vec3 bedColor, vec3 worldPos, vec3 normal ) {
    float streamMask = ( 1.0 - smoothstep( -1.85, -1.10, worldPos.x ) ) * smoothstep( -6.2, -5.0, worldPos.x );
    float u = clamp( ( 11.6 - worldPos.z ) / 20.8, 0.0, 1.0 );
    float approxWy = 0.25 + 2.95 * pow( u, 1.08 );
    float waterDepth = clamp( approxWy - worldPos.y, 0.0, 0.65 );
    float submergeMask = smoothstep( 0.004, 0.038, waterDepth ) * streamMask;
    if ( submergeMask <= 0.001 ) return bedColor;

    float eps = 0.05;
    vec2 xz = worldPos.xz;
    float hC = combinedWaveHeightAt( xz, uCausticTime );
    float hR = combinedWaveHeightAt( xz + vec2( eps, 0.0 ), uCausticTime );
    float hU = combinedWaveHeightAt( xz + vec2( 0.0, eps ), uCausticTime );
    float hL = combinedWaveHeightAt( xz - vec2( eps, 0.0 ), uCausticTime );
    float hD = combinedWaveHeightAt( xz - vec2( 0.0, eps ), uCausticTime );

    vec3 surfNormal = normalize( vec3( ( hL - hR ) / ( 2.0 * eps ), 1.0, ( hD - hU ) / ( 2.0 * eps ) ) );
    vec3 lightDir = normalize( uCausticLightDir );
    vec3 dispRay = refract( -lightDir, surfNormal, 0.75 );
    vec3 newPos = worldPos + dispRay * ( waterDepth / max( 0.2, abs( dispRay.y ) ) );

    float laplacian = ( hR + hL + hU + hD - 4.0 * hC ) / ( eps * eps );
    float focusDepth = clamp( waterDepth * 1.9, 0.08, 0.55 );
    float curvatureFocus = clamp( 1.0 - laplacian * focusDepth * 0.52, 0.25, 2.8 );

    float causticNet = pow( max( 0.0, curvatureFocus - 0.74 ), 1.65 );
    float net1 = bedNoise( newPos.xz * 4.6 + vec2( 0.0, -uCausticTime * 1.8 ) );
    float net2 = bedNoise( newPos.xz * 7.8 + vec2( 3.7, -uCausticTime * 2.5 ) );
    float cellNet = smoothstep( 0.58, 0.88, net1 * 0.6 + net2 * 0.4 );
    causticNet = clamp( causticNet * 0.65 + cellNet * 0.55, 0.0, 1.35 );

    float sunWin = bedCanopySunWindow( worldPos, uCausticLightDir );
    float absorb = 1.0 - exp( -waterDepth * 1.8 );
    vec3 clearBed = bedColor * ( 0.86 + 0.34 * sunWin );
    vec3 tintedBed = mix( clearBed, clearBed * vec3( 0.76, 0.92, 0.86 ), absorb * 0.42 );

    float upFacing = clamp( dot( normalize( normal ), vec3( 0.0, 1.0, 0.0 ) ) * 0.7 + 0.3, 0.0, 1.0 );
    vec3 causticLight = vec3( 0.76, 0.88, 0.78 ) * causticNet * upFacing * ( 0.28 + 0.85 * sunWin );

    return mix( bedColor, tintedBed + causticLight * 0.58, submergeMask );
  }
`;
