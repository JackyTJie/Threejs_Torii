// 第一优先级：屏幕空间环境光遮蔽（SSAO）+ 世界空间分层流动高度雾（Layered Animated Height Fog）
//
// 1. SSAO 环境光遮蔽：
//    - 由深度纹理（tDepth）反解视图空间三维坐标与邻域差分法线；
//    - 采用 16 点黄金螺旋双尺度采样（小半径强化树叶缝隙、石阶拼接缝、石块底部与草木根部闭塞阴影，
//      中半径强化石块与地形接触暗部），配合双边深度阈值保护避免远景轮廓产生伪影黑边；
//    - 闭塞色采用深林冷墨绿（uSsaoColor），消除物体扁平粘连感，同时保留三渲二色阶的干净通透。
//
// 2. 分层流动高度雾（替代全局均匀雾）：
//    - 通过 uInvViewMatrix 将视图空间坐标反变换至真实世界坐标 worldPos；
//    - 低海拔区域（石阶中下段、山涧溪谷 worldY <= uFogBaseY）雾气浓度最高，随海拔高度（worldY）上升
//      按指数规律自然变淡，确保高处鸟居朱红漆面与林冠透光清晰通透；
//    - 叠加低速三维 FBM 噪声扰动（uTime * uFogSpeed），呈现山涧雨后云雾缓慢流动的自然生命力。

export const SSAO_FOG_FS = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform vec2 uTexel;
  uniform vec2 uResolution;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uProjScale;
  uniform float uAspect;
  uniform mat4 uInvViewMatrix;
  uniform vec3 uCameraPos;

  // SSAO 参数
  uniform float uSsaoEnabled;
  uniform float uSsaoStrength;
  uniform float uSsaoRadius;
  uniform float uSsaoBias;
  uniform vec3 uSsaoColor;

  // 分层动态高度雾参数
  uniform float uFogEnabled;
  uniform vec3 uFogColor;
  uniform vec3 uFogSunTint;
  uniform float uFogDensity;
  uniform float uFogBaseY;
  uniform float uFogHeightFalloff;
  uniform float uFogSpeed;
  uniform float uFogNoiseAmp;
  uniform float uTime;

  varying vec2 vUv;

  float hash12( vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }

  float noise3( vec3 x ) {
    vec3 i = floor( x );
    vec3 f = fract( x );
    f = f * f * ( 3.0 - 2.0 * f );
    float n = i.x + i.y * 157.0 + 113.0 * i.z;
    vec4 v1 = fract( 753.5453123 * sin( n + vec4( 0.0, 1.0, 157.0, 158.0 ) ) );
    vec4 v2 = fract( 753.5453123 * sin( n + vec4( 113.0, 114.0, 270.0, 271.0 ) ) );
    vec4 v = mix( v1, v2, f.z );
    vec2 vh = mix( v.xy, v.zw, f.y );
    return mix( vh.x, vh.y, f.x );
  }

  float fogFbm( vec3 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 3; i++ ) {
      v += a * noise3( p );
      p = p * 2.03 + vec3( 13.7, -9.2, 7.1 );
      a *= 0.5;
    }
    return v;
  }

  // 深度值 -> 视图空间正向距离（-viewZ）
  float readLinearDepth( vec2 uv ) {
    float z = texture2D( tDepth, uv ).r;
    if ( z >= 0.99995 ) return -1.0;
    float viewZ = ( uCameraNear * uCameraFar ) / ( ( uCameraFar - uCameraNear ) * z - uCameraFar );
    return max( -viewZ, 0.01 );
  }

  // 屏幕 UV + 正向距离 -> 视图空间三维坐标（右手系，相机朝 -Z）
  vec3 reconstructViewPos( vec2 uv, float dist ) {
    vec2 ndc = uv * 2.0 - 1.0;
    float vx = ndc.x * uAspect * dist / max( uProjScale, 0.001 );
    float vy = ndc.y * dist / max( uProjScale, 0.001 );
    return vec3( vx, vy, -dist );
  }

  void main() {
    vec4 base = texture2D( tScene, vUv );
    float centerDist = readLinearDepth( vUv );
    if ( centerDist < 0.0 ) {
      gl_FragColor = base;
      return;
    }

    vec3 viewPos = reconstructViewPos( vUv, centerDist );
    vec3 worldPos = ( uInvViewMatrix * vec4( viewPos, 1.0 ) ).xyz;
    vec3 color = base.rgb;

    // ------------------------------------------------------------------ 1) SSAO 屏幕空间环境光遮蔽
    if ( uSsaoEnabled > 0.5 && uSsaoStrength > 0.001 ) {
      // 由四邻域中深度更连续的一侧重建视图法线，避免跨物体边缘的伪法线
      float dL = readLinearDepth( vUv - vec2( uTexel.x, 0.0 ) );
      float dR = readLinearDepth( vUv + vec2( uTexel.x, 0.0 ) );
      float dD = readLinearDepth( vUv - vec2( 0.0, uTexel.y ) );
      float dU = readLinearDepth( vUv + vec2( 0.0, uTexel.y ) );

      vec3 pL = dL > 0.0 ? reconstructViewPos( vUv - vec2( uTexel.x, 0.0 ), dL ) : viewPos;
      vec3 pR = dR > 0.0 ? reconstructViewPos( vUv + vec2( uTexel.x, 0.0 ), dR ) : viewPos;
      vec3 pD = dD > 0.0 ? reconstructViewPos( vUv - vec2( 0.0, uTexel.y ), dD ) : viewPos;
      vec3 pU = dU > 0.0 ? reconstructViewPos( vUv + vec2( 0.0, uTexel.y ), dU ) : viewPos;

      vec3 dx = abs( dR - centerDist ) < abs( centerDist - dL ) ? ( pR - viewPos ) : ( viewPos - pL );
      vec3 dy = abs( dU - centerDist ) < abs( centerDist - dD ) ? ( pU - viewPos ) : ( viewPos - pD );
      vec3 viewNormal = normalize( cross( dx, dy ) );

      // 屏幕空间采样半径随距离透视缩放（限制上下界保住细缝与根部接触感）
      float screenRadius = clamp( uSsaoRadius * uProjScale / max( centerDist, 1.2 ), 0.003, 0.036 );
      float jitter = hash12( floor( vUv * uResolution ) ) * 6.2831853;

      float occ = 0.0;
      float validSamples = 0.0;
      const int TAPS = 16;

      for ( int i = 0; i < TAPS; i++ ) {
        float fi = float( i ) + 0.5;
        float rFrac = sqrt( fi / float( TAPS ) );
        float theta = fi * 2.39996323 + jitter;
        vec2 dir = vec2( cos( theta ), sin( theta ) );
        vec2 sampleUv = vUv + dir * ( screenRadius * rFrac ) * vec2( 1.0 / max( uAspect, 0.1 ), 1.0 );

        float sampleDist = readLinearDepth( sampleUv );
        if ( sampleDist < 0.0 ) continue;

        vec3 samplePos = reconstructViewPos( sampleUv, sampleDist );
        vec3 vDiff = samplePos - viewPos;
        float dist3D = length( vDiff );
        if ( dist3D < 0.0005 ) continue;

        vec3 sampleDir = vDiff / dist3D;
        // 法线半球内侧遮蔽度（石阶夹角、石底、树叶叠缝、草根处 dot 显著为正）
        float nds = max( 0.0, dot( viewNormal, sampleDir ) - uSsaoBias );
        // 双边范围衰减：只允许真实物理邻域（0.02m ~ 0.85m）产生闭塞，彻底杜绝背景被前景误黑
        float rangeCheck = smoothstep( uSsaoRadius * 2.2, uSsaoRadius * 0.25, dist3D ) *
                           smoothstep( 1.25, 0.18, abs( centerDist - sampleDist ) );
        occ += nds * rangeCheck;
        validSamples += 1.0;
      }

      float ao = validSamples > 0.0 ? clamp( ( occ / validSamples ) * 2.15 * uSsaoStrength, 0.0, 0.78 ) : 0.0;
      // 低处石阶缝隙、溪石根部与植被根部略微增强闭塞感
      float groundBoost = 1.0 + 0.22 * ( 1.0 - smoothstep( 0.2, 4.5, worldPos.y ) );
      ao = clamp( ao * groundBoost, 0.0, 0.80 );

      // Preserve vermilion glow while deepening crevices with forest-slate occlusion
      color = mix( color, color * uSsaoColor, ao );
    }

    // ------------------------------------------------------------------ 2) 分层动态高度雾（Layered Animated Height Fog）
    if ( uFogEnabled > 0.5 && uFogDensity > 0.0001 ) {
      float rayDist = length( worldPos - uCameraPos );

      // 低速流动的三维深林云雾噪声场（沿山涧向下游与林间缓慢漂移）
      vec3 windFlow = vec3( uTime * uFogSpeed * 0.28, -uTime * uFogSpeed * 0.08, uTime * uFogSpeed * 0.42 );
      float n1 = fogFbm( worldPos * 0.24 + windFlow );
      float n2 = fogFbm( worldPos * 0.58 - windFlow * 1.35 + vec3( 4.2, 1.7, -3.1 ) );
      float mistWave = ( n1 * 0.65 + n2 * 0.35 - 0.45 ) * uFogNoiseAmp;

      // 海拔高度分层：低处石阶与山涧溪流（worldY <= uFogBaseY）雾气最浓，随高度上升指数衰减
      float effectiveY = max( 0.0, ( worldPos.y - uFogBaseY ) - mistWave * 1.35 );
      float heightFactor = exp( -effectiveY * uFogHeightFalloff );

      // 溪谷与低处石阶走廊微聚雾加成（营造山涧湿气升腾与低处聚雾氛围）
      float valleyPool = exp( -max( 0.0, worldPos.y - 1.85 ) * 0.95 ) *
                         ( 0.65 + 0.55 * smoothstep( 2.5, -4.5, worldPos.x ) );
      float localDensity = uFogDensity * ( heightFactor * 0.78 + valleyPool * 0.48 ) * ( 0.82 + 0.42 * n1 );

      // 距离积分消光（近处保持前景画框锐利，中低处石阶与溪谷漫入柔和薄雾）
      float distFactor = max( 0.0, rayDist - 2.4 );
      float fogAmount = clamp( 1.0 - exp( -localDensity * distFactor * 0.14 ), 0.0, 0.82 );

      // 高处林隙微带天光散射色温，低处贴合深林暗绿调性
      float skyBlend = clamp( smoothstep( 0.5, 6.5, worldPos.y ) * 0.35 + n2 * 0.18, 0.0, 0.48 );
      vec3 fogTone = mix( uFogColor, uFogSunTint, skyBlend );

      // 对鸟居高饱和朱红漆面做适度透雾保护，使画面中心红色鸟居焦点鲜明突出
      float vermilionKeep = clamp( ( color.r - max( color.g, color.b ) ) * 1.8, 0.0, 0.42 );
      fogAmount *= ( 1.0 - vermilionKeep );

      color = mix( color, fogTone, fogAmount );
    }

    gl_FragColor = vec4( color, base.a );
  }
`;
