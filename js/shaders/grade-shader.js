// 输出级（S8.3）：曝光 → ACES 色调映射 → sRGB 编码 → 暖秋日调色（显示参考空间）
//
// 为什么色调映射必须写在这里而不是交给渲染器：
//   three.js 只在「渲染到屏幕」时才做色调映射与色彩空间转换，渲染进离屏缓冲时两者都跳过；
//   而 ShaderMaterial 不含 <tonemapping_fragment> / <colorspace_fragment>，即使画到屏幕也不会自动转换。
//   本管线全程离屏，最后一趟用 ShaderMaterial 画到屏幕 —— 于是ACES 与 sRGB 编码谁都没做，
//   线性 HDR 被直接 clamp 进 0..1：高光削平、中间调发暗，RENDER.toneMapping 配了等于没配。
//   因此渲染器侧显式设为 NoToneMapping，色调映射由本 pass 独占（见 js/renderer.js）。
//
// 调色放在 sRGB 编码之后做：对比 / 饱和 / 色偏是显示参考空间的操作，
// 在线性空间做同样的数值会得到完全不同的观感（线性空间的 0.5 比肉眼意义上的中灰暗得多）。

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

  // 暖秋日 LUT：暗部微冷青、中间调暖橙、高光琥珀 —— 三段各自给色偏而不是全局乘一个暖色
  vec3 autumnLUT( vec3 c, float l ) {
    vec3 shadowTint = vec3( 0.930, 0.972, 1.060 );
    vec3 midTint    = vec3( 1.052, 1.000, 0.902 );
    vec3 highTint   = vec3( 1.062, 1.010, 0.878 );
    float s = smoothstep( 0.03, 0.34, l );
    float h = smoothstep( 0.56, 0.92, l );
    vec3 tint = mix( mix( shadowTint, midTint, s ), highTint, h );
    return mix( c, c * tint, uLutStrength );
  }

  void main() {
    vec4 base = texture2D( tScene, vUv );

    // 1) 线性 HDR → 显示参考：曝光 + ACES 软肩
    vec3 c = base.rgb * uExposure * uGain;
    c = acesFilmic( c );
    c = linearToSRGB( c );

    // 2) 高光柔化（显示空间，膝点才有肉眼意义）：软膝压缩，避免过曝刺眼
    const float knee = 0.72;
    float hi = max( c.r, max( c.g, c.b ) );
    float soft = clamp( ( hi - knee ) / max( 1.0 - knee, 0.001 ), 0.0, 1.0 );
    c -= c * soft * uHighlightSoftening;

    // 3) 暗部抬升：只抬暗侧，不让 lift 把黑底糊成灰（保留通透感）
    float darkMask = 1.0 - smoothstep( 0.0, 0.42, luma( c ) );
    c += uLift * darkMask * ( 1.0 - c );

    // 4) 暖秋日 LUT
    float l = luma( c );
    c = autumnLUT( c, l );
    c *= mix( vec3( 1.0 ), vec3( 1.045, 1.005, 0.925 ), uWarmth );

    // 5) 对比（围绕肉眼中灰，柔和）
    c = ( c - 0.5 ) * uContrast + 0.5;

    // 6) 饱和度：按亮度加权，高亮区不再往上推饱和（秋日自然饱和、不刺眼）
    float sat = uSaturation - 0.22 * smoothstep( 0.72, 1.0, luma( c ) );
    c = mix( vec3( luma( c ) ), c, clamp( sat, 0.0, 2.0 ) );

    // 7) 暗角（软边，不切边）
    vec2 q = vUv - 0.5;
    float r = length( q ) * ( 1.0 + uVignetteSoftness );
    float vig = 1.0 - smoothstep( 0.42, 0.92, r ) * uVignette;
    c *= vig;

    // 8) 细颗粒（显示空间 0.018 是「看得见但不脏」的量级）
    float g = ( grainNoise( vUv * 1024.0 + vec2( uTime * 37.0, uTime * 17.0 ) ) - 0.5 ) * uGrain;
    c += g;

    gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), base.a );
  }
`;
