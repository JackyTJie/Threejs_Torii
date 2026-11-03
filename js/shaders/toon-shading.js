// 三渲二着色扩展：半兰伯特漫反射、色阶带、叶片次表面透光、青苔附着
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
  // 写成 dot( viewDir, -sunTravel ) 会把最该发亮的逆光视角判成 0，顺光时反而发亮。
  vec3 leafTranslucency( vec3 normal, vec3 viewDir, vec3 sunTravel, vec3 lightColor, float lightIntensity ) {
    float back = dot( viewDir, sunTravel );
    back = pow( clamp( back, 0.0, 1.0 ), uTranslucencyPower );
    float rim = pow( 1.0 - clamp( dot( normal, viewDir ), 0.0, 1.0 ), 2.0 );
    float thickness = 0.35 + 0.65 * rim;
    return uTranslucencyColor * back * thickness * uTranslucencyStrength * lightColor * lightIntensity;
  }
`;

/** 青苔附着：按高度与背阴程度在构件底部混合青苔色 */
export const MOSS_ATTACHMENT_UNIFORMS = /* glsl */ `
  uniform vec3 uMossColor;
  uniform float uMossHeight;
  uniform float uMossBand;
  uniform float uMossAmount;
  uniform vec3 uMossSunDir;
`;

export const MOSS_ATTACHMENT_FRAG = /* glsl */ `
  float mossNoise( vec3 p ) {
    return fract( sin( dot( floor( p * 9.0 ), vec3( 12.9898, 78.233, 45.164 ) ) ) * 43758.5453 );
  }

  // sunDir = 光子行进方向（太阳 → 场景）。面朝太阳的表面满足 dot( normal, -sunDir ) > 0，
  // 因此「背阴度」= 0.5 + 0.5·dot( normal, sunDir )：顶面 ≈0.23（少苔）、底面 ≈0.77（多苔）。
  vec3 applyMoss( vec3 baseColor, vec3 worldPos, vec3 normal, vec3 sunDir ) {
    float heightFade = 1.0 - clamp( ( worldPos.y - uMossHeight ) / max( uMossBand, 0.001 ), 0.0, 1.0 );
    float shade = clamp( 0.5 + 0.5 * dot( normal, sunDir ), 0.0, 1.0 );
    float n = mossNoise( worldPos );
    float mask = clamp( heightFade * ( 0.45 + 0.55 * shade ) * ( 0.55 + 0.75 * n ) * uMossAmount, 0.0, 1.0 );
    return mix( baseColor, uMossColor, mask );
  }
`;

/** 风化老化：底部与迎风面优先老化、顶面轻微积尘 */
export const WEATHERING_UNIFORMS = /* glsl */ `
  uniform vec3 uWearColor;
  uniform vec3 uDustColor;
  uniform float uWearStart;
  uniform float uWearBand;
  uniform float uWearAmount;
  uniform float uDustAmount;
`;

export const WEATHERING_FRAG = /* glsl */ `
  float wearNoise( vec3 p ) {
    return fract( sin( dot( floor( p * 13.0 ), vec3( 39.3468, 11.135, 27.719 ) ) ) * 24634.6345 );
  }

  vec3 applyWeathering( vec3 baseColor, vec3 worldPos, vec3 normal ) {
    float bottom = 1.0 - clamp( ( worldPos.y - uWearStart ) / max( uWearBand, 0.001 ), 0.0, 1.0 );
    float n = wearNoise( worldPos );
    float wear = clamp( bottom * ( 0.5 + 0.9 * n ) * uWearAmount, 0.0, 1.0 );
    float top = clamp( normal.y, 0.0, 1.0 ) * ( 0.4 + 0.6 * n ) * uDustAmount;
    vec3 c = mix( baseColor, uWearColor, wear );
    c = mix( c, uDustColor, clamp( top, 0.0, 1.0 ) );
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
