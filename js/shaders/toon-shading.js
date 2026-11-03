// 三渲二着色扩展：半兰伯特漫反射、色阶带、叶片次表面透光、向溪背阴青苔附着、
// 以及鸟居三段式真实物理老化（顶部笠木积灰重苔 / 腰部游客触碰光滑微亮 / 立柱底部雨水溅射剥落发黑露木纹 + 受光暖橙/阴影深红褐）。

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

/** 青苔附着：遵循「靠近溪流处多（-x 侧）、背阴处多、向阳处少」的空间分布逻辑 */
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
    float streamBias = 0.62 + 0.68 * smoothstep( 1.85, -1.65, worldPos.x );

    float n1 = mossNoise3( worldPos * 4.2 );
    float n2 = mossNoise3( worldPos * 10.5 + vec3( 7.3, 2.1, 5.4 ) );
    float organic = n1 * 0.65 + n2 * 0.35;

    float topFacing = smoothstep( 0.42, 0.80, nrm.y );
    float topPatch = smoothstep( 0.40, 0.66, organic + topFacing * 0.16 + ( streamBias - 0.85 ) * 0.18 )
      * topFacing * ( 0.35 + 0.65 * sunlitSuppress ) * streamBias;
    float baseMask = heightFade * ( 0.32 + 0.68 * shade ) * streamBias * smoothstep( 0.40, 0.70, organic ) * 0.58;
    float mask = clamp( max( baseMask, topPatch * 0.92 ) * uMossAmount, 0.0, 0.82 );

    vec3 lushMoss = mix( uMossColor * 0.74, uMossColor * vec3( 1.08, 1.18, 0.90 ), clamp( nrm.y * 0.5 + organic * 0.5, 0.0, 1.0 ) );
    return mix( baseColor, lushMoss, mask );
  }
`;

/**
 * 风化老化与鸟居三段式质感着色：
 * - uToriiMode == 1.0（鸟居朱红漆）：
 *   1) 整体朱红色偏深暗，受光面偏暖橙朱砂，阴影面偏深红褐，彻底消除亮红塑料感；
 *   2) 立柱底部（hRel < 0.95m）因雨水溅射与泥土接触，漆面剥落发黑、露出深褐竖向木纹；
 *   3) 腰部高度（hRel ≈ 0.95m ~ 1.72m，中心 1.32m）因常年游客触碰，剥落减少、色泽稍亮且漆面光滑温润；
 * - uToriiMode == 2.0（顶部笠木黑漆）：
 *   顶部积灰、陈年落尘与青苔侵蚀最严重。
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
      // 1) 受光处偏暖橙、阴影处偏深红褐，整体朱红深暗厚重，告别亮红塑料感
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
      float specMask = ( 1.0 - peelPattern * 0.92 ) * ( 0.32 + 0.68 * grain + waistTouch * 1.15 );
      float spec = pow( ndh, expPower ) * specMask;
      c += vec3( 0.28, 0.16, 0.08 ) * spec * uRoughnessVar * 0.42;
    } else if ( uToriiMode >= 1.5 ) {
      // 顶部笠木（kasagi / nimaki）：积灰与风化最严重
      float heavyDust = smoothstep( 0.08, 0.72, nrm.y ) * ( 0.52 + 0.48 * grain + 0.35 * n ) * uDustAmount;
      c = mix( c, uWearColor, wear * 0.55 );
      c = mix( c, vec3( 0.26, 0.28, 0.22 ), clamp( heavyDust, 0.0, 0.78 ) );
    } else {
      c = mix( c, uWearColor, wear );
      float top = clamp( nrm.y, 0.0, 1.0 ) * ( 0.4 + 0.6 * n ) * uDustAmount;
      c = mix( c, uDustColor, clamp( top, 0.0, 1.0 ) );
      if ( uRoughnessVar > 0.001 ) {
        vec3 halfVec = normalize( lightToEye + normalize( viewDir ) );
        float ndh = max( 0.0, dot( nrm, halfVec ) );
        float microGloss = mix( 10.0, 38.0, grain * ( 1.0 - wear * 0.75 ) );
        float spec = pow( ndh, microGloss ) * ( 0.35 + 0.65 * grain ) * ( 1.0 - wear * 0.82 );
        c += ( baseColor * 0.45 + vec3( 0.16, 0.14, 0.12 ) ) * spec * uRoughnessVar * 0.28;
      }
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
