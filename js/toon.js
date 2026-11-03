// 三渲二材质工具：渐变带、叶片透光、青苔附着、老化叠加、资产收尾（描边 + 阴影策略）
import * as THREE from 'three';
import { TOON_BANDS, OUTLINE, PALETTE, LIGHT } from './config.js';
import { sunDirection } from './lighting.js';
import { gradientMap } from './textures.js';
import {
  LEAF_TRANSLUCENCY_FRAG, LEAF_TRANSLUCENCY_UNIFORMS,
  MOSS_ATTACHMENT_FRAG, MOSS_ATTACHMENT_UNIFORMS,
  WEATHERING_FRAG, WEATHERING_UNIFORMS
} from './shaders/toon-shading.js';
import { LEAF_FLUTTER_VERT, LEAF_FLUTTER_APPLY, LEAF_FLUTTER_UNIFORMS } from './shaders/leaf-vertex.js';
import { WATER_FLOW_FRAG, WATER_FLOW_UNIFORMS } from './shaders/water-shader.js';
import { STREAM_PATH } from './layout.js';
import { outlineGroup, markNoOutline, shouldSkipOutline } from './outline.js';

const DEG = Math.PI / 180;

/**
 * 世界空间太阳光方向。
 * 直接转发 lighting.js —— 主光、叶片透光、青苔背阴、老化迎风面、光斑漂移、尘埃逆光
 * 必须共用同一个方向，改一次 LIGHT.sunAzimuthDeg 全部跟着走。
 */
export function sunDirectionVector() {
  return sunDirection();
}

export const BANDS = TOON_BANDS;

/** 给材质指定卡通色阶带（硬 / 中 / 软 / 平面） */
export function setBanding(material, band = 'mid') {
  const steps = BANDS[band] || BANDS.mid;
  material.gradientMap = gradientMap(steps);
  material.userData.toonBand = band;
  return material;
}

// shouldSkipOutline 单一来源在 outline.js（前缀表 config.NO_OUTLINE_PREFIXES）：
// 描边与阴影策略必须用同一条判据，两处各写一份迟早会分家。

/**
 * three r160 的片元模板把 `#include <opaque_fragment>` 放在 `outgoingLight` 声明之后，
 * 而 `<lights_fragment_end>` 在它之前 —— 注入到 lights_fragment_end 会引用尚未声明的
 * outgoingLight（GLSL 报未声明标识符，program 编译失败）。统一挂在 opaque_fragment 之前。
 */
const FRAGMENT_SURFACE_ANCHOR = '#include <opaque_fragment>';

/**
 * uniform 声明与**函数定义**都必须落在片元着色器全局作用域：
 * GLSL 既不允许在 void main() 内声明 uniform，也不允许在函数体内定义函数。
 * 注入点落在 main() 体内，所以函数体走这里前置，注入点只留调用语句。
 */
function injectGlobals(shader, declarations) {
  shader.fragmentShader = `${declarations}\n${shader.fragmentShader}`;
}

/** 把片段插到 outgoingLight 已就绪的位置（opaque_fragment 之前） */
function injectSurface(shader, body) {
  shader.fragmentShader = shader.fragmentShader.replace(FRAGMENT_SURFACE_ANCHOR, `${body}\n${FRAGMENT_SURFACE_ANCHOR}`);
}

/**
 * 注入世界坐标 varying（兼容 instancing），供着色器内做位置相关的老化 / 青苔混合。
 *
 * 名字必须是 three 不会用到的：three 的 shadowmap chunk 自带 `varying vec3 vWorldPosition;`，
 * 曾经用 `includes('varying vec3 vWorldPos')` 做幂等判据时，字符串前缀命中它，
 * 于是凡是 receiveShadow 的材质（水面、木构…）整条注入被静默跳过 ——
 * 片元里引用 vWorldPos 直接报 undeclared identifier。
 * 现在：判据用参数对象上的显式标记，名字也改成不会撞车的 vStationWorldPos。
 *
 * 一个材质可能同时挂老化 + 青苔（woodWeathered），注入两次会重复声明 varying 与 `vwp`
 * —— 标记让第二次直接跳过。
 */
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

/** 把 uniform 挂到材质上，并保留引用以便运行时微调 */
function bindUniforms(material, uniforms) {
  // 合并而不是替换：一个材质可能同时注入透光 / 青苔 / 老化 / 微振 / 水流，
  // 直接赋值会让先注入的那批 uniform 引用丢失（tuneMaterial 之后找不到键）。
  // 必须新建对象：clone() 是 userData 浅拷贝，父子共用同一个 dict，
  // 原地 Object.assign 会把父材质的 uniform 表一起改掉。
  material.userData.uniforms = Object.assign({}, material.userData.uniforms, uniforms);
  return uniforms;
}

/** 运行时微调已注入的 uniform */
export function tuneMaterial(material, key, value) {
  const uniforms = material.userData.uniforms;
  if (!uniforms || !uniforms[key]) return false;
  const target = uniforms[key].value;
  if (target && target.isColor) target.set(value);
  else uniforms[key].value = value;
  return true;
}

/** 叶片次表面透光（逆光叶隙）：颜色/强度/硬度全部由 uniform 驱动，主光色取自 LIGHT.sunColor */
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
  return material;
}

/** 青苔附着：仅在构件底部与背阴面出现，不泛滥 */
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
  return material;
}

/** 统一老化规则：底部与迎风面优先老化，顶面轻微积尘 */
export function applyWeathering(material, { wear = PALETTE.toriiLacquerLoss, dust = PALETTE.soilWet, start = 0, band = 0.6, wearAmount = 0.5, dustAmount = 0.22 } = {}) {
  const uniforms = bindUniforms(material, {
    uWearColor: { value: new THREE.Color(wear) },
    uDustColor: { value: new THREE.Color(dust) },
    uWearStart: { value: start },
    uWearBand: { value: band },
    uWearAmount: { value: wearAmount },
    uDustAmount: { value: dustAmount }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectWorldPosition(shader);
    injectGlobals(shader, `${WEATHERING_UNIFORMS}\n${WEATHERING_FRAG}`);
    injectSurface(shader, `{
        outgoingLight = applyWeathering( outgoingLight, vStationWorldPos, normal );
      }`);
    material.userData.shader = shader;
  });
  return material;
}

/** 暗部抬升 / 明暗交界柔化：避免卡通分层在暗侧糊死 */
export function applyShadowLift(material, { lift = 0.14, knee = 0.42 } = {}) {
  const uniforms = bindUniforms(material, {
    uShadowLift: { value: lift },
    uShadowKnee: { value: knee }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // 这两个 uniform 原先只挂进 shader.uniforms、没在 GLSL 里声明，着色器一编译就报未声明标识符
    injectGlobals(shader, `
      uniform float uShadowLift;
      uniform float uShadowKnee;
    `);
    injectSurface(shader, `{
        float l = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
        float k = 1.0 - smoothstep( uShadowKnee * 0.35, uShadowKnee, l );
        outgoingLight += outgoingLight * k * uShadowLift + vec3( 0.012, 0.010, 0.008 ) * k;
      }`);
    material.userData.shader = shader;
  });
  return material;
}

/**
 * 把新的注入串到已有的 onBeforeCompile 之后。
 * 一个材质只有一个 onBeforeCompile：透光 / 青苔 / 老化 / 微振 / 水流要能叠加，
 * 否则后调用者会静默覆盖前者（叶片透光被微振吃掉，表现为叶片不再逆光发亮）。
 */
function composeBeforeCompile(material, inject) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    inject(shader);
  };
}

/** 已启用 GPU 叶片微振的材质（animations/tree-sway.js 逐帧推进它们的 uTime / uGust） */
export const LEAF_FLUTTER_MATERIALS = [];

/**
 * 叶片微振：簇内每一片叶的极小幅抖动（GPU 侧，与 CPU 的构件组摆动叠加）。
 * 只对 InstancedMesh 生效（shader 内 USE_INSTANCING 判定）。
 */
export function applyLeafFlutter(material, { amplitude = 0.012, period = 3.4 } = {}) {
  const uniforms = bindUniforms(material, {
    uTime: { value: 0 },
    uAmplitude: { value: amplitude },
    uPeriod: { value: period },
    uGust: { value: 1 }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // uniform 与函数定义都只能出现在全局作用域（顶点着色器侧），注入点只留调用
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

/** 溪流下游方向的水平单位向量（由 STREAM_PATH 首末算，整条溪近似直线） */
export function streamFlowDirection() {
  const a = STREAM_PATH[0];
  const b = STREAM_PATH[STREAM_PATH.length - 1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return new THREE.Vector2(dx / len, dz / len);
}

/**
 * 水面颜色流：顺流推进的亮带 + 掠射反光。
 * 几何波由 animations/stream-flow.js 在 CPU 上做（见 docs/ASSET_INDEX.md §59 / §61）。
 */
export function applyWaterFlow(material, { speed = 0.055, scale = 0.42, strength = 1 } = {}) {
  const uniforms = bindUniforms(material, {
    uTime: { value: 0 },
    uFlowSpeed: { value: speed },
    uFlowDir: { value: streamFlowDirection() },
    uShallowColor: { value: new THREE.Color(PALETTE.waterShallow) },
    uDeepColor: { value: new THREE.Color(PALETTE.waterDeep) },
    uFlowScale: { value: scale },
    uFlowStrength: { value: strength }
  });
  composeBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectWorldPosition(shader);
    injectGlobals(shader, `${WATER_FLOW_UNIFORMS}\n${WATER_FLOW_FRAG}`);
    injectSurface(shader, `{
        vec3 waterViewDirV = normalize( vViewPosition );
        outgoingLight = waterFlow( outgoingLight, vStationWorldPos, normal, waterViewDirV );
      }`);
    material.userData.shader = shader;
  });
  material.userData.waterFlow = true;
  return material;
}

/**
 * 资产收尾：阴影策略 + 逐网格独立描边。
 *
 * 阴影与描边是两件事，旧版本用 shouldSkipOutline 同时决定两者，于是
 * 「leafSheet* 不描边」顺带把 js/tree-kit.js 里 `instanced.castShadow = true`
 * 静默改回 false —— 树冠不再投影，而叶隙投影正是 S7.6 斑驳光斑的物理来源。
 * 现在：不描边只看材质名 / 不透明度；投不投影只看资产层的显式决定（userData.noCast /
 * userData.noReceive）与材质是否是加色面片。
 *
 * @param {THREE.Object3D} root 资产根
 * @param {object} options shadowPolicy:
 *   'fill'（默认，别名 'both'）资产层决定优先：标了 noCast 的网格（落叶薄片、苔壳、锈斑、
 *       玻璃、水面、加色光斑…）永不投影，未写决定的构件（树干、枝条、灌木茎、道具主体）
 *       一律投影 + 受光。这样既不会漏掉构件阴影，也不会覆盖资产层的例外。
 *   'cast'    只投影不受光（仍尊重 noCast）
 *   'receive' 整组只受光（底座 / 地形这类整块面）
 *   'none'    既不投影也不受光
 *   'keep'    完全沿用资产层写法，组装层不改动
 */
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
    // 描边壳体不参与阴影：壳体自己投影会在构件外侧糊出一份实心影
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
      default: // 'fill' / 'both'
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

/** 材质本身是否不该参与阴影：加色面片（光斑 / 灯罩发光 / 尘埃）与几乎全透的膜 */
export function isOverlayMaterial(material) {
  if (!material) return true;
  if (material.blending === THREE.AdditiveBlending) return true;
  if (material.transparent && material.opacity < 0.35) return true;
  return false;
}

export { outlineGroup, markNoOutline, shouldSkipOutline };
