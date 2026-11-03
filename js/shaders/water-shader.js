// 分区水动力学山涧溪流着色器系统（Zoned Mountain Stream Shader System）：
//
// 彻底消除「大海长波浪」感，根据全流域水动力学分区纹理（uHydroTex = simulator.obstacleTex）
// 在不同区域应用针对性的波浪算法：
//   1. 平缓深潭区（Calm Pools，regimeSpeed < 0.35）：
//      水面极其平缓（起伏 < 2mm），清澈见底透出泥沙卵石，清晰倒映翠绿林冠与朱红鸟居，阳光下泛起细腻微光；
//   2. 束水湍急与石头八字分流区（Rapids & Bifurcation Split-Flow）：
//      流线沿岩石两侧势流偏转角（flowDir）加速分流，产生高频鱼鳞状八字急流细波（Anisotropic Chevron Riffles）；
//   3. 石头迎水驻点与 6 级小瀑布跌水激荡区（Bow Wave Cushion & Waterfall Plunge Splash）：
//      迎石正面水体受阻隆起弧形水枕，瀑布落水潭产生高频水跃（Hydraulic Jump）与晶莹飞溅水花（Splash Droplets）；
//   4. 石后卡门涡街与潭湾漩涡区（Kármán Vortex Street & Eddy Swirls）：
//      背水回流区形成对数螺旋旋转流线与微凹涡心，带动细微水纹盘旋打转。

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

  // 解码当前顶点的水动力学分区参数
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

  // 分区波浪几何位移（彻底告别大海长波浪！平缓潭水接近镜面微澜，湍急与迎石/跌水处局部激荡起伏）：
  // 1) 湍急段与八字分流区的细密鱼鳞状急流波（波长短 0.25~0.4m，振幅随流速缩放）
  float rapidWeight = smoothstep( 0.28, 0.75, regimeSpeed );
  float chevronPhase1 = sAlong * 18.5 + abs( sCross ) * 14.0 - uTime * ( 6.5 + 4.5 * regimeSpeed );
  float chevronPhase2 = sAlong * 26.0 - sCross * 19.5 - uTime * ( 8.8 + 5.2 * regimeSpeed );
  float rapidWaveY = ( sin( chevronPhase1 ) * 0.0055 + cos( chevronPhase2 ) * 0.0038 ) * rapidWeight;

  // 2) 石头迎水驻波水枕与小瀑布落水激荡水跃（局部隆起 + 高频飞溅波峰）
  float splashChop = sin( wp.x * 28.0 + wp.y * 24.0 - uTime * 14.5 ) * cos( wp.x * 22.0 - wp.y * 31.0 - uTime * 16.2 );
  float bowAndPlungeY = splashZone * ( 0.014 + 0.009 * splashChop );

  // 3) 石后卡门涡街与潭湾漩涡微凹（涡心下陷 4mm + 旋转波纹）
  float vortexDimpleY = vortexZone * ( -0.0045 + 0.0032 * sin( sAlong * 22.0 + sCross * 22.0 - uTime * 9.5 ) );

  // 4) 平缓深潭微澜（振幅仅 1.2mm，保持山林静水澄澈感）
  float calmRippleY = sin( sAlong * 9.5 - uTime * 3.2 + sCross * 6.0 ) * 0.0012 * ( 1.0 - rapidWeight * 0.7 );

  float sweMask = ( 1.0 - isSolidObs ) * step( 0.01, uSweDisplaceScale );
  float zonedWaveY = rapidWaveY + bowAndPlungeY + vortexDimpleY + calmRippleY;
  float totalDispY = ( sweSample.r * uSweDisplaceScale * 1.15 + zonedWaveY ) * sweMask;

  transformed.y += totalDispY;

  // 计算分区波浪法线梯度
  vec2 worldStep = sweSpan * uSweTexel * 2.0;
  float dSweDx = ( sweHR - sweHL ) * uSweDisplaceScale * 1.15 / max( 0.01, worldStep.x );
  float dSweDz = ( sweHU - sweHD ) * uSweDisplaceScale * 1.15 / max( 0.01, worldStep.y );

  float dRapidDAlong = ( cos( chevronPhase1 ) * 18.5 * 0.0055 - sin( chevronPhase2 ) * 26.0 * 0.0038 ) * rapidWeight;
  float dRapidDCross = ( cos( chevronPhase1 ) * 14.0 * sign( sCross ) * 0.0055 + sin( chevronPhase2 ) * 19.5 * 0.0038 ) * rapidWeight;
  float dSplashDx = splashZone * 0.009 * 25.0 * cos( wp.x * 28.0 + wp.y * 24.0 - uTime * 14.5 );
  float dSplashDz = splashZone * 0.009 * 24.0 * sin( wp.x * 22.0 - wp.y * 31.0 - uTime * 16.2 );

  float dZonedDx = localFlowDir.x * dRapidDAlong + localCrossDir.x * dRapidDCross + dSplashDx;
  float dZonedDz = localFlowDir.y * dRapidDAlong + localCrossDir.y * dRapidDCross + dSplashDz;

  vSweNormal = normalize( vec3(
    -( dSweDx + dZonedDx * sweMask ),
    1.0,
    -( dSweDz + dZonedDz * sweMask )
  ) );
  vSweAgitation = max( sweSample.a, splashZone * 0.9 + vortexZone * 0.45 + rapidWeight * 0.25 );
  vSweObstacle = isSolidObs;
  vWaveCrest = clamp( totalDispY * 28.0 + 0.5, 0.0, 1.0 );
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

  float linearizeDepth( float d, float zNear, float zFar ) {
    float zNdc = d * 2.0 - 1.0;
    return ( 2.0 * zNear * zFar ) / max( 0.0001, zFar + zNear - zNdc * ( zFar - zNear ) );
  }

  float streamApproxCenterX( float z ) {
    return -3.25 + 0.58 * sin( z * 0.36 + 0.5 ) + 0.28 * cos( z * 0.21 - 0.8 );
  }

  // 林冠斑驳阳光透射窗（树叶遮挡阴影 vs 阳光直射林隙）
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
    return smoothstep( 0.46, 0.72, rawSun );
  }

  /**
   * 分区各向异性微表面水波梯度（Zoned Anisotropic Wave Gradient）：
   * - 平缓深潭（regimeSpeed 低）：柔和舒展的细微张力波；
   * - 湍急与石头分流区（regimeSpeed 高）：沿绕石势流流线拉伸的八字分流波纹；
   * - 石后与潭湾漩涡区（vortexIntensity 高）：叠加对数螺旋旋转涡流扰动（Swirling Eddy）。
   */
  vec2 zonedStreamWaveGradient( vec2 xz, vec2 localFlowDir, float regimeSpeed, float splashMask, float vortexMask, float time ) {
    vec2 crossDir = vec2( -localFlowDir.y, localFlowDir.x );
    float sAlong = dot( xz, localFlowDir );
    float sCross = dot( xz, crossDir );

    // 漩涡区螺旋坐标扭转（模拟石后卡门涡街与水湾漩涡）
    if ( vortexMask > 0.05 ) {
      float swirlPhase = time * 3.8 + length( xz ) * 8.0;
      float cSwirl = cos( swirlPhase * vortexMask );
      float sSwirl = sin( swirlPhase * vortexMask );
      vec2 rotCoord = vec2( sCross * cSwirl - sAlong * sSwirl, sCross * sSwirl + sAlong * cSwirl );
      sCross = mix( sCross, rotCoord.x, vortexMask * 0.45 );
      sAlong = mix( sAlong, rotCoord.y, vortexMask * 0.45 );
    }

    // 沿流向与横向各向异性缩放：湍急/分流段纵向拉长、横向收紧，形成真实山涧流丝而非大海波浪
    float speedRate = time * ( 1.8 + 3.6 * regimeSpeed );
    vec2 q1 = vec2( sCross * ( 4.2 + 2.5 * regimeSpeed ), sAlong * 2.6 - speedRate );
    vec2 q2 = vec2( sCross * 8.8 - sin( sAlong * 3.2 ) * 0.45, sAlong * 5.4 - speedRate * 1.45 );
    vec2 q3 = vec2( sCross * 16.5 + sAlong * 6.5, sAlong * 12.8 - speedRate * 2.1 );

    float eps = 0.035;
    float w1 = 0.45 * ( 0.55 + 0.45 * regimeSpeed );
    float w2 = 0.35 * ( 0.65 + 0.65 * regimeSpeed );
    float w3 = 0.20 * ( 0.40 + 1.25 * splashMask + 0.75 * vortexMask );

    float h0 = waterFbm( q1 ) * w1 + waterFbm( q2 ) * w2 + waterNoise( q3 ) * w3;
    float hx = waterFbm( q1 + vec2( eps, 0.0 ) ) * w1 + waterFbm( q2 + vec2( eps, 0.0 ) ) * w2 + waterNoise( q3 + vec2( eps, 0.0 ) ) * w3;
    float hz = waterFbm( q1 + vec2( 0.0, eps ) ) * w1 + waterFbm( q2 + vec2( 0.0, eps ) ) * w2 + waterNoise( q3 + vec2( 0.0, eps ) ) * w3;
    vec2 localGrad = ( vec2( hx - h0, hz - h0 ) / eps ) * ( 0.16 + 0.18 * regimeSpeed + 0.14 * splashMask );
    return crossDir * localGrad.x + localFlowDir * localGrad.y;
  }

  // 三维几何光追反射（树木与朱红鸟居波光倒影）
  vec3 traceSceneReflectionRay( vec3 worldPos, vec3 R, float sunWindow ) {
    vec3 rd = normalize( vec3( R.x, max( 0.08, abs( R.y ) ), R.z ) );

    float tTree = ( 4.2 - worldPos.y ) / max( 0.12, rd.y );
    vec2 treeHitXZ = worldPos.xz + rd.xz * clamp( tTree, 0.5, 18.0 );
    vec2 canopySway = vec2( sin( uTime * 0.7 + treeHitXZ.y * 0.5 ), cos( uTime * 0.6 + treeHitXZ.x * 0.5 ) ) * 0.08;
    float foliage1 = waterFbm( treeHitXZ * 1.15 + canopySway );
    float foliage2 = waterFbm( treeHitXZ * 2.85 - canopySway * 1.4 );
    float skyHole = smoothstep( 0.68, 0.86, foliage1 * 0.65 + foliage2 * 0.35 );
    float trunkWave = pow( max( 0.0, sin( treeHitXZ.x * 2.6 + sin( treeHitXZ.y * 0.8 ) ) ), 8.0 );

    vec3 deepCanopy = vec3( 0.07, 0.18, 0.09 );
    vec3 midCanopy = vec3( 0.15, 0.34, 0.16 );
    vec3 sunlitMaple = vec3( 0.42, 0.68, 0.24 );
    vec3 barkTone = vec3( 0.12, 0.09, 0.07 );
    vec3 skyGapTone = vec3( 0.52, 0.68, 0.62 );

    vec3 envColor = mix( deepCanopy, midCanopy, smoothstep( 0.28, 0.65, foliage1 ) );
    envColor = mix( envColor, sunlitMaple, smoothstep( 0.55, 0.82, foliage2 ) * ( 0.35 + 0.65 * sunWindow ) );
    envColor = mix( envColor, barkTone, trunkWave * 0.45 );
    envColor = mix( envColor, skyGapTone, skyHole * 0.55 );

    vec3 toToriiCenter = normalize( vec3( 0.15 - worldPos.x, 3.85 - worldPos.y, -0.65 - worldPos.z ) );
    vec3 perturbedR = normalize( rd + vec3( R.x - rd.x, 0.0, R.z - rd.z ) * 1.35 );
    float toriiAlign = dot( perturbedR, toToriiCenter );

    float distToTorii = length( vec2( 0.15 - worldPos.x, -0.65 - worldPos.z ) );
    vec3 localRay = perturbedR - toToriiCenter * toriiAlign;
    float uTorii = localRay.x * distToTorii * 0.42 + ( R.x - toToriiCenter.x ) * 2.2;
    float vTorii = ( perturbedR.y - toToriiCenter.y * 0.55 ) * distToTorii * 0.38 + 0.48;

    float inToriiWindow = smoothstep( 0.45, 0.82, toriiAlign ) * smoothstep( 12.5, 5.5, abs( worldPos.z - 2.2 ) );
    if ( inToriiWindow > 0.001 ) {
      float waveShimmer = sin( worldPos.z * 14.0 - uTime * 5.6 + worldPos.x * 9.0 ) * 0.045;
      float uT = uTorii + waveShimmer;
      float vT = vTorii + cos( worldPos.x * 12.0 - uTime * 4.8 ) * 0.035;

      float postL1 = smoothstep( 0.13, 0.05, abs( uT + 0.48 ) ) * smoothstep( 0.0, 0.08, vT ) * smoothstep( 0.88, 0.80, vT );
      float postR1 = smoothstep( 0.13, 0.05, abs( uT - 0.48 ) ) * smoothstep( 0.0, 0.08, vT ) * smoothstep( 0.88, 0.80, vT );
      float postL2 = smoothstep( 0.11, 0.04, abs( uT + 0.34 ) ) * smoothstep( 0.05, 0.12, vT ) * smoothstep( 0.82, 0.74, vT );
      float postR2 = smoothstep( 0.11, 0.04, abs( uT - 0.34 ) ) * smoothstep( 0.05, 0.12, vT ) * smoothstep( 0.82, 0.74, vT );

      float nuki = smoothstep( 0.72, 0.58, abs( uT ) ) * smoothstep( 0.07, 0.025, abs( vT - 0.56 ) );
      float shimaki = smoothstep( 0.82, 0.66, abs( uT ) ) * smoothstep( 0.065, 0.025, abs( vT - 0.76 ) );
      float gakuzuka = smoothstep( 0.07, 0.025, abs( uT ) ) * smoothstep( 0.54, 0.58, vT ) * smoothstep( 0.78, 0.74, vT );

      float curveArch = 0.83 + 0.06 * uT * uT;
      float kasagi = smoothstep( 0.90, 0.72, abs( uT ) ) * smoothstep( 0.06, 0.02, abs( vT - curveArch ) );

      float vermilionHit = clamp( max( max( postL1, postR1 ), max( max( postL2, postR2 ), max( nuki, max( shimaki, gakuzuka ) ) ) ), 0.0, 1.0 );
      float blackHit = clamp( kasagi * ( 1.0 - vermilionHit * 0.5 ), 0.0, 1.0 );

      vec3 toriiRed = mix( vec3( 0.72, 0.16, 0.06 ), vec3( 0.92, 0.32, 0.12 ), 0.5 + 0.5 * sunWindow );
      vec3 toriiBlackCol = vec3( 0.08, 0.10, 0.12 );

      envColor = mix( envColor, toriiRed, vermilionHit * inToriiWindow * 0.88 );
      envColor = mix( envColor, toriiBlackCol, blackHit * inToriiWindow * 0.75 );
    }

    return envColor;
  }

  vec4 waterFlow( vec3 color, float baseAlpha, vec3 worldPos, vec3 normal, vec3 viewDir, vec2 localUv, float shadowMask ) {
    vec2 p = worldPos.xz;
    vec2 sweSpan = max( vec2( 0.001 ), uSweDomainMax - uSweDomainMin );
    vec2 sweUv = clamp( ( p - uSweDomainMin ) / sweSpan, 0.0, 1.0 );
    vec4 sweFrag = texture2D( uSweTex, sweUv );
    vec4 hydroFrag = texture2D( uHydroTex, sweUv );

    // 解码片元处的水动力学五类分区状态
    float flowDirX = hydroFrag.r * 2.0 - 1.0;
    float flowDirZ = sqrt( max( 0.05, 1.0 - flowDirX * flowDirX ) );
    vec2 localFlowDir = normalize( vec2( flowDirX, flowDirZ ) );
    vec2 localLatDir = vec2( -localFlowDir.y, localFlowDir.x );
    float regimeSpeed = hydroFrag.g; // 平缓 vs 湍急/分流
    float isSolidObs = step( 0.75, hydroFrag.b );
    float splashMask = clamp( hydroFrag.b / 0.65, 0.0, 1.0 ) * ( 1.0 - isSolidObs );
    float vortexMask = hydroFrag.a * ( 1.0 - isSolidObs );
    float agitation = max( vSweAgitation, sweFrag.a );

    float along = dot( p, localFlowDir );
    float lateral = dot( p, localLatDir );

    // 1. 合成三维分区波浪法线（含绕石八字分流波纹、急流鱼鳞细波与石后漩涡倾角）
    vec2 microGrad = zonedStreamWaveGradient( p, localFlowDir, regimeSpeed, splashMask, vortexMask, uTime );
    vec3 sweN = length( vSweNormal ) > 0.1 ? vSweNormal : vec3( 0.0, 1.0, 0.0 );
    vec3 nrm = normalize( normal + ( sweN - vec3( 0.0, 1.0, 0.0 ) ) * 1.45 + vec3( -microGrad.x, 0.0, -microGrad.y ) * 1.35 );
    vec3 V = normalize( viewDir );
    float ndv = clamp( abs( dot( nrm, V ) ), 0.02, 1.0 );

    float fresnel = clamp( 0.03 + 0.82 * pow( 1.0 - ndv, 3.4 ), 0.03, 0.86 );

    vec3 shallowTone = vec3( 0.24, 0.52, 0.45 );
    vec3 deepTone = vec3( 0.08, 0.25, 0.21 );
    vec3 foamTint = vec3( 0.86, 0.93, 0.91 );

    if ( uOverlayMode > 0.5 && uOverlayMode < 1.5 ) {
      float edgeX = smoothstep( 0.0, 0.28, localUv.x ) * smoothstep( 1.0, 0.72, localUv.x );
      float edgeY = smoothstep( 0.0, 0.22, localUv.y ) * smoothstep( 1.0, 0.74, localUv.y );
      vec2 fallUv = vec2( localUv.x * 8.5 + sin( localUv.y * 6.0 ) * 0.25, localUv.y * 3.2 - uTime * 5.2 );
      float fallThreads = smoothstep( 0.50, 0.82, waterFbm( fallUv ) );
      float plungeBubbles = smoothstep( 0.60, 0.95, localUv.y ) * smoothstep( 0.45, 0.78, waterNoise( fallUv * 2.6 ) );
      float alpha = edgeX * edgeY * ( 0.10 + 0.38 * fallThreads + 0.32 * plungeBubbles );
      return vec4( mix( shallowTone * 1.15, foamTint, fallThreads * 0.68 + plungeBubbles * 0.32 ), alpha );
    }
    if ( uOverlayMode >= 1.5 ) {
      return vec4( shallowTone, 0.0 );
    }

    // 2. 树冠遮挡阴影 vs 阳光直射窗口
    float sunWindow = canopySunWindow( worldPos, uWaterSunDir );
    float sunLit = clamp( shadowMask * ( 0.35 + 0.65 * sunWindow ), 0.0, 1.0 );

    // 3. 斯涅尔光学折射：清澈透出水底石头、卵石与金褐泥沙（平缓潭水如水晶般澄澈，急流处折射随细波微颤）
    float cx = streamApproxCenterX( p.y );
    float bankDist = abs( p.x - cx );
    float geomDepth = clamp( 0.22 * ( 1.0 - smoothstep( 0.45, 1.38, bankDist ) ), 0.008, 0.36 );
    float waterDepth = geomDepth;

    vec2 screenUv = ( vWaterClipPos.xy / max( 0.0001, vWaterClipPos.w ) ) * 0.5 + 0.5;
    vec2 refractOffset = nrm.xz * clamp( 0.015 + waterDepth * 0.075, 0.012, 0.044 );
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

    vec3 sigma = vec3( 2.35, 0.72, 0.96 ) * ( uExtinctionDensity * 0.38 );
    vec3 transmittance = exp( -sigma * waterDepth );
    float extinction = 1.0 - ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;

    vec3 waterBody = mix( shallowTone, deepTone, extinction );
    if ( uHasRefraction > 0.5 ) {
      vec3 refractedBed = texture2D( tRefractionColor, refractUv ).rgb;
      float bedSunBoost = 0.82 + 0.42 * sunLit;
      vec3 clearBed = refractedBed * transmittance * bedSunBoost;
      vec3 scatterWater = mix( shallowTone, deepTone, extinction ) * ( 0.22 + 0.32 * sunLit );
      waterBody = mix( scatterWater, clearBed, clamp( transmittance.g * 0.92 + 0.08, 0.25, 0.96 ) );
    }

    // 4. 真实光追反射与平面镜面反射（树木与朱红鸟居倒影）
    vec3 R = reflect( -V, nrm );
    vec3 rayTracedEnv = traceSceneReflectionRay( worldPos, R, sunLit );

    if ( uHasReflection > 0.5 ) {
      vec2 reflUv = clamp( vec2( screenUv.x, 1.0 - screenUv.y ) + nrm.xz * 0.068, vec2( 0.002 ), vec2( 0.998 ) );
      vec3 planarRefl = texture2D( tReflectionColor, reflUv ).rgb;
      float planarLuma = dot( planarRefl, vec3( 0.299, 0.587, 0.114 ) );
      if ( planarLuma > 0.008 ) {
        rayTracedEnv = mix( rayTracedEnv, planarRefl * 1.18, 0.52 );
      }
    }
    if ( uHasRefraction > 0.5 ) {
      vec2 ssrUv = clamp( screenUv + vec2( nrm.x * 0.045, abs( R.y ) * 0.085 + nrm.z * 0.045 ), vec2( 0.002 ), vec2( 0.998 ) );
      float ssrDepth = linearizeDepth( texture2D( tRefractionDepth, ssrUv ).r, uCameraNear, uCameraFar );
      float surfDepth = linearizeDepth( gl_FragCoord.z, uCameraNear, uCameraFar );
      if ( ssrDepth < surfDepth + 1.8 && ssrDepth > surfDepth - 0.6 ) {
        vec3 ssrCol = texture2D( tRefractionColor, ssrUv ).rgb;
        rayTracedEnv = mix( rayTracedEnv, ssrCol * 0.95, 0.36 );
      }
    }

    float waveFacet = smoothstep( 0.25, 0.85, vWaveCrest + dot( nrm.xz, vec2( 0.7, 0.7 ) ) * 1.4 );
    vec3 waveReflection = rayTracedEnv * ( 0.75 + 0.48 * waveFacet ) * ( 0.68 + 0.45 * sunLit );

    // 5. 阳光直射处的粼粼波光（GGX 微表面闪烁高光 Solar Glitter）
    vec3 L = normalize( -uWaterSunDir );
    vec3 H = normalize( V + L );
    float ndh = max( 0.0, dot( nrm, H ) );

    vec2 glitterCell = floor( vec2( lateral * 20.0, along * 18.0 - uTime * ( 2.5 + 3.5 * regimeSpeed ) ) );
    float cellSparkle = waterHash21( glitterCell );
    vec3 sparkleNrm = normalize( nrm + vec3(
      sin( lateral * 38.0 + uTime * 6.5 ) * 0.15,
      0.0,
      cos( along * 42.0 - uTime * 7.8 ) * 0.15
    ) );
    float sparkleNdh = max( 0.0, dot( sparkleNrm, H ) );

    float broadSpec = pow( ndh, 42.0 ) * 0.45;
    float sharpGlint = pow( sparkleNdh, 240.0 ) * ( 1.8 + 1.6 * step( 0.62, cellSparkle ) );
    vec3 sunGlitter = vec3( 1.0, 0.97, 0.88 ) * ( broadSpec * ( 0.18 + 0.82 * sunLit ) + sharpGlint * sunLit * 1.45 );

    // 6. 分区物理水花、分流流丝与石后漩涡纹（精准投放在对应水动力学区域，绝不糊满水面）：
    float slopeTilt = clamp( ( 1.0 - abs( nrm.y ) ) * 5.2, 0.0, 1.0 );
    vec2 streamUv = vec2( lateral * 11.0 + nrm.x * 1.4, along * 6.5 - uTime * ( 2.4 + 4.2 * regimeSpeed ) );
    float fineDroplets = smoothstep( 0.58, 0.86, waterFbm( streamUv * 1.6 ) );

    // (a) 迎水激荡水花与小瀑布落水潭飞沫（splashMask 区）
    float bowAndPlungeSplash = splashMask * ( 0.42 + 0.58 * fineDroplets ) * smoothstep( 0.12, 0.65, splashMask + slopeTilt * 0.5 );

    // (b) 石头两侧八字分流丝与急流接触圈微沫
    float splitStreamFilaments = smoothstep( 0.48, 0.82, regimeSpeed ) * smoothstep( 0.66, 0.88, waterFbm( vec2( lateral * 16.0, along * 4.2 - uTime * 5.5 ) ) ) * 0.28;
    float contactRing = ( 1.0 - smoothstep( 0.004, uShoreFoamThreshold * 0.52, waterDepth ) ) * smoothstep( 0.30, 0.80, agitation ) * fineDroplets * 0.62;

    // (c) 石后卡门涡街与水湾旋转涡纹（螺旋流丝）
    float eddyAngle = atan( nrm.z, nrm.x ) + length( p ) * 12.0 - uTime * 4.5;
    float vortexSwirl = vortexMask * smoothstep( 0.54, 0.84, sin( eddyAngle * 2.0 ) * 0.5 + 0.5 ) * fineDroplets * 0.34;

    float totalFoam = clamp( bowAndPlungeSplash * 0.78 + contactRing + splitStreamFilaments + vortexSwirl + smoothstep( 0.58, 0.92, slopeTilt ) * fineDroplets * 0.48, 0.0, 0.74 );

    // 7. 最终水体光学合成：清澈折射河床 + 菲涅尔波光倒影（树木 & 朱红鸟居）+ 阳光粼粼波光 + 分区激荡水花/漩涡
    float reflectMix = clamp( fresnel * ( 0.65 + 0.45 * waveFacet ) + 0.14, 0.12, 0.84 );
    vec3 surfaceCol = mix( waterBody, waveReflection, reflectMix );
    surfaceCol += sunGlitter;
    surfaceCol = mix( surfaceCol, foamTint * ( 0.74 + 0.26 * sunLit ), totalFoam );

    surfaceCol *= ( 0.74 + 0.34 * sunLit );

    float edgeFade = 1.0 - smoothstep( 1.18, 1.48, bankDist );
    float glintAlpha = clamp( dot( sunGlitter, vec3( 0.333 ) ) * 0.45, 0.0, 0.35 );
    float clearAlpha = uHasRefraction > 0.5
      ? clamp( ( 0.46 + extinction * 0.22 + fresnel * 0.32 + totalFoam * 0.28 + glintAlpha ) * edgeFade, 0.18, 0.88 )
      : clamp( ( 0.24 + extinction * 0.24 + fresnel * 0.42 + totalFoam * 0.36 + glintAlpha ) * edgeFade, 0.12, 0.78 );

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
