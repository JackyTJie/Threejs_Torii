// 叶片微振顶点位移（S7.9）：单片叶子在叶簇内的极小幅抖动。
//
// 与 animations/tree-sway.js 的分工：
//   - tree-sway 在 CPU 上转「构件组」（主枝 Group / 叶簇 Group），负责枝梢与整簇叶片的起伏；
//   - 本 shader 在 GPU 上给「簇内每一片叶」叠加一层更细、更快的微振，
//     这是 CPU 逐叶片做不到的（36 株 × 每株 300+ 叶逐实例矩阵重写会白白吃掉每帧几千次矩阵运算）。
//     叶隙闪烁（斑驳光斑的来源）正是来自这一层。
//
// 相位来源 = instanceMatrix 的平移列：同一簇内的每片叶拿到一个稳定而互不相同的相位，
// 不需要额外的属性、也不随帧变化（叶片不会因此「跳相」）。
// 振幅由 uAmplitude 给死上限，uGust 由 CPU 侧共用同一阵风曲线（与枝摆同步，不会出现两套风）。

// uniform 声明必须独立前置到顶点着色器全局作用域：片段被注入到 void main() 内部，
// GLSL 不允许函数体内声明 uniform（整条 program 编译失败 = 叶片全部不渲染）。
export const LEAF_FLUTTER_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uPeriod;
  uniform float uGust;
`;

export const LEAF_FLUTTER_VERT = /* glsl */ `
  vec3 leafFlutter( vec3 displaced, mat4 instanceTransform ) {
    // instanceTransform[3].xyz = 该叶片在叶簇局部空间里的位置，作为稳定相位种子
    vec3 origin = instanceTransform[3].xyz;
    float seed = fract( dot( origin, vec3( 12.9898, 78.233, 45.164 ) ) );
    float phase = seed * 6.2831853;
    // 逐叶片振幅差：有的叶几乎不动，有的叶明显抖 —— 均匀抖动看起来像整簇在抖
    float a = uAmplitude * uGust * ( 0.55 + 0.75 * seed );
    float t = ( uTime / max( uPeriod, 0.001 ) ) * 6.2831853;
    displaced.x += sin( t + phase ) * a;
    displaced.y += sin( t * 0.71 + phase * 1.7 ) * a * 0.45;   // 竖向最弱：叶片薄，竖向位移最容易与邻叶穿叠
    displaced.z += cos( t * 1.19 + phase * 0.6 ) * a * 0.8;
    return displaced;
  }
`;

/** 注入点：紧跟 <begin_vertex>，且只在带 instanceMatrix 的网格上生效 */
export const LEAF_FLUTTER_APPLY = /* glsl */ `
  #ifdef USE_INSTANCING
    transformed = leafFlutter( transformed, instanceMatrix );
  #endif
`;
