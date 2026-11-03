// 水面流动片元着色（S7.9）：顺流推进的亮带 + 视角落差决定的水面反光。
//
// 与 animations/stream-flow.js 的分工：
//   - stream-flow 在 CPU 上做**几何**波（逐顶点位移 + 重算法线），高光与折射因此会真的跟着波面走；
//   - 本 shader 做**颜色**流：亮带沿溪流下游方向缓慢推进，让「水在流」这件事看得见。
//     只有几何波而没有颜色流，水面看起来是「整片起伏的静止玻璃」。
//
// 为什么不在 GPU 上做几何波：水体是 MeshPhysicalMaterial（transmission + clearcoat），
// 注入顶点位移要同时改主渲染与阴影两套 program，风险远大于收益（详见 docs/ASSET_INDEX.md §59 / §61）。
//
// 横向相位错开（lateral 项）是必要的：直溪段若只按纵向推进，整条溪会呈现
// 「一整条同步亮带」的机械感；靠岸一侧滞后才像真的被河床摩擦的水。

// uniform 声明单独导出：片段被注入到 void main() 内部，而 GLSL 不允许函数体内声明 uniform。
export const WATER_FLOW_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform vec2 uFlowDir;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform float uFlowScale;
  uniform float uFlowStrength;
`;

export const WATER_FLOW_FRAG = /* glsl */ `
  vec3 waterFlow( vec3 color, vec3 worldPos, vec3 normal, vec3 viewDir ) {
    vec2 p = worldPos.xz;
    float along = dot( p, uFlowDir ) * uFlowScale;
    vec2 lateralDir = vec2( -uFlowDir.y, uFlowDir.x );
    float lateral = dot( p, lateralDir );

    // 主亮带：顺流推进
    float flow = fract( along + lateral * 0.18 + uTime * uFlowSpeed );
    float band = pow( 0.5 + 0.5 * sin( flow * 6.2831853 ), 2.4 );
    // 副亮带：不同速度、反向、不同周期，打破「一整条同步亮带」
    float flow2 = fract( along * 0.63 - lateral * 0.11 - uTime * uFlowSpeed * 1.37 + 0.31 );
    float band2 = pow( 0.5 + 0.5 * sin( flow2 * 6.2831853 ), 2.8 );

    // 视角落差：掠射角时反光强、俯视时看到水体本色
    float ndv = abs( dot( normalize( normal ), normalize( viewDir ) ) );
    float fresnel = pow( 1.0 - clamp( ndv, 0.0, 1.0 ), 2.2 );

    vec3 body = mix( uDeepColor, uShallowColor, 0.30 + 0.70 * band );
    vec3 tint = mix( vec3( 1.0 ), body * 1.35, 0.30 * uFlowStrength );
    vec3 sheen = ( uShallowColor * band + uDeepColor * band2 * 0.5 ) * fresnel * 0.55;
    return color * tint + sheen * uFlowStrength;
  }
`;
