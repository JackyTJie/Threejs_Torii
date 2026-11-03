// 阶段二 & 阶段三：基于二维浅水方程（SWE）高度场的顶点位移、实时焦散、深度消光（Depth Fade）与岸边/撞石泡沫着色器

export const WATER_SWE_VERT_UNIFORMS = /* glsl */ `
  uniform sampler2D uSweTex;
  uniform vec2 uSweDomainMin;
  uniform vec2 uSweDomainMax;
  uniform vec2 uSweTexel;
  uniform float uSweDisplaceScale;
  varying vec3 vSweNormal;
  varying float vSweAgitation;
  varying float vSweObstacle;
  varying vec4 vWaterClipPos;
`;

export const WATER_SWE_VERT_DISPLACE = /* glsl */ `
  vec4 sweWorldTmp = modelMatrix * vec4( transformed, 1.0 );
  vec2 sweSpan = max( vec2( 0.001 ), uSweDomainMax - uSweDomainMin );
  vec2 sweUv = clamp( ( sweWorldTmp.xz - uSweDomainMin ) / sweSpan, 0.0, 1.0 );
  vec4 sweSample = texture2D( uSweTex, sweUv );
  float sweHL = texture2D( uSweTex, sweUv - vec2( uSweTexel.x, 0.0 ) ).r;
  float sweHR = texture2D( uSweTex, sweUv + vec2( uSweTexel.x, 0.0 ) ).r;
  float sweHD = texture2D( uSweTex, sweUv - vec2( 0.0, uSweTexel.y ) ).r;
  float sweHU = texture2D( uSweTex, sweUv + vec2( 0.0, uSweTexel.y ) ).r;

  float sweMask = 1.0 - step( 0.5, sweSample.b );
  transformed.y += sweSample.r * uSweDisplaceScale * sweMask;

  vec2 worldStep = sweSpan * uSweTexel * 2.0;
  vSweNormal = normalize( vec3(
    ( sweHL - sweHR ) * uSweDisplaceScale / max( 0.01, worldStep.x ),
    1.0,
    ( sweHD - sweHU ) * uSweDisplaceScale / max( 0.01, worldStep.y )
  ) );
  vSweAgitation = sweSample.a;
  vSweObstacle = sweSample.b;
`;

export const WATER_SWE_VERT_CLIP = /* glsl */ `
  vWaterClipPos = gl_Position;
`;

export const WATER_FLOW_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform vec2 uFlowDir;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform float uFlowScale;
  uniform float uFlowStrength;
  uniform float uOverlayMode;
  uniform sampler2D uSweTex;
  uniform vec2 uSweDomainMin;
  uniform vec2 uSweDomainMax;
  uniform vec2 uSweTexel;
  uniform sampler2D tRefractionColor;
  uniform sampler2D tRefractionDepth;
  uniform float uHasRefraction;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uExtinctionDensity;
  uniform float uShoreFoamThreshold;
  varying vec3 vSweNormal;
  varying float vSweAgitation;
  varying float vSweObstacle;
  varying vec4 vWaterClipPos;
`;

export const WATER_FLOW_FRAG = /* glsl */ `
  float waterHash21( vec2 p ) {
    p = fract( p * vec2( 123.34, 456.21 ) );
    p += dot( p, p + 45.32 );
    return fract( p.x * p.y );
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

  float waterFbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2( 0.80, -0.60, 0.60, 0.80 );
    for ( int i = 0; i < 4; i++ ) {
      v += a * waterNoise( p );
      p = rot * p * 2.03 + vec2( 13.7, -9.2 );
      a *= 0.5;
    }
    return v;
  }

  float linearizeDepth( float d, float zNear, float zFar ) {
    float zNdc = d * 2.0 - 1.0;
    return ( 2.0 * zNear * zFar ) / max( 0.0001, zFar + zNear - zNdc * ( zFar - zNear ) );
  }

  float streamApproxCenterX( float z ) {
    return -3.25 + 0.58 * sin( z * 0.36 + 0.5 ) + 0.28 * cos( z * 0.21 - 0.8 );
  }

  vec2 streamWaveGradient( vec2 xz, float time ) {
    float cx = streamApproxCenterX( xz.y );
    float lat = xz.x - cx;
    float s = xz.y * 1.04;
    vec2 q1 = vec2( lat * 2.4 + sin( s * 0.7 ) * 0.4, s * 2.1 - time * 2.8 );
    vec2 q2 = vec2( lat * 4.1 - cos( s * 1.1 ) * 0.3, s * 3.8 - time * 4.2 );
    float eps = 0.06;
    float h0 = waterFbm( q1 ) * 0.65 + waterFbm( q2 ) * 0.35;
    float hx = waterFbm( q1 + vec2( eps, 0.0 ) ) * 0.65 + waterFbm( q2 + vec2( eps, 0.0 ) ) * 0.35;
    float hz = waterFbm( q1 + vec2( 0.0, eps ) ) * 0.65 + waterFbm( q2 + vec2( 0.0, eps ) ) * 0.35;
    return ( vec2( hx - h0, hz - h0 ) / eps ) * 0.14;
  }

  vec4 waterFlow( vec3 color, float baseAlpha, vec3 worldPos, vec3 normal, vec3 viewDir, vec2 localUv ) {
    vec2 p = worldPos.xz;
    vec2 flowDir = normalize( uFlowDir );
    vec2 latDir = vec2( -flowDir.y, flowDir.x );
    float along = dot( p, flowDir );
    float lateral = dot( p, latDir );

    vec2 microGrad = streamWaveGradient( p, uTime * ( 0.8 + uFlowSpeed * 2.4 ) );
    vec3 sweN = length( vSweNormal ) > 0.1 ? vSweNormal : vec3( 0.0, 1.0, 0.0 );
    vec3 nrm = normalize( normal + ( sweN - vec3( 0.0, 1.0, 0.0 ) ) * 1.35 + vec3( -microGrad.x, 0.0, -microGrad.y ) );
    vec3 V = normalize( viewDir );
    float ndv = clamp( abs( dot( nrm, V ) ), 0.0, 1.0 );

    float fresnel = 0.02 + 0.40 * pow( 1.0 - ndv, 4.2 );

    vec2 sweSpan = max( vec2( 0.001 ), uSweDomainMax - uSweDomainMin );
    vec2 sweUv = clamp( ( p - uSweDomainMin ) / sweSpan, 0.0, 1.0 );
    vec4 sweFrag = texture2D( uSweTex, sweUv );
    float agitation = max( vSweAgitation, sweFrag.a );

    vec2 foamUv = vec2( lateral * 5.0 + nrm.x * 0.8, along * 2.0 - uTime * uFlowSpeed * 9.2 );
    float fbmA = waterFbm( foamUv );
    float fbmB = waterFbm( foamUv * vec2( 2.1, 1.4 ) + vec2( 6.3, -uTime * uFlowSpeed * 4.8 ) );
    float porousFoam = smoothstep( 0.50, 0.78, fbmA * 0.6 + fbmB * 0.4 );

    float cx = streamApproxCenterX( p.y );
    float bankDist = abs( p.x - cx );
    float geomDepth = clamp( 0.22 * ( 1.0 - smoothstep( 0.45, 1.35, bankDist ) ), 0.008, 0.32 );
    float waterDepth = geomDepth;

    vec2 screenUv = ( vWaterClipPos.xy / max( 0.0001, vWaterClipPos.w ) ) * 0.5 + 0.5;
    vec2 refractUv = clamp( screenUv - nrm.xz * 0.012, vec2( 0.002 ), vec2( 0.998 ) );

    if ( uHasRefraction > 0.5 ) {
      float rawSceneD = texture2D( tRefractionDepth, refractUv ).r;
      if ( rawSceneD < 0.9999 ) {
        float sceneD = linearizeDepth( rawSceneD, uCameraNear, uCameraFar );
        float surfD = linearizeDepth( gl_FragCoord.z, uCameraNear, uCameraFar );
        float diffD = ( sceneD - surfD ) * ndv;
        if ( diffD > 0.0 ) {
          waterDepth = clamp( diffD, 0.005, 0.65 );
        }
      }
    }

    vec3 canopyReflect = vec3( 0.19, 0.33, 0.26 );
    vec3 foamTint = vec3( 0.52, 0.66, 0.60 );
    vec3 shallowTone = uShallowColor * 0.92;
    vec3 deepTone = uDeepColor * 0.82;

    if ( uOverlayMode > 2.5 ) {
      return vec4( mix( shallowTone * 1.12, foamTint * 1.1, 0.62 ), baseAlpha * 0.68 );
    }
    if ( uOverlayMode > 1.5 ) {
      vec2 centered = localUv - vec2( 0.5 );
      float dist = length( centered ) * 2.0;
      float ang = atan( centered.y, centered.x );
      float radialFade = smoothstep( 1.0, 0.24, dist ) * smoothstep( 0.06, 0.26, dist );
      vec2 swirlUv = vec2( dist * 3.5, ang * 0.95 - uTime * 1.6 + dist * 4.2 );
      float swirlBand = smoothstep( 0.48, 0.76, waterFbm( swirlUv * 2.2 ) );
      return vec4( mix( shallowTone, foamTint, 0.5 + 0.5 * swirlBand ), baseAlpha * radialFade * swirlBand * 0.62 );
    }
    if ( uOverlayMode > 0.5 ) {
      float edgeX = smoothstep( 0.0, 0.26, localUv.x ) * smoothstep( 1.0, 0.74, localUv.x );
      float edgeY = smoothstep( 0.0, 0.20, localUv.y ) * smoothstep( 1.0, 0.76, localUv.y );
      vec2 fallUv = vec2( localUv.x * 6.0, localUv.y * 2.5 - uTime * 3.6 );
      float fallThreads = smoothstep( 0.44, 0.78, waterFbm( fallUv ) );
      return vec4( mix( shallowTone * 0.9, foamTint, fallThreads ), baseAlpha * edgeX * edgeY * ( 0.14 + 0.58 * fallThreads ) );
    }

    float extinction = 1.0 - exp( -uExtinctionDensity * waterDepth );
    vec3 waterBody = mix( shallowTone, deepTone, extinction );

    if ( uHasRefraction > 0.5 ) {
      vec3 refractedBed = texture2D( tRefractionColor, refractUv ).rgb;
      vec3 transTint = mix( vec3( 0.82, 0.96, 0.90 ), shallowTone * 1.35, extinction );
      waterBody = mix( refractedBed * transTint, deepTone, extinction * 0.68 );
    }

    float slopeTilt = clamp( ( 1.0 - abs( nrm.y ) ) * 4.5, 0.0, 1.0 );
    float shoreMask = 1.0 - smoothstep( 0.008, uShoreFoamThreshold, waterDepth );
    float obstacleFoam = smoothstep( 0.36, 0.82, agitation ) * porousFoam;
    float shoreFoam = shoreMask * smoothstep( 0.46, 0.76, fbmB ) * 0.55;
    float cascadeFoam = slopeTilt * porousFoam * 0.82;
    float totalFoam = clamp( max( cascadeFoam, obstacleFoam * 0.68 + shoreFoam ), 0.0, 0.80 );

    vec3 surfaceCol = mix( waterBody, canopyReflect, fresnel );
    surfaceCol = mix( surfaceCol, foamTint, totalFoam );

    float edgeFade = 1.0 - smoothstep( 1.15, 1.48, bankDist );
    float clearAlpha = uHasRefraction > 0.5
      ? clamp( ( 0.78 + fresnel * 0.18 + totalFoam * 0.20 ) * edgeFade, 0.0, 0.96 )
      : clamp( ( 0.15 + extinction * 0.22 + fresnel * 0.45 + totalFoam * 0.52 ) * edgeFade, 0.08, 0.72 );

    return vec4( surfaceCol, clearAlpha );
  }
`;

export const RIVERBED_CAUSTICS_UNIFORMS = /* glsl */ `
  uniform float uCausticTime;
  uniform vec3 uCausticLightDir;
  uniform vec3 uWaterAbsorbShallow;
  uniform vec3 uWaterAbsorbDeep;
  uniform sampler2D uSweTex;
  uniform vec2 uSweDomainMin;
  uniform vec2 uSweDomainMax;
  uniform vec2 uSweTexel;
`;

export const RIVERBED_CAUSTICS_FRAG = /* glsl */ `
  float bedHash21( vec2 p ) {
    p = fract( p * vec2( 127.1, 311.7 ) );
    p += dot( p, p + 34.23 );
    return fract( p.x * p.y );
  }

  float bedNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( bedHash21( i ), bedHash21( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( bedHash21( i + vec2( 0.0, 1.0 ) ), bedHash21( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  float combinedWaveHeightAt( vec2 xz, float t ) {
    vec2 sweSpan = max( vec2( 0.001 ), uSweDomainMax - uSweDomainMin );
    vec2 sweUv = clamp( ( xz - uSweDomainMin ) / sweSpan, 0.0, 1.0 );
    float sweH = texture2D( uSweTex, sweUv ).r * 1.4;
    vec2 p1 = vec2( xz.x * 2.1, xz.y * 1.6 - t * 1.85 );
    vec2 p2 = vec2( xz.x * 3.4 - 0.6 * xz.y, xz.y * 2.9 - t * 2.65 );
    float microH = ( bedNoise( p1 ) - 0.5 ) * 0.038 + ( bedNoise( p2 ) - 0.5 ) * 0.022;
    return sweH + microH;
  }

  vec3 applyRiverbedCaustics( vec3 bedColor, vec3 worldPos, vec3 normal ) {
    float streamMask = smoothstep( -1.10, -1.85, worldPos.x ) * smoothstep( -6.2, -5.0, worldPos.x );
    if ( streamMask <= 0.001 ) return bedColor;

    float u = clamp( ( 11.6 - worldPos.z ) / 20.8, 0.0, 1.0 );
    float approxWy = 0.25 + 2.95 * pow( u, 1.08 );
    // 严格仅对水面以下的河床与浸水石根生效（出水石面 waterDepth <= 0 绝不染色）
    float waterDepth = clamp( approxWy - worldPos.y, 0.0, 0.65 );
    float submergeMask = smoothstep( 0.005, 0.045, waterDepth ) * streamMask;
    if ( submergeMask <= 0.001 ) return bedColor;

    float eps = 0.055;
    vec2 xz = worldPos.xz;
    float hC = combinedWaveHeightAt( xz, uCausticTime );
    float hR = combinedWaveHeightAt( xz + vec2( eps, 0.0 ), uCausticTime );
    float hU = combinedWaveHeightAt( xz + vec2( 0.0, eps ), uCausticTime );
    float hL = combinedWaveHeightAt( xz - vec2( eps, 0.0 ), uCausticTime );
    float hD = combinedWaveHeightAt( xz - vec2( 0.0, eps ), uCausticTime );

    vec3 surfNormal = normalize( vec3( ( hL - hR ) / ( 2.0 * eps ), 1.0, ( hD - hU ) / ( 2.0 * eps ) ) );
    vec3 lightDir = normalize( uCausticLightDir );

    vec3 flatRay = refract( -lightDir, vec3( 0.0, 1.0, 0.0 ), 0.75 );
    vec3 dispRay = refract( -lightDir, surfNormal, 0.75 );
    vec3 oldPos = worldPos + flatRay * ( waterDepth / max( 0.2, abs( flatRay.y ) ) );
    vec3 newPos = worldPos + dispRay * ( waterDepth / max( 0.2, abs( dispRay.y ) ) );

    float oldArea = length( dFdx( oldPos ) ) * length( dFdy( oldPos ) );
    float newArea = max( 1e-7, length( dFdx( newPos ) ) * length( dFdy( newPos ) ) );
    float areaRatio = clamp( oldArea / newArea, 0.4, 2.4 );

    float laplacian = ( hR + hL + hU + hD - 4.0 * hC ) / ( eps * eps );
    float focusDepth = clamp( waterDepth * 1.8, 0.08, 0.55 );
    float curvatureFocus = clamp( 1.0 - laplacian * focusDepth * 0.42, 0.25, 2.6 );

    float causticNet = pow( max( 0.0, ( areaRatio * 0.45 + curvatureFocus * 0.55 ) - 0.78 ), 1.75 );
    float net2 = bedNoise( newPos.xz * 4.8 + vec2( 0.0, -uCausticTime * 1.6 ) );
    causticNet = clamp( causticNet * 0.68 + smoothstep( 0.65, 0.90, net2 ) * 0.35, 0.0, 1.15 );

    // 保留水底泥沙与灰石的自然本色，仅做轻微深水消光与柔和天光焦散（不把石头染成翠绿色）
    float absorb = 1.0 - exp( -waterDepth * 2.0 );
    vec3 tintedBed = mix( bedColor, bedColor * vec3( 0.78, 0.84, 0.82 ), absorb * 0.38 );

    float upFacing = clamp( dot( normalize( normal ), vec3( 0.0, 1.0, 0.0 ) ) * 0.7 + 0.3, 0.0, 1.0 );
    vec3 causticLight = vec3( 0.48, 0.58, 0.54 ) * causticNet * upFacing * ( 1.0 - absorb * 0.35 );

    return mix( bedColor, tintedBed + causticLight * 0.38, submergeMask );
  }
`;
