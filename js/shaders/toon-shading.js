// 三渲二着色扩展：半兰伯特漫反射、色阶带、叶片次表面透光、向溪背阴青苔附着、风化与漆面微粗糙度高光
// 这些 GLSL 片段通过 material.onBeforeCompile 注入 MeshToonMaterial，
// 保持 Three.js 内置光照模型的同时获得卡通分层与透光特性。

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

/**
 * uniform 声明必须单独放在片元着色器的全局作用域。
 * 这些片段是注入到 `void main()` 内部的：GLSL 不允许在函数体内声明 uniform
 * （ANGLE 报 `'uniform' : only allowed at global scope`，整个 program 编译失败，
 * 材质直接不渲染 —— 表现为「树是光的、水不见了」）。声明与函数分开导出，注入方负责前置。
 */

/** 叶片透光（translucency）：背光侧被主光点亮，颜色与强度由 uniform 决定 */
export const LEAF_TRANSLUCENCY_UNIFORMS = /* glsl */ `
  uniform vec3 uTranslucencyColor;
  uniform float uTranslucencyStrength;
  uniform float uTranslucencyPower;
  uniform vec3 uTranslucencySunTint;
  uniform vec3 uSunDir;
`;

export const LEAF_TRANSLUCENCY_FRAG = /* glsl */ `
  // viewDir = 由叶片指向眼睛（three.js 的 vViewPosition 就是这个方向）。
  // 透射成立的条件是「光子行进方向」与「出射到眼睛的方向」大致同向 ——
  // 即眼睛、叶片、太阳排成一条线，镜头朝向太阳看时叶子最亮。
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

  // 同时支持构件根部微润青苔与踏面/山石顶面青苔斑块：
  // 严格遵循「靠近溪流处（worldPos.x 偏左负向）多、背阴处多、向阳处少」的分布逻辑
  vec3 applyMoss( vec3 baseColor, vec3 worldPos, vec3 normal, vec3 sunDir ) {
    vec3 nrm = normalize( normal );
    float heightFade = 1.0 - clamp( ( worldPos.y - uMossHeight ) / max( uMossBand, 0.001 ), 0.0, 1.0 );
    // sunDir 为从光源指向场景的方向，因此 dot(nrm, sunDir) > 0 代表背阴面，< 0 代表向阳面
    float shade = clamp( 0.55 + 0.65 * dot( nrm, sunDir ), 0.0, 1.0 );
    float sunlitSuppress = smoothstep( -0.55, 0.25, dot( nrm, sunDir ) );
    // 靠近左侧山涧溪流（x < 0.2）湿度高，青苔覆盖显著增加；向右侧阳坡递减
    float streamBias = 0.62 + 0.68 * smoothstep( 1.85, -1.65, worldPos.x );

    float n1 = mossNoise3( worldPos * 4.2 );
    float n2 = mossNoise3( worldPos * 10.5 + vec3( 7.3, 2.1, 5.4 ) );
    float organic = n1 * 0.65 + n2 * 0.35;

    // 朝上的踏面/岩石平台面（nrm.y > 0.45）在向溪侧与背阴侧生成自然团簇青苔垫
    float topFacing = smoothstep( 0.45, 0.82, nrm.y );
    float topPatch = smoothstep( 0.42, 0.68, organic + topFacing * 0.14 + ( streamBias - 0.85 ) * 0.18 )
      * topFacing * sunlitSuppress * streamBias;
    // 构件底部与石缝潮湿青苔
    float baseMask = heightFade * ( 0.32 + 0.68 * shade ) * streamBias * smoothstep( 0.42, 0.72, organic ) * 0.54;
    float mask = clamp( max( baseMask, topPatch * 0.88 ) * uMossAmount, 0.0, 0.76 );

    vec3 lushMoss = mix( uMossColor * 0.76, uMossColor * vec3( 1.08, 1.18, 0.90 ), clamp( nrm.y * 0.5 + organic * 0.5, 0.0, 1.0 ) );
    return mix( baseColor, lushMoss, mask );
  }
`;

/** 风化老化与微粗糙度高光：底部与缝隙风化、顶面积尘、漆面/石面粗糙度细微差异与不均匀高光 */
export const WEATHERING_UNIFORMS = /* glsl */ `
  uniform vec3 uWearColor;
  uniform vec3 uDustColor;
  uniform float uWearStart;
  uniform float uWearBand;
  uniform float uWearAmount;
  uniform float uDustAmount;
  uniform float uRoughnessVar;
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
    float bottom = 1.0 - clamp( ( worldPos.y - uWearStart ) / max( uWearBand, 0.001 ), 0.0, 1.0 );
    float n = wearNoise( worldPos );
    float grain = smoothWearNoise( worldPos * vec3( 6.5, 18.0, 6.5 ) );
    float wear = clamp( ( bottom * ( 0.48 + 0.88 * n ) + ( 1.0 - grain ) * 0.22 ) * uWearAmount, 0.0, 1.0 );
    float top = clamp( normal.y, 0.0, 1.0 ) * ( 0.4 + 0.6 * n ) * uDustAmount;
    vec3 c = mix( baseColor, uWearColor, wear );
    c = mix( c, uDustColor, clamp( top, 0.0, 1.0 ) );

    // 漆面/湿润表面微粗糙度差异化高光：未剥落处温润微亮，剥落磨损处哑光粗糙，形成自然不均匀高光
    if ( uRoughnessVar > 0.001 ) {
      vec3 lightToEye = normalize( -uSpecSunDir );
      vec3 halfVec = normalize( lightToEye + normalize( viewDir ) );
      float ndh = max( 0.0, dot( normalize( normal ), halfVec ) );
      float microGloss = mix( 10.0, 38.0, grain * ( 1.0 - wear * 0.75 ) );
      float spec = pow( ndh, microGloss ) * ( 0.35 + 0.65 * grain ) * ( 1.0 - wear * 0.82 );
      c += ( baseColor * 0.45 + vec3( 0.16, 0.14, 0.12 ) ) * spec * uRoughnessVar * 0.28;
    }
    return c;
  }
`;

/** 注入辅助：给材质挂 uniform 并保证每帧存在 */
export function ensureUniforms(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => material.name;
  return material;
}
