// 三渲二着色扩展：半兰伯特漫反射、色阶带、叶片次表面透光、
// 灰褐基底上高密度深绿微点连成大片的真实片状青苔（遵循「靠近溪流多、靠近路边多、路正中少」规律）、
// 百年参道石阶 4 层复合材质、全局光照颜色反弹、石灯笼 3×3 格栅地面光斑投射、以及鸟居三段式真实物理老化。

/** 半兰伯特漫反射：把 [-1,1] 映射到 [0,1]，让明暗交界更柔和、暗部不死黑 */
export const HALF_LAMBERT_DIFFUSE = /* glsl */ `
  float halfLambert = dot( normal, directLight.direction ) * 0.5 + 0.5;
  float toonBand = clamp( halfLambert, 0.0, 1.0 );
`;

/** 色阶带量化：与 gradientMap 配合，控制硬/软边缘 */
export const BAND_QUANTIZE = /* glsl */ `
  float bandQuantize( float value, float steps ) {
    return floor( clamp( value, 0.0, 1.0 ) * steps + 0.5 ) / steps;
  }
`;

/** 叶片透光（translucency）：背光侧被主光点亮，颜色与强度由 uniform 决定 */
export const LEAF_TRANSLUCENCY_UNIFORMS = /* glsl */ `
  uniform vec3 uTranslucencyColor;
  uniform float uTranslucencyStrength;
  uniform float uTranslucencyPower;
  uniform vec3 uTranslucencySunTint;
  uniform vec3 uSunDir;
`;

export const LEAF_TRANSLUCENCY_FRAG = /* glsl */ `
  vec3 leafTranslucency( vec3 normal, vec3 viewDir, vec3 sunTravel, vec3 lightColor, float lightIntensity ) {
    float back = dot( viewDir, sunTravel );
    back = pow( clamp( back, 0.0, 1.0 ), uTranslucencyPower );
    float rim = pow( 1.0 - clamp( dot( normal, viewDir ), 0.0, 1.0 ), 2.0 );
    float thickness = 0.35 + 0.65 * rim;
    return uTranslucencyColor * back * thickness * uTranslucencyStrength * lightColor * lightIntensity;
  }
`;

/**
 * 真实片状微颗粒青苔附着（灰褐色基底上密集的绿色小圆点连成一大片青苔）：
 * - 宏观形态：连绵成片的有机不规则片状苔斑（macroSheet），绝非孤立散落的大圆点；
 * - 微观肌理：底层与外缘先铺垫灰褐色湿润腐殖土（soilSubstrate），其上由成千上万密集的细小深绿色苔点连缀成片（85%+ 覆盖率，孔隙微露灰褐底土）；
 * - 空间规律：靠近左侧溪流处最厚、靠近石阶路边次之、路正中间少。
 */
export const MOSS_ATTACHMENT_UNIFORMS = /* glsl */ `
  uniform vec3 uMossColor;
  uniform float uMossHeight;
  uniform float uMossBand;
  uniform float uMossAmount;
  uniform vec3 uMossSunDir;
`;

export const MOSS_ATTACHMENT_FRAG = /* glsl */ `
  float mossHash( vec3 p ) {
    p = fract( p * vec3( 12.9898, 78.233, 45.164 ) );
    p += dot( p, p.yzx + 19.19 );
    return fract( ( p.x + p.y ) * p.z );
  }

  float mossNoise3( vec3 p ) {
    vec3 i = floor( p );
    vec3 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix(
        mix( mossHash( i ), mossHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
        mix( mossHash( i + vec3( 0.0, 1.0, 0.0 ) ), mossHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ),
        f.y
      ),
      mix(
        mix( mossHash( i + vec3( 0.0, 0.0, 1.0 ) ), mossHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
        mix( mossHash( i + vec3( 0.0, 1.0, 1.0 ) ), mossHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ),
        f.y
      ),
      f.z
    );
  }

  vec3 applyMoss( vec3 baseColor, vec3 worldPos, vec3 normal, vec3 sunDir ) {
    vec3 nrm = normalize( normal );
    float heightFade = 1.0 - clamp( ( worldPos.y - uMossHeight ) / max( uMossBand, 0.001 ), 0.0, 1.0 );
    float shade = clamp( 0.55 + 0.65 * dot( nrm, sunDir ), 0.0, 1.0 );
    float sunlitSuppress = smoothstep( -0.55, 0.25, dot( nrm, sunDir ) );
    // 严格递增 smoothstep：越靠近左侧溪流（worldPos.x 越小），streamBias 越高
    float streamBias = 0.55 + 0.75 * ( 1.0 - smoothstep( -1.65, 1.85, worldPos.x ) );

    // 宏观连片噪声（低频控制大片形状）+ 高频密集微点（控制内部颗粒肌理）
    float nSheet1 = mossNoise3( worldPos * 1.85 );
    float nSheet2 = mossNoise3( worldPos * 4.2 + vec3( 5.2, 1.7, 3.4 ) );
    float sheetField = nSheet1 * 0.65 + nSheet2 * 0.35;

    float nMicroDot = mossNoise3( worldPos * 52.0 + vec3( 19.1, -11.4, 8.7 ) );
    float nUltraDot = mossHash( floor( worldPos * 145.0 ) );

    float topFacing = smoothstep( 0.32, 0.80, nrm.y );
    float rawSheet = max(
      heightFade * ( 0.40 + 0.60 * shade ) * streamBias * smoothstep( 0.28, 0.56, sheetField ) * 0.78,
      smoothstep( 0.32, 0.58, sheetField + topFacing * 0.16 + ( streamBias - 0.80 ) * 0.20 )
        * topFacing * ( 0.42 + 0.58 * sunlitSuppress ) * streamBias * 0.92
    ) * uMossAmount;

    // 1) 灰褐色湿腐殖土基底：覆盖整片苔斑及外缘过渡圈
    float soilMask = clamp( smoothstep( 0.08, 0.32, rawSheet ), 0.0, 0.85 );
    vec3 soilSubstrate = mix( vec3( 0.16, 0.13, 0.10 ), vec3( 0.25, 0.21, 0.17 ), nMicroDot );

    // 2) 密集绿色微点连成一大片青苔：在片状区域内部以高密度（85%+）微点连缀成片，仅微细孔隙透出底层灰褐土
    float sheetCore = smoothstep( 0.18, 0.44, rawSheet );
    float denseMicroDots = smoothstep( 0.12, 0.48, nMicroDot * 0.58 + nUltraDot * 0.42 );
    float mossCarpetMask = sheetCore * ( 0.52 + 0.48 * denseMicroDots );

    vec3 darkGreenDot = mix(
      vec3( 0.08, 0.15, 0.06 ),
      uMossColor * vec3( 0.72, 0.84, 0.58 ),
      clamp( nUltraDot * 0.62 + nMicroDot * 0.38, 0.0, 1.0 )
    );
    float matteRough = 0.78 + 0.28 * ( nUltraDot - 0.5 );

    vec3 withSoil = mix( baseColor, soilSubstrate, soilMask * 0.76 );
    return mix( withSoil, darkGreenDot * matteRough, clamp( mossCarpetMask * 0.90, 0.0, 0.88 ) );
  }
`;

export const WEATHERING_UNIFORMS = /* glsl */ `
  uniform vec3 uWearColor;
  uniform vec3 uDustColor;
  uniform float uWearStart;
  uniform float uWearBand;
  uniform float uWearAmount;
  uniform float uDustAmount;
  uniform float uRoughnessVar;
  uniform float uToriiMode;
  uniform vec3 uSpecSunDir;
  uniform float uWeatherTime;
  uniform float uWeatherWetness;
  uniform float uLanternIntensity;
  uniform vec3 uLanternPosL;
  uniform vec3 uLanternPosR;
`;

export const WEATHERING_FRAG = /* glsl */ `
  float wearNoise( vec3 p ) {
    return fract( sin( dot( floor( p * 13.0 ), vec3( 39.3468, 11.135, 27.719 ) ) ) * 24634.6345 );
  }

  float smoothWearNoise( vec3 p ) {
    vec3 i = floor( p );
    vec3 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    float a = fract( sin( dot( i, vec3( 39.3468, 11.135, 27.719 ) ) ) * 24634.6345 );
    float b = fract( sin( dot( i + vec3( 1.0, 0.0, 0.0 ), vec3( 39.3468, 11.135, 27.719 ) ) ) * 24634.6345 );
    float c = fract( sin( dot( i + vec3( 0.0, 1.0, 0.0 ), vec3( 39.3468, 11.135, 27.719 ) ) ) * 24634.6345 );
    float d = fract( sin( dot( i + vec3( 1.0, 1.0, 0.0 ), vec3( 39.3468, 11.135, 27.719 ) ) ) * 24634.6345 );
    return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
  }

  // 近似参道中心线 X(z)，用于定位石阶中央踩踏带与两侧路边青苔带
  float approxPathCenterX( float z ) {
    if ( z > -0.9 ) {
      float u = clamp( ( 11.6 - z ) / 12.5, 0.0, 1.0 );
      return 0.82 * ( 1.0 - u ) * ( 1.0 - u ) + 2.0 * ( -0.34 ) * u * ( 1.0 - u ) + 0.28 * u * u;
    }
    float s = clamp( -0.9 - z, 0.0, 8.3 );
    return 0.28 + 0.0992 * s + 0.032 * s * s;
  }

  // 参道木灯笼 3×3 格栅地面投射光斑（收敛在灯笼正下方石阶，不染色高处树叶）
  vec3 evalLanternLatticeGobo( vec3 worldPos, vec3 nrm ) {
    if ( uLanternIntensity <= 0.01 ) return vec3( 0.0 );
    vec3 totalGlow = vec3( 0.0 );
    for ( int i = 0; i < 2; i++ ) {
      vec3 lPos = i == 0 ? uLanternPosL : uLanternPosR;
      vec3 toFrag = worldPos - lPos;
      float dist = length( toFrag );
      if ( dist < 2.25 && toFrag.y < -0.15 ) {
        vec3 dir = toFrag / max( dist, 0.001 );
        float ndl = max( 0.0, dot( nrm, -dir ) );
        float atten = exp( -dist * 1.35 ) * ( 1.0 - smoothstep( 0.4, 2.25, dist ) ) * ( 0.35 + 0.65 * ndl );
        vec2 horiz = toFrag.xz / max( 0.28, -toFrag.y + 0.35 );
        float barX = smoothstep( 0.08, 0.22, abs( fract( horiz.x * 2.35 + 0.5 ) - 0.5 ) );
        float barZ = smoothstep( 0.08, 0.22, abs( fract( horiz.y * 2.35 + 0.5 ) - 0.5 ) );
        float postShadow = smoothstep( 0.14, 0.32, length( toFrag.xz ) );
        float latticePattern = mix( 0.42, 1.12, barX * barZ ) * postShadow;
        totalGlow += vec3( 1.0, 0.72, 0.32 ) * atten * latticePattern * uLanternIntensity * 0.15;
      }
    }
    return totalGlow;
  }

  vec3 applyWeathering( vec3 baseColor, vec3 worldPos, vec3 normal, vec3 viewDir ) {
    vec3 nrm = normalize( normal );
    vec3 lightToEye = normalize( -uSpecSunDir );
    float hRel = worldPos.y - uWearStart;
    float bottom = 1.0 - clamp( hRel / max( uWearBand, 0.001 ), 0.0, 1.0 );
    float n = wearNoise( worldPos );
    float grain = smoothWearNoise( worldPos * vec3( 9.5, 24.0, 9.5 ) );
    float woodFiber = 0.5 + 0.5 * sin( ( worldPos.x + worldPos.z ) * 68.0 + grain * 5.0 );

    vec3 c = baseColor;
    float wear = clamp( ( bottom * ( 0.48 + 0.88 * n ) + ( 1.0 - grain ) * 0.22 ) * uWearAmount, 0.0, 1.0 );

    if ( uToriiMode > 0.5 && uToriiMode < 1.5 ) {
      float sunFacing = dot( nrm, lightToEye );
      float warmSunMask = smoothstep( -0.10, 0.62, sunFacing );
      vec3 warmOrangeShift = c * vec3( 1.12, 0.90, 0.64 ) + vec3( 0.035, 0.018, 0.002 );
      vec3 deepUmberShadow = c * vec3( 0.64, 0.34, 0.25 );
      c = mix( deepUmberShadow, warmOrangeShift, warmSunMask );

      float waistTouch = exp( -pow( ( hRel - 1.32 ) / 0.36, 2.0 ) );
      wear *= ( 1.0 - waistTouch * 0.76 );
      c = mix( c, c * vec3( 1.16, 1.08, 0.96 ) + vec3( 0.028, 0.012, 0.004 ), waistTouch * 0.68 );

      float splashZone = 1.0 - smoothstep( 0.04, 0.92, hRel );
      float peelPattern = smoothstep( 0.28, 0.72, splashZone * ( 0.65 + 0.55 * n ) + ( 1.0 - woodFiber ) * 0.35 * splashZone );
      vec3 bareWoodGrain = mix( vec3( 0.07, 0.05, 0.04 ), vec3( 0.22, 0.14, 0.09 ), woodFiber );
      c = mix( c, uWearColor, wear * 0.65 );
      c = mix( c, bareWoodGrain, peelPattern * 0.88 );

      vec3 halfVec = normalize( lightToEye + normalize( viewDir ) );
      float ndh = max( 0.0, dot( nrm, halfVec ) );
      float expPower = mix( 16.0, 56.0, waistTouch * 0.75 + grain * 0.25 );
      float specMask = ( 1.0 - peelPattern * 0.92 ) * ( 0.32 + 0.68 * grain + waistTouch * 1.15 ) * ( 1.0 + uWeatherWetness * 0.45 );
      float spec = pow( ndh, expPower ) * specMask;
      c += vec3( 0.28, 0.16, 0.08 ) * spec * uRoughnessVar * 0.42;
    } else if ( uToriiMode >= 1.5 && uToriiMode < 2.5 ) {
      float heavyDust = smoothstep( 0.08, 0.72, nrm.y ) * ( 0.52 + 0.48 * grain + 0.35 * n ) * uDustAmount;
      c = mix( c, uWearColor, wear * 0.55 );
      c = mix( c, vec3( 0.24, 0.25, 0.20 ), clamp( heavyDust, 0.0, 0.78 ) );
    } else if ( uToriiMode >= 2.5 && uToriiMode < 3.5 ) {
      // ------------------------------------------------------------------ 百年参道石阶 4 层复合结构 + 连片规律分布青苔
      float pathCx = approxPathCenterX( worldPos.z );
      float dxPath = worldPos.x - pathCx;
      float distFromCenter = abs( dxPath );
      float upTread = smoothstep( 0.52, 0.86, nrm.y );

      // 第 1 层（基层）：天然青石板纹理（冷青灰基调，带自然节理裂纹与每块石板微色差）
      float slabHash = fract( sin( dot( floor( worldPos.xz * vec2( 1.8, 2.2 ) ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      vec3 slateTint = mix( vec3( 0.78, 0.88, 0.92 ), vec3( 0.92, 0.96, 0.98 ), slabHash );
      float crackLine = pow( 1.0 - abs( sin( worldPos.x * 14.0 + worldPos.z * 9.0 + grain * 4.2 ) ), 12.0 );
      c *= slateTint;
      c = mix( c, c * 0.52, crackLine * 0.65 );

      // 第 2 层（踩踏区）：路正中间（|dxPath| < 0.48m）被百年脚步磨得光滑发亮，青苔难以存留
      float footTraffic = exp( -pow( distFromCenter / 0.46, 2.0 ) ) * upTread;
      c = mix( c, c * vec3( 1.14, 1.16, 1.18 ) + vec3( 0.018, 0.022, 0.026 ), footTraffic * 0.62 );

      // 第 3 层（规律性片状青苔：靠近左侧溪流最厚连片、靠近右侧路边次之、路正中间稀少）：
      // (a) 左侧靠溪权重（dxPath 从 -0.15 到 -1.35 递增至 1.0）
      float leftStreamZone = 1.0 - smoothstep( -1.30, -0.12, dxPath );
      // (b) 右侧靠路边权重（dxPath 从 +0.25 到 +1.30 递增至 0.82）
      float rightEdgeZone = smoothstep( 0.25, 1.25, dxPath ) * 0.82;
      // (c) 台阶立面与接缝凹槽权重
      float riserAndJointZone = ( 1.0 - upTread ) * 0.78;

      // 低频片状场（控制青苔连成一大片而非孤立小圆点）
      float sheetMacro1 = smoothWearNoise( worldPos * vec3( 1.65, 2.0, 1.65 ) );
      float sheetMacro2 = smoothWearNoise( worldPos * vec3( 3.8, 4.0, 3.8 ) + vec3( 4.1, 2.3, 7.9 ) );
      float macroSheetNoise = sheetMacro1 * 0.65 + sheetMacro2 * 0.35;

      // 合成空间分布势场：溪侧与路边连成大片，正中踩踏区强力抑制
      float spatialDistribution = max( leftStreamZone * 1.08, max( rightEdgeZone, riserAndJointZone ) ) * ( 1.0 - footTraffic * 0.88 );
      float sheetField = spatialDistribution * ( 0.55 + 0.65 * macroSheetNoise );

      // 底层灰褐色基底（在青苔片区及边缘铺垫灰褐腐殖土，自然过渡融入石阶）
      float soilSubstrateMask = clamp( smoothstep( 0.18, 0.48, sheetField ), 0.0, 0.84 );
      vec3 creviceSoilCol = mix( vec3( 0.16, 0.13, 0.10 ), vec3( 0.24, 0.20, 0.16 ), grain );
      c = mix( c, creviceSoilCol, soilSubstrateMask * 0.68 );

      // 上层密集的细小深绿色苔点在灰褐色基底上连成一大片青苔（双尺度密集小圆点网格：85%+ 区域连成绿毯，细微间隙露出灰褐基底）
      float sheetCoreMask = smoothstep( 0.24, 0.52, sheetField );
      vec2 dotGridA = worldPos.xz * 56.0;
      vec2 dotCellA = floor( dotGridA );
      vec2 dotFracA = fract( dotGridA ) - 0.5;
      float seedA = fract( sin( dot( dotCellA, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
      vec2 jitterA = vec2( fract( seedA * 13.7 ) - 0.5, fract( seedA * 29.3 ) - 0.5 ) * 0.42;
      float roundDotA = 1.0 - smoothstep( 0.18, 0.46, length( dotFracA - jitterA ) );

      vec2 dotGridB = worldPos.xz * 96.0 + vec2( 17.3, -9.1 );
      vec2 dotCellB = floor( dotGridB );
      vec2 dotFracB = fract( dotGridB ) - 0.5;
      float seedB = fract( sin( dot( dotCellB, vec2( 269.5, 183.3 ) ) ) * 43758.5453 );
      vec2 jitterB = vec2( fract( seedB * 19.1 ) - 0.5, fract( seedB * 37.7 ) - 0.5 ) * 0.40;
      float roundDotB = 1.0 - smoothstep( 0.16, 0.44, length( dotFracB - jitterB ) );

      float denseGreenDots = clamp( max( roundDotA, roundDotB * 0.92 ), 0.0, 1.0 );
      float mossSheetCoverage = sheetCoreMask * ( 0.34 + 0.66 * denseGreenDots );

      float dotShade = seedA * 0.55 + seedB * 0.45;
      vec3 deepMossDotCol = mix(
        vec3( 0.06, 0.13, 0.05 ),
        vec3( 0.18, 0.31, 0.12 ),
        dotShade
      );
      c = mix( c, deepMossDotCol, clamp( mossSheetCoverage * 0.92, 0.0, 0.90 ) );

      // 第 4 层（清晨与雨后台阶凹陷处积水膜）：3 方向微涟漪干涉，反射天空与朱红鸟居
      float dishField = smoothWearNoise( worldPos * vec3( 2.4, 1.0, 3.2 ) );
      float puddleMask = footTraffic * smoothstep( 0.56 - uWeatherWetness * 0.18, 0.76, dishField ) * upTread * ( 1.0 - soilSubstrateMask * 0.8 );
      if ( puddleMask > 0.01 ) {
        float wA = sin( dot( worldPos.xz, vec2( 16.0, 9.0 ) ) - uWeatherTime * 3.8 );
        float wB = sin( dot( worldPos.xz, vec2( -13.0, 14.0 ) ) + uWeatherTime * 4.4 );
        float wC = sin( dot( worldPos.xz, vec2( 7.0, -18.0 ) ) - uWeatherTime * 5.1 );
        vec2 pRipGrad = vec2( wA * 0.35 - wB * 0.35, wB * 0.35 - wC * 0.35 ) * 0.045;
        vec3 pNrm = normalize( vec3( nrm.x + pRipGrad.x, 1.0, nrm.z + pRipGrad.y ) );
        vec3 reflDir = reflect( -normalize( viewDir ), pNrm );
        float toriiProximity = exp( -pow( ( worldPos.z - 1.5 ) / 5.5, 2.0 ) );
        vec3 skyRefl = vec3( 0.26, 0.36, 0.38 );
        vec3 toriiRefl = vec3( 0.62, 0.16, 0.08 );
        vec3 waterRefl = mix( skyRefl, toriiRefl, toriiProximity * smoothstep( -0.3, 0.5, reflDir.z ) * 0.58 );
        float pFresnel = 0.18 + 0.54 * pow( 1.0 - max( 0.0, dot( pNrm, normalize( viewDir ) ) ), 3.0 );
        c = mix( c * 0.78, waterRefl, puddleMask * pFresnel * ( 0.55 + 0.35 * uWeatherWetness ) );
      }

      // 踩踏区光滑反射高光（青苔片区完全哑光不反光）
      vec3 halfVec = normalize( lightToEye + normalize( viewDir ) );
      float ndh = max( 0.0, dot( nrm, halfVec ) );
      float polishPower = mix( 14.0, 64.0, footTraffic * 0.8 + uWeatherWetness * 0.2 );
      float polishStrength = ( 0.20 + 1.30 * footTraffic + 0.55 * puddleMask + 0.45 * uWeatherWetness ) * ( 1.0 - soilSubstrateMask * 0.92 );
      float spec = pow( ndh, polishPower ) * polishStrength;
      c += vec3( 0.22, 0.25, 0.27 ) * spec * uRoughnessVar;
    } else if ( uToriiMode >= 3.5 ) {
      // 独立片状青苔材质（mossPatch / mossWet / mossDamp）：
      // 灰褐色基底上由密集的绿色小圆点连成整片厚实青苔，仅外缘与微细孔隙透出灰褐底土，零镜面反光
      float sheetMacro = smoothWearNoise( worldPos * 3.2 );
      float microDot1 = smoothWearNoise( worldPos * 46.0 );
      float microDot2 = wearNoise( worldPos * 9.5 );
      float microDot3 = wearNoise( worldPos * 24.0 + vec3( 4.7, 1.9, 8.3 ) );

      vec3 earthBase = mix( vec3( 0.16, 0.13, 0.10 ), vec3( 0.24, 0.20, 0.16 ), microDot1 );
      vec3 greenMicroDots = mix(
        vec3( 0.07, 0.14, 0.05 ),
        vec3( 0.18, 0.30, 0.12 ),
        microDot2 * 0.55 + microDot3 * 0.45
      );
      // 密集绿色小圆点连成大片（86% 面积为连绵绿点簇，14% 细微孔隙与边缘露出灰褐底土）
      float dotCluster = smoothstep( 0.08, 0.36, microDot1 * 0.5 + microDot2 * 0.5 ) * ( 0.78 + 0.22 * sheetMacro );
      c = mix( earthBase, greenMicroDots * ( 0.82 + 0.26 * microDot3 ), clamp( dotCluster, 0.0, 0.90 ) );
    } else {
      c = mix( c, uWearColor, wear );
      float top = clamp( nrm.y, 0.0, 1.0 ) * ( 0.4 + 0.6 * n ) * uDustAmount;
      c = mix( c, uDustColor, clamp( top, 0.0, 1.0 ) );
      if ( uRoughnessVar > 0.001 ) {
        vec3 halfVec = normalize( lightToEye + normalize( viewDir ) );
        float ndh = max( 0.0, dot( nrm, halfVec ) );
        float microGloss = mix( 10.0, 38.0, grain * ( 1.0 - wear * 0.75 ) );
        float spec = pow( ndh, microGloss ) * ( 0.35 + 0.65 * grain ) * ( 1.0 - wear * 0.82 ) * ( 1.0 + uWeatherWetness * 0.6 );
        c += ( baseColor * 0.45 + vec3( 0.16, 0.14, 0.12 ) ) * spec * uRoughnessVar * 0.28;
      }
    }

    // 全局光照颜色反弹（GI Color Bounce）：
    float dToriiFront = length( ( worldPos - vec3( 0.28, 4.2, -0.88 ) ) * vec3( 0.55, 0.45, 0.65 ) );
    float dToriiRear = length( ( worldPos - vec3( 0.18, 4.5, -2.18 ) ) * vec3( 0.55, 0.45, 0.65 ) );
    float toriiBounce = ( exp( -dToriiFront * 0.85 ) + exp( -dToriiRear * 0.85 ) ) * ( 1.0 - smoothstep( 3.0, 6.2, worldPos.y ) );
    c += vec3( 0.58, 0.14, 0.06 ) * toriiBounce * 0.048;

    float shadowGreenMask = ( 1.0 - clamp( dot( nrm, lightToEye ), 0.0, 1.0 ) ) * smoothstep( 0.0, 0.8, nrm.y );
    c += vec3( 0.03, 0.07, 0.04 ) * shadowGreenMask * 0.28;

    c += evalLanternLatticeGobo( worldPos, nrm );

    if ( uWeatherWetness > 0.01 ) {
      c *= mix( 1.0, 0.84, uWeatherWetness * smoothstep( 0.1, 0.9, nrm.y ) );
    }

    return c;
  }
`;

export function ensureUniforms(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => material.name;
  return material;
}
