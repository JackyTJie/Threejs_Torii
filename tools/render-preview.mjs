#!/usr/bin/env node
// S9.8 视觉排查：离线软件光栅化预览（支持全天时瑞利散射天空、双层体积云、5层视差远山、3D体积雾、丁达尔体积光、4层复合石阶、底层灰褐土微点青苔与岸石波光）
import { installDomStub } from './dom-stub.mjs';
installDomStub();

const fs = await import('node:fs');
const zlib = await import('node:zlib');
const THREE = await import('three');

const { createMaterialLibrary } = await import('../js/materials.js');
const { createScene } = await import('../js/scene.js');
const { createLighting } = await import('../js/lighting.js');
const { assembleScene } = await import('../js/scene-assembly.js');
const { shellWorldThickness } = await import('../js/outline.js');
const { stepAnimations } = await import('../js/animations/registry.js');
const { evaluateHydroZone } = await import('../js/animations/stream-flow.js');
const { createDayNightSystem } = await import('../js/day-night.js');
const { createWeatherSystem } = await import('../js/weather.js');
const { getShrineLanternWorldPositions } = await import('../js/assets/torii.js');
const { CAMERA, LIGHT, POST, TOON_BANDS, OUTLINE } = await import('../js/config.js');
const { pathCenterX } = await import('../js/layout.js');

/* ------------------------------------------------------------------ 参数 */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}
const W = Number(arg('w', arg('width', 1280)));
const H = Number(arg('h', arg('height', 720)));
const SS = Math.max(1, Math.min(4, Number(arg('ss', 2))));
const RW = W * SS;
const RH = H * SS;
const DEG = Math.PI / 180;
const azDeg = Number(arg('az', CAMERA.azimuthDeg));
const elDeg = Number(arg('el', CAMERA.elevationDeg));
const radius = Number(arg('r', CAMERA.radius));
const target = new THREE.Vector3(
  Number(arg('tx', CAMERA.target.x)),
  Number(arg('ty', CAMERA.target.y)),
  Number(arg('tz', CAMERA.target.z))
);
const simSeconds = Number(arg('sim', 4));
const dayHour = Number(arg('hour', 10.5));
const weatherModeName = String(arg('weather', 'clear'));
const showShells = arg('shells', '1') !== '0';
const outPath = arg('out', '/tmp/preview.png');

/* ------------------------------------------------------------------ 场景 */
const scene = createScene({ environment: false });
const lighting = createLighting(scene);
const materials = createMaterialLibrary();
const assembly = assembleScene(scene, materials);
const dayNight = createDayNightSystem({ scene, lighting, post: null });
dayNight.setHour(dayHour);
const weather = createWeatherSystem({ scene, post: null, swe: null });
weather.setMode(weatherModeName);

for (let i = 0; i < Math.round(simSeconds * 60); i++) {
  stepAnimations(1 / 60);
  weather.step(1 / 60, (i + 1) / 60);
}
scene.updateMatrixWorld(true);

/* ------------------------------------------------------------------ 相机 */
const camera = new THREE.PerspectiveCamera(CAMERA.fov, RW / RH, CAMERA.near, CAMERA.far);
const az = azDeg * DEG;
const el = elDeg * DEG;
camera.position.set(
  target.x + Math.cos(az) * Math.cos(el) * radius,
  target.y + Math.sin(el) * radius,
  target.z + Math.sin(az) * Math.cos(el) * radius
);
camera.lookAt(target);
camera.updateWorldMatrix(true, false);

const viewMat = camera.matrixWorld.clone().invert();
const viewEls = viewMat.elements;
const projScale = 1 / Math.tan((camera.fov * DEG) / 2);
const aspect = RW / RH;

function mulMat(a, b) {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] + a[row + 4] * b[col * 4 + 1] +
        a[row + 8] * b[col * 4 + 2] + a[row + 12] * b[col * 4 + 3];
    }
  }
  return out;
}

/* ------------------------------------------------------------------ 缓冲 */
const color = new Float32Array(RW * RH * 3);
const depth = new Float32Array(RW * RH).fill(Infinity);
const objId = new Int32Array(RW * RH).fill(-1);
const idInfo = [];

/* ------------------------------------------------------------------ 光照与贴图采样 */
const sunTravel = lighting.sunDirection;
const toSun = { x: -sunTravel.x, y: -sunTravel.y, z: -sunTravel.z };
const rimTravel = (() => {
  const azr = LIGHT.rimAzimuthDeg * DEG;
  const elr = LIGHT.rimElevationDeg * DEG;
  return { x: -Math.cos(azr) * Math.cos(elr), y: -Math.sin(elr), z: -Math.sin(azr) * Math.cos(elr) };
})();
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
function aces(x) {
  const v = Math.max(0, x);
  return (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
}
const rgbOf = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const SUN = [srgbToLinear(lighting.key.color.r), srgbToLinear(lighting.key.color.g), srgbToLinear(lighting.key.color.b)];
const RIM = [srgbToLinear(lighting.rim.color.r), srgbToLinear(lighting.rim.color.g), srgbToLinear(lighting.rim.color.b)];
const AMB = [srgbToLinear(lighting.ambient.color.r), srgbToLinear(lighting.ambient.color.g), srgbToLinear(lighting.ambient.color.b)];
const HEMI_SKY = [srgbToLinear(lighting.fill.color.r), srgbToLinear(lighting.fill.color.g), srgbToLinear(lighting.fill.color.b)];
const HEMI_GROUND = [srgbToLinear(lighting.fill.groundColor.r), srgbToLinear(lighting.fill.groundColor.g), srgbToLinear(lighting.fill.groundColor.b)];
const lanternPositions = getShrineLanternWorldPositions();
const lanternIntensity = lighting.getLanternBrightness ? lighting.getLanternBrightness() : 0.38;
const weatherWetness = weatherModeName === 'rain' ? 0.95 : weatherModeName === 'fog' ? 0.45 : 0.22;
const weatherCode = weatherModeName === 'rain' ? 1.0 : weatherModeName === 'fog' ? 2.0 : 0.0;

function sampleMap(map, u, v, out) {
  const img = map && map.image && map.image._imageData;
  if (!img || !img.data) {
    out[0] = 1; out[1] = 1; out[2] = 1;
    return out;
  }
  const w = img.width;
  const h = img.height;
  const uu = ((u % 1) + 1) % 1;
  const vv = ((v % 1) + 1) % 1;
  const ix = Math.min(w - 1, Math.floor(uu * w));
  const iy = Math.min(h - 1, Math.floor(vv * h));
  const idx = (iy * w + ix) * 4;
  out[0] = img.data[idx] / 255;
  out[1] = img.data[idx + 1] / 255;
  out[2] = img.data[idx + 2] / 255;
  return out;
}

function toonRamp(ndl, steps) {
  const hl = Math.max(0, Math.min(1, ndl * 0.5 + 0.5));
  const q = Math.floor(hl * steps + 0.5) / steps;
  const idx = Math.max(0, Math.min(steps - 1, Math.floor(q * steps)));
  return 0.086 + 0.914 * (idx / (steps - 1));
}

function bandSteps(material) {
  const name = material && material.gradientMap && material.gradientMap.name;
  const m = name && /grad-(\d+)/.exec(name);
  return m ? Number(m[1]) : TOON_BANDS.mid;
}

function hash21(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x, y) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 3; i++) {
    v += a * valueNoise(x, y);
    const nx = 0.8 * x - 0.6 * y;
    const ny = 0.6 * x + 0.8 * y;
    x = nx * 2.02 + 13.7;
    y = ny * 2.02 - 9.2;
    a *= 0.5;
  }
  return v;
}

const stats = {
  meshes: 0, shells: 0, instanced: 0, triangles: 0, culled: 0,
  skippedShader: 0, skippedNoOutline: 0, transparentMeshes: 0, additiveMeshes: 0, points: 0
};

const texScratch = new Float64Array(3);
const shadeScratch = new Float64Array(4);

function shadeLit(material, nx, ny, nz, u, v, wxWorld, wy, wzWorld, out) {
  const steps = bandSteps(material);
  const ndl = nx * toSun.x + ny * toSun.y + nz * toSun.z;
  const key = toonRamp(ndl, steps) * lighting.key.intensity;
  const ndlRim = nx * (-rimTravel.x) + ny * (-rimTravel.y) + nz * (-rimTravel.z);
  const rim = toonRamp(ndlRim, steps) * lighting.rim.intensity * 0.6;
  const hemiMix = 0.5 + 0.5 * ny;
  const metal = material.metalness || 0;
  const diffuse = 1 - metal * 0.65;

  let lr = AMB[0] * lighting.ambient.intensity + HEMI_SKY[0] * hemiMix * lighting.fill.intensity +
    HEMI_GROUND[0] * (1 - hemiMix) * lighting.fill.intensity;
  let lg = AMB[1] * lighting.ambient.intensity + HEMI_SKY[1] * hemiMix * lighting.fill.intensity +
    HEMI_GROUND[1] * (1 - hemiMix) * lighting.fill.intensity;
  let lb = AMB[2] * lighting.ambient.intensity + HEMI_SKY[2] * hemiMix * lighting.fill.intensity +
    HEMI_GROUND[2] * (1 - hemiMix) * lighting.fill.intensity;
  lr += SUN[0] * key * diffuse + RIM[0] * rim;
  lg += SUN[1] * key * diffuse + RIM[1] * rim;
  lb += SUN[2] * key * diffuse + RIM[2] * rim;

  const c = material.color || { r: 1, g: 1, b: 1 };
  let mr = c.r, mg = c.g, mb = c.b;
  if (material.map) {
    sampleMap(material.map, u, v, texScratch);
    mr *= texScratch[0];
    mg *= texScratch[1];
    mb *= texScratch[2];
  }

  const uniforms = material.userData && material.userData.uniforms;
  const toriiMode = uniforms && uniforms.uToriiMode ? uniforms.uToriiMode.value : 0;

  // 真实微颗粒粗糙青苔附着（底层灰褐土 + 上层细密深绿苔点）
  if (uniforms && uniforms.uMossColor && wy !== undefined) {
    const mh = uniforms.uMossHeight.value;
    const mbd = Math.max(0.001, uniforms.uMossBand.value);
    const ma = uniforms.uMossAmount.value;
    const hFade = Math.max(0, Math.min(1, 1 - (wy - mh) / mbd));
    const streamBias = 0.58 + 0.72 * Math.max(0, Math.min(1, (1.85 - wxWorld) / 3.5));
    const nMacro = fbm2(wxWorld * 3.8, wzWorld * 3.8);
    const nMicro = valueNoise(wxWorld * 48.0, wzWorld * 48.0);
    const nUltra = hash21(Math.floor(wxWorld * 120.0), Math.floor(wzWorld * 120.0));
    const topFacing = Math.max(0, Math.min(1, (ny - 0.38) / 0.44));
    const rawZone = Math.max(
      hFade * streamBias * Math.max(0, Math.min(1, (nMacro - 0.34) / 0.40)) * 0.65,
      Math.max(0, Math.min(1, (nMacro + topFacing * 0.14 - 0.38) / 0.32)) * topFacing * streamBias * 0.82
    ) * ma;

    const soilMask = Math.min(0.75, Math.max(0, (rawZone - 0.08) / 0.34) * (0.62 + 0.38 * nMicro));
    const soilR = 0.17 + 0.08 * nMicro, soilG = 0.14 + 0.07 * nMicro, soilB = 0.11 + 0.06 * nMicro;
    mr = mr * (1 - soilMask * 0.72) + soilR * (soilMask * 0.72);
    mg = mg * (1 - soilMask * 0.72) + soilG * (soilMask * 0.72);
    mb = mb * (1 - soilMask * 0.72) + soilB * (soilMask * 0.72);

    const dotDensity = Math.max(0, Math.min(1, (rawZone - 0.22) / 0.46)) * Math.max(0, Math.min(1, (nMicro * 0.6 + nUltra * 0.4 - 0.24) / 0.52));
    const mc = uniforms.uMossColor.value;
    const dotR = (0.07 + mc.r * 0.52 * nUltra) * 0.85;
    const dotG = (0.13 + mc.g * 0.62 * nUltra) * 0.85;
    const dotB = (0.06 + mc.b * 0.44 * nUltra) * 0.85;
    mr = mr * (1 - dotDensity * 0.84) + dotR * (dotDensity * 0.84);
    mg = mg * (1 - dotDensity * 0.84) + dotG * (dotDensity * 0.84);
    mb = mb * (1 - dotDensity * 0.84) + dotB * (dotDensity * 0.84);
  }

  // 1) 鸟居三段式老化（toriiMode == 1 或 2）
  if (toriiMode > 0.5 && toriiMode < 1.5) {
    const mh = uniforms && uniforms.uWearStart ? uniforms.uWearStart.value : 3.5;
    const hLocal = wy - mh;
    const sunFacing = Math.max(0, Math.min(1, (ndl + 0.15) / 0.70));
    const warmR = mr * 1.10 + 0.05, warmG = mg * 1.08 + 0.032, warmB = mb * 0.86;
    const coolR = mr * 0.62, coolG = mg * 0.48, coolB = mb * 0.52;
    mr = coolR + (warmR - coolR) * sunFacing;
    mg = coolG + (warmG - coolG) * sunFacing;
    mb = coolB + (warmB - coolB) * sunFacing;

    const baseSplash = Math.max(0, Math.min(1, 1 - (hLocal - 0.08) / 0.70));
    const woodGrain = fbm2(wxWorld * 18.0, wy * 3.8 + wzWorld * 18.0);
    const peelMask = baseSplash * Math.max(0, Math.min(1, (woodGrain + (1 - hLocal) * 0.35 - 0.30) / 0.32));
    const bareR = 0.15 + 0.13 * woodGrain, bareG = 0.10 + 0.09 * woodGrain, bareB = 0.08 + 0.05 * woodGrain;
    mr = mr * (1 - peelMask * 0.88) + bareR * (peelMask * 0.88);
    mg = mg * (1 - peelMask * 0.88) + bareG * (peelMask * 0.88);
    mb = mb * (1 - peelMask * 0.88) + bareB * (peelMask * 0.88);

    const waistTouch = Math.max(0, Math.min(1, (hLocal - 0.82) / 0.33)) * Math.max(0, Math.min(1, 1 - (hLocal - 1.48) / 0.40));
    mr = mr * (1 + 0.18 * waistTouch) + 0.032 * waistTouch * sunFacing;
    mg = mg * (1 + 0.16 * waistTouch) + 0.018 * waistTouch * sunFacing;
    mb = mb * (1 + 0.10 * waistTouch) + 0.008 * waistTouch * sunFacing;
  } else if (toriiMode >= 2.5 && toriiMode < 3.5) {
    // 2) 百年参道石阶 4 层复合材质（基层青石裂纹色差 + 中央踩踏磨光高反光 + 缝隙积土微粒苔 + 凹陷积水涟漪反射）
    const pathCx = pathCenterX(wzWorld);
    const distFromCenter = Math.abs(wxWorld - pathCx);
    const upTread = Math.max(0, Math.min(1, (ny - 0.52) / 0.34));
    const grain = fbm2(wxWorld * 8.5, wzWorld * 8.5);
    const slabHash = hash21(Math.floor(wxWorld * 1.8), Math.floor(wzWorld * 2.2));
    const crackLine = Math.pow(1 - Math.abs(Math.sin(wxWorld * 14.0 + wzWorld * 9.0 + grain * 4.2)), 12.0);
    mr *= (0.78 + 0.14 * slabHash) * (1 - crackLine * 0.32);
    mg *= (0.88 + 0.10 * slabHash) * (1 - crackLine * 0.32);
    mb *= (0.92 + 0.08 * slabHash) * (1 - crackLine * 0.32);

    // 踩踏区：中央光滑磨亮
    const footTraffic = Math.exp(-Math.pow(distFromCenter / 0.54, 2.0)) * upTread;
    mr = mr * (1 + 0.14 * footTraffic) + 0.020 * footTraffic;
    mg = mg * (1 + 0.16 * footTraffic) + 0.024 * footTraffic;
    mb = mb * (1 + 0.18 * footTraffic) + 0.028 * footTraffic;

    // 缝隙边缘：积土与细密深绿苔点
    const edgeCrevice = Math.min(1, (1 - upTread) * 0.82 + Math.max(0, Math.min(1, (distFromCenter - 0.42) / 0.66)) * 0.68);
    const streamSideBoost = 0.58 + 0.62 * Math.max(0, Math.min(1, (1.4 - (wxWorld - pathCx)) / 2.6));
    const creviceSoilMask = Math.min(0.78, edgeCrevice * streamSideBoost * (0.52 + 0.48 * grain) * (1 - footTraffic * 0.82));
    mr = mr * (1 - creviceSoilMask * 0.54) + 0.19 * (creviceSoilMask * 0.54);
    mg = mg * (1 - creviceSoilMask * 0.54) + 0.16 * (creviceSoilMask * 0.54);
    mb = mb * (1 - creviceSoilMask * 0.54) + 0.13 * (creviceSoilMask * 0.54);

    const microDots = hash21(Math.floor(wxWorld * 120.0), Math.floor(wzWorld * 120.0));
    const mossDotMask = Math.max(0, Math.min(1, (creviceSoilMask - 0.32) / 0.43)) * Math.max(0, Math.min(1, (microDots * 0.65 + grain * 0.35 - 0.38) / 0.44));
    mr = mr * (1 - mossDotMask * 0.74) + (0.08 + 0.07 * microDots) * (mossDotMask * 0.74);
    mg = mg * (1 - mossDotMask * 0.74) + (0.14 + 0.10 * microDots) * (mossDotMask * 0.74);
    mb = mb * (1 - mossDotMask * 0.74) + (0.06 + 0.05 * microDots) * (mossDotMask * 0.74);

    // 积水层：清晨与雨后台阶凹陷处积水反射天空与鸟居
    const dishField = fbm2(wxWorld * 2.4, wzWorld * 3.2);
    const puddleMask = footTraffic * Math.max(0, Math.min(1, (dishField - (0.56 - weatherWetness * 0.18)) / 0.20)) * upTread;
    if (puddleMask > 0.01) {
      const toriiProx = Math.exp(-Math.pow((wzWorld - 1.5) / 5.5, 2.0));
      const pReflR = 0.34 * (1 - toriiProx * 0.45) + 0.68 * (toriiProx * 0.45);
      const pReflG = 0.46 * (1 - toriiProx * 0.45) + 0.18 * (toriiProx * 0.45);
      const pReflB = 0.48 * (1 - toriiProx * 0.45) + 0.09 * (toriiProx * 0.45);
      const pm = puddleMask * (0.45 + 0.35 * weatherWetness);
      mr = mr * (1 - pm) + pReflR * pm;
      mg = mg * (1 - pm) + pReflG * pm;
      mb = mb * (1 - pm) + pReflB * pm;
    }
  } else if (toriiMode >= 3.5) {
    // 3) 独立青苔斑块（mossPatch / mossWet / mossDamp）：底层灰褐腐殖土 + 上层细密深绿苔点 + 粗糙哑光
    const dot1 = valueNoise(wxWorld * 14.0, wzWorld * 14.0);
    const dot2 = hash21(Math.floor(wxWorld * 95.0), Math.floor(wzWorld * 95.0));
    const soilUnder = Math.max(0, Math.min(1, 0.75 - dot1 * 0.55 - ny * 0.15));
    const earthR = 0.17 + 0.08 * dot1, earthG = 0.14 + 0.07 * dot1, earthB = 0.11 + 0.05 * dot1;
    const mossR = 0.07 + 0.09 * dot2, mossG = 0.13 + 0.13 * dot2, mossB = 0.06 + 0.06 * dot2;
    const mixEarth = Math.min(0.76, soilUnder * 0.55 + (1 - dot2) * 0.32);
    mr = mossR * (1 - mixEarth) + earthR * mixEarth;
    mg = mossG * (1 - mixEarth) + earthG * mixEarth;
    mb = mossB * (1 - mixEarth) + earthB * mixEarth;
  }

  out[0] = srgbToLinear(mr) * lr;
  out[1] = srgbToLinear(mg) * lg;
  out[2] = srgbToLinear(mb) * lb;
  out[3] = 1;

  // 全局光照颜色反弹（鸟居朱红反弹 + 林冠冷绿浸染）与石灯笼地面 3×3 格子光斑
  const dTorii1 = Math.hypot((wxWorld - 0.28) * 0.55, (wy - 4.2) * 0.45, (wzWorld + 0.88) * 0.65);
  const dTorii2 = Math.hypot((wxWorld - 0.18) * 0.55, (wy - 4.5) * 0.45, (wzWorld + 2.18) * 0.65);
  const toriiBounce = (Math.exp(-dTorii1 * 0.85) + Math.exp(-dTorii2 * 0.85)) * Math.max(0, Math.min(1, (6.2 - wy) / 3.2));
  out[0] += 0.028 * toriiBounce;
  out[1] += 0.007 * toriiBounce;
  out[2] += 0.003 * toriiBounce;

  if (lanternIntensity > 0.01) {
    for (const lPos of lanternPositions) {
      const dxL = wxWorld - lPos.x, dyL = wy - lPos.y, dzL = wzWorld - lPos.z;
      const distL = Math.hypot(dxL, dyL, dzL);
      if (distL < 4.6 && dyL < 0.25) {
        const atten = Math.exp(-distL * 0.72) * Math.max(0, Math.min(1, (4.6 - distL) / 4.0));
        const denom = Math.max(0.28, -dyL + 0.35);
        const hx = Math.abs((((dxL / denom) * 2.35 + 0.5) % 1 + 1) % 1 - 0.5);
        const hz = Math.abs((((dzL / denom) * 2.35 + 0.5) % 1 + 1) % 1 - 0.5);
        const barX = Math.max(0, Math.min(1, (hx - 0.08) / 0.14));
        const barZ = Math.max(0, Math.min(1, (hz - 0.08) / 0.14));
        const gobo = (0.32 + 0.86 * barX * barZ) * atten * lanternIntensity * 0.32;
        out[0] += gobo * 1.0;
        out[1] += gobo * 0.55;
        out[2] += gobo * 0.14;
      }
    }
  }

  if (material.emissive && (material.emissiveIntensity || 0) > 0) {
    const ei = material.emissiveIntensity;
    out[0] += srgbToLinear(material.emissive.r) * ei;
    out[1] += srgbToLinear(material.emissive.g) * ei;
    out[2] += srgbToLinear(material.emissive.b) * ei;
  }

  if (uniforms && uniforms.uShadowLift) {
    const lift = uniforms.uShadowLift.value;
    const luma = out[0] * 0.2126 + out[1] * 0.7152 + out[2] * 0.0722;
    const k = Math.max(0, Math.min(1, 1 - luma / Math.max(0.05, uniforms.uShadowKnee.value)));
    const skyFacing = Math.max(0.15, Math.min(1, ny * 0.5 + 0.5));
    const floor = (0.065 + 0.075 * skyFacing) * lift * 2.2;
    out[0] += (srgbToLinear(mr) * floor + 0.014) * k;
    out[1] += (srgbToLinear(mg) * floor + 0.016) * k;
    out[2] += (srgbToLinear(mb) * floor + 0.014) * k;
  }

  if (uniforms && uniforms.uTranslucencyColor) {
    const tc = uniforms.uTranslucencyColor.value;
    const str = uniforms.uTranslucencyStrength.value * 0.28;
    out[0] += srgbToLinear(tc.r) * str;
    out[1] += srgbToLinear(tc.g) * str;
    out[2] += srgbToLinear(tc.b) * str;
  }

  // 林冠斑驳阳光透射窗（树叶遮挡阴影 vs 阳光直射林隙）
  const sunBeam1 = Math.exp(-Math.hypot(wxWorld + 3.1, wzWorld - 6.2) * 0.48);
  const sunBeam2 = Math.exp(-Math.hypot(wxWorld + 3.5, wzWorld - 2.3) * 0.52);
  const sunBeam3 = Math.exp(-Math.hypot(wxWorld + 2.8, wzWorld + 1.8) * 0.50);
  const sunBeam4 = Math.exp(-Math.hypot(wxWorld + 3.3, wzWorld - 9.4) * 0.55);
  const beamBoost = Math.max(sunBeam1, sunBeam2, sunBeam3, sunBeam4);
  const canopyGap = fbm2(wxWorld * 0.68, wzWorld * 0.68);
  const sunLit = Math.max(0, Math.min(1, (canopyGap * 0.65 + beamBoost * 0.55 - 0.36) / 0.32));

  // 1) 水底河床与鹅卵石实时斯涅尔折射焦散
  if (material.userData && material.userData.submergedCaustics && wxWorld < -1.15 && wxWorld > -6.0) {
    const uNorm = Math.max(0, Math.min(1, (11.6 - wzWorld) / 20.8));
    const approxWy = 0.25 + 2.95 * Math.pow(uNorm, 1.08);
    const waterDepth = Math.max(0, Math.min(0.65, approxWy - wy));
    if (waterDepth > 0.004) {
      const n1 = fbm2(wxWorld * 2.6, wzWorld * 2.1 - simSeconds * 2.2);
      const n2 = fbm2(wxWorld * 4.2 + 4.2, wzWorld * 3.6 - simSeconds * 3.1);
      const causticNet = Math.pow(Math.max(0, (n1 * 0.6 + n2 * 0.4) - 0.42) * 2.3, 1.65);
      const absorb = 1 - Math.exp(-waterDepth * 1.8);
      const sunBoost = 0.84 + 0.38 * sunLit;
      out[0] = out[0] * sunBoost * (1 - absorb * 0.22) + srgbToLinear(0.76) * causticNet * (0.25 + 0.75 * sunLit) * 0.55;
      out[1] = out[1] * sunBoost * (1 - absorb * 0.05) + srgbToLinear(0.88) * causticNet * (0.25 + 0.75 * sunLit) * 0.58;
      out[2] = out[2] * sunBoost * (1 - absorb * 0.08) + srgbToLinear(0.78) * causticNet * (0.25 + 0.75 * sunLit) * 0.55;
    }
  }

  // 2) 分区水动力学清澈山涧 + 岸边与石头周围水波荡漾/水光粼粼
  if (material.userData && material.userData.waterFlow && uniforms) {
    const overlayMode = uniforms.uOverlayMode ? uniforms.uOverlayMode.value : 0;
    const sc = uniforms.uShallowColor.value;
    const dc = uniforms.uDeepColor.value;
    const hz = evaluateHydroZone(wxWorld, wzWorld);
    const slopeTilt = Math.max(0, Math.min(1, (1 - Math.abs(ny)) * 4.8));

    if (overlayMode > 0.5 && overlayMode < 1.5) {
      const advX = wxWorld - hz.dirX * simSeconds * (1.2 + hz.speed * 1.5);
      const advZ = wzWorld - hz.dirZ * simSeconds * (1.2 + hz.speed * 1.5);
      const filament = fbm2(advX * 4.2, advZ * 2.6);
      const threads = Math.max(0, Math.min(1, (filament - 0.42) * 2.2)) *
        Math.min(1, hz.cascadeMask * 0.9 + hz.splash * 0.7 + hz.splitShear * 0.5 + slopeTilt * 0.6);
      out[0] = srgbToLinear(sc.r * 0.35 + 0.88 * 0.65);
      out[1] = srgbToLinear(sc.g * 0.35 + 0.95 * 0.65);
      out[2] = srgbToLinear(sc.b * 0.35 + 0.92 * 0.65);
      out[3] = 0.06 + 0.48 * threads;
    } else if (overlayMode >= 1.5) {
      out[3] = 0;
    } else {
      const vx = camera.position.x - wxWorld;
      const vy = camera.position.y - wy;
      const vz = camera.position.z - wzWorld;
      const vlen = Math.hypot(vx, vy, vz) || 1;
      const vxN = vx / vlen, vyN = vy / vlen, vzN = vz / vlen;

      const approxCx = -3.25 + 0.58 * Math.sin(wzWorld * 0.36 + 0.5) + 0.28 * Math.cos(wzWorld * 0.21 - 0.8);
      const bankDist = Math.abs(wxWorld - approxCx);
      const bankWaveMask = Math.max(0, Math.min(1, (bankDist - 0.30) / 0.56));
      const stoneWaveMask = Math.min(1, hz.splash * 1.4 + hz.splitShear * 1.1 + Math.abs(hz.vorticity) * 1.1);
      const nearBankOrRock = Math.max(bankWaveMask, stoneWaveMask);

      const rippleAmp = 0.045 + 0.14 * Math.min(1, (hz.speed - 0.55) / 1.4) + 0.12 * nearBankOrRock;
      const wnx = nx + Math.sin(wxWorld * 14.5 - hz.dirX * simSeconds * 6.0 + wzWorld * 8.2) * rippleAmp;
      const wnz = nz + Math.cos(wxWorld * 11.8 - wzWorld * 14.4 - simSeconds * 5.8) * rippleAmp;
      const wlen = Math.hypot(wnx, ny, wnz) || 1;
      const mnx = wnx / wlen, mny = ny / wlen, mnz = wnz / wlen;

      const ndv = Math.max(0.02, Math.abs(mnx * vxN + mny * vyN + mnz * vzN));
      const fresnel = Math.min(0.78, 0.04 + 0.72 * Math.pow(1 - ndv, 3.4));

      const dotVN = vxN * mnx + vyN * mny + vzN * mnz;
      const rx = 2 * dotVN * mnx - vxN;
      const ry = Math.max(0.08, Math.abs(2 * dotVN * mny - vyN));
      const rz = 2 * dotVN * mnz - vzN;

      const foliage = fbm2(wxWorld * 1.4 + rx * 2.5, wzWorld * 1.4 + rz * 2.5);
      let envR = 0.08 + 0.24 * foliage * (0.4 + 0.6 * sunLit);
      let envG = 0.22 + 0.38 * foliage * (0.4 + 0.6 * sunLit);
      let envB = 0.12 + 0.18 * foliage * (0.4 + 0.6 * sunLit);

      const tx = 0.15 - wxWorld, ty = 3.85 - wy, tz = -0.65 - wzWorld;
      const tlen = Math.hypot(tx, ty, tz) || 1;
      const align = (rx * tx + ry * ty + rz * tz) / tlen;
      if (align > 0.45 && Math.abs(wzWorld - 2.2) < 11.5) {
        const shimmer = Math.sin(wzWorld * 14.0 - simSeconds * 5.6 + wxWorld * 9.0);
        const toriiBand = Math.max(0, (align - 0.45) / 0.42) * (0.5 + 0.5 * shimmer);
        envR = envR * (1 - toriiBand * 0.75) + 0.88 * toriiBand * 0.75;
        envG = envG * (1 - toriiBand * 0.75) + 0.24 * toriiBand * 0.75;
        envB = envB * (1 - toriiBand * 0.75) + 0.09 * toriiBand * 0.75;
      }

      // 顺应岸线与绕石流线的细长弧形小水波（消除圆点阵列感）
      const flowWarp = fbm2(wxWorld * 3.8, wzWorld * 2.2 - simSeconds * 1.4);
      const bankRippleWave = Math.sin(bankDist * 34.0 - wzWorld * 6.5 - simSeconds * 5.2 + flowWarp * 6.0);
      const stoneRippleWave = Math.sin(wzWorld * 20.0 + wxWorld * 8.0 - simSeconds * 6.8 + flowWarp * 7.5);
      const ribbonCrest = Math.max(0, Math.min(1, (bankRippleWave * bankWaveMask + stoneRippleWave * stoneWaveMask * 0.85 - 0.58) / 0.36));
      const bankRockShimmer = nearBankOrRock * ribbonCrest * (0.38 + 0.62 * Math.pow(1 - ndv, 1.8));

      const foamNoise = fbm2(wxWorld * 9.5 - hz.dirX * simSeconds * 4.5, wzWorld * 3.8 - hz.dirZ * simSeconds * 4.5);
      const splashFoam = Math.min(0.76, (hz.splash * 0.95 + hz.cascadeMask * 0.48) * (0.45 + 0.62 * foamNoise));
      const splitChevron = hz.splitShear * Math.max(0, Math.sin(wxWorld * 22.0 + wzWorld * 14.0 - simSeconds * 9.5)) * 0.34;
      const eddySwirl = Math.abs(hz.vorticity) * Math.max(0, Math.sin(Math.atan2(wzWorld, wxWorld) * 4.0 + simSeconds * 4.2 + foamNoise * 4.0)) * 0.36;
      const whitewater = Math.min(0.76, splashFoam + splitChevron + eddySwirl + bankRockShimmer * 0.28);

      const hx = vxN + toSun.x, hy = vyN + toSun.y, hzSun = vzN + toSun.z;
      const hlen = Math.hypot(hx, hy, hzSun) || 1;
      const ndh = Math.max(0, (mnx * hx + mny * hy + mnz * hzSun) / hlen);
      const glint = (Math.pow(ndh, 32) * 1.15 + ribbonCrest * (0.55 + 0.95 * nearBankOrRock)) * (0.35 + 0.65 * sunLit);

      const wr = sc.r * 0.65 + dc.r * 0.35;
      const wg = sc.g * 0.65 + dc.g * 0.35;
      const wb = sc.b * 0.65 + dc.b * 0.35;
      const shadeMod = 0.68 + 0.42 * sunLit;

      const baseR = (srgbToLinear(wr * (1 - fresnel) + envR * fresnel) + glint * 0.95) * shadeMod;
      const baseG = (srgbToLinear(wg * (1 - fresnel) + envG * fresnel) + glint * 0.98) * shadeMod;
      const baseB = (srgbToLinear(wb * (1 - fresnel) + envB * fresnel) + glint * 0.88) * shadeMod;

      out[0] = baseR * (1 - whitewater * 0.65) + srgbToLinear(0.84) * (whitewater * 0.65);
      out[1] = baseG * (1 - whitewater * 0.65) + srgbToLinear(0.94) * (whitewater * 0.65);
      out[2] = baseB * (1 - whitewater * 0.65) + srgbToLinear(0.92) * (whitewater * 0.65);
      out[3] = Math.min(0.76, (0.18 + fresnel * 0.34 + whitewater * 0.36 + Math.min(0.28, glint * 0.34)) * (0.85 + 0.15 * slopeTilt));
    }
  }

  return out;
}

function rasterMesh(node, id) {
  const geo = node.geometry;
  if (!geo || !geo.attributes || !geo.attributes.position) return;
  const mat = node.material;
  if (!mat) return;

  const isShell = !!node.userData.isOutline;
  if (isShell && !showShells) return;

  const side = mat.side === undefined ? 0 : mat.side;
  const blending = mat.blending === undefined ? 1 : mat.blending;
  let opacity = mat.opacity === undefined ? 1 : mat.opacity;
  let shellFade = 1;
  let shellColor = null;

  if (isShell) {
    const u = mat.uniforms || {};
    shellColor = u.uColor ? [u.uColor.value.r, u.uColor.value.g, u.uColor.value.b] : rgbOf(OUTLINE.color);
    opacity = u.uOpacity ? u.uOpacity.value : opacity;
  } else if (mat.isShaderMaterial) {
    const u = mat.uniforms || {};
    if (!u.uColor) { stats.skippedShader++; return; }
    shellColor = [u.uColor.value.r, u.uColor.value.g, u.uColor.value.b];
  }

  const unlit = isShell || !!shellColor || !!mat.isMeshBasicMaterial || !!mat.isPointsMaterial;
  const posAttr = geo.attributes.position;
  const pos = posAttr.array;
  const nrmAttr = geo.attributes.normal || null;
  const nrm = nrmAttr ? nrmAttr.array : null;
  const uvAttr = geo.attributes.uv || null;
  const uvArr = uvAttr ? uvAttr.array : null;
  const index = geo.index ? geo.index.array : null;
  const vCount = posAttr.count !== undefined ? posAttr.count : pos.length / 3;
  const triCount = index ? (index.count !== undefined ? index.count : index.length) / 3 : vCount / 3;

  const worldEls = node.matrixWorld.elements;
  const viewOfMesh = mulMat(viewEls, worldEls);
  const instanceEls = node.isInstancedMesh ? node.instanceMatrix.array : null;
  const instances = node.isInstancedMesh ? node.count : 1;

  const vp = new Float64Array(vCount * 3);
  const wxArr = new Float64Array(vCount);
  const wyArr = new Float64Array(vCount);
  const wzArr = new Float64Array(vCount);
  const wn = new Float64Array(vCount * 3);

  for (let inst = 0; inst < instances; inst++) {
    let viewM = viewOfMesh;
    let worldM = worldEls;
    if (instanceEls) {
      const im = new Float64Array(16);
      for (let k = 0; k < 16; k++) im[k] = instanceEls[inst * 16 + k];
      viewM = mulMat(viewOfMesh, im);
      worldM = mulMat(worldEls, im);
      stats.instanced++;
    }

    let anyVisible = false;
    for (let i = 0; i < vCount; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const vx = viewM[0] * x + viewM[4] * y + viewM[8] * z + viewM[12];
      const vy = viewM[1] * x + viewM[5] * y + viewM[9] * z + viewM[13];
      const vz = viewM[2] * x + viewM[6] * y + viewM[10] * z + viewM[14];
      vp[i * 3] = vx; vp[i * 3 + 1] = vy; vp[i * 3 + 2] = vz;
      wxArr[i] = worldM[0] * x + worldM[4] * y + worldM[8] * z + worldM[12];
      wyArr[i] = worldM[1] * x + worldM[5] * y + worldM[9] * z + worldM[13];
      wzArr[i] = worldM[2] * x + worldM[6] * y + worldM[10] * z + worldM[14];
      if (vz < -camera.near) anyVisible = true;
      if (nrm) {
        const nx0 = nrm[i * 3], ny0 = nrm[i * 3 + 1], nz0 = nrm[i * 3 + 2];
        let nx = worldM[0] * nx0 + worldM[4] * ny0 + worldM[8] * nz0;
        let ny = worldM[1] * nx0 + worldM[5] * ny0 + worldM[9] * nz0;
        let nz = worldM[2] * nx0 + worldM[6] * ny0 + worldM[10] * nz0;
        const len = Math.hypot(nx, ny, nz) || 1;
        wn[i * 3] = nx / len; wn[i * 3 + 1] = ny / len; wn[i * 3 + 2] = nz / len;
      }
    }
    if (!anyVisible) continue;

    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index[t * 3] : t * 3;
      const i1 = index ? index[t * 3 + 1] : t * 3 + 1;
      const i2 = index ? index[t * 3 + 2] : t * 3 + 2;
      const ax = vp[i0 * 3], ay = vp[i0 * 3 + 1], az_ = vp[i0 * 3 + 2];
      const bx = vp[i1 * 3], by = vp[i1 * 3 + 1], bz = vp[i1 * 3 + 2];
      const cx = vp[i2 * 3], cy = vp[i2 * 3 + 1], cz = vp[i2 * 3 + 2];
      if (az_ >= -camera.near || bz >= -camera.near || cz >= -camera.near) { stats.culled++; continue; }

      const e1x = bx - ax, e1y = by - ay, e1z = bz - az_;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az_;
      let fx = e1y * e2z - e1z * e2y;
      let fy = e1z * e2x - e1x * e2z;
      let fz = e1x * e2y - e1y * e2x;
      const flen = Math.hypot(fx, fy, fz);
      if (flen < 1e-12) { stats.culled++; continue; }
      fx /= flen; fy /= flen; fz /= flen;
      const facing = fx * ax + fy * ay + fz * az_;
      if (side === 0 && facing > 0) { stats.culled++; continue; }
      if (side === 1 && facing < 0) { stats.culled++; continue; }

      let wnx, wny, wnz;
      if (nrm) {
        wnx = (wn[i0 * 3] + wn[i1 * 3] + wn[i2 * 3]) / 3;
        wny = (wn[i0 * 3 + 1] + wn[i1 * 3 + 1] + wn[i2 * 3 + 1]) / 3;
        wnz = (wn[i0 * 3 + 2] + wn[i1 * 3 + 2] + wn[i2 * 3 + 2]) / 3;
        const wl = Math.hypot(wnx, wny, wnz) || 1;
        wnx /= wl; wny /= wl; wnz /= wl;
      } else {
        wnx = viewEls[0] * fx + viewEls[1] * fy + viewEls[2] * fz;
        wny = viewEls[4] * fx + viewEls[5] * fy + viewEls[6] * fz;
        wnz = viewEls[8] * fx + viewEls[9] * fy + viewEls[10] * fz;
      }

      const sa = 1 / (-az_), sb = 1 / (-bz), sc = 1 / (-cz);
      const pax = (0.5 + 0.5 * (ax * projScale / aspect) * sa) * RW;
      const pay = (0.5 - 0.5 * (ay * projScale) * sa) * RH;
      const pbx = (0.5 + 0.5 * (bx * projScale / aspect) * sb) * RW;
      const pby = (0.5 - 0.5 * (by * projScale) * sb) * RH;
      const pcx = (0.5 + 0.5 * (cx * projScale / aspect) * sc) * RW;
      const pcy = (0.5 - 0.5 * (cy * projScale) * sc) * RH;

      const minX = Math.max(0, Math.floor(Math.min(pax, pbx, pcx)));
      const maxX = Math.min(RW - 1, Math.ceil(Math.max(pax, pbx, pcx)));
      const minY = Math.max(0, Math.floor(Math.min(pay, pby, pcy)));
      const maxY = Math.min(RH - 1, Math.ceil(Math.max(pay, pby, pcy)));
      if (maxX < minX || maxY < minY) { stats.culled++; continue; }

      const mu = uvArr ? (uvArr[i0 * 2] + uvArr[i1 * 2] + uvArr[i2 * 2]) / 3 : 0.5;
      const mv = uvArr ? (uvArr[i0 * 2 + 1] + uvArr[i1 * 2 + 1] + uvArr[i2 * 2 + 1]) / 3 : 0.5;
      const mwx = (wxArr[i0] + wxArr[i1] + wxArr[i2]) / 3;
      const mwy = (wyArr[i0] + wyArr[i1] + wyArr[i2]) / 3;
      const mwz = (wzArr[i0] + wzArr[i1] + wzArr[i2]) / 3;

      const dist = (-az_ - bz - cz) / 3;
      let r, g, b, alpha;
      if (isShell) {
        const world = shellWorldThickness(mat, dist);
        if (world <= 1e-6) { stats.skippedNoOutline++; continue; }
        const u = mat.uniforms || {};
        const k = Math.max(0, Math.min(1, (dist - (u.uNearDistance ? u.uNearDistance.value : 14)) /
          Math.max((u.uFarDistance ? u.uFarDistance.value : 60) - (u.uNearDistance ? u.uNearDistance.value : 14), 0.001)));
        shellFade = 1 + ((u.uFarKeep ? u.uFarKeep.value : 0.78) - 1) * k;
        r = srgbToLinear(shellColor[0]); g = srgbToLinear(shellColor[1]); b = srgbToLinear(shellColor[2]);
        alpha = opacity * shellFade;
      } else if (shellColor) {
        r = srgbToLinear(shellColor[0]); g = srgbToLinear(shellColor[1]); b = srgbToLinear(shellColor[2]);
        alpha = opacity;
      } else if (unlit) {
        const c = mat.color || { r: 1, g: 1, b: 1 };
        let mr = c.r, mg = c.g, mb = c.b;
        let mapMask = 1;
        if (mat.map) {
          sampleMap(mat.map, mu, mv, texScratch);
          mapMask = (texScratch[0] + texScratch[1] + texScratch[2]) / 3;
        }
        r = srgbToLinear(mr); g = srgbToLinear(mg); b = srgbToLinear(mb);
        alpha = opacity * mapMask;
      } else {
        shadeLit(mat, wnx, wny, wnz, mu, mv, mwx, mwy, mwz, shadeScratch);
        r = shadeScratch[0]; g = shadeScratch[1]; b = shadeScratch[2];
        const isWaterFlow = !!(mat.userData && mat.userData.waterFlow);
        alpha = mat.transparent ? (isWaterFlow ? shadeScratch[3] : Math.min(0.88, opacity * shadeScratch[3])) : 1;
      }
      const isWaterFlow = !!(mat.userData && mat.userData.waterFlow);
      const area = (pbx - pax) * (pcy - pay) - (pby - pay) * (pcx - pax);
      if (Math.abs(area) < 1e-9) { stats.culled++; continue; }
      const invArea = 1 / area;

      for (let py = minY; py <= maxY; py++) {
        const rowOff = py * RW;
        for (let px = minX; px <= maxX; px++) {
          const pxc = px + 0.5;
          const pyc = py + 0.5;
          const w0 = ((pbx - pxc) * (pcy - pyc) - (pby - pyc) * (pcx - pxc)) * invArea;
          const w1 = ((pcx - pxc) * (pay - pyc) - (pcy - pyc) * (pax - pxc)) * invArea;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * (-az_) + w1 * (-bz) + w2 * (-cz);
          const idx = rowOff + px;
          if (z >= depth[idx]) continue;

          if (isWaterFlow) {
            const pwx = w0 * wxArr[i0] + w1 * wxArr[i1] + w2 * wxArr[i2];
            const pwy = w0 * wyArr[i0] + w1 * wyArr[i1] + w2 * wyArr[i2];
            const pwz = w0 * wzArr[i0] + w1 * wzArr[i1] + w2 * wzArr[i2];
            shadeLit(mat, wnx, wny, wnz, mu, mv, pwx, pwy, pwz, shadeScratch);
            r = shadeScratch[0]; g = shadeScratch[1]; b = shadeScratch[2];
            alpha = shadeScratch[3];

            const wWaveX = Math.sin(pwx * 9.5 + pwz * 6.2 - simSeconds * 4.8) * 4.2;
            const wWaveY = Math.cos(pwx * 7.8 - pwz * 10.4 - simSeconds * 5.6) * 4.2;
            const rpx = Math.max(0, Math.min(RW - 1, Math.round(px + wWaveX)));
            const rpy = Math.max(0, Math.min(RH - 1, Math.round(py + wWaveY)));
            const rIdx = rpy * RW + rpx;
            const bedD = depth[rIdx] < Infinity && depth[rIdx] > z ? depth[rIdx] : depth[idx];
            const wDepth = Math.max(0.09, Math.min(0.52, (bedD - z) * 0.55 + 0.08));
            const useIdx = depth[rIdx] > z ? rIdx : idx;
            const br = color[useIdx * 3], bg = color[useIdx * 3 + 1], bb = color[useIdx * 3 + 2];

            const trR = Math.exp(-wDepth * 3.8);
            const trG = Math.exp(-wDepth * 0.85);
            const trB = Math.exp(-wDepth * 1.15);
            const refrR = br * trR * 0.82 + srgbToLinear(0.14) * (1 - trR);
            const refrG = bg * trG * 1.06 + srgbToLinear(0.46) * (1 - trG);
            const refrB = bb * trB * 1.00 + srgbToLinear(0.40) * (1 - trB);

            const ia = 1 - alpha;
            color[idx * 3] = refrR * ia + r * alpha;
            color[idx * 3 + 1] = refrG * ia + g * alpha;
            color[idx * 3 + 2] = refrB * ia + b * alpha;
            objId[idx] = id;
            stats.triangles++;
            continue;
          }

          objId[idx] = id;
          if (blending === 2) {
            color[idx * 3] += r * alpha;
            color[idx * 3 + 1] += g * alpha;
            color[idx * 3 + 2] += b * alpha;
          } else if (alpha >= 0.999) {
            color[idx * 3] = r;
            color[idx * 3 + 1] = g;
            color[idx * 3 + 2] = b;
            depth[idx] = z;
          } else {
            const ia = 1 - alpha;
            color[idx * 3] = color[idx * 3] * ia + r * alpha;
            color[idx * 3 + 1] = color[idx * 3 + 1] * ia + g * alpha;
            color[idx * 3 + 2] = color[idx * 3 + 2] * ia + b * alpha;
          }
          stats.triangles++;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ 遍历与排序 */
function assetRootName(node) {
  let cur = node;
  while (cur.parent && cur.parent !== scene) cur = cur.parent;
  return cur.name || '(unnamed asset)';
}

const opaqueMeshes = [];
const blendMeshes = [];
scene.traverse((node) => {
  if (!node.visible) return;
  if (!node.isMesh) return;
  const mat = node.material;
  if (!mat) return;
  stats.meshes++;
  if (node.userData.isOutline) stats.shells++;
  const center = new THREE.Vector3();
  node.getWorldPosition(center);
  const dist = center.distanceTo(camera.position);
  const skipList = String(arg('skip', '')).split(',').filter(Boolean);
  if (skipList.includes(assetRootName(node))) return;
  const id = idInfo.length;
  idInfo.push({ asset: assetRootName(node), mesh: node.name || '(unnamed)', shell: !!node.userData.isOutline });
  if (mat.transparent) blendMeshes.push({ node, dist, id });
  else opaqueMeshes.push({ node, dist, id });
});

opaqueMeshes.sort((a, b) => a.dist - b.dist);
for (const item of opaqueMeshes) rasterMesh(item.node, item.id);

blendMeshes.sort((a, b) => b.dist - a.dist);
for (const item of blendMeshes) {
  stats.transparentMeshes++;
  rasterMesh(item.node, item.id);
}

/* ------------------------------------------------------------------ 瑞利大气天空 + 双层体积云 + 5层视差远山与千本鸟居微光 */
const hMod = ((dayHour % 24) + 24) % 24;
const nightW = Math.min(1, Math.max(0, (5.4 - hMod) / 1.6) + Math.max(0, (hMod - 19.6) / 1.8));
const blueHourW = Math.min(1, Math.exp(-Math.pow((hMod - 5.15) / 0.65, 2)) + Math.exp(-Math.pow((hMod - 18.85) / 0.65, 2)));
const goldenW = Math.min(1, Math.exp(-Math.pow((hMod - 6.25) / 1.05, 2)) + Math.exp(-Math.pow((hMod - 17.65) / 1.05, 2)));
const noonW = Math.exp(-Math.pow((hMod - 13.0) / 2.8, 2));

function evalPhysicalSkyAndMountains(rx, ry, rz, outRgb) {
  const elev = Math.max(-0.15, Math.min(1.0, ry));
  const e01 = Math.max(0, Math.min(1, elev));
  const rayGrad = Math.pow(1 - e01, 2.2);

  let sr = (0.22 + 0.04 * noonW) * (1 - rayGrad) + (0.56 + 0.10 * noonW) * rayGrad;
  let sg = (0.38 + 0.10 * noonW) * (1 - rayGrad) + (0.68 + 0.12 * noonW) * rayGrad;
  let sb = (0.48 + 0.16 * noonW) * (1 - rayGrad) + (0.66 + 0.18 * noonW) * rayGrad;

  if (goldenW > 0.001) {
    const gm = Math.pow(1 - e01, 3.0);
    const gr = 0.14 * (1 - gm) + 0.96 * gm;
    const gg = 0.24 * (1 - gm) + 0.50 * gm;
    const gb = 0.44 * (1 - gm) + 0.24 * gm;
    sr = sr * (1 - goldenW) + gr * goldenW;
    sg = sg * (1 - goldenW) + gg * goldenW;
    sb = sb * (1 - goldenW) + gb * goldenW;
  }
  if (blueHourW > 0.001) {
    const bm = Math.pow(1 - e01, 2.6);
    const br = 0.07 * (1 - bm) + 0.64 * bm;
    const bg = 0.13 * (1 - bm) + 0.34 * bm;
    const bb = 0.28 * (1 - bm) + 0.48 * bm;
    sr = sr * (1 - blueHourW * 0.88) + br * (blueHourW * 0.88);
    sg = sg * (1 - blueHourW * 0.88) + bg * (blueHourW * 0.88);
    sb = sb * (1 - blueHourW * 0.88) + bb * (blueHourW * 0.88);
  }
  if (nightW > 0.001) {
    const nr = 0.03 * (1 - rayGrad) + 0.09 * rayGrad;
    const ng = 0.06 * (1 - rayGrad) + 0.14 * rayGrad;
    const nb = 0.12 * (1 - rayGrad) + 0.22 * rayGrad;
    sr = sr * (1 - nightW) + nr * nightW;
    sg = sg * (1 - nightW) + ng * nightW;
    sb = sb * (1 - nightW) + nb * nightW;
  }

  // 深夜银河与星点
  if (nightW > 0.02 && elev > 0.02) {
    const sx = rx / (Math.abs(ry) + 0.35);
    const sz = rz / (Math.abs(ry) + 0.35);
    const galAxis = sx * 0.75 + sz * 0.65 - 0.2;
    const galBand = Math.exp(-galAxis * galAxis * 3.8) * fbm2(sx * 2.8, sz * 2.8);
    sr += 0.14 * galBand * nightW;
    sg += 0.18 * galBand * nightW;
    sb += 0.32 * galBand * nightW;
    const starSeed = hash21(Math.floor(sx * 90), Math.floor(sz * 90));
    if (starSeed > 0.97) {
      const sbright = ((starSeed - 0.97) / 0.03) * nightW;
      sr += 0.85 * sbright; sg += 0.90 * sbright; sb += 1.0 * sbright;
    }
  }

  // 双层程序化体积云
  if (elev > -0.02) {
    const spx = rx / Math.max(0.14, elev + 0.16);
    const spz = rz / Math.max(0.14, elev + 0.16);
    const c1 = fbm2(spx * 0.32 + simSeconds * 0.02, spz * 0.32);
    const cloudMask = Math.max(0, Math.min(0.75, (c1 - 0.48) * 1.8));
    const cR = goldenW > 0.2 ? 0.95 : nightW > 0.5 ? 0.18 : 0.78;
    const cG = goldenW > 0.2 ? 0.62 : nightW > 0.5 ? 0.25 : 0.84;
    const cB = goldenW > 0.2 ? 0.42 : nightW > 0.5 ? 0.36 : 0.86;
    sr = sr * (1 - cloudMask) + cR * cloudMask;
    sg = sg * (1 - cloudMask) + cG * cloudMask;
    sb = sb * (1 - cloudMask) + cB * cloudMask;
  }

  // 5层大气透视程序化远山 + 视差滚动 + 远山千本鸟居微光
  const azRay = Math.atan2(rx, -rz);
  const hzR = sr * 0.75 + 0.06, hzG = sg * 0.75 + 0.08, hzB = sb * 0.75 + 0.08;
  for (let layer = 0; layer < 5; layer++) {
    const fl = layer;
    const parallax = camera.position.x * (0.006 + fl * 0.0085);
    const theta = azRay + parallax + fl * 1.37;
    const baseH = 0.26 - fl * 0.032;
    const rNoise = fbm2(theta * (1.8 + fl * 0.85), fl * 3.7);
    const mtnTop = baseH + (0.055 - fl * 0.005) * Math.sin(theta * 2.4 + fl * 1.9) + (0.075 - fl * 0.006) * (rNoise - 0.5);
    if (elev < mtnTop) {
      const nearFactor = fl / 4.0;
      const aerialMix = 0.82 * (1 - nearFactor) + 0.18 * nearFactor;
      let lr = 0.08 * (1 - aerialMix) + hzR * aerialMix;
      let lg = 0.17 * (1 - aerialMix) + hzG * aerialMix;
      let lb = 0.11 * (1 - aerialMix) + hzB * aerialMix;
      if (layer >= 2) {
        const gx = theta * 120 + fl * 19;
        const gy = (mtnTop - elev) * 280;
        const lSeed = hash21(Math.floor(gx), Math.floor(gy));
        const dDot = Math.hypot((gx % 1 + 1) % 1 - 0.5, (gy % 1 + 1) % 1 - 0.5);
        if (lSeed > 0.95 && dDot < 0.16 && (mtnTop - elev) > 0.02 && (mtnTop - elev) < 0.08) {
          const wDot = (1 - dDot / 0.16) * (0.25 + 0.75 * Math.max(nightW, goldenW + blueHourW));
          lr += 0.36 * wDot; lg += 0.14 * wDot; lb += 0.04 * wDot;
        }
      }
      sr = lr; sg = lg; sb = lb;
    }
  }

  outRgb[0] = srgbToLinear(Math.max(0, Math.min(1, sr)));
  outRgb[1] = srgbToLinear(Math.max(0, Math.min(1, sg)));
  outRgb[2] = srgbToLinear(Math.max(0, Math.min(1, sb)));
}

const skyScratch = new Float64Array(3);
const invView = camera.matrixWorld.elements;
for (let py = 0; py < RH; py++) {
  for (let px = 0; px < RW; px++) {
    const idx = py * RW + px;
    if (depth[idx] !== Infinity) continue;
    const ndcX = ((px + 0.5) / RW) * 2 - 1;
    const ndcY = 1 - ((py + 0.5) / RH) * 2;
    let dx = (ndcX * aspect) / projScale;
    let dy = ndcY / projScale;
    let dz = -1;
    const len = Math.hypot(dx, dy, dz);
    dx /= len; dy /= len; dz /= len;
    const wx = invView[0] * dx + invView[4] * dy + invView[8] * dz;
    const wy = invView[1] * dx + invView[5] * dy + invView[9] * dz;
    const wz = invView[2] * dx + invView[6] * dy + invView[10] * dz;
    evalPhysicalSkyAndMountains(wx, wy, wz, skyScratch);
    color[idx * 3] = skyScratch[0];
    color[idx * 3 + 1] = skyScratch[1];
    color[idx * 3 + 2] = skyScratch[2];
  }
}

/* ------------------------------------------------------------------ 3D 体积雾 + 林间丁达尔体积光（God Ray）+ 调色 */
const fogBaseR = srgbToLinear(((POST.heightFog.color >> 16) & 255) / 255);
const fogBaseG = srgbToLinear(((POST.heightFog.color >> 8) & 255) / 255);
const fogBaseB = srgbToLinear((POST.heightFog.color & 255) / 255);
const grade = POST.grade;
const final = new Float32Array(W * H * 3);

for (let sy = 0; sy < H; sy++) {
  for (let sx = 0; sx < W; sx++) {
    let cr = 0, cg = 0, cb = 0;
    for (let o = 0; o < SS * SS; o++) {
      const ox = sx * SS + (o % SS);
      const oy = sy * SS + Math.floor(o / SS);
      const k = (oy * RW + ox) * 3;
      cr += color[k]; cg += color[k + 1]; cb += color[k + 2];
    }
    const n = SS * SS;
    cr /= n; cg /= n; cb /= n;

    const d = depth[(sy * SS) * RW + (sx * SS)];
    const uScreen = (sx + 0.5) / W;
    const vScreen = (sy + 0.5) / H;

    if (d !== Infinity) {
      const fogMult = weatherCode > 1.5 ? 2.6 : weatherCode > 0.5 ? 1.45 : 1.0;
      const f = Math.min(weatherCode > 1.5 ? 0.90 : 0.72, 1 - Math.exp(-0.018 * fogMult * Math.max(0, d - 2.5)));
      cr += (fogBaseR - cr) * f;
      cg += (fogBaseG - cg) * f;
      cb += (fogBaseB - cb) * f;
    }

    // 林间丁达尔体积光束（God Ray：从林冠斜射穿过鸟居与参道）
    const beamAxis = (uScreen - 0.46) * 0.78 + (vScreen - 0.18) * 0.62;
    const shaft1 = Math.exp(-Math.pow((beamAxis - 0.02) / 0.08, 2));
    const shaft2 = Math.exp(-Math.pow((beamAxis + 0.14) / 0.06, 2));
    const shaft3 = Math.exp(-Math.pow((beamAxis - 0.16) / 0.07, 2));
    const godRay = (shaft1 * 0.55 + shaft2 * 0.35 + shaft3 * 0.30) * Math.max(0, 1 - vScreen * 0.85) * (1 - nightW * 0.65);
    const rayWarmR = goldenW > 0.2 ? 1.0 : 0.72;
    const rayWarmG = goldenW > 0.2 ? 0.62 : 0.84;
    const rayWarmB = goldenW > 0.2 ? 0.28 : 0.74;
    cr += srgbToLinear(rayWarmR) * godRay * 0.14;
    cg += srgbToLinear(rayWarmG) * godRay * 0.14;
    cb += srgbToLinear(rayWarmB) * godRay * 0.14;

    cr = aces(cr * grade.exposure * grade.gain);
    cg = aces(cg * grade.exposure * grade.gain);
    cb = aces(cb * grade.exposure * grade.gain);

    cr = linearToSrgb(cr);
    cg = linearToSrgb(cg);
    cb = linearToSrgb(cb);

    const luma = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
    cr = luma + (cr - luma) * grade.saturation;
    cg = luma + (cg - luma) * grade.saturation;
    cb = luma + (cb - luma) * grade.saturation;
    cr += grade.warmth * 0.4; cg += grade.warmth * 0.08; cb -= grade.warmth * 0.35;
    cr = (cr - 0.5) * grade.contrast + 0.5;
    cg = (cg - 0.5) * grade.contrast + 0.5;
    cb = (cb - 0.5) * grade.contrast + 0.5;
    cr += grade.lift * (1 - luma);
    cg += grade.lift * (1 - luma);
    cb += grade.lift * 0.85 * (1 - luma);

    const fx = uScreen * 2 - 1;
    const fy = vScreen * 2 - 1;
    const r2 = fx * fx + fy * fy;
    const vig = 1 - grade.vignette * Math.max(0, r2 - grade.vignetteSoftness) / Math.max(1e-4, 2 - grade.vignetteSoftness);
    final[(sy * W + sx) * 3] = Math.max(0, Math.min(1, cr * vig));
    final[(sy * W + sx) * 3 + 1] = Math.max(0, Math.min(1, cg * vig));
    final[(sy * W + sx) * 3 + 2] = Math.max(0, Math.min(1, cb * vig));
  }
}

/* ------------------------------------------------------------------ PNG 输出 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function writePng(path, w, h, rgb) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w * 3; x++) {
      const v = rgb[y * w * 3 + x];
      raw[y * stride + 1 + x] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    chunks.push(len, t, data, crc);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk('IHDR', ihdr);
  chunk('IDAT', zlib.deflateSync(raw, { level: 6 }));
  chunk('IEND', Buffer.alloc(0));
  fs.writeFileSync(path, Buffer.concat(chunks));
}
writePng(outPath, W, H, final);

console.log(`=== 离线预览 ===`);
console.log(`画面 ${W}x${H}（超采样 ${SS}x -> ${RW}x${RH}）| 时刻 ${dayHour}h | 天气 ${weatherModeName} | 机位 az=${azDeg} el=${elDeg} r=${radius} | 输出 ${outPath}`);
