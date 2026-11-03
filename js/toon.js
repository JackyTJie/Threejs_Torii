// 三渲二材质工具：渐变带、叶片透光、青苔附着、老化叠加、SWE 浅水方程水体与水底实时焦散、资产收尾
import * as THREE from 'three';
import { TOON_BANDS, OUTLINE, PALETTE, LIGHT, CAMERA } from './config.js';
import { sunDirection } from './lighting.js';
import { gradientMap } from './textures.js';
import {
  LEAF_TRANSLUCENCY_FRAG, LEAF_TRANSLUCENCY_UNIFORMS,
  MOSS_ATTACHMENT_FRAG, MOSS_ATTACHMENT_UNIFORMS,
  WEATHERING_FRAG, WEATHERING_UNIFORMS
} from './shaders/toon-shading.js';
import { LEAF_FLUTTER_VERT, LEAF_FLUTTER_APPLY, LEAF_FLUTTER_UNIFORMS } from './shaders/leaf-vertex.js';
import {
  WATER_SWE_VERT_UNIFORMS, WATER_SWE_VERT_DISPLACE, WATER_SWE_VERT_CLIP,
  WATER_FLOW_FRAG, WATER_FLOW_UNIFORMS,
  RIVERBED_CAUSTICS_FRAG, RIVERBED_CAUSTICS_UNIFORMS
} from './shaders/water-shader.js';
import {
  SWE_DOMAIN, SWE_TEX_HEIGHT, SWE_TEX_WIDTH, getSweSimulator
} from './water/swe-simulator.js';
import { STREAM_PATH } from './layout.js';
import { outlineGroup, markNoOutline, shouldSkipOutline } from './outline.js';

export function sunDirectionVector() {
  return sunDirection();
}

export const BANDS = TOON_BANDS;

export function setBanding(material, band = 'mid') {
  const steps = BANDS[band] || BANDS.mid;
  material.gradientMap = gradientMap(steps);
  material.userData.toonBand = band;
  return material;
}

const FRAGMENT_SURFACE_ANCHOR = '#include <opaque_fragment>';

function injectGlobals(shader, declarations) {
  shader.fragmentShader = `${declarations}\n${shader.fragmentShader}`;
}

function injectSurface(shader, body) {
  shader.fragmentShader = shader.fragmentShader.replace(FRAGMENT_SURFACE_ANCHOR, `${body}\n${FRAGMENT_SURFACE_ANCHOR}`);
}

function injectWorldPosition(shader) {
  if (shader.__stationWorldPos) return;
  shader.__stationWorldPos = true;
  shader.vertexShader = `varying vec3 vStationWorldPos;\n${shader.vertexShader}`;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <project_vertex>',
    `vec4 vwp = vec4( transformed, 1.0 );
     #ifdef USE_INSTANCING
       vwp = instanceMatrix * vwp;
     #endif
     vwp = modelMatrix * vwp;
     vStationWorldPos = vwp.xyz;
     #include <project_vertex>`
  );
  shader.fragmentShader = `varying vec3 vStationWorldPos;\n${shader.fragmentShader}`;
}

function bindUniforms(material, uniforms) {
  material.userData.uniforms = Object.assign({}, material.userData.uniforms, uniforms);
  return uniforms;
}

export function tuneMaterial(material, key, value) {
  const uniforms = material.userData.uniforms;
  if (!uniforms || !uniforms[key]) return false;
  const target = uniforms[key].value;
  if (target && target.isColor) target.set(value);
  else uniforms[key].value = value;
  return true;
}

/** 收集所有挂有光照方向 uniform 的材质，供昼夜切换系统实时同步主光源方向与色温 */
export const SUN_LINKED_MATERIALS = [];

function registerSunMaterial(material) {
  if (!SUN_LINKED_MATERIALS.includes(material)) SUN_LINKED_MATERIALS.push(material);
}

export function applyLeafTranslucency(material, { color = 0x9fd6a0, strength = 0.4, power = 2.6 } = {}) {
  const sun = sunDirectionVector();
  const uniforms = bindUniforms(material, {
    uTranslucencyColor: { value: new THREE.Color(color) },
    uTranslucencyStrength: { value: strength },
    uTranslucencyPower: { value: power },
    uTranslucencySunTint: { value: new THREE.Color(LIGHT.sunColor) },
    uSunDir: { value: sun.clone() }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectWorldPosition(shader);
    injectGlobals(shader, `${LEAF_TRANSLUCENCY_UNIFORMS}\n${LEAF_TRANSLUCENCY_FRAG}`);
    injectSurface(shader, `{
        vec3 viewDirV = normalize( vViewPosition );
        vec3 sunDirV = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
        vec3 translucency = leafTranslucency( normal, viewDirV, sunDirV, uTranslucencySunTint, 1.0 );
        outgoingLight += translucency;
      }`);
    material.userData.shader = shader;
  });
  material.name = material.name || 'leafToon';
  registerSunMaterial(material);
  return material;
}

export function applyMossAttachment(material, { color = PALETTE.moss, height = 0, band = 0.55, amount = 0.5 } = {}) {
  const uniforms = bindUniforms(material, {
    uMossColor: { value: new THREE.Color(color) },
    uMossHeight: { value: height },
    uMossBand: { value: band },
    uMossAmount: { value: amount },
    uMossSunDir: { value: sunDirectionVector() }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectWorldPosition(shader);
    injectGlobals(shader, `${MOSS_ATTACHMENT_UNIFORMS}\n${MOSS_ATTACHMENT_FRAG}`);
    injectSurface(shader, `{
        outgoingLight = applyMoss( outgoingLight, vStationWorldPos, normal, normalize( uMossSunDir ) );
      }`);
    material.userData.shader = shader;
  });
  registerSunMaterial(material);
  return material;
}

export function applyWeathering(material, {
  wear = PALETTE.toriiLacquerLoss,
  dust = PALETTE.soilWet,
  start = 0,
  band = 0.6,
  wearAmount = 0.5,
  dustAmount = 0.22,
  roughnessVar = 0.16,
  toriiMode = 0.0
} = {}) {
  const uniforms = bindUniforms(material, {
    uWearColor: { value: new THREE.Color(wear) },
    uDustColor: { value: new THREE.Color(dust) },
    uWearStart: { value: start },
    uWearBand: { value: band },
    uWearAmount: { value: wearAmount },
    uDustAmount: { value: dustAmount },
    uRoughnessVar: { value: roughnessVar },
    uToriiMode: { value: toriiMode },
    uSpecSunDir: { value: sunDirectionVector() }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectWorldPosition(shader);
    injectGlobals(shader, `${WEATHERING_UNIFORMS}\n${WEATHERING_FRAG}`);
    injectSurface(shader, `{
        outgoingLight = applyWeathering( outgoingLight, vStationWorldPos, normal, normalize( vViewPosition ) );
      }`);
    material.userData.shader = shader;
  });
  registerSunMaterial(material);
  return material;
}

export function applyShadowLift(material, { lift = 0.14, knee = 0.42 } = {}) {
  const uniforms = bindUniforms(material, {
    uShadowLift: { value: lift },
    uShadowKnee: { value: knee }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectGlobals(shader, `
      uniform float uShadowLift;
      uniform float uShadowKnee;
    `);
    injectSurface(shader, `{
        float l = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
        float k = 1.0 - smoothstep( uShadowKnee * 0.35, uShadowKnee, l );
        float skyFacing = clamp( normal.y * 0.5 + 0.5, 0.15, 1.0 );
        vec3 baseFloor = diffuseColor.rgb * ( 0.065 + 0.075 * skyFacing ) * ( uShadowLift * 2.4 );
        outgoingLight += ( outgoingLight * uShadowLift + baseFloor + vec3( 0.014, 0.016, 0.014 ) ) * k;
      }`);
    material.userData.shader = shader;
  });
  return material;
}

function composeBeforeCompile(material, inject) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    inject(shader);
  };
}

export const LEAF_FLUTTER_MATERIALS = [];

export function applyLeafFlutter(material, { amplitude = 0.012, period = 3.4 } = {}) {
  const uniforms = bindUniforms(material, {
    uTime: { value: 0 },
    uAmplitude: { value: amplitude },
    uPeriod: { value: period },
    uGust: { value: 1 }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `${LEAF_FLUTTER_UNIFORMS}\n${LEAF_FLUTTER_VERT}\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      ${LEAF_FLUTTER_APPLY}`
    );
    material.userData.shader = shader;
  });
  material.userData.leafFlutter = true;
  if (!LEAF_FLUTTER_MATERIALS.includes(material)) LEAF_FLUTTER_MATERIALS.push(material);
  return material;
}

export function streamFlowDirection() {
  const a = STREAM_PATH[0];
  const b = STREAM_PATH[STREAM_PATH.length - 1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return new THREE.Vector2(dx / len, dz / len);
}

export const WATER_FLOW_MATERIALS = [];
export const RIVERBED_CAUSTIC_MATERIALS = [];

export function applySubmergedCaustics(material) {
  const sun = sunDirectionVector();
  const sim = getSweSimulator();
  const uniforms = bindUniforms(material, {
    uCausticTime: { value: 0 },
    uCausticLightDir: { value: sun.clone() },
    uWaterAbsorbShallow: { value: new THREE.Color(PALETTE.waterShallow) },
    uWaterAbsorbDeep: { value: new THREE.Color(PALETTE.waterDeep) },
    uSweTex: { value: sim.texture },
    uSweDomainMin: { value: new THREE.Vector2(SWE_DOMAIN.xMin, SWE_DOMAIN.zMin) },
    uSweDomainMax: { value: new THREE.Vector2(SWE_DOMAIN.xMax, SWE_DOMAIN.zMax) },
    uSweTexel: { value: new THREE.Vector2(1 / SWE_TEX_WIDTH, 1 / SWE_TEX_HEIGHT) }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectWorldPosition(shader);
    injectGlobals(shader, `${RIVERBED_CAUSTICS_UNIFORMS}\n${RIVERBED_CAUSTICS_FRAG}`);
    injectSurface(shader, `{
        outgoingLight = applyRiverbedCaustics( outgoingLight, vStationWorldPos, normal );
      }`);
    material.userData.shader = shader;
  });
  material.userData.submergedCaustics = true;
  if (!RIVERBED_CAUSTIC_MATERIALS.includes(material)) RIVERBED_CAUSTIC_MATERIALS.push(material);
  registerSunMaterial(material);
  return material;
}

export function applyWaterFlow(material, { speed = 0.055, scale = 0.42, strength = 1, overlayMode = 0 } = {}) {
  const sim = getSweSimulator();
  const sun = sunDirectionVector();
  const uniforms = bindUniforms(material, {
    uTime: { value: 0 },
    uFlowSpeed: { value: speed },
    uFlowDir: { value: streamFlowDirection() },
    uShallowColor: { value: new THREE.Color(PALETTE.waterShallow) },
    uDeepColor: { value: new THREE.Color(PALETTE.waterDeep) },
    uFlowScale: { value: scale },
    uFlowStrength: { value: strength },
    uOverlayMode: { value: overlayMode },
    uWaterSunDir: { value: sun.clone() },
    uSweTex: { value: sim.texture },
    uSweDomainMin: { value: new THREE.Vector2(SWE_DOMAIN.xMin, SWE_DOMAIN.zMin) },
    uSweDomainMax: { value: new THREE.Vector2(SWE_DOMAIN.xMax, SWE_DOMAIN.zMax) },
    uSweTexel: { value: new THREE.Vector2(1 / SWE_TEX_WIDTH, 1 / SWE_TEX_HEIGHT) },
    uSweDisplaceScale: { value: overlayMode === 0 ? 1.35 : 0.0 },
    tRefractionColor: { value: sim.refractionColorTex },
    tRefractionDepth: { value: sim.refractionDepthTex },
    tReflectionColor: { value: sim.reflectionColorTex },
    uHasRefraction: { value: 0.0 },
    uHasReflection: { value: 0.0 },
    uCameraNear: { value: CAMERA.near },
    uCameraFar: { value: CAMERA.far },
    uExtinctionDensity: { value: 2.8 },
    uShoreFoamThreshold: { value: 0.048 }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectWorldPosition(shader);
    if (!shader.__waterLocalUv) {
      shader.__waterLocalUv = true;
      shader.vertexShader = `varying vec2 vWaterLocalUv;\n${WATER_SWE_VERT_UNIFORMS}\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>\nvWaterLocalUv = uv;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${WATER_SWE_VERT_DISPLACE}`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>\n${WATER_SWE_VERT_CLIP}`
      );
      shader.fragmentShader = `varying vec2 vWaterLocalUv;\n${shader.fragmentShader}`;
    }
    injectGlobals(shader, `${WATER_FLOW_UNIFORMS}\n${WATER_FLOW_FRAG}`);
    injectSurface(shader, `{
        vec3 waterViewDirV = normalize( vViewPosition );
        float litLuma = dot( outgoingLight, vec3( 0.299, 0.587, 0.114 ) );
        float waterShadowMask = clamp( smoothstep( 0.03, 0.22, litLuma ), 0.15, 1.0 );
        vec4 waterFlowOut = waterFlow( outgoingLight, diffuseColor.a, vStationWorldPos, normal, waterViewDirV, vWaterLocalUv, waterShadowMask );
        outgoingLight = waterFlowOut.rgb;
        diffuseColor.a = waterFlowOut.a;
      }`);
    material.userData.shader = shader;
  });
  material.userData.waterFlow = true;
  if (!WATER_FLOW_MATERIALS.includes(material)) WATER_FLOW_MATERIALS.push(material);
  registerSunMaterial(material);
  return material;
}

export function finishAsset(root, options = {}) {
  const {
    shadowPolicy = 'fill',
    thickness = OUTLINE.thickness,
    auto = true,
    maxThickness = OUTLINE.maxThickness,
    outlineKey = 'default',
    outlineColor = PALETTE.outline,
    noOutline = false
  } = options;

  root.traverse((node) => {
    if (!node.isMesh) return;
    if (node.userData.isOutline) return;
    const optedOutCast = node.userData.noCast === true || isOverlayMaterial(node.material);
    const optedOutReceive = node.userData.noReceive === true;
    switch (shadowPolicy) {
      case 'cast':
        node.castShadow = !optedOutCast;
        node.receiveShadow = false;
        break;
      case 'receive':
        node.castShadow = false;
        node.receiveShadow = !optedOutReceive;
        break;
      case 'none':
        node.castShadow = false;
        node.receiveShadow = false;
        break;
      case 'keep':
        break;
      default:
        node.castShadow = !optedOutCast;
        node.receiveShadow = !optedOutReceive;
    }
  });

  if (noOutline) {
    markNoOutline(root);
    return [];
  }

  return outlineGroup(root, { thickness, auto, maxThickness, key: outlineKey, color: outlineColor });
}

export function isOverlayMaterial(material) {
  if (!material) return true;
  if (material.blending === THREE.AdditiveBlending) return true;
  if (material.transparent && material.opacity < 0.35) return true;
  return false;
}

export { outlineGroup, markNoOutline, shouldSkipOutline };
