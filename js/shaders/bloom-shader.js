// 辉光：亮度提取 + 半分辨率高斯模糊，用于逆光叶隙与金属高光

export const BRIGHT_FS = /* glsl */ `
  uniform sampler2D tScene;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  void main() {
    vec4 base = texture2D( tScene, vUv );
    float l = dot( base.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
    // 阈值在「线性 HDR」里比较（离屏缓冲不做色调映射，受光面可以到 2~4）。
    // 旧写法除以 (1 - uThreshold)：阈值一旦 >= 1 分母变负，亮度越高 k 越负，
    // 辉光变成负数往画面里减颜色。改成显式膝宽。
    float k = clamp( ( l - uThreshold ) / max( uKnee, 1e-4 ), 0.0, 1.0 );
    gl_FragColor = vec4( base.rgb * k * k, 1.0 );
  }
`;

export const BLUR_FS = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uTexel;
  uniform float uRadius;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexel * uRadius;
    vec3 sum = texture2D( tScene, vUv ).rgb * 0.25;
    sum += texture2D( tScene, vUv + vec2(  o.x, 0.0 ) ).rgb * 0.125;
    sum += texture2D( tScene, vUv + vec2( -o.x, 0.0 ) ).rgb * 0.125;
    sum += texture2D( tScene, vUv + vec2( 0.0,  o.y ) ).rgb * 0.125;
    sum += texture2D( tScene, vUv + vec2( 0.0, -o.y ) ).rgb * 0.125;
    sum += texture2D( tScene, vUv + o ).rgb * 0.0625;
    sum += texture2D( tScene, vUv - o ).rgb * 0.0625;
    sum += texture2D( tScene, vUv + vec2( o.x, -o.y ) ).rgb * 0.0625;
    sum += texture2D( tScene, vUv + vec2( -o.x, o.y ) ).rgb * 0.0625;
    gl_FragColor = vec4( sum, 1.0 );
  }
`;

export const COMPOSITE_FS = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float uBloomStrength;
  varying vec2 vUv;
  void main() {
    vec4 base = texture2D( tScene, vUv );
    vec3 bloom = texture2D( tBloom, vUv ).rgb;
    gl_FragColor = vec4( base.rgb + bloom * uBloomStrength, base.a );
  }
`;
