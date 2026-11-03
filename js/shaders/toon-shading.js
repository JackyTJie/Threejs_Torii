// 三渲二着色扩展：半兰伯特漫反射、色阶带、叶片次表面透光、
// 底层灰褐土+上层微米深绿颗粒的真实粗糙青苔、百年参道石阶 4 层复合材质、
// 全局光照颜色反弹（鸟居朱红反弹 + 林冠冷绿阴影浸染）、石灯笼 3×3 格栅地面光斑投射、
// 以及鸟居三段式真实物理老化（顶部笠木积灰重苔 / 腰部游客触碰光滑微亮 / 立柱底部雨水溅射剥落发黑露木纹）。

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
 * 真实微颗粒粗糙青苔附着（底层灰褐色腐殖土 + 上层密集细小深绿色苔点 + 边缘自然过渡）：
 * - 遵循「靠近溪流处多（-x 侧）、背阴处多、向阳处少、缝隙边缘厚」的空间分布逻辑；
 * - 彻底摒弃纯青色高反光塑料感：外圈先过渡一层灰褐色积土（soilRim），内圈密布高频深绿微绒颗粒簇，
 *   且表面粗糙哑光、与石阶青石底色自然融合。
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
    float streamBias = 0.58 + 0.72 * smoothstep( 1.85, -1.65, worldPos.x );

    // 多尺度噪声：宏观斑块 + 中尺度绒团 + 高频微米级深绿苔点
    float nMacro = mossNoise3( worldPos * 3.8 );
    float nMid = mossNoise3( worldPos * 12.5 + vec3( 7.3, 2.1, 5.4 ) );
    float nMicroDot = mossNoise3( worldPos * 46.0 + vec3( 19.1, -11.4, 8.7 ) );
    float nUltraDot = mossHash( floor( worldPos * 135.0 ) );
    float organic = nMacro * 0.55 + nMid * 0.30 + nMicroDot * 0.15;

    float topFacing = smoothstep( 0.36, 0.82, nrm.y );
    float rawZone = max(
      heightFade * ( 0.35 + 0.65 * shade ) * streamBias * smoothstep( 0.34, 0.74, organic ) * 0.65,
      smoothstep( 0.38, 0.70, organic + topFacing * 0.14 + ( streamBias - 0.85 ) * 0.18 )
        * topFacing * ( 0.38 + 0.62 * sunlitSuppress ) * streamBias * 0.85
    ) * uMossAmount;

    // 1) 底层与边缘过渡带：灰褐色湿腐殖土（先在石面缝隙与苔斑外缘铺垫灰褐土，消除突兀绿边）
    float soilMask = clamp( smoothstep( 0.08, 0.42, rawZone ) * ( 0.62 + 0.38 * nMid ), 0.0, 0.76 );
    vec3 soilSubstrate = mix( vec3( 0.15, 0.13, 0.10 ), vec3( 0.25, 0.21, 0.17 ), nMicroDot );

    // 2) 上层细小深绿色点簇：由密集微小的深墨绿/暗橄榄绿颗粒点构成，透出底层灰褐土隙
    float dotDensity = smoothstep( 0.22, 0.68, rawZone ) * smoothstep( 0.24, 0.78, nMicroDot * 0.62 + nUltraDot * 0.38 );
    vec3 darkGreenDot = mix(
      vec3( 0.07, 0.13, 0.06 ),
      uMossColor * vec3( 0.68, 0.78, 0.56 ),
      clamp( nUltraDot * 0.65 + nMid * 0.35, 0.0, 1.0 )
    );
    // 粗糙哑光微绒漫反射压制（吸收镜面反光，呈现真实干燥/微湿绒毛粗糙感）
    float matteRough = 0.76 + 0.32 * ( nUltraDot - 0.5 );

    vec3 withSoil = mix( baseColor, soilSubstrate, soilMask * 0.72 );
    return mix( withSoil, darkGreenDot * matteRough, clamp( dotDensity * 0.88, 0.0, 0.84 ) );
  }
`;

/**
 * 风化老化、鸟居三段式质感、百年参道石阶 4 层复合材质、全局光照颜色反弹与石灯笼 3×3 格子光斑：
 * - uToriiMode == 1.0（鸟居朱红漆）：受光暖橙/阴影深红褐 + 腰部触摸光滑微亮 + 柱底溅泥剥落露木纹；
 * - uToriiMode == 2.0（顶部笠木黑漆）：顶部积灰与陈年厚苔；
 * - uToriiMode == 3.0（百年参道石阶 4 层复合结构）：
 *   1) 基层：天然青石板裂纹与块面色差；
 *   2) 踩踏区：台阶中央（围绕弯曲参道中心线 ±0.58m）经百年香客脚步摩挲，表面光滑微亮、反射率显著提高；
 *   3) 缝隙边缘：石缝与台阶边缘积聚灰褐色腐殖土与细小深绿点状青苔，越靠近左侧溪流与阶根背阴处越厚；
 *   4) 积水层：清晨与雨后台阶中央微凹洼槽处积聚薄水膜，实时倒映天空与朱红鸟居，并泛起细微同心涟漪；
 * - 全局光照颜色反弹（GI Color Bounce）与参道木灯笼地面 3×3 格子光斑（Lantern Lattice Gobo）。
 */
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

  // 近似参道中心线 X(z)，用于定位台阶中央百年踩踏抛光带
  float approxPathCenterX( float z ) {
    if ( z > -0.2 ) {
      float u = clamp( ( 11.6 - z ) / 11.8, 0.0, 1.0 );
      return 0.30 - 0.42 * sin( u * 3.14159265 * 0.88 );
    }
    float v = clamp( ( -0.2 - z ) / 9.2, 0.0, 1.0 );
    return 0.14 + 5.45 * pow( v, 1.68 );
  }

  // 参道木灯笼 3×3 格栅地面投射光斑（灯光穿过木格窗在周囲石阶与地面投下暖黄格子光斑）
  vec3 evalLanternLatticeGobo( vec3 worldPos, vec3 nrm ) {
    if ( uLanternIntensity <= 0.01 ) return vec3( 0.0 );
    vec3 totalGlow = vec3( 0.0 );
    for ( int i = 0; i < 2; i++ ) {
      vec3 lPos = i == 0 ? uLanternPosL : uLanternPosR;
      vec3 toFrag = worldPos - lPos;
      float dist = length( toFrag );
      if ( dist < 4.6 && toFrag.y < 0.25 ) {
        vec3 dir = toFrag / max( dist, 0.001 );
        float ndl = max( 0.0, dot( nrm, -dir ) );
        float atten = exp( -dist * 0.72 ) * smoothstep( 4.6, 0.6, dist ) * ( 0.35 + 0.65 * ndl );
        // 投射 3×3 窗棂格栅阴影与暖光方格（木框挡光、纸格透光）
        vec2 horiz = toFrag.xz / max( 0.28, -toFrag.y + 0.35 );
        float barX = smoothstep( 0.08, 0.22, abs( fract( horiz.x * 2.35 + 0.5 ) - 0.5 ) );
        float barZ = smoothstep( 0.08, 0.22, abs( fract( horiz.y * 2.35 + 0.5 ) - 0.5 ) );
        float postShadow = smoothstep( 0.14, 0.32, length( toFrag.xz ) );
        float latticePattern = mix( 0.32, 1.18, barX * barZ ) * postShadow;
        totalGlow += vec3( 1.0, 0.66, 0.24 ) * atten * latticePattern * uLanternIntensity * 0.34;
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
      // 1) 鸟居朱红漆：受光处偏暖橙、阴影处偏深红褐，整体朱红深暗厚重，告别亮红塑料感
      float sunFacing = dot( nrm, lightToEye );
      float warmSunMask = smoothstep( -0.10, 0.62, sunFacing );
      vec3 warmOrangeShift = c * vec3( 1.12, 0.90, 0.64 ) + vec3( 0.035, 0.018, 0.002 );
      vec3 deepUmberShadow = c * vec3( 0.64, 0.34, 0.25 );
      c = mix( deepUmberShadow, warmOrangeShift, warmSunMask );

      // 2) 腰部高度（hRel ≈ 0.95m ~ 1.72m，中心 1.32m）常年受游客抚触：漆面更光滑、剥落少、色泽温润微亮
      float waistTouch = exp( -pow( ( hRel - 1.32 ) / 0.36, 2.0 ) );
      wear *= ( 1.0 - waistTouch * 0.76 );
      c = mix( c, c * vec3( 1.16, 1.08, 0.96 ) + vec3( 0.028, 0.012, 0.004 ), waistTouch * 0.68 );

      // 3) 立柱底部（hRel < 0.92m）雨水溅射与泥土侵蚀：漆面剥落发黑并露出纵向老木纹
      float splashZone = 1.0 - smoothstep( 0.04, 0.92, hRel );
      float peelPattern = smoothstep( 0.28, 0.72, splashZone * ( 0.65 + 0.55 * n ) + ( 1.0 - woodFiber ) * 0.35 * splashZone );
      vec3 bareWoodGrain = mix( vec3( 0.07, 0.05, 0.04 ), vec3( 0.22, 0.14, 0.09 ), woodFiber );
      c = mix( c, uWearColor, wear * 0.65 );
      c = mix( c, bareWoodGrain, peelPattern * 0.88 );

      // 4) 腰部光滑高光 vs 底部剥落哑光 vs 常规微粗糙度高光
      vec3 halfVec = normalize( lightToEye + normalize( viewDir ) );
      float ndh = max( 0.0, dot( nrm, halfVec ) );
      float expPower = mix( 16.0, 56.0, waistTouch * 0.75 + grain * 0.25 );
      float specMask = ( 1.0 - peelPattern * 0.92 ) * ( 0.32 + 0.68 * grain + waistTouch * 1.15 ) * ( 1.0 + uWeatherWetness * 0.45 );
      float spec = pow( ndh, expPower ) * specMask;
      c += vec3( 0.28, 0.16, 0.08 ) * spec * uRoughnessVar * 0.42;
    } else if ( uToriiMode >= 1.5 && uToriiMode < 2.5 ) {
      // 顶部笠木（kasagi / nimaki）：积灰与风化最严重
      float heavyDust = smoothstep( 0.08, 0.72, nrm.y ) * ( 0.52 + 0.48 * grain + 0.35 * n ) * uDustAmount;
      c = mix( c, uWearColor, wear * 0.55 );
      c = mix( c, vec3( 0.24, 0.25, 0.20 ), clamp( heavyDust, 0.0, 0.78 ) );
    } else if ( uToriiMode >= 2.5 && uToriiMode < 3.5 ) {
      // ------------------------------------------------------------------ 百年参道石阶 4 层复合结构
      float pathCx = approxPathCenterX( worldPos.z );
      float distFromCenter = abs( worldPos.x - pathCx );
      float upTread = smoothstep( 0.52, 0.86, nrm.y );

      // 第 1 层（基层）：天然青石板纹理（冷青灰基调，带自然节理裂纹与每块石板微色差）
      float slabHash = fract( sin( dot( floor( worldPos.xz * vec2( 1.8, 2.2 ) ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      vec3 slateTint = mix( vec3( 0.78, 0.88, 0.92 ), vec3( 0.92, 0.96, 0.98 ), slabHash );
      float crackLine = pow( 1.0 - abs( sin( worldPos.x * 14.0 + worldPos.z * 9.0 + grain * 4.2 ) ), 12.0 );
      c *= slateTint;
      c = mix( c, c * 0.52, crackLine * 0.65 );

      // 第 2 层（踩踏区）：台阶中央（|x - pathCx| < 0.58m）被百年脚步磨得光滑发亮，反射率更高
      float footTraffic = exp( -pow( distFromCenter / 0.54, 2.0 ) ) * upTread;
      c = mix( c, c * vec3( 1.14, 1.16, 1.18 ) + vec3( 0.018, 0.022, 0.026 ), footTraffic * 0.62 );

      // 第 3 层（缝隙边缘积土与微颗粒深绿青苔）：越靠近左侧溪流、阶根背阴处越厚，踩踏中心自动消退
      float edgeCrevice = clamp( ( 1.0 - upTread ) * 0.82 + smoothstep( 0.42, 1.08, distFromCenter ) * 0.68, 0.0, 1.0 );
      float streamSideBoost = 0.58 + 0.62 * smoothstep( 1.4, -1.2, worldPos.x - pathCx );
      float creviceSoilMask = clamp( edgeCrevice * streamSideBoost * ( 0.52 + 0.48 * grain ) * ( 1.0 - footTraffic * 0.82 ), 0.0, 0.78 );
      vec3 creviceSoilCol = mix( vec3( 0.15, 0.13, 0.11 ), vec3( 0.23, 0.20, 0.17 ), n );
      c = mix( c, creviceSoilCol, creviceSoilMask * 0.54 );

      // 在积土层之上生长细小深绿色苔藓微点（底层透出灰褐土，不突兀）
      float microMossDots = fract( sin( dot( floor( worldPos * 120.0 ), vec3( 19.1, 73.7, 41.3 ) ) ) * 31415.9 );
      float mossDotMask = smoothstep( 0.32, 0.75, creviceSoilMask ) * smoothstep( 0.38, 0.82, microMossDots * 0.65 + grain * 0.35 );
      vec3 deepMossDotCol = mix( vec3( 0.07, 0.13, 0.06 ), vec3( 0.15, 0.24, 0.11 ), microMossDots );
      c = mix( c, deepMossDotCol, mossDotMask * 0.74 );

      // 第 4 层（清晨与雨后台阶凹陷处积水膜）：反射天空与朱红鸟居，带细微涟漪
      float dishField = smoothWearNoise( worldPos * vec3( 2.4, 1.0, 3.2 ) );
      float puddleMask = footTraffic * smoothstep( 0.56 - uWeatherWetness * 0.18, 0.76, dishField ) * upTread;
      if ( puddleMask > 0.01 ) {
        vec2 pCell = floor( worldPos.xz * 2.2 ) / 2.2 + vec2( 0.22 );
        float rRip = length( worldPos.xz - pCell );
        float rippleWave = sin( rRip * 48.0 - uWeatherTime * 4.6 ) * exp( -rRip * 4.5 );
        vec3 pNrm = normalize( vec3( nrm.x + rippleWave * 0.06, 1.0, nrm.z + rippleWave * 0.06 ) );
        vec3 reflDir = reflect( -normalize( viewDir ), pNrm );
        float toriiProximity = exp( -pow( ( worldPos.z - 1.5 ) / 5.5, 2.0 ) );
        vec3 skyRefl = vec3( 0.34, 0.46, 0.48 );
        vec3 toriiRefl = vec3( 0.68, 0.18, 0.09 );
        vec3 waterRefl = mix( skyRefl, toriiRefl, toriiProximity * smoothstep( -0.3, 0.5, reflDir.z ) * 0.58 );
        float pFresnel = 0.22 + 0.62 * pow( 1.0 - max( 0.0, dot( pNrm, normalize( viewDir ) ) ), 3.0 );
        c = mix( c * 0.76, waterRefl, puddleMask * pFresnel * ( 0.65 + 0.35 * uWeatherWetness ) );
      }

      // 踩踏区光滑反射高光（中央磨光带与雨水湿润时反射率显著提升）
      vec3 halfVec = normalize( lightToEye + normalize( viewDir ) );
      float ndh = max( 0.0, dot( nrm, halfVec ) );
      float polishPower = mix( 14.0, 64.0, footTraffic * 0.8 + uWeatherWetness * 0.2 );
      float polishStrength = ( 0.22 + 1.35 * footTraffic + 0.65 * puddleMask + 0.55 * uWeatherWetness ) * ( 1.0 - creviceSoilMask * 0.85 );
      float spec = pow( ndh, polishPower ) * polishStrength;
      c += vec3( 0.22, 0.25, 0.27 ) * spec * uRoughnessVar;
    } else if ( uToriiMode >= 3.5 ) {
      // 独立青苔斑块（mossPatch / mossWet / mossDamp）：底层灰褐土 + 上层细密深绿苔点 + 零镜面反光粗糙绒面
      float dot1 = wearNoise( worldPos * 9.5 );
      float dot2 = wearNoise( worldPos * 22.0 + vec3( 4.7, 1.9, 8.3 ) );
      float soilUnder = smoothstep( 0.15, 0.68, 1.0 - grain * 0.75 - nrm.y * 0.25 );
      vec3 earthCol = mix( vec3( 0.15, 0.13, 0.10 ), vec3( 0.24, 0.20, 0.16 ), dot1 );
      vec3 mossDots = mix( vec3( 0.06, 0.11, 0.05 ), vec3( 0.16, 0.25, 0.11 ), dot2 );
      c = mix( mossDots * ( 0.78 + 0.32 * dot1 ), earthCol, clamp( soilUnder * 0.58 + ( 1.0 - dot2 ) * 0.34, 0.0, 0.78 ) );
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
    // 1) 鸟居朱红色反弹到周围石阶、灯笼基座与树干底部
    float dToriiFront = length( ( worldPos - vec3( 0.28, 4.2, -0.88 ) ) * vec3( 0.55, 0.45, 0.65 ) );
    float dToriiRear = length( ( worldPos - vec3( 0.18, 4.5, -2.18 ) ) * vec3( 0.55, 0.45, 0.65 ) );
    float toriiBounce = ( exp( -dToriiFront * 0.85 ) + exp( -dToriiRear * 0.85 ) ) * smoothstep( 6.2, 3.0, worldPos.y );
    c += vec3( 0.58, 0.14, 0.06 ) * toriiBounce * 0.048;

    // 2) 森林绿叶冠层对地面与背阴面的微弱冷绿漫射浸染
    float shadowGreenMask = ( 1.0 - clamp( dot( nrm, lightToEye ), 0.0, 1.0 ) ) * smoothstep( 0.0, 0.8, nrm.y );
    c += vec3( 0.03, 0.07, 0.04 ) * shadowGreenMask * 0.28;

    // 3) 参道春日木灯笼暖光与 3×3 窗格地面光斑（Lantern Lattice Gobo）
    c += evalLanternLatticeGobo( worldPos, nrm );

    // 4) 雨天模式全局湿润压暗与微镜面增强
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
