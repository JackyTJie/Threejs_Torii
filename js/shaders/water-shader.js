// 山涧溪流光学水体与水底实时折射焦散着色器（无贴图、无规则点阵、清澈见底）：
// 1) 水底折射焦散（RIVERBED_CAUSTICS_FRAG）：
//    直接作用在溪床泥沙（soilStreamBed）、溪底鹅卵石（stonePebble）与溪石（stoneStream）上，
//    根据水面波浪法线的斯涅尔折射（Snell's Law, IOR 1.0 -> 1.333）与光线雅可比散度（Jacobian Area Ratio），
//    在水底泥土与卵石表面投射出随波流动的澄澈焦散亮网，并根据水深做比尔-朗伯定律（Beer-Lambert）青翠色消光；
// 2) 清澈光学水面（WATER_FLOW_FRAG）：
//    彻底摒弃假贴图与规则正弦高光点阵，采用纯物理菲涅尔反射（Schlick Fresnel）+ 切向流线微澜，
//    垂直俯视时水体极度澄澈透明（alpha 仅 0.14~0.26），直视水底焦散与卵石；仅在掠射角与小瀑布跌水处泛起柔和天光与丝状水花。

export const WATER_FLOW_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform vec2 uFlowDir;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform float uFlowScale;
  uniform float uFlowStrength;
  uniform float uOverlayMode;
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

  // 计算曲折溪流中心线近似 X 坐标（与 layout.js STREAM_PATH 对齐）
  float streamApproxCenterX( float z ) {
    return -3.25 + 0.58 * sin( z * 0.36 + 0.5 ) + 0.28 * cos( z * 0.21 - 0.8 );
  }

  // 根据连续多波叠加场求取解析波浪梯度，杜绝规则网格点阵
  vec2 streamWaveGradient( vec2 xz, float time ) {
    float cx = streamApproxCenterX( xz.y );
    float lat = xz.x - cx;
    float s = xz.y * 1.04;
    vec2 q1 = vec2( lat * 2.4 + sin( s * 0.7 ) * 0.4, s * 2.1 - time * 2.8 );
    vec2 q2 = vec2( lat * 4.1 - cos( s * 1.1 ) * 0.3, s * 3.8 - time * 4.2 );
    float eps = 0.06;
    float h0 = waterFbm( q1 ) * 0.65 + waterFbm( q2 ) * 0.35;
    float hx = waterFbm( q1 + vec2( eps, 0.0 ) ) * 0.65 + waterFbm( q2 + vec2( eps, 0.0 ) ) * 0.35;
    float hz = waterFbm( q1 + vec2( 0.0, eps ) ) * 0.65 + waterFbm( q2 + vec2( 0.0, eps ) ) * 0.35;
    return ( vec2( hx - h0, hz - h0 ) / eps ) * 0.16;
  }

  vec4 waterFlow( vec3 color, float baseAlpha, vec3 worldPos, vec3 normal, vec3 viewDir, vec2 localUv ) {
    vec2 p = worldPos.xz;
    vec2 flowDir = normalize( uFlowDir );
    vec2 latDir = vec2( -flowDir.y, flowDir.x );
    float along = dot( p, flowDir );
    float lateral = dot( p, latDir );

    vec2 grad = streamWaveGradient( p, uTime * ( 0.8 + uFlowSpeed * 2.5 ) );
    vec3 nrm = normalize( normal + vec3( -grad.x, 0.0, -grad.y ) );
    vec3 V = normalize( viewDir );
    float ndv = clamp( abs( dot( nrm, V ) ), 0.0, 1.0 );

    // 物理 Schlick 菲涅尔：垂直俯视时极低反射、极高透射（清澈见底），掠射角柔和映出林冠天光
    float fresnel = 0.02 + 0.42 * pow( 1.0 - ndv, 4.2 );

    // 顺流拉丝流线（用于小瀑布跌水与急流微澜，全部采用非周期 FBM 连续流场）
    vec2 streamUv = vec2( lateral * 5.2 + grad.x * 1.4, along * 1.8 - uTime * uFlowSpeed * 9.5 );
    float ribbonA = waterFbm( streamUv );
    float ribbonB = waterFbm( streamUv * vec2( 1.9, 1.35 ) + vec2( 7.4, -uTime * uFlowSpeed * 5.0 ) );
    float filament = smoothstep( 0.52, 0.78, ribbonA * 0.62 + ribbonB * 0.38 );

    // 小瀑布坡度检测：水面越陡，重力加速跌水水花越明显
    float slopeTilt = clamp( ( 1.0 - abs( nrm.y ) ) * 4.5, 0.0, 1.0 );
    float cascadeFoam = slopeTilt * filament;

    // 岸边与溪石边缘柔化度
    float cx = streamApproxCenterX( p.y );
    float bankDist = abs( p.x - cx );
    float bankShore = smoothstep( 0.92, 1.35, bankDist );
    float edgeFade = 1.0 - smoothstep( 1.15, 1.48, bankDist );

    // 幽深森林林冠天光反射色与清溪水体透射色
    vec3 canopyReflect = vec3( 0.20, 0.34, 0.27 );
    vec3 foamTint = vec3( 0.50, 0.64, 0.58 );
    vec3 shallowTone = uShallowColor * 0.90;
    vec3 deepTone = uDeepColor * 0.82;

    // 1) 粒子流体与水花（uOverlayMode == 3）
    if ( uOverlayMode > 2.5 ) {
      vec3 dropletCol = mix( shallowTone * 1.15, foamTint * 1.12, 0.65 );
      return vec4( dropletCol, baseAlpha * 0.72 );
    }
    // 2) 瀑下回流旋涡泡沫丝（uOverlayMode == 2）
    if ( uOverlayMode > 1.5 ) {
      vec2 centered = localUv - vec2( 0.5 );
      float dist = length( centered ) * 2.0;
      float ang = atan( centered.y, centered.x );
      float radialFade = smoothstep( 1.0, 0.24, dist ) * smoothstep( 0.06, 0.26, dist );
      vec2 swirlUv = vec2( dist * 3.5, ang * 0.95 - uTime * 1.6 + dist * 4.2 );
      float swirlBand = smoothstep( 0.48, 0.76, waterFbm( swirlUv * 2.2 ) );
      float alphaOut = baseAlpha * radialFade * swirlBand * 0.68;
      vec3 eddyCol = mix( shallowTone, foamTint, 0.45 + 0.55 * swirlBand );
      return vec4( eddyCol, alphaOut );
    }
    // 3) 样条曲线瀑布流管水帘（uOverlayMode == 1）
    if ( uOverlayMode > 0.5 ) {
      float edgeX = smoothstep( 0.0, 0.24, localUv.x ) * smoothstep( 1.0, 0.76, localUv.x );
      float edgeY = smoothstep( 0.0, 0.18, localUv.y ) * smoothstep( 1.0, 0.78, localUv.y );
      vec2 fallUv = vec2( localUv.x * 6.5, localUv.y * 2.6 - uTime * 3.8 );
      float fallThreads = smoothstep( 0.42, 0.78, waterFbm( fallUv ) );
      float curtainAlpha = baseAlpha * edgeX * edgeY * ( 0.16 + 0.68 * fallThreads );
      vec3 curtainCol = mix( shallowTone * 0.88, foamTint, fallThreads );
      return vec4( curtainCol, curtainAlpha );
    }

    // 4) 主清澈水面（uOverlayMode == 0）：
    // 垂直看去清澈见底（alpha 极低，水下河床焦散与鹅卵石一目了然），斜看泛起柔和菲涅尔林冠反光与流线微澜
    vec3 waterTint = mix( deepTone, shallowTone, 0.35 + 0.45 * filament );
    vec3 surfaceCol = mix( waterTint, canopyReflect, fresnel );
    float shoreFoam = bankShore * smoothstep( 0.54, 0.78, ribbonB ) * 0.32;
    float totalFoam = clamp( cascadeFoam * 0.82 + shoreFoam, 0.0, 0.78 );
    surfaceCol = mix( surfaceCol, foamTint, totalFoam );

    // 关键：平缓深潭处 alpha 低至 0.16~0.28，绝不遮挡水底卵石与水底焦散；仅在菲涅尔掠射角与瀑布跌水处升高
    float clearAlpha = clamp( ( 0.15 + fresnel * 0.48 + totalFoam * 0.52 + filament * 0.06 ) * edgeFade, 0.08, 0.74 );
    return vec4( surfaceCol, clearAlpha );
  }
`;

/**
 * 水底河床与水中鹅卵石专属：实时斯涅尔折射焦散（Snell's Law Refractive Caustics）+ 比尔定律水深消光。
 * 让焦散真正长在「水下的泥土、砂砾与石头表面」，从而透过高透明水面呈现「清可见底、澄澈透亮」的真实山涧质感！
 */
export const RIVERBED_CAUSTICS_UNIFORMS = /* glsl */ `
  uniform float uCausticTime;
  uniform vec3 uCausticLightDir;
  uniform vec3 uWaterAbsorbShallow;
  uniform vec3 uWaterAbsorbDeep;
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

  // 计算水波表面高度场，供斯涅尔折射与雅可比面积收敛度（Real-time Caustics Area Ratio）使用
  float surfaceWaveHeightAt( vec2 xz, float t ) {
    vec2 p1 = vec2( xz.x * 2.1, xz.y * 1.6 - t * 1.85 );
    vec2 p2 = vec2( xz.x * 3.4 - 0.6 * xz.y, xz.y * 2.9 - t * 2.65 );
    float h = ( bedNoise( p1 ) - 0.5 ) * 0.045 + ( bedNoise( p2 ) - 0.5 ) * 0.025;
    p1 = mat2( 0.8, -0.6, 0.6, 0.8 ) * p1 * 2.02;
    h += ( bedNoise( p1 + vec2( 0.0, -t * 1.4 ) ) - 0.5 ) * 0.015;
    return h;
  }

  vec3 applyRiverbedCaustics( vec3 bedColor, vec3 worldPos, vec3 normal ) {
    // 仅在溪谷走廊（x < -1.15）的水下或湿岸区域激活水底折射焦散
    float streamMask = smoothstep( -1.10, -1.85, worldPos.x ) * smoothstep( -6.2, -5.0, worldPos.x );
    if ( streamMask <= 0.001 ) return bedColor;

    // 估算当前 z 处的溪流水面高度 wy（与 layout.js valleyLevel + STREAM_CASCADES 一致）
    float u = clamp( ( 11.6 - worldPos.z ) / ( 11.6 - ( -9.2 ) ), 0.0, 1.0 );
    float approxWy = 0.25 + ( 3.25 - 0.30 ) * pow( u, 1.08 );
    float waterDepth = clamp( approxWy - worldPos.y + 0.14, 0.0, 0.65 );
    float submergeMask = smoothstep( 0.0, 0.06, waterDepth ) * streamMask;
    if ( submergeMask <= 0.001 ) return bedColor;

    // 采样水面波浪法线并计算斯涅尔折射光线（IOR_AIR / IOR_WATER = 1.0 / 1.333 = 0.75）
    float eps = 0.055;
    vec2 xz = worldPos.xz;
    float hC = surfaceWaveHeightAt( xz, uCausticTime );
    float hR = surfaceWaveHeightAt( xz + vec2( eps, 0.0 ), uCausticTime );
    float hU = surfaceWaveHeightAt( xz + vec2( 0.0, eps ), uCausticTime );
    float hL = surfaceWaveHeightAt( xz - vec2( eps, 0.0 ), uCausticTime );
    float hD = surfaceWaveHeightAt( xz - vec2( 0.0, eps ), uCausticTime );

    vec3 surfNormal = normalize( vec3( ( hL - hR ) / ( 2.0 * eps ), 1.0, ( hD - hU ) / ( 2.0 * eps ) ) );
    vec3 lightDir = normalize( uCausticLightDir );
    vec3 refRay = refract( -lightDir, surfNormal, 0.75 );

    // 利用水面曲率（拉普拉斯算子 ∇²h）解析求解折射光线在河床深度 waterDepth 处的聚焦强度（Caustics Convergence）
    float laplacian = ( hR + hL + hU + hD - 4.0 * hC ) / ( eps * eps );
    float focusDepth = clamp( waterDepth * 1.8, 0.08, 0.55 );
    float convergence = clamp( 1.0 - laplacian * focusDepth * 0.42, 0.25, 2.8 );
    float causticNet = pow( max( 0.0, convergence - 0.72 ), 1.65 );

    // 叠加折射偏移后的双层微焦散网，形成清澈山涧水底灵动光网
    vec2 refractedXz = xz + refRay.xz * ( waterDepth / max( 0.25, abs( refRay.y ) ) );
    float net2 = bedNoise( refractedXz * 4.8 + vec2( 0.0, -uCausticTime * 1.6 ) );
    causticNet = clamp( causticNet * 0.72 + smoothstep( 0.62, 0.88, net2 ) * 0.45, 0.0, 1.35 );

    // 比尔-朗伯定律（Beer-Lambert Law）：清澈浅水保留泥土与卵石原色并提亮焦散，深潭过渡至澄澈冷翠色
    float absorb = 1.0 - exp( -waterDepth * 2.4 );
    vec3 tintedBed = mix( bedColor * 1.08, bedColor * uWaterAbsorbShallow * 1.45, absorb * 0.62 );
    tintedBed = mix( tintedBed, uWaterAbsorbDeep * 0.65, absorb * absorb * 0.38 );

    float upFacing = clamp( dot( normalize( normal ), vec3( 0.0, 1.0, 0.0 ) ) * 0.7 + 0.3, 0.0, 1.0 );
    vec3 causticLight = vec3( 0.46, 0.72, 0.60 ) * causticNet * upFacing * ( 1.0 - absorb * 0.35 );

    return mix( bedColor, tintedBed + causticLight * 0.52, submergeMask );
  }
`;
