// 物理级程序化大气天空 + 多层体积云 + 5层视差远山与千本鸟居微光 + SSAO + 3D体积雾 + 林间丁达尔体积光（God Ray）
//
// 1. 瑞利与米氏散射程序化天空（Rayleigh & Mie Atmospheric Sky）：
//    - 彻底取代静态纯青背景贴图，实时解算「深夜(银河/旋转星穹) → 蓝调时刻(深蓝/紫粉橘) → 日出/黄昏(暖金橘红/玫红/钴蓝)
//      → 清晨/雨后 → 正午(淡青蓝) → 月夜(冷银灰蓝/月相)」的全天时大气光学过渡；
//    - 双层程序化体积云（高空丝缕卷云 + 低空翻涌层云）：随时间漂移演化，云量随时段自动消长，云缘受阳光/月光米氏前向散射形成银金亮边。
//
// 2. 5层大气透视程序化远山与相机视差滚动（5-Layer Atmospheric Perspective Mountains & Parallax）：
//    - 在天空与中景林木之间插入 5 层远山剪影：越远亮度越高、饱和度越低、越贴近天际雾色；
//    - 最近一层山脊带杉林树冠细节与主光照阴阳受光面；所有山体随相机移动/转动产生真实多平面视差滚动；
//    - 远山坳中点缀极细微的暖红色光点，模拟远处稻荷山绵延整山的千本鸟居与参道石灯笼。
//
// 3. 3D 噪声驱动体积雾与林间丁达尔体积光（3D Volumetric Fog & Forest God Rays）：
//    - 沿视线进行三维步进积分：谷底石阶与溪流最浓、随海拔升高消散，沿参道流动并自然绕开鸟居立柱与树干；
//    - 阳光/月光穿过树冠缝隙与鸟居横梁形成丁达尔体积光束（God Ray），光束内可见漂浮微尘颗粒，黄昏时形成穿过鸟居的「光影隧道」；
//    - 参道春日木灯笼的暖黄灯光在三维雾气中扩散成柔和的球形暖光晕。

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

  // 3D 体积雾与大气/体积光参数
  uniform float uFogEnabled;
  uniform vec3 uFogColor;
  uniform vec3 uFogSunTint;
  uniform float uFogDensity;
  uniform float uFogBaseY;
  uniform float uFogHeightFalloff;
  uniform float uFogSpeed;
  uniform float uFogNoiseAmp;
  uniform float uTime;

  // 全天时大气、主光源、灯笼与天气联动参数
  uniform float uDayHour;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform float uGodRayStrength;
  uniform float uLanternIntensity;
  uniform vec3 uLanternPosL;
  uniform vec3 uLanternPosR;
  uniform float uWeatherMode; // 0 = 雨后初霁, 1 = 细雨霏霏, 2 = 深山浓雾
  uniform float uMoonPhase;

  varying vec2 vUv;

  float hash12( vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }

  float hash13( vec3 p3 ) {
    p3 = fract( p3 * 0.1031 );
    p3 += dot( p3, p3.zyx + 31.32 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }

  float noise2( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    float a = hash12( i );
    float b = hash12( i + vec2( 1.0, 0.0 ) );
    float c = hash12( i + vec2( 0.0, 1.0 ) );
    float d = hash12( i + vec2( 1.0, 1.0 ) );
    return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
  }

  float fbm2( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2( 0.80, -0.60, 0.60, 0.80 );
    for ( int i = 0; i < 4; i++ ) {
      v += a * noise2( p );
      p = rot * p * 2.02 + vec2( 13.7, -9.2 );
      a *= 0.5;
    }
    return v;
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

  float readLinearDepth( vec2 uv ) {
    float z = texture2D( tDepth, uv ).r;
    if ( z >= 0.99995 ) return -1.0;
    float viewZ = ( uCameraNear * uCameraFar ) / ( ( uCameraFar - uCameraNear ) * z - uCameraFar );
    return max( -viewZ, 0.01 );
  }

  vec3 reconstructViewPos( vec2 uv, float dist ) {
    vec2 ndc = uv * 2.0 - 1.0;
    float vx = ndc.x * uAspect * dist / max( uProjScale, 0.001 );
    float vy = ndc.y * dist / max( uProjScale, 0.001 );
    return vec3( vx, vy, -dist );
  }

  /**
   * 1. 基于瑞利散射（Rayleigh）与米氏散射（Mie）的程序化全天时天空 + 双层体积云 + 5层视差远山与千本鸟居微光
   */
  vec3 evalSkyAndMountains( vec3 rayDir ) {
    vec3 rd = normalize( rayDir );
    vec3 toSun = normalize( -uSunDir );
    float elev = clamp( rd.y, -0.15, 1.0 );
    float h = mod( uDayHour, 24.0 );

    // 时段权重计算：深夜 / 蓝调时刻 / 日出黄昏 / 清晨雨后 / 正午 / 月夜
    float nightW = smoothstep( 5.4, 3.8, h ) + smoothstep( 19.6, 21.4, h );
    nightW = clamp( nightW, 0.0, 1.0 );
    float blueHourW = exp( -pow( ( h - 5.15 ) / 0.65, 2.0 ) ) + exp( -pow( ( h - 18.85 ) / 0.65, 2.0 ) );
    blueHourW = clamp( blueHourW, 0.0, 1.0 );
    float goldenW = exp( -pow( ( h - 6.25 ) / 1.05, 2.0 ) ) + exp( -pow( ( h - 17.65 ) / 1.05, 2.0 ) );
    goldenW = clamp( goldenW, 0.0, 1.0 );
    float noonW = exp( -pow( ( h - 13.0 ) / 2.8, 2.0 ) );

    // 各时段天顶（Zenith）与地平线（Horizon）瑞利散射基色（彻底告别假平青色！）
    vec3 dayZenith = mix( vec3( 0.22, 0.38, 0.48 ), vec3( 0.26, 0.48, 0.64 ), noonW );
    vec3 dayHorizon = mix( vec3( 0.56, 0.68, 0.66 ), vec3( 0.66, 0.80, 0.84 ), noonW );

    vec3 goldenZenith = vec3( 0.14, 0.24, 0.44 ); // 钴蓝天顶
    vec3 goldenMid = vec3( 0.72, 0.28, 0.38 );    // 玫红中天
    vec3 goldenHorizon = vec3( 0.96, 0.52, 0.22 ); // 暖金橘红地平线

    vec3 blueZenith = vec3( 0.07, 0.13, 0.28 );   // 深蓝天顶
    vec3 blueHorizon = vec3( 0.64, 0.34, 0.48 );  // 紫粉与橘粉晕染

    float moonLum = clamp( uMoonPhase, 0.15, 1.0 );
    vec3 nightZenith = mix( vec3( 0.02, 0.04, 0.09 ), vec3( 0.05, 0.09, 0.16 ), moonLum );
    vec3 nightHorizon = mix( vec3( 0.05, 0.08, 0.14 ), vec3( 0.12, 0.19, 0.28 ), moonLum );

    float rayleighGrad = pow( 1.0 - clamp( elev, 0.0, 1.0 ), 2.2 );
    vec3 skyCol = mix( dayZenith, dayHorizon, rayleighGrad );

    if ( goldenW > 0.001 ) {
      vec3 gCol = mix( goldenZenith, goldenMid, smoothstep( 0.12, 0.58, 1.0 - clamp( elev, 0.0, 1.0 ) ) );
      gCol = mix( gCol, goldenHorizon, pow( 1.0 - clamp( elev, 0.0, 1.0 ), 3.2 ) );
      skyCol = mix( skyCol, gCol, goldenW );
    }
    if ( blueHourW > 0.001 ) {
      vec3 bCol = mix( blueZenith, blueHorizon, pow( 1.0 - clamp( elev, 0.0, 1.0 ), 2.6 ) );
      skyCol = mix( skyCol, bCol, blueHourW * 0.88 );
    }
    if ( nightW > 0.001 ) {
      vec3 nCol = mix( nightZenith, nightHorizon, rayleighGrad );
      skyCol = mix( skyCol, nCol, nightW );
    }

    // 太阳 / 月亮米氏前向散射光晕（Mie Scattering Aureole）
    float mu = clamp( dot( rd, toSun ), 0.0, 1.0 );
    float mieHalo = pow( mu, 8.0 ) * 0.32 + pow( mu, 64.0 ) * 0.65;
    vec3 mieCol = mix( uSunColor, vec3( 1.0, 0.58, 0.24 ), goldenW * 0.65 );
    skyCol += mieCol * mieHalo * ( 0.35 + 0.65 * ( 1.0 - nightW ) );

    // 深夜与月夜：缓慢旋转的星空与璀璨银河（Milky Way & Rotating Starfield）
    if ( nightW > 0.02 && elev > 0.02 ) {
      float celAngle = uTime * 0.008 + h * 0.2618;
      mat2 celRot = mat2( cos( celAngle ), -sin( celAngle ), sin( celAngle ), cos( celAngle ) );
      vec2 starSphere = celRot * ( rd.xz / ( abs( rd.y ) + 0.35 ) );

      // 银河星云带（斜跨天穹的银蓝星云与暗尘埃带）
      float galAxis = starSphere.x * 0.75 + starSphere.y * 0.65 - 0.2;
      float galBand = exp( -galAxis * galAxis * 3.8 );
      float galCloud = fbm2( starSphere * 2.8 + vec2( 1.7, -2.3 ) );
      float dustLane = smoothstep( 0.38, 0.68, fbm2( starSphere * 5.6 ) );
      vec3 milkyWay = mix( vec3( 0.08, 0.14, 0.26 ), vec3( 0.22, 0.28, 0.42 ), galCloud ) * galBand * ( 1.0 - dustLane * 0.55 );
      skyCol += milkyWay * nightW * smoothstep( 0.04, 0.28, elev ) * 0.85;

      // 多层级闪烁星点
      vec2 starCell = floor( starSphere * 95.0 );
      vec2 starFrac = fract( starSphere * 95.0 ) - 0.5;
      float starSeed = hash12( starCell );
      if ( starSeed > 0.965 ) {
        float dStar = length( starFrac );
        float twinkle = 0.65 + 0.35 * sin( uTime * 3.2 + starSeed * 62.8 );
        float starBright = smoothstep( 0.22, 0.02, dStar ) * twinkle * ( ( starSeed - 0.965 ) / 0.035 );
        vec3 starTint = mix( vec3( 0.78, 0.86, 1.0 ), vec3( 1.0, 0.92, 0.78 ), fract( starSeed * 37.0 ) );
        skyCol += starTint * starBright * nightW * smoothstep( 0.05, 0.22, elev ) * 1.35;
      }
    }

    // 双层程序化体积云（高空卷云 Cirrus + 低空层云 Stratocumulus，带阳光/月光银金亮边）
    if ( elev > -0.02 ) {
      vec2 skyPlane = rd.xz / max( 0.14, elev + 0.16 );
      float cloudCover = mix( 0.46, 0.64, goldenW + blueHourW * 0.6 );
      cloudCover = mix( cloudCover, 0.32, noonW );
      cloudCover = mix( cloudCover, 0.38, nightW );
      if ( uWeatherMode > 0.5 ) cloudCover = 0.82;

      // 第 1 层：高空丝缕卷云（缓慢漂移）
      vec2 cirrusUv = skyPlane * 0.42 + vec2( uTime * 0.012, -uTime * 0.007 );
      float cirrus = smoothstep( 1.0 - cloudCover * 0.75, 0.92, fbm2( cirrusUv * vec2( 1.8, 0.8 ) ) );

      // 第 2 层：低空翻涌层云（形态随时间缓慢演化）
      vec2 stratoUv = skyPlane * 0.28 + vec2( uTime * 0.022, uTime * 0.014 );
      float stratoBase = fbm2( stratoUv );
      float stratoDetail = fbm2( stratoUv * 2.6 - vec2( uTime * 0.015 ) );
      float strato = smoothstep( 1.0 - cloudCover, 0.88, stratoBase * 0.72 + stratoDetail * 0.28 );

      // 云体边缘阳光 / 月光透射亮边（Silver / Golden Lining）
      float stratoSunSample = fbm2( stratoUv + toSun.xz * 0.08 );
      float rimLight = clamp( strato - stratoSunSample, 0.0, 1.0 ) * 2.4 + pow( mu, 5.0 ) * 0.55;

      vec3 cloudBaseCol = mix( vec3( 0.62, 0.68, 0.70 ), vec3( 0.34, 0.28, 0.36 ), goldenW * 0.7 + blueHourW * 0.8 );
      cloudBaseCol = mix( cloudBaseCol, vec3( 0.10, 0.15, 0.22 ), nightW );
      vec3 cloudLitCol = mix( uSunColor * 1.15, vec3( 1.0, 0.62, 0.28 ), goldenW * 0.75 );
      cloudLitCol = mix( cloudLitCol, vec3( 0.52, 0.68, 0.88 ), nightW );

      vec3 cloudCol = mix( cloudBaseCol, cloudLitCol, clamp( 0.32 + rimLight * 0.85, 0.0, 1.0 ) );
      float cloudAlpha = clamp( ( cirrus * 0.42 + strato * 0.78 ) * smoothstep( -0.02, 0.16, elev ), 0.0, 0.88 );
      skyCol = mix( skyCol, cloudCol, cloudAlpha );
    }

    // ------------------------------------------------------------------ 2) 5层大气透视程序化远山 + 视差滚动 + 远山千本鸟居暖红微光
    float az = atan( rd.x, -rd.z ); // 水平视角方位角
    vec3 horizonHaze = mix( skyCol, mix( uFogColor, uFogSunTint, 0.5 ), 0.55 );

    for ( int layer = 0; layer < 5; layer++ ) {
      float fl = float( layer );
      // 远山视差滚动：越近的山层随相机位置 (uCameraPos.x) 产生的方位视差越大
      float parallax = uCameraPos.x * ( 0.006 + fl * 0.0085 ) + uCameraPos.z * ( 0.002 + fl * 0.003 );
      float theta = az + parallax + fl * 1.37;

      // 层级基准高度：最远山（layer 0）高耸贴近天际，近山（layer 4）略低并带丰富林冠起伏
      float baseH = 0.26 - fl * 0.032;
      float freq = 1.8 + fl * 0.85;
      float ridgeNoise = fbm2( vec2( theta * freq, fl * 3.7 ) );
      float ridge = baseH
        + ( 0.055 - fl * 0.005 ) * sin( theta * 2.4 + fl * 1.9 )
        + ( 0.035 - fl * 0.003 ) * cos( theta * 4.5 - fl * 0.8 )
        + ( 0.075 - fl * 0.006 ) * ( ridgeNoise - 0.5 );

      // 近层山脊叠加针叶杉林树梢锯齿细节，最远层平滑柔和
      float treeCrownDetail = ( fl / 4.0 ) * ( noise2( vec2( theta * ( 85.0 + fl * 35.0 ), fl * 11.0 ) ) - 0.5 ) * 0.014;
      float mtnTop = ridge + treeCrownDetail;

      if ( elev < mtnTop ) {
        // 大气透视（Atmospheric Perspective）：
        // 越远的山体（fl -> 0）：亮度越高、饱和度越低、越接近天空雾色、轮廓越柔和
        float nearFactor = fl / 4.0; // 0 = 最远山, 1 = 最近山
        float edgeSoftness = mix( 0.018, 0.004, nearFactor );
        float silhouetteAlpha = clamp( ( mtnTop - elev ) / edgeSoftness, 0.0, 1.0 );

        // 计算山坡受光面与背阴面（最近几层山受主光照射具有立体明暗面）
        float dRidge = cos( theta * 2.4 + fl * 1.9 ) * 0.12 - sin( theta * 4.5 - fl * 0.8 ) * 0.14;
        vec3 slopeNrm = normalize( vec3( -dRidge, 0.65, 0.55 ) );
        float slopeSun = clamp( dot( slopeNrm, toSun ) * 0.5 + 0.5, 0.0, 1.0 );

        // 近山植被深林色（带纹理明暗）vs 远山大气散射青黛色
        float canopyTex = fbm2( vec2( theta * ( 28.0 + fl * 14.0 ), ( mtnTop - elev ) * 36.0 + fl * 5.0 ) );
        vec3 nearForestCol = mix( vec3( 0.05, 0.12, 0.08 ), vec3( 0.12, 0.24, 0.14 ), slopeSun * 0.7 + canopyTex * 0.3 );
        nearForestCol += uSunColor * pow( slopeSun, 2.0 ) * 0.06 * ( 1.0 - nightW * 0.6 );

        // 按距离指数消光混入天空与山谷雾色（layer 0 保留 82% 天际雾色，几乎与天空融为一体）
        float aerialMix = mix( 0.82, 0.18, pow( nearFactor, 1.15 ) );
        vec3 layerCol = mix( nearForestCol, horizonHaze, aerialMix );

        // 山谷间漂浮的乳白/青黛云雾带
        float valleyMist = exp( -pow( ( ( mtnTop - elev ) - 0.045 ) / 0.028, 2.0 ) ) * ( 0.35 + 0.45 * fbm2( vec2( theta * 8.0 + uTime * 0.02, fl * 4.0 ) ) );
        layerCol = mix( layerCol, horizonHaze * 1.08, valleyMist * ( 1.0 - nearFactor * 0.4 ) );

        // 稻荷山远山坳点缀的极细微暖红色光点（模拟远处绵延整山的千本鸟居与参道灯笼）
        if ( layer >= 2 ) {
          float valleyDip = smoothstep( 0.02, 0.06, mtnTop - elev ) * smoothstep( 0.11, 0.04, mtnTop - elev );
          vec2 lanternGrid = vec2( theta * ( 95.0 + fl * 25.0 ), ( mtnTop - elev ) * 240.0 );
          vec2 lCell = floor( lanternGrid );
          vec2 lFrac = fract( lanternGrid ) - 0.5;
          float lSeed = hash12( lCell + vec2( fl * 19.0, 7.0 ) );
          float trailAlign = exp( -pow( sin( theta * 3.5 + ( mtnTop - elev ) * 18.0 + fl ), 2.0 ) * 10.0 );
          if ( lSeed > 0.93 && trailAlign > 0.45 ) {
            float dDot = length( lFrac );
            float glowDot = smoothstep( 0.18, 0.02, dDot ) * valleyDip * trailAlign;
            float nightBoost = 0.25 + 0.75 * max( nightW, goldenW + blueHourW );
            vec3 senbonGlow = mix( vec3( 0.92, 0.26, 0.10 ), vec3( 1.0, 0.64, 0.24 ), fract( lSeed * 13.0 ) );
            layerCol += senbonGlow * glowDot * nightBoost * ( 0.25 + 0.35 * nearFactor );
          }
        }

        skyCol = mix( skyCol, layerCol, silhouetteAlpha );
      }
    }

    return skyCol;
  }

  void main() {
    vec4 base = texture2D( tScene, vUv );
    float centerDist = readLinearDepth( vUv );

    // 重建当前像素的世界空间视线方向（无论背景天空还是前景物体均适用）
    vec3 farViewPos = reconstructViewPos( vUv, 100.0 );
    vec3 farWorldPos = ( uInvViewMatrix * vec4( farViewPos, 1.0 ) ).xyz;
    vec3 rayDir = normalize( farWorldPos - uCameraPos );

    // 若为远景天空像素（centerDist < 0），直接输出瑞利大气天空 + 双层体积云 + 5层视差远山，并叠加林间丁达尔体积光晕
    if ( centerDist < 0.0 ) {
      vec3 skyColor = evalSkyAndMountains( rayDir );
      // 浓雾天气模式下天际融入浓厚山雾
      if ( uWeatherMode > 1.5 ) {
        skyColor = mix( skyColor, mix( uFogColor, uFogSunTint, 0.5 ), 0.72 );
      }
      gl_FragColor = vec4( skyColor, 1.0 );
      return;
    }

    vec3 viewPos = reconstructViewPos( vUv, centerDist );
    vec3 worldPos = ( uInvViewMatrix * vec4( viewPos, 1.0 ) ).xyz;
    vec3 color = base.rgb;

    // ------------------------------------------------------------------ 1) SSAO 屏幕空间环境光遮蔽
    if ( uSsaoEnabled > 0.5 && uSsaoStrength > 0.001 ) {
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
        float nds = max( 0.0, dot( viewNormal, sampleDir ) - uSsaoBias );
        float rangeCheck = smoothstep( uSsaoRadius * 2.2, uSsaoRadius * 0.25, dist3D ) *
                           smoothstep( 1.25, 0.18, abs( centerDist - sampleDist ) );
        occ += nds * rangeCheck;
        validSamples += 1.0;
      }

      float ao = validSamples > 0.0 ? clamp( ( occ / validSamples ) * 2.15 * uSsaoStrength, 0.0, 0.78 ) : 0.0;
      float groundBoost = 1.0 + 0.22 * ( 1.0 - smoothstep( 0.2, 4.5, worldPos.y ) );
      ao = clamp( ao * groundBoost, 0.0, 0.80 );

      color = mix( color, color * uSsaoColor, ao );
    }

    // ------------------------------------------------------------------ 2) 噪声驱动的 3D 体积雾 + 林间丁达尔体积光束（God Ray）+ 灯笼雾中暖光球
    if ( uFogEnabled > 0.5 && ( uFogDensity > 0.0001 || uGodRayStrength > 0.001 ) ) {
      float rayDist = length( worldPos - uCameraPos );
      float marchMaxDist = min( rayDist, 28.0 );
      vec3 toSun = normalize( -uSunDir );
      float h = mod( uDayHour, 24.0 );
      float goldenBoost = 1.0 + 0.85 * ( exp( -pow( ( h - 6.3 ) / 1.2, 2.0 ) ) + exp( -pow( ( h - 17.6 ) / 1.2, 2.0 ) ) );
      float weatherFogMult = uWeatherMode > 1.5 ? 2.65 : ( uWeatherMode > 0.5 ? 1.45 : 1.0 );

      // 沿参道走向缓慢漂移的三维风场速度
      vec3 windFlow = vec3( uTime * uFogSpeed * 0.24, -uTime * uFogSpeed * 0.06, uTime * uFogSpeed * 0.46 );

      // 6 步三维视线步进（3D Raymarching Volumetric Medium + Tyndall God Rays）
      const int MARCH_STEPS = 6;
      float jitterStep = hash12( floor( vUv * uResolution ) );
      float accumDensity = 0.0;
      vec3 accumInscatter = vec3( 0.0 );
      float stepLen = marchMaxDist / float( MARCH_STEPS );

      for ( int s = 0; s < MARCH_STEPS; s++ ) {
        float tMarch = ( float( s ) + jitterStep ) * stepLen;
        vec3 sampleP = uCameraPos + rayDir * tMarch;

        // 垂直高度分布：山谷石阶、溪流处最浓，随海拔升高变薄，林冠线（7.5m）以上几乎无雾
        float altFade = exp( -max( 0.0, sampleP.y - uFogBaseY ) * uFogHeightFalloff ) * smoothstep( 9.2, 5.2, sampleP.y );
        float valleyWeight = 1.0 + 0.55 * exp( -max( 0.0, sampleP.y - 2.2 ) * 0.85 ) * smoothstep( 2.8, -4.5, sampleP.x );

        // 水平流动与障碍物绕流（遇到鸟居立柱与大树干自然绕开形成缝隙）
        float dPostL = length( sampleP.xz - vec2( -1.08, -0.88 ) );
        float dPostR = length( sampleP.xz - vec2( 1.64, -0.88 ) );
        float obstacleParting = smoothstep( 0.22, 0.68, min( dPostL, dPostR ) );

        float n3D = fogFbm( sampleP * 0.28 + windFlow );
        float localRho = uFogDensity * weatherFogMult * altFade * valleyWeight * obstacleParting * ( 0.65 + 0.70 * n3D );
        accumDensity += localRho * stepLen * 0.085;

        // 林间丁达尔体积光束（God Ray：光线从树冠缝隙与鸟居横梁间隙斜射而下）
        // 投影到林冠平面计算树冠透光孔洞 + 鸟居「光影隧道」通道
        vec2 sunProjXZ = sampleP.xz + toSun.xz * max( 0.0, ( 6.2 - sampleP.y ) / max( 0.18, toSun.y ) );
        float canopyShaft = smoothstep( 0.46, 0.74, fbm2( sunProjXZ * 0.82 + vec2( uTime * 0.008 ) ) );
        float toriiTunnel = exp( -pow( sampleP.x - 0.2, 2.0 ) * 0.45 ) * smoothstep( 6.8, 1.5, sampleP.y ) * smoothstep( 6.5, -3.5, sampleP.z );
        float shaftMask = max( canopyShaft * 0.85, toriiTunnel * 0.95 ) * smoothstep( 0.5, 6.8, sampleP.y );

        // 米氏前向散射相函数（Henyey-Greenstein 近似）
        float cosTheta = clamp( dot( rayDir, toSun ), 0.0, 1.0 );
        float phaseHG = 0.28 + 1.45 * pow( cosTheta, 5.0 );

        // 光束中漂浮的微尘颗粒（Floating Dust Motes in Sunbeams）
        vec3 dustCoord = sampleP * 5.8 + vec3( -uTime * 0.18, uTime * 0.12, -uTime * 0.15 );
        float dustSeed = hash13( floor( dustCoord ) );
        float dustMote = step( 0.972, dustSeed ) * smoothstep( 0.42, 0.08, length( fract( dustCoord ) - 0.5 ) );

        vec3 shaftColor = mix( uSunColor, vec3( 1.0, 0.72, 0.36 ), clamp( ( goldenBoost - 1.0 ) * 0.8, 0.0, 0.85 ) );
        accumInscatter += shaftColor * shaftMask * phaseHG * ( localRho * 0.65 + 0.08 + dustMote * 0.65 ) * stepLen * 0.048 * uGodRayStrength * goldenBoost;

        // 参道石灯笼/木灯笼在三维雾气中扩散出的球形暖光晕（Spherical Lantern Fog Halo）
        if ( uLanternIntensity > 0.01 ) {
          float dLanternL = length( sampleP - uLanternPosL );
          float dLanternR = length( sampleP - uLanternPosR );
          float lanternScatter = ( 1.0 / ( 1.0 + dLanternL * dLanternL * 1.35 ) + 1.0 / ( 1.0 + dLanternR * dLanternR * 1.35 ) );
          accumInscatter += vec3( 1.0, 0.66, 0.22 ) * lanternScatter * uLanternIntensity * ( 0.022 + localRho * 0.045 ) * stepLen;
        }
      }

      // 屏幕空间径向丁达尔光束增强（当太阳处于视野前方或侧前方时强化穿越林冠与鸟居的光束）
      float fogAmount = clamp( 1.0 - exp( -accumDensity ), 0.0, uWeatherMode > 1.5 ? 0.93 : 0.82 );
      float skyBlend = clamp( smoothstep( 0.5, 6.5, worldPos.y ) * 0.42, 0.0, 0.52 );
      vec3 fogTone = mix( uFogColor, uFogSunTint, skyBlend );

      // 对近处鸟居朱红与暖黄灯笼做适度透雾保护（浓雾模式下近处鸟居与灯笼清晰浮现）
      float nearKeep = smoothstep( 18.5, 9.5, rayDist );
      float vermilionKeep = clamp( ( color.r - max( color.g, color.b ) ) * 1.8, 0.0, 0.48 ) * ( 0.55 + 0.45 * nearKeep );
      fogAmount *= ( 1.0 - vermilionKeep );

      color = mix( color, fogTone, fogAmount ) + accumInscatter;
    }

    gl_FragColor = vec4( color, base.a );
  }
`;
