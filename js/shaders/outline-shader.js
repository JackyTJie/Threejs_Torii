// 描边：反向壳体（几何）+ 后处理深度边缘（screen-space）双路
// 反向壳体提供稳定、不断裂的轮廓；后处理深度差补充细部与远处收细。
//
// 自适应规则（AGENT.md 二级：近处略粗、远处自然收细，不能抖动、断裂）：
//   屏幕线宽 1.6 px（近）→ 0.7 px（远），在世界厚度上表现为「随距离略微变厚」，
//   用来抵消透视投影本身的收缩（透视会把 60 m 处的轮廓缩到 14 m 处的 1/4，
//   直接固定世界厚度等于远处描边几乎看不见 —— 那就是「断裂」）。

/** 全屏四边形顶点（后处理通用） */
export const QUAD_VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`;

/** 深度边缘检测：邻域深度差 → 轮廓强度（深度差按该处距离归一化） */
export const EDGE_FS = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform vec2 uTexel;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uThreshold;
  uniform float uStrength;
  uniform float uNearDistance;
  uniform float uFarDistance;
  uniform float uNearWeight;
  uniform float uFarWeight;
  uniform vec3 uOutlineColor;
  varying vec2 vUv;

  // 未绘制像素（天空）的哨兵距离。必须远大于任何真实几何距离，而且不能借用
  // camera.far：相机 far 随滚轮在 120…960 之间变化，拿它当参考的话同一段几何
  // 会在缩放过程中忽描忽不描（描边随滚轮呼吸）。
  const float SKY_DISTANCE = 1.0e7;

  float readDistance( vec2 uv ) {
    float z = texture2D( tDepth, uv ).r;
    if ( z >= 0.99999 ) return SKY_DISTANCE;
    float viewZ = ( uCameraNear * uCameraFar ) / ( ( uCameraFar - uCameraNear ) * z - uCameraFar );
    return max( -viewZ, 0.01 );
  }

  void main() {
    vec4 base = texture2D( tScene, vUv );
    float d = readDistance( vUv );
    if ( d >= SKY_DISTANCE ) {
      // 天空像素自己不描边：轮廓线只画在几何一侧，避免剪影变成双倍宽度的硬线
      gl_FragColor = base;
      return;
    }
    float dl = readDistance( vUv + vec2( -uTexel.x, 0.0 ) );
    float dr = readDistance( vUv + vec2(  uTexel.x, 0.0 ) );
    float du = readDistance( vUv + vec2( 0.0,  uTexel.y ) );
    float dd = readDistance( vUv + vec2( 0.0, -uTexel.y ) );

    // 相对深度差：轮廓边缘的深度跳变与观察距离成正比，除以距离后
    // 近处与远处得到同一把尺子（否则远处先掉线）。
    float diff = ( abs( d - dl ) + abs( d - dr ) + abs( d - du ) + abs( d - dd ) ) / max( d, 0.5 );
    float edge = smoothstep( uThreshold, uThreshold * 3.0, diff );

    // 远处收细（不是关掉）
    float k = clamp( ( d - uNearDistance ) / max( uFarDistance - uNearDistance, 0.001 ), 0.0, 1.0 );
    edge *= mix( uNearWeight, uFarWeight, k );

    gl_FragColor = vec4( mix( base.rgb, uOutlineColor, clamp( edge * uStrength, 0.0, 1.0 ) ), base.a );
  }
`;

/** 反向壳体片元：纯色轮廓，远处只轻微减淡（不淡到 0） */
export const SHELL_FS = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vShellFade;
  void main() {
    gl_FragColor = vec4( uColor, uOpacity * vShellFade );
  }
`;

/** 反向壳体顶点：按目标屏幕线宽反算世界厚度，再换算回网格局部空间 */
export const SHELL_VS = /* glsl */ `
  uniform float uNearPx;
  uniform float uFarPx;
  uniform float uNearDistance;
  uniform float uFarDistance;
  uniform float uPxScale;
  uniform float uCapThickness;
  uniform float uFarKeep;
  varying float vShellFade;

  void main() {
    vec4 base = modelViewMatrix * vec4( position, 1.0 );
    float dist = max( -base.z, 0.01 );

    // 目标屏幕线宽：近处略粗、远处自然收细
    float k = clamp( ( dist - uNearDistance ) / max( uFarDistance - uNearDistance, 0.001 ), 0.0, 1.0 );
    float px = mix( uNearPx, uFarPx, k );

    // 世界厚度 = 线宽 × 距离 / 单位距离像素尺度；上限防止远处壳体吞掉细构件
    float world = min( px * dist / max( uPxScale, 1.0 ), uCapThickness );
    // modelViewMatrix 的列长就是网格自身缩放（视图矩阵是刚体，不含缩放）
    float localScale = max( length( modelViewMatrix[ 0 ].xyz ), 0.001 );

    // 法线归一化：非均匀缩放的网格其 normal 属性不再是单位长，直接用会让壳体
    // 在某个轴上偏厚（描边粗细随观察方向变化）
    vec3 outward = normalize( normal );
    vec3 displaced = position + outward * ( world / localScale );
    vec4 mv = modelViewMatrix * vec4( displaced, 1.0 );

    vShellFade = mix( 1.0, uFarKeep, k );
    gl_Position = projectionMatrix * mv;
  }
`;
