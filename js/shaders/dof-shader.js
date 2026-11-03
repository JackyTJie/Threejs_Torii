// 景深（S8.2）：CoC 感知的可分离 gather + 锐/糊合成
//
// 为什么不用「一圈 Poisson 采样」：8 个采样点在半径十几像素时会把邻域的像素离散地搬过来，
// 在树叶、道砟这种高频细节上表现为颗粒状鬼影；而且采样轴固定在世界屏幕轴上，
// 远处山林会出现肉眼可见的水平/竖直条纹。
//
// 本实现：
//   1) 弥散圆（CoC）用「超出焦外的深度量」直接给像素半径，近/远分别加权 —— 前景底座「微失焦」、
//      北坡林「轻微虚化」是两个可以各自调的旋钮，不靠镜头公式间接实现；
//   2) 横向 + 纵向两趟 gather，每趟的采样轴按像素哈希旋转一个随机角（两趟正交）——
//      散景因此不带轴向网格；
//   3) gather 带「弥散圆够大才允许进入」的判据：清晰像素不会被糊样本污染，
//      已虚化的前景也不会被更远的清晰背景漏进来（遮挡关系由近侧样本优先保证）；
//   4) 最后按 CoC 平滑混合锐/糊，避免「锐利 → 模糊」的硬边界。

/** 共用：深度 → 视空间距离、深度 → 弥散圆像素半径 */
const DOF_COMMON = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform vec2 uTexel;
  uniform vec2 uResolution;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uFocusDistance;
  uniform float uFocusRange;
  uniform float uMaxBlurPx;
  uniform float uNearWeight;
  uniform float uFarWeight;
  uniform float uDepthFalloff;
  uniform float uAxis;
  varying vec2 vUv;

  float readDepth( vec2 uv ) {
    float z = texture2D( tDepth, uv ).r;
    // 天空 / 无物处：按最远处理，让它吃满虚化而不是被当成「贴脸的近物」
    if ( z >= 0.9999 ) return uCameraFar;
    float viewZ = ( uCameraNear * uCameraFar ) / ( ( uCameraFar - uCameraNear ) * z - uCameraFar );
    return max( -viewZ, 0.0 );
  }

  float cocPx( float depth ) {
    float d = depth - uFocusDistance;
    float ad = abs( d );
    if ( ad <= uFocusRange ) return 0.0;
    float excess = ad - uFocusRange;
    float t = clamp( excess * uDepthFalloff, 0.0, 1.0 );
    t *= ( d > 0.0 ) ? uFarWeight : uNearWeight;
    return clamp( t, 0.0, 1.0 ) * uMaxBlurPx;
  }

  // 逐像素随机角（两趟之间再正交 90°）：打散采样轴，散景不出现轴向条纹
  float sampleAngle() {
    vec2 p = floor( vUv * uResolution );
    float h = fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    return h * 1.5707963 + uAxis * 1.5707963;
  }
`;

/** 单趟 gather（横向 / 纵向各一次） */
export const DOF_GATHER_FS = DOF_COMMON + /* glsl */ `
  const int TAPS = 16;

  void main() {
    vec4 base = texture2D( tScene, vUv );
    float depth = readDepth( vUv );
    float coc = cocPx( depth );

    if ( coc < 0.6 ) {
      gl_FragColor = base;
      return;
    }

    float ang = sampleAngle();
    vec2 dir = vec2( cos( ang ), sin( ang ) );
    vec3 sum = base.rgb;
    float wsum = 1.0;

    for ( int i = 1; i <= TAPS; i++ ) {
      float t = ( float( i ) - 0.5 ) / float( TAPS );
      float dist = coc * t;
      vec2 off = dir * ( dist * uTexel );

      vec2 uvA = vUv + off;
      vec2 uvB = vUv - off;

      float depthA = readDepth( uvA );
      float depthB = readDepth( uvB );
      float cocA = cocPx( depthA );
      float cocB = cocPx( depthB );

      // 允许该样本进入的条件：它的弥散圆够大，覆盖得到本像素
      float wA = ( cocA >= dist || cocA >= coc ) ? 1.0 : 0.0;
      float wB = ( cocB >= dist || cocB >= coc ) ? 1.0 : 0.0;
      // 遮挡边界：更近的样本优先，不让远处抢近处的颜色
      wA *= depthA < depth ? 1.18 : 1.0;
      wB *= depthB < depth ? 1.18 : 1.0;

      sum += texture2D( tScene, uvA ).rgb * wA;
      sum += texture2D( tScene, uvB ).rgb * wB;
      wsum += wA + wB;
    }

    gl_FragColor = vec4( sum / max( wsum, 1.0 ), base.a );
  }
`;

/** 锐 / 糊按 CoC 平滑混合 */
export const DOF_COMPOSITE_FS = DOF_COMMON + /* glsl */ `
  uniform sampler2D tSharp;
  uniform sampler2D tBlurred;

  void main() {
    float depth = readDepth( vUv );
    float coc = cocPx( depth );
    vec4 sharp = texture2D( tSharp, vUv );
    vec4 blurred = texture2D( tBlurred, vUv );
    // 低弥散区先混合回锐利：既保住焦点区域的细节，也让「开始糊」这件事没有硬边界
    float k = clamp( smoothstep( 0.0, max( uMaxBlurPx, 0.001 ) * 0.35, coc ), 0.0, 1.0 );
    gl_FragColor = vec4( mix( sharp.rgb, blurred.rgb, k ), sharp.a );
  }
`;

/** 保留旧导出名，供已有引用过渡 */
export const DOF_FS = DOF_GATHER_FS;
