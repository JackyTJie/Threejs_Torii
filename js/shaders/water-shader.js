// 山涧叠瀑清澈水体片元着色器：
// 融合 danielsofran/threejs-water-shader 与 jeantimex/threejs-water 的核心水体光学特征，
// 针对雨后深林幽暗色调专门压暗适配，消除死白镜面反光，呈现四重水体细节：
// 1) 清澈透底（Clear Depth Absorption）：低不透明度 + 深潭/浅滩比尔定律吸收，清晰透出溪底湿泥与卵石；
// 2) 粼粼波光（Voronoi Cellular Caustics + Micro-Glints）：双层错速蜂窝焦散网与四向波纹法线微闪高光；
// 3) 漩涡回流（Swirling Vortex / Eddy Field）：石畔与瀑下深潭的旋转涡流纹理与环状水纹；
// 4) 叠瀑激荡（Cascade White-Water Agitation）：根据水面坡度（小瀑布跌水处法线倾斜）与湍流噪声生成丝状瀑流与碎沫。

export const WATER_FLOW_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform vec2 uFlowDir;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform float uFlowScale;
  uniform float uFlowStrength;
  uniform float uOverlayMode;
`;

export const WATER_FLOW_FRAG = /* glsl */ `
  float waterHash21( vec2 p ) {
    p = fract( p * vec2( 123.34, 456.21 ) );
    p += dot( p, p + 45.32 );
    return fract( p.x * p.y );
  }

  vec2 waterHash22( vec2 p ) {
    float n = waterHash21( p );
    return vec2( n, waterHash21( p + n + 17.3 ) );
  }

  float waterNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    float a = waterHash21( i );
    float b = waterHash21( i + vec2( 1.0, 0.0 ) );
    float c = waterHash21( i + vec2( 0.0, 1.0 ) );
    float d = waterHash21( i + vec2( 1.0, 1.0 ) );
    return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
  }

  // Voronoi 蜂窝焦散网：模拟清澈浅溪中的粼粼波光与水底焦散亮网
  float waterCausticLayer( vec2 uv, float time ) {
    vec2 g = floor( uv );
    vec2 f = fract( uv );
    float minDist1 = 1.0;
    float minDist2 = 1.0;
    for ( int y = -1; y <= 1; y++ ) {
      for ( int x = -1; x <= 1; x++ ) {
        vec2 lattice = vec2( float( x ), float( y ) );
        vec2 rnd = waterHash22( g + lattice );
        vec2 point = lattice + 0.5 + 0.42 * sin( time * 1.35 + 6.2831853 * rnd );
        float d = length( point - f );
        if ( d < minDist1 ) {
          minDist2 = minDist1;
          minDist1 = d;
        } else if ( d < minDist2 ) {
          minDist2 = d;
        }
      }
    }
    float edge = clamp( minDist2 - minDist1, 0.0, 1.0 );
    return pow( 1.0 - smoothstep( 0.0, 0.28, edge ), 2.2 );
  }

  // 局部漩涡场：在石块背水侧与小瀑布落水潭生成旋转回流涡纹
  vec2 waterVortexWarp( vec2 p, float time ) {
    vec2 cell = floor( p * 0.55 );
    vec2 local = fract( p * 0.55 ) - 0.5;
    float r = length( local );
    float seed = waterHash21( cell );
    float spinDir = seed > 0.5 ? 1.0 : -1.0;
    float swirl = exp( -r * r * 9.5 ) * ( 2.6 * spinDir );
    float angle = swirl + time * 1.15 * spinDir;
    float s = sin( angle );
    float c = cos( angle );
    vec2 rotated = vec2( local.x * c - local.y * s, local.x * s + local.y * c );
    return ( cell + rotated + 0.5 ) / 0.55;
  }

  vec4 waterFlow( vec3 color, float baseAlpha, vec3 worldPos, vec3 normal, vec3 viewDir, vec2 localUv ) {
    vec2 p = worldPos.xz;
    vec2 flowDir = normalize( uFlowDir );
    vec2 latDir = vec2( -flowDir.y, flowDir.x );
    float along = dot( p, flowDir );
    float lateral = dot( p, latDir );

    // 1. 漩涡扭曲坐标 + 顺流推进
    vec2 warped = waterVortexWarp( p, uTime * uFlowSpeed * 4.0 );
    float wAlong = dot( warped, flowDir ) * uFlowScale;
    float wLat = dot( warped, latDir );

    // 2. 双层错速 Voronoi 焦散（粼粼波光）
    vec2 uv1 = vec2( wAlong * 3.4 - uTime * uFlowSpeed * 5.2, wLat * 3.2 + sin( along * 1.3 ) * 0.35 );
    vec2 uv2 = vec2( wAlong * 4.6 - uTime * uFlowSpeed * 3.7 + 1.7, wLat * 4.4 - cos( along * 1.7 ) * 0.3 );
    float c1 = waterCausticLayer( uv1, uTime * 0.9 );
    float c2 = waterCausticLayer( uv2, -uTime * 1.1 );
    float caustics = clamp( c1 * 0.65 + c2 * 0.65, 0.0, 1.0 );

    // 3. 漩涡环纹（Eddy Rings）
    vec2 eddyCell = fract( p * 0.62 + vec2( 0.15 * sin( uTime * 0.4 ), -uTime * uFlowSpeed * 1.2 ) ) - 0.5;
    float eddyR = length( eddyCell );
    float eddyAng = atan( eddyCell.y, eddyCell.x );
    float eddySpiral = sin( eddyR * 28.0 - eddyAng * 2.0 - uTime * 2.6 );
    float eddyMask = smoothstep( 0.42, 0.12, eddyR ) * smoothstep( 0.03, 0.12, eddyR ) * max( 0.0, eddySpiral );

    // 4. 小瀑布跌水与湍流激荡（Cascade & Agitation）
    vec3 nrm = normalize( normal );
    float slopeTilt = clamp( ( 1.0 - abs( nrm.y ) ) * 4.8, 0.0, 1.0 );
    float streakNoise = waterNoise( vec2( wLat * 14.0, along * 3.2 - uTime * uFlowSpeed * 16.0 ) );
    float fineFoam = waterNoise( vec2( wLat * 26.0, along * 7.5 - uTime * uFlowSpeed * 22.0 ) );
    float cascadeStreaks = slopeTilt * smoothstep( 0.32, 0.78, streakNoise * 0.65 + fineFoam * 0.35 );

    // 跌水潭底部的冲击碎沫带
    float plungeWave = sin( along * 1.57 - 0.4 );
    float plungePool = pow( max( 0.0, plungeWave ), 8.0 ) * smoothstep( 0.42, 0.82, streakNoise );

    // 5. 细碎波光闪烁（Sparkle Glints，克制不刺眼，绝不像镜子）
    float ripple1 = sin( along * 18.0 + lateral * 9.0 - uTime * 4.2 );
    float ripple2 = cos( along * 23.0 - lateral * 14.0 - uTime * 5.1 );
    float glint = pow( max( 0.0, ripple1 * ripple2 ), 6.0 ) * ( 0.4 + 0.6 * caustics );

    // 6. 幽暗深林水色合成（压暗镜面反射，突出清澈水底层次、翠绿焦散与柔和泡沫）
    float ndv = abs( dot( nrm, normalize( viewDir ) ) );
    float fresnel = pow( 1.0 - clamp( ndv, 0.0, 1.0 ), 2.8 ) * 0.28;

    vec3 deepTone = uDeepColor * 0.74;
    vec3 shallowTone = uShallowColor * 0.88;
    vec3 body = mix( deepTone, shallowTone, 0.22 + 0.56 * caustics + 0.22 * eddyMask );

    // 柔和青白泡沫色（适配雨后阴天幽暗森林，不过曝）
    vec3 foamColor = vec3( 0.42, 0.56, 0.50 );
    vec3 glintColor = vec3( 0.54, 0.72, 0.64 );

    // 针对跌水水帘（uOverlayMode == 1）与漩涡盘（uOverlayMode == 2）做边缘羽化与丝状镂空，消除生硬多边形块感
    if ( uOverlayMode > 1.5 ) {
      vec2 centered = localUv - vec2( 0.5 );
      float dist = length( centered ) * 2.0;
      float ang = atan( centered.y, centered.x );
      float radialFade = smoothstep( 1.0, 0.28, dist ) * smoothstep( 0.04, 0.22, dist );
      float spiral = 0.5 + 0.5 * sin( dist * 18.0 - ang * 3.0 - uTime * 2.4 + streakNoise * 3.2 );
      float ringMask = radialFade * smoothstep( 0.36, 0.84, spiral * 0.65 + fineFoam * 0.35 );
      vec3 eddyCol = mix( shallowTone * 0.85, foamColor, 0.55 + 0.45 * spiral );
      return vec4( eddyCol, baseAlpha * ringMask );
    } else if ( uOverlayMode > 0.5 ) {
      float edgeX = smoothstep( 0.0, 0.22, localUv.x ) * smoothstep( 1.0, 0.78, localUv.x );
      float edgeY = smoothstep( 0.0, 0.18, localUv.y ) * smoothstep( 1.0, 0.76, localUv.y );
      float threads = smoothstep( 0.34, 0.82, streakNoise * 0.62 + fineFoam * 0.38 );
      float curtainAlpha = baseAlpha * edgeX * edgeY * ( 0.25 + 0.75 * threads );
      vec3 curtainCol = mix( shallowTone * 0.82, foamColor * 1.06, threads );
      return vec4( curtainCol, curtainAlpha );
    }

    float foamAmount = clamp( cascadeStreaks * 0.85 + plungePool * 0.42 + eddyMask * 0.24, 0.0, 0.86 );
    vec3 waterBase = mix( color * 0.48 + body * 0.52, foamColor, foamAmount * uFlowStrength );
    vec3 causticGlow = shallowTone * caustics * 0.34 + glintColor * glint * 0.44 + shallowTone * fresnel;
    float outAlpha = clamp( baseAlpha * ( 0.64 + 0.42 * caustics + 0.65 * foamAmount ), 0.18, 0.82 );

    return vec4( waterBase + causticGlow * uFlowStrength, outAlpha );
  }
`;
