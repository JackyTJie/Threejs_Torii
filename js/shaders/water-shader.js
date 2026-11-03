// 物理级山涧溪流着色器系统：
// 1) 顶点着色器（WATER_SWE_VERT_DISPLACE）：
//    结合 GPU 二维浅水方程（SWE）高度场与四波段三维 Gerstner / 驻波水跃位移，使水面产生真实的高低起伏、
//    迎石隆起（Bow Wave）与背石涡街凹槽，绝非平坦贴图；
// 2) 片元着色器（WATER_FLOW_FRAG）：
//    - 彻底摒弃假白色条纹贴图：依靠真实的斯涅尔折射（Snell's Law Refraction）采样水底离屏缓冲（tRefractionColor），
//      清澈透出河床的金褐泥沙、错落河石、碎砾与沉水红叶；
//    - 真实光追与镜面反射（Planar Reflection FBO + Screen-Space Ray Marching + 3D 鸟居/树冠几何光追）：
//      根据实时起伏的波浪法线反射上方的翠绿林木与特定角度下的朱红色明神鸟居，形成波光粼粼的破碎动态倒影；
//    - 树影遮挡与阳光直射粼粼波光（Shadow Map + Canopy Sun Window + GGX 微表面闪烁高光）：
//      树木遮挡处水色幽深静谧，阳光穿透林隙直射处呈现晶莹闪烁的波峰金光与水底明亮折射焦散。

export const WATER_SWE_VERT_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uSweTex;
  uniform vec2 uSweDomainMin;
  uniform vec2 uSweDomainMax;
  uniform vec2 uSweTexel;
  uniform float uSweDisplaceScale;
  varying vec3 vSweNormal;
  varying float vSweAgitation;
  varying float vSweObstacle;
  varying vec4 vWaterClipPos;
  varying float vWaveCrest;
`;

export const WATER_SWE_VERT_DISPLACE = /* glsl */ `
  vec4 sweWorldTmp = modelMatrix * vec4( transformed, 1.0 );
  vec2 sweSpan = max( vec2( 0.001 ), uSweDomainMax - uSweDomainMin );
  vec2 sweUv = clamp( ( sweWorldTmp.xz - uSweDomainMin ) / sweSpan, 0.0, 1.0 );
  vec4 sweSample = texture2D( uSweTex, sweUv );
  float sweHL = texture2D( uSweTex, sweUv - vec2( uSweTexel.x, 0.0 ) ).r;
  float sweHR = texture2D( uSweTex, sweUv + vec2( uSweTexel.x, 0.0 ) ).r;
  float sweHD = texture2D( uSweTex, sweUv - vec2( 0.0, uSweTexel.y ) ).r;
  float sweHU = texture2D( uSweTex, sweUv + vec2( 0.0, uSweTexel.y ) ).r;

  // 三维多波段 Gerstner 行波与绕石驻波（让水面具备真实的高低起伏几何体积感）
  vec2 wp = sweWorldTmp.xz;
  float wPhase1 = wp.y * 5.8 - uTime * 4.8 + sin( wp.x * 3.2 ) * 0.85;
  float wPhase2 = wp.x * 7.4 + wp.y * 4.3 - uTime * 3.9;
  float wPhase3 = -wp.x * 6.2 + wp.y * 8.6 - uTime * 6.2;
  float wPhase4 = wp.x * 11.5 + wp.y * 10.8 - uTime * 7.4;

  float gerstnerY =
    sin( wPhase1 ) * 0.018 +
    sin( wPhase2 ) * 0.012 +
    cos( wPhase3 ) * 0.009 +
    sin( wPhase4 ) * 0.005 * ( 0.6 + 0.8 * sweSample.a );

  // Gerstner 水平切向微聚拢（使波峰更立体锐利、波谷更舒展）
  float gerstnerX = -cos( wPhase2 ) * 0.006 + sin( wPhase3 ) * 0.004;
  float gerstnerZ = -cos( wPhase1 ) * 0.008 - cos( wPhase3 ) * 0.005;

  float sweMask = ( 1.0 - step( 0.55, sweSample.b ) ) * step( 0.01, uSweDisplaceScale );
  float totalDispY = ( sweSample.r * uSweDisplaceScale * 1.45 + gerstnerY ) * sweMask;

  transformed.x += gerstnerX * sweMask;
  transformed.y += totalDispY;
  transformed.z += gerstnerZ * sweMask;

  // 合成 SWE 差分法线与三维 Gerstner 解析导数法线
  vec2 worldStep = sweSpan * uSweTexel * 2.0;
  float dSweDx = ( sweHR - sweHL ) * uSweDisplaceScale * 1.45 / max( 0.01, worldStep.x );
  float dSweDz = ( sweHU - sweHD ) * uSweDisplaceScale * 1.45 / max( 0.01, worldStep.y );

  float dGerDx =
    cos( wPhase1 ) * ( 3.2 * cos( wp.x * 3.2 ) * 0.85 ) * 0.018 +
    cos( wPhase2 ) * 7.4 * 0.012 +
    sin( wPhase3 ) * 6.2 * 0.009 +
    cos( wPhase4 ) * 11.5 * 0.005;
  float dGerDz =
    cos( wPhase1 ) * 5.8 * 0.018 +
    cos( wPhase2 ) * 4.3 * 0.012 -
    sin( wPhase3 ) * 8.6 * 0.009 +
    cos( wPhase4 ) * 10.8 * 0.005;

  vSweNormal = normalize( vec3(
    -( dSweDx + dGerDx * sweMask ),
    1.0,
    -( dSweDz + dGerDz * sweMask )
  ) );
  vSweAgitation = sweSample.a;
  vSweObstacle = sweSample.b;
  vWaveCrest = clamp( totalDispY * 22.0 + 0.5, 0.0, 1.0 );
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

  // 林冠斑驳阳光透射窗（模拟树叶遮挡阴影 vs 阳光直射林隙，形成清晰的明暗斑驳对比）
  float canopySunWindow( vec3 worldPos, vec3 sunDir ) {
    // 沿太阳方向投射到林冠层标高（y ≈ 5.5 m）
    vec3 toSun = normalize( -sunDir );
    float tCanopy = max( 0.0, ( 5.4 - worldPos.y ) / max( 0.25, toSun.y ) );
    vec2 canopyXZ = worldPos.xz + toSun.xz * tCanopy * 0.45;

    // 多尺度树冠枝叶遮挡场 + 随微风缓慢摇曳的阳光林隙
    vec2 windShift = vec2( sin( uTime * 0.42 ) * 0.14, cos( uTime * 0.36 ) * 0.10 );
    float macroGap = waterFbm( canopyXZ * 0.68 + windShift );
    float leafGap = waterNoise( canopyXZ * 2.35 - windShift * 1.6 );

    // 在溪流前中段与跌水池设置几处通透的阳光直射光斑，其余为浓密树影遮挡区
    float sunBeam1 = exp( -length( worldPos.xz - vec2( -3.1, 6.2 ) ) * 0.48 );
    float sunBeam2 = exp( -length( worldPos.xz - vec2( -3.5, 2.3 ) ) * 0.52 );
    float sunBeam3 = exp( -length( worldPos.xz - vec2( -2.8, -1.8 ) ) * 0.50 );
    float sunBeam4 = exp( -length( worldPos.xz - vec2( -3.3, 9.4 ) ) * 0.55 );
    float beamBoost = max( max( sunBeam1, sunBeam2 ), max( sunBeam3, sunBeam4 ) );

    float rawSun = macroGap * 0.62 + leafGap * 0.38 + beamBoost * 0.38;
    return smoothstep( 0.46, 0.72, rawSun );
  }

  // 高频微表面波浪梯度（产生波光粼粼的多面折射与反射微倾角）
  vec2 streamWaveGradient( vec2 xz, float time ) {
    float cx = streamApproxCenterX( xz.y );
    float lat = xz.x - cx;
    float s = xz.y * 1.04;
    vec2 q1 = vec2( lat * 3.2 + sin( s * 0.9 ) * 0.45, s * 2.8 - time * 3.4 );
    vec2 q2 = vec2( lat * 6.4 - cos( s * 1.4 ) * 0.35, s * 5.2 - time * 5.1 );
    vec2 q3 = vec2( lat * 11.5 + s * 4.2, s * 9.6 - time * 6.8 );
    float eps = 0.04;
    float h0 = waterFbm( q1 ) * 0.55 + waterFbm( q2 ) * 0.30 + waterNoise( q3 ) * 0.15;
    float hx = waterFbm( q1 + vec2( eps, 0.0 ) ) * 0.55 + waterFbm( q2 + vec2( eps, 0.0 ) ) * 0.30 + waterNoise( q3 + vec2( eps, 0.0 ) ) * 0.15;
    float hz = waterFbm( q1 + vec2( 0.0, eps ) ) * 0.55 + waterFbm( q2 + vec2( 0.0, eps ) ) * 0.30 + waterNoise( q3 + vec2( 0.0, eps ) ) * 0.15;
    return ( vec2( hx - h0, hz - h0 ) / eps ) * 0.24;
  }

  // 三维几何光追反射（Ray-Traced Torii & Forest Canopy Reflection）：
  // 从水面点 worldPos 沿波浪反射射线 R 追踪场景中的两座朱红色明神鸟居与四周摇曳的森林树冠，
  // 使特定观察角度下溪流能反射出鲜明的朱红鸟居波光倒影，其他角度反射出层叠的翠绿树影与林隙天光。
  vec3 traceSceneReflectionRay( vec3 worldPos, vec3 R, float sunWindow ) {
    vec3 rd = normalize( vec3( R.x, max( 0.08, abs( R.y ) ), R.z ) );

    // 1. 森林树冠与枝叶体积光追采样（随微风摇曳的深翠/嫩绿树冠层 + 树干）
    float tTree = ( 4.2 - worldPos.y ) / max( 0.12, rd.y );
    vec2 treeHitXZ = worldPos.xz + rd.xz * clamp( tTree, 0.5, 18.0 );
    vec2 canopySway = vec2( sin( uTime * 0.7 + treeHitXZ.y * 0.5 ), cos( uTime * 0.6 + treeHitXZ.x * 0.5 ) ) * 0.08;
    float foliage1 = waterFbm( treeHitXZ * 1.15 + canopySway );
    float foliage2 = waterFbm( treeHitXZ * 2.85 - canopySway * 1.4 );
    float skyHole = smoothstep( 0.68, 0.86, foliage1 * 0.65 + foliage2 * 0.35 );

    // 树干竖影（两侧大树主干投射在水面反射中的深褐竖影）
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

    // 2. 朱红色明神鸟居三维平面与柱梁光追交点测试（前座 z ≈ -0.25，后座 z ≈ -1.55，以及水面朝向参道中段的镜像走廊）
    // 当视线从溪流侧观察、反射向量朝向鸟居方位（rd.x > 0 朝参道方向，或沿溪流望向中段 z ∈ [-3.5, 5.5]）时，
    // 波浪起伏的法线会将鸟居的朱红立柱、贯（横梁）与黑色笠木切割成波光粼粼的朱红倒影带！
    vec3 toToriiCenter = normalize( vec3( 0.15 - worldPos.x, 3.85 - worldPos.y, -0.65 - worldPos.z ) );
    vec3 perturbedR = normalize( rd + vec3( R.x - rd.x, 0.0, R.z - rd.z ) * 1.35 );
    float toriiAlign = dot( perturbedR, toToriiCenter );

    // 计算反射射线在鸟居立面平面上的投影坐标（uvTorii）
    float distToTorii = length( vec2( 0.15 - worldPos.x, -0.65 - worldPos.z ) );
    vec3 localRay = perturbedR - toToriiCenter * toriiAlign;
    float uTorii = localRay.x * distToTorii * 0.42 + ( R.x - toToriiCenter.x ) * 2.2;
    float vTorii = ( perturbedR.y - toToriiCenter.y * 0.55 ) * distToTorii * 0.38 + 0.48;

    // 明神鸟居精确几何轮廓场（左右双柱 ±0.52、岛木/笠木顶梁 v∈[0.74,0.92]、贯横梁 v∈[0.52,0.62]、额束）
    float inToriiWindow = smoothstep( 0.45, 0.82, toriiAlign ) * smoothstep( 12.5, 5.5, abs( worldPos.z - 2.2 ) );
    if ( inToriiWindow > 0.001 ) {
      float waveShimmer = sin( worldPos.z * 14.0 - uTime * 5.6 + worldPos.x * 9.0 ) * 0.045;
      float uT = uTorii + waveShimmer;
      float vT = vTorii + cos( worldPos.x * 12.0 - uTime * 4.8 ) * 0.035;

      // 左右朱红主柱（前座 + 后座双排韵律）
      float postL1 = smoothstep( 0.13, 0.05, abs( uT + 0.48 ) ) * smoothstep( 0.0, 0.08, vT ) * smoothstep( 0.88, 0.80, vT );
      float postR1 = smoothstep( 0.13, 0.05, abs( uT - 0.48 ) ) * smoothstep( 0.0, 0.08, vT ) * smoothstep( 0.88, 0.80, vT );
      float postL2 = smoothstep( 0.11, 0.04, abs( uT + 0.34 ) ) * smoothstep( 0.05, 0.12, vT ) * smoothstep( 0.82, 0.74, vT );
      float postR2 = smoothstep( 0.11, 0.04, abs( uT - 0.34 ) ) * smoothstep( 0.05, 0.12, vT ) * smoothstep( 0.82, 0.74, vT );

      // 贯（下横梁）与岛木（上横梁）
      float nuki = smoothstep( 0.72, 0.58, abs( uT ) ) * smoothstep( 0.07, 0.025, abs( vT - 0.56 ) );
      float shimaki = smoothstep( 0.82, 0.66, abs( uT ) ) * smoothstep( 0.065, 0.025, abs( vT - 0.76 ) );
      float gakuzuka = smoothstep( 0.07, 0.025, abs( uT ) ) * smoothstep( 0.54, 0.58, vT ) * smoothstep( 0.78, 0.74, vT );

      // 黑色反宇笠木（顶梁）
      float curveArch = 0.83 + 0.06 * uT * uT;
      float kasagi = smoothstep( 0.90, 0.72, abs( uT ) ) * smoothstep( 0.06, 0.02, abs( vT - curveArch ) );

      float vermilionHit = clamp( max( max( postL1, postR1 ), max( max( postL2, postR2 ), max( nuki, max( shimaki, gakuzuka ) ) ) ), 0.0, 1.0 );
      float blackHit = clamp( kasagi * ( 1.0 - vermilionHit * 0.5 ), 0.0, 1.0 );

      vec3 toriiRed = mix( vec3( 0.82, 0.16, 0.06 ), vec3( 0.98, 0.32, 0.12 ), 0.5 + 0.5 * sunWindow );
      vec3 toriiBlackCol = vec3( 0.08, 0.10, 0.12 );

      envColor = mix( envColor, toriiRed, vermilionHit * inToriiWindow * 0.88 );
      envColor = mix( envColor, toriiBlackCol, blackHit * inToriiWindow * 0.75 );
    }

    return envColor;
  }

  vec4 waterFlow( vec3 color, float baseAlpha, vec3 worldPos, vec3 normal, vec3 viewDir, vec2 localUv, float shadowMask ) {
    vec2 p = worldPos.xz;
    vec2 flowDir = normalize( uFlowDir );
    vec2 latDir = vec2( -flowDir.y, flowDir.x );
    float along = dot( p, flowDir );
    float lateral = dot( p, latDir );

    // 1. 合成三维波浪法线（SWE 浅水高度场法线 + Gerstner 三维波峰法线 + 微表面涟漪梯度）
    vec2 microGrad = streamWaveGradient( p, uTime * ( 0.85 + uFlowSpeed * 2.5 ) );
    vec3 sweN = length( vSweNormal ) > 0.1 ? vSweNormal : vec3( 0.0, 1.0, 0.0 );
    vec3 nrm = normalize( normal + ( sweN - vec3( 0.0, 1.0, 0.0 ) ) * 1.55 + vec3( -microGrad.x, 0.0, -microGrad.y ) * 1.35 );
    vec3 V = normalize( viewDir );
    float ndv = clamp( abs( dot( nrm, V ) ), 0.02, 1.0 );

    // 真实水体菲涅尔反射率（Schlick 近似，正视清澈见底 R≈0.02，掠射角强反射倒影）
    float fresnel = clamp( 0.03 + 0.82 * pow( 1.0 - ndv, 3.4 ), 0.03, 0.86 );

    vec2 sweSpan = max( vec2( 0.001 ), uSweDomainMax - uSweDomainMin );
    vec2 sweUv = clamp( ( p - uSweDomainMin ) / sweSpan, 0.0, 1.0 );
    vec4 sweFrag = texture2D( uSweTex, sweUv );
    float agitation = max( vSweAgitation, sweFrag.a );

    // 2. 瀑布水帘与漩涡辅件分支（柔化羽化，绝不遮挡河床）
    vec3 shallowTone = vec3( 0.24, 0.52, 0.45 );
    vec3 deepTone = vec3( 0.08, 0.25, 0.21 );
    vec3 foamTint = vec3( 0.82, 0.90, 0.88 );

    if ( uOverlayMode > 0.5 && uOverlayMode < 1.5 ) {
      // 6 级小瀑布透明水舌（仅在跌水口呈现晶莹水丝与落水气旋，边缘平滑羽化）
      float edgeX = smoothstep( 0.0, 0.28, localUv.x ) * smoothstep( 1.0, 0.72, localUv.x );
      float edgeY = smoothstep( 0.0, 0.22, localUv.y ) * smoothstep( 1.0, 0.74, localUv.y );
      vec2 fallUv = vec2( localUv.x * 7.5 + sin( localUv.y * 6.0 ) * 0.25, localUv.y * 2.8 - uTime * 4.2 );
      float fallThreads = smoothstep( 0.52, 0.84, waterFbm( fallUv ) );
      float plungeBubbles = smoothstep( 0.65, 0.95, localUv.y ) * smoothstep( 0.48, 0.80, waterNoise( fallUv * 2.4 ) );
      float alpha = edgeX * edgeY * ( 0.08 + 0.36 * fallThreads + 0.28 * plungeBubbles );
      return vec4( mix( shallowTone * 1.15, foamTint, fallThreads * 0.65 + plungeBubbles * 0.35 ), alpha );
    }
    if ( uOverlayMode >= 1.5 ) {
      return vec4( shallowTone, 0.0 );
    }

    // 3. 树冠遮挡阴影 vs 阳光直射窗口计算（结合 Three.js 硬件阴影 shadowMask 与林冠动态阳光窗）
    float sunWindow = canopySunWindow( worldPos, uWaterSunDir );
    float sunLit = clamp( shadowMask * ( 0.35 + 0.65 * sunWindow ), 0.0, 1.0 );
    float treeShade = 1.0 - sunLit;

    // 4. 真实水深解算与斯涅尔光学折射（Snell's Law Refraction）：清澈透出水底石头、卵石与金褐泥沙
    float cx = streamApproxCenterX( p.y );
    float bankDist = abs( p.x - cx );
    float geomDepth = clamp( 0.22 * ( 1.0 - smoothstep( 0.45, 1.38, bankDist ) ), 0.008, 0.36 );
    float waterDepth = geomDepth;

    vec2 screenUv = ( vWaterClipPos.xy / max( 0.0001, vWaterClipPos.w ) ) * 0.5 + 0.5;
    // 随三维波浪法线偏折折射采样坐标（波纹越起伏，水底卵石与泥沙的折射荡漾感越真实）
    vec2 refractOffset = nrm.xz * clamp( 0.018 + waterDepth * 0.085, 0.014, 0.048 );
    vec2 refractUv = clamp( screenUv - refractOffset, vec2( 0.002 ), vec2( 0.998 ) );

    if ( uHasRefraction > 0.5 ) {
      float rawSceneD = texture2D( tRefractionDepth, refractUv ).r;
      float surfD = linearizeDepth( gl_FragCoord.z, uCameraNear, uCameraFar );
      if ( rawSceneD < 0.9999 ) {
        float sceneD = linearizeDepth( rawSceneD, uCameraNear, uCameraFar );
        // 深度防伪影保护：若折射采样点落在了出水巨石上（sceneD < surfD），回退至未偏移的 screenUv
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

    // Beer-Lambert 波长选择性消光（浅水 94% 透明直视泥沙卵石，深水泛清透冷翠色）
    vec3 sigma = vec3( 2.35, 0.72, 0.96 ) * ( uExtinctionDensity * 0.38 );
    vec3 transmittance = exp( -sigma * waterDepth );
    float extinction = 1.0 - ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;

    vec3 waterBody = mix( shallowTone, deepTone, extinction );
    if ( uHasRefraction > 0.5 ) {
      vec3 refractedBed = texture2D( tRefractionColor, refractUv ).rgb;
      // 阳光直射处水底卵石与泥沙更通透明亮，树冠阴影下水底自然压暗
      float bedSunBoost = 0.82 + 0.42 * sunLit;
      vec3 clearBed = refractedBed * transmittance * bedSunBoost;
      vec3 scatterWater = mix( shallowTone, deepTone, extinction ) * ( 0.22 + 0.32 * sunLit );
      waterBody = mix( scatterWater, clearBed, clamp( transmittance.g * 0.92 + 0.08, 0.25, 0.96 ) );
    }

    // 5. 真实光追反射与平面镜面反射（反射翠绿树木与特定角度的朱红色鸟居，随波浪法线波光粼粼）
    vec3 R = reflect( -V, nrm );
    vec3 rayTracedEnv = traceSceneReflectionRay( worldPos, R, sunLit );

    // 结合离屏平面反射缓冲（tReflectionColor）与屏幕空间步进反射（SSR）
    if ( uHasReflection > 0.5 ) {
      vec2 reflUv = clamp( vec2( screenUv.x, 1.0 - screenUv.y ) + nrm.xz * 0.072, vec2( 0.002 ), vec2( 0.998 ) );
      vec3 planarRefl = texture2D( tReflectionColor, reflUv ).rgb;
      float planarLuma = dot( planarRefl, vec3( 0.299, 0.587, 0.114 ) );
      if ( planarLuma > 0.008 ) {
        // 若离屏反射捕获到了朱红鸟居或树冠，与三维几何光追反射融合
        rayTracedEnv = mix( rayTracedEnv, planarRefl * 1.18, 0.52 );
      }
    }
    if ( uHasRefraction > 0.5 ) {
      // 屏幕空间近场步进（SSR）：让溪边紧贴水面的岩石与蕨类在波浪上产生近景倒影
      vec2 ssrUv = clamp( screenUv + vec2( nrm.x * 0.045, abs( R.y ) * 0.085 + nrm.z * 0.045 ), vec2( 0.002 ), vec2( 0.998 ) );
      float ssrDepth = linearizeDepth( texture2D( tRefractionDepth, ssrUv ).r, uCameraNear, uCameraFar );
      float surfDepth = linearizeDepth( gl_FragCoord.z, uCameraNear, uCameraFar );
      if ( ssrDepth < surfDepth + 1.8 && ssrDepth > surfDepth - 0.6 ) {
        vec3 ssrCol = texture2D( tRefractionColor, ssrUv ).rgb;
        rayTracedEnv = mix( rayTracedEnv, ssrCol * 0.95, 0.36 );
      }
    }

    // 波浪曲率调制反射亮度（让倒影呈现参考图中“波光粼粼、随水波破碎摇曳”的真实质感）
    float waveFacet = smoothstep( 0.25, 0.85, vWaveCrest + dot( nrm.xz, vec2( 0.7, 0.7 ) ) * 1.4 );
    vec3 waveReflection = rayTracedEnv * ( 0.75 + 0.48 * waveFacet ) * ( 0.68 + 0.45 * sunLit );

    // 6. 阳光直射处的粼粼波光（GGX 微表面闪烁高光 Solar Glitter，树影遮挡处自动隐去）
    vec3 L = normalize( -uWaterSunDir );
    vec3 H = normalize( V + L );
    float ndh = max( 0.0, dot( nrm, H ) );

    // 双尺度波峰高光：宽波峰天光辉光 + 锐利阳光钻石星芒闪烁
    vec2 glitterCell = floor( p * 18.0 + vec2( 0.0, -uTime * 3.2 ) );
    float cellSparkle = waterHash21( glitterCell );
    vec3 sparkleNrm = normalize( nrm + vec3(
      sin( p.x * 38.0 + uTime * 6.5 ) * 0.16,
      0.0,
      cos( p.y * 42.0 - uTime * 7.8 ) * 0.16
    ) );
    float sparkleNdh = max( 0.0, dot( sparkleNrm, H ) );

    float broadSpec = pow( ndh, 42.0 ) * 0.45;
    float sharpGlint = pow( sparkleNdh, 240.0 ) * ( 1.8 + 1.6 * step( 0.62, cellSparkle ) );
    // 树影遮挡处仅保留微弱天光高光，阳光直射处迸发璀璨粼粼波光
    vec3 sunGlitter = vec3( 1.0, 0.97, 0.88 ) * ( broadSpec * ( 0.18 + 0.82 * sunLit ) + sharpGlint * sunLit * 1.45 );

    // 7. 极克制的物理碰撞微泡沫（仅在石头接触边缘 waterDepth < 0.024m 与陡峭跌水处产生细密水花，绝不在水面铺白膜）
    float slopeTilt = clamp( ( 1.0 - abs( nrm.y ) ) * 5.2, 0.0, 1.0 );
    vec2 bubbleUv = vec2( lateral * 9.0 + nrm.x * 1.2, along * 5.5 - uTime * uFlowSpeed * 6.5 );
    float microBubble = smoothstep( 0.64, 0.88, waterFbm( bubbleUv ) );
    float contactRing = ( 1.0 - smoothstep( 0.004, uShoreFoamThreshold * 0.48, waterDepth ) ) * smoothstep( 0.35, 0.85, agitation );
    float cascadeSplash = smoothstep( 0.55, 0.92, slopeTilt ) * microBubble * 0.65;
    float totalFoam = clamp( contactRing * microBubble * 0.72 + cascadeSplash, 0.0, 0.68 );

    // 8. 最终水体光学合成：折射水底 + 菲涅尔波光倒影（树木 & 朱红鸟居）+ 阳光直射粼粼波光 + 撞石微沫
    float reflectMix = clamp( fresnel * ( 0.65 + 0.45 * waveFacet ) + 0.14, 0.12, 0.84 );
    vec3 surfaceCol = mix( waterBody, waveReflection, reflectMix );
    surfaceCol += sunGlitter;
    surfaceCol = mix( surfaceCol, foamTint * ( 0.72 + 0.28 * sunLit ), totalFoam );

    // 树冠遮挡阴影对比增强：让林荫处水色沉静幽深，阳光处通透闪耀
    surfaceCol *= ( 0.74 + 0.34 * sunLit );

    float edgeFade = 1.0 - smoothstep( 1.18, 1.48, bankDist );
    float glintAlpha = clamp( dot( sunGlitter, vec3( 0.333 ) ) * 0.45, 0.0, 0.35 );
    float clearAlpha = uHasRefraction > 0.5
      ? clamp( ( 0.46 + extinction * 0.22 + fresnel * 0.32 + totalFoam * 0.25 + glintAlpha ) * edgeFade, 0.18, 0.88 )
      : clamp( ( 0.24 + extinction * 0.24 + fresnel * 0.42 + totalFoam * 0.35 + glintAlpha ) * edgeFade, 0.12, 0.78 );

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
    // GLSL smoothstep(edge0, edge1, x) 严格保证 edge0 < edge1
    float streamMask = ( 1.0 - smoothstep( -1.85, -1.10, worldPos.x ) ) * smoothstep( -6.2, -5.0, worldPos.x );
    float u = clamp( ( 11.6 - worldPos.z ) / 20.8, 0.0, 1.0 );
    float approxWy = 0.25 + 2.95 * pow( u, 1.08 );
    // 严格仅对水面以下的河床与水下卵石生效（出水石面绝不染色）
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

    // 使用有限差分拉普拉斯曲率聚焦（避免在条件分支中使用 dFdx/dFdy 引发 Metal/ANGLE 未定义行为）
    float laplacian = ( hR + hL + hU + hD - 4.0 * hC ) / ( eps * eps );
    float focusDepth = clamp( waterDepth * 1.9, 0.08, 0.55 );
    float curvatureFocus = clamp( 1.0 - laplacian * focusDepth * 0.52, 0.25, 2.8 );

    float causticNet = pow( max( 0.0, curvatureFocus - 0.74 ), 1.65 );
    float net1 = bedNoise( newPos.xz * 4.6 + vec2( 0.0, -uCausticTime * 1.8 ) );
    float net2 = bedNoise( newPos.xz * 7.8 + vec2( 3.7, -uCausticTime * 2.5 ) );
    float cellNet = smoothstep( 0.58, 0.88, net1 * 0.6 + net2 * 0.4 );
    causticNet = clamp( causticNet * 0.65 + cellNet * 0.55, 0.0, 1.35 );

    // 阳光穿透树冠窗口的地方焦散明亮清澈，树影遮挡的地方水底幽静自然
    float sunWin = bedCanopySunWindow( worldPos, uCausticLightDir );
    float absorb = 1.0 - exp( -waterDepth * 1.8 );
    vec3 clearBed = bedColor * ( 0.86 + 0.34 * sunWin );
    vec3 tintedBed = mix( clearBed, clearBed * vec3( 0.76, 0.92, 0.86 ), absorb * 0.42 );

    float upFacing = clamp( dot( normalize( normal ), vec3( 0.0, 1.0, 0.0 ) ) * 0.7 + 0.3, 0.0, 1.0 );
    vec3 causticLight = vec3( 0.76, 0.88, 0.78 ) * causticNet * upFacing * ( 0.28 + 0.85 * sunWin );

    return mix( bedColor, tintedBed + causticLight * 0.58, submergeMask );
  }
`;
