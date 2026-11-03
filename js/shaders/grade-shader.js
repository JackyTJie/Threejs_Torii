// 输出级：曝光 → ACES 色调映射 → sRGB 编码 → 雨后深林阴天电影级调色（显示参考空间）
//
// 为什么色调映射必须写在这里而不是交给渲染器：
//   three.js 只在「渲染到屏幕」时才做色调映射与色彩空间转换，渲染进离屏缓冲时两者都跳过；
//   而 ShaderMaterial 不含 <tonemapping_fragment> / <colorspace_fragment>，即使画到屏幕也不会自动转换。
//   因此渲染器侧显式设为 NoToneMapping，色调映射由本 pass 独占（见 js/renderer.js）。
//
// 调色放在 sRGB 编码之后做：
//   雨后深林三段 LUT（暗部幽深青绿、中间调湿润森绿、高光柔和冷天光），
//   同时对鸟居的朱红暖色相做高保真保留，避免冷调压灰朱红漆面。

export const GRADE_FS = /* glsl */ `
  uniform sampler2D tScene;
  uniform float uExposure;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uLift;
  uniform float uGain;
  uniform float uWarmth;
  uniform float uLutStrength;
  uniform float uHighlightSoftening;
  uniform float uVignette;
  uniform float uVignetteSoftness;
  uniform float uGrain;
  uniform float uTime;
  varying vec2 vUv;

  float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

  float grainNoise( vec2 p ) {
    return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  }

  // ACES Filmic 的解析近似（与 three.js 内置 RRTAndODTFit 同一条曲线）
  vec3 acesFilmic( vec3 x ) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp( ( x * ( a * x + b ) ) / ( x * ( c * x + d ) + e ), 0.0, 1.0 );
  }

  // 线性 → sRGB 输出编码（OETF）
  vec3 linearToSRGB( vec3 c ) {
    vec3 lo = 12.92 * c;
    vec3 hi = 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 1.0 / 2.4 ) ) - 0.055;
    return mix( lo, hi, step( vec3( 0.0031308 ), c ) );
  }

  // 雨后深林阴天 LUT：极暗部保持纯净深蓝黑夜空，中暗部墨绿、中间调通透湿润，朱红焦点独立保护
  vec3 rainForestLUT( vec3 c, float l ) {
    vec3 nightShadowTint = vec3( 0.94, 0.96, 1.02 );
    vec3 shadowTint = mix( nightShadowTint, vec3( 0.92, 0.965, 0.955 ), smoothstep( 0.02, 0.14, l ) );
    vec3 midTint    = vec3( 0.965, 1.015, 0.985 );
    vec3 highTint   = vec3( 0.980, 1.010, 1.025 );
    float s = smoothstep( 0.03, 0.34, l );
    float h = smoothstep( 0.56, 0.92, l );
    vec3 tint = mix( mix( shadowTint, midTint, s ), highTint, h );
    float vermilionMask = clamp( ( c.r - max( c.g, c.b ) ) * 2.5, 0.0, 1.0 );
    vec3 finalTint = mix( tint, vec3( 1.04, 0.98, 0.94 ), vermilionMask * 0.75 );
    return mix( c, c * finalTint, uLutStrength );
  }

  void main() {
    vec4 base = texture2D( tScene, vUv );

    // 1) 线性 HDR → 显示参考：曝光 + ACES 软肩
    vec3 c = base.rgb * uExposure * uGain;
    c = acesFilmic( c );
    c = linearToSRGB( c );

    // 2) 高光柔化：阴天漫射光软膝压缩，避免过曝刺眼
    const float knee = 0.74;
    float hi = max( c.r, max( c.g, c.b ) );
    float soft = clamp( ( hi - knee ) / max( 1.0 - knee, 0.001 ), 0.0, 1.0 );
    c -= c * soft * uHighlightSoftening;

    // 3) 暗部抬升：对接近纯黑的夜空与黑山剪影不做发灰抬升
    float l0 = luma( c );
    float darkMask = smoothstep( 0.015, 0.08, l0 ) * ( 1.0 - smoothstep( 0.08, 0.42, l0 ) );
    c += uLift * 0.55 * darkMask * ( 1.0 - c );

    // 4) 雨后深林 LUT 与色温微调
    float l = luma( c );
    c = rainForestLUT( c, l );
    c *= mix( vec3( 1.0 ), vec3( 1.045, 1.005, 0.925 ), uWarmth );

    // 5) 对比（围绕中灰，凸显明暗层次）
    c = ( c - 0.5 ) * uContrast + 0.5;

    // 6) 饱和度：自然低饱和，高亮区收敛
    float sat = uSaturation - 0.18 * smoothstep( 0.72, 1.0, luma( c ) );
    c = mix( vec3( luma( c ) ), c, clamp( sat, 0.0, 2.0 ) );

    // 7) 暗角（四周林木天然画框氛围加持）
    vec2 q = vUv - 0.5;
    float r = length( q ) * ( 1.0 + uVignetteSoftness );
    float vig = 1.0 - smoothstep( 0.42, 0.92, r ) * uVignette;
    c *= vig;

    // 8) 胶片细颗粒
    float g = ( grainNoise( vUv * 1024.0 + vec2( uTime * 37.0, uTime * 17.0 ) ) - 0.5 ) * uGrain;
    c += g;

    gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), base.a );
  }
`;
