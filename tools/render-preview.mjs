#!/usr/bin/env node
// S9.8 视觉排查：离线软件光栅化预览（支持 CanvasTexture 采样、三渲二色阶、水下折射焦散、光学清溪与超采样抗锯齿）
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
const { CAMERA, LIGHT, PALETTE, POST, TOON_BANDS, OUTLINE } = await import('../js/config.js');
const { DOF_FOCUS } = await import('../js/layout.js');

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
const dofOn = arg('dof', '1') !== '0';
const showShells = arg('shells', '1') !== '0';
const outPath = arg('out', '/tmp/preview.png');

/* ------------------------------------------------------------------ 场景 */
const scene = createScene({ environment: false });
const lighting = createLighting(scene);
const materials = createMaterialLibrary();
const assembly = assembleScene(scene, materials);

for (let i = 0; i < Math.round(simSeconds * 60); i++) stepAnimations(1 / 60);
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
const SUN = rgbOf(LIGHT.sunColor).map(srgbToLinear);
const RIM = rgbOf(LIGHT.rimColor).map(srgbToLinear);
const AMB = rgbOf(LIGHT.ambientColor).map(srgbToLinear);
const HEMI_SKY = rgbOf(LIGHT.hemiSky).map(srgbToLinear);
const HEMI_GROUND = rgbOf(LIGHT.hemiGround).map(srgbToLinear);
const FOG = rgbOf(LIGHT.fogColor).map(srgbToLinear);

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
  const key = toonRamp(ndl, steps) * LIGHT.sunIntensity;
  const ndlRim = nx * (-rimTravel.x) + ny * (-rimTravel.y) + nz * (-rimTravel.z);
  const rim = toonRamp(ndlRim, steps) * LIGHT.rimIntensity * 0.6;
  const hemiMix = 0.5 + 0.5 * ny;
  const metal = material.metalness || 0;
  const diffuse = 1 - metal * 0.65;

  let lr = AMB[0] * LIGHT.ambientIntensity + HEMI_SKY[0] * hemiMix * LIGHT.hemiIntensity +
    HEMI_GROUND[0] * (1 - hemiMix) * LIGHT.hemiIntensity;
  let lg = AMB[1] * LIGHT.ambientIntensity + HEMI_SKY[1] * hemiMix * LIGHT.hemiIntensity +
    HEMI_GROUND[1] * (1 - hemiMix) * LIGHT.hemiIntensity;
  let lb = AMB[2] * LIGHT.ambientIntensity + HEMI_SKY[2] * hemiMix * LIGHT.hemiIntensity +
    HEMI_GROUND[2] * (1 - hemiMix) * LIGHT.hemiIntensity;
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
  if (uniforms && uniforms.uMossColor && wy !== undefined) {
    const mh = uniforms.uMossHeight.value;
    const mbd = Math.max(0.001, uniforms.uMossBand.value);
    const ma = uniforms.uMossAmount.value;
    const hFade = Math.max(0, Math.min(1, 1 - (wy - mh) / mbd));
    const organic = fbm2(wxWorld * 4.2, wzWorld * 4.2);
    const topFacing = Math.max(0, Math.min(1, (ny - 0.48) / 0.34));
    const topPatch = Math.max(0, Math.min(1, (organic + topFacing * 0.16 - 0.46) / 0.26)) * topFacing;
    const baseMask = hFade * Math.max(0, Math.min(1, (organic - 0.45) / 0.30)) * 0.38;
    const mask = Math.min(0.72, Math.max(baseMask, topPatch * 0.85) * ma);
    const mc = uniforms.uMossColor.value;
    mr = mr * (1 - mask) + mc.r * 1.05 * mask;
    mg = mg * (1 - mask) + mc.g * 1.12 * mask;
    mb = mb * (1 - mask) + mc.b * 0.92 * mask;

    // 鸟居三段式真实风化与深暗朱漆受光暖橙/阴影深红褐调制（与 WebGL uToriiMode 1:1 对齐）
    if (uniforms.uToriiMode && uniforms.uToriiMode.value > 0.5) {
      const hLocal = wy - mh;
      const sunFacing = Math.max(0, Math.min(1, (ndl + 0.15) / 0.70));
      // 受光处偏暖橙朱砂，背阴处偏深暗红褐
      const warmR = mr * 1.10 + 0.05, warmG = mg * 1.08 + 0.032, warmB = mb * 0.86;
      const coolR = mr * 0.62, coolG = mg * 0.48, coolB = mb * 0.52;
      mr = coolR + (warmR - coolR) * sunFacing;
      mg = coolG + (warmG - coolG) * sunFacing;
      mb = coolB + (warmB - coolB) * sunFacing;

      // 1) 柱底雨水溅射、泥土接触发黑与漆面剥落露出竖向深褐木纹（hLocal < 0.78m）
      const baseSplash = Math.max(0, Math.min(1, 1 - (hLocal - 0.08) / 0.70));
      const woodGrain = fbm2(wxWorld * 18.0, wy * 3.8 + wzWorld * 18.0);
      const peelMask = baseSplash * Math.max(0, Math.min(1, (woodGrain + (1 - hLocal) * 0.35 - 0.30) / 0.32));
      const bareR = 0.15 + (0.28 - 0.15) * woodGrain;
      const bareG = 0.10 + (0.19 - 0.10) * woodGrain;
      const bareB = 0.08 + (0.13 - 0.08) * woodGrain;
      mr = mr * (1 - peelMask * 0.88) + bareR * (peelMask * 0.88);
      mg = mg * (1 - peelMask * 0.88) + bareG * (peelMask * 0.88);
      mb = mb * (1 - peelMask * 0.88) + bareB * (peelMask * 0.88);
      const mudDark = Math.max(0, Math.min(1, 1 - hLocal / 0.42)) * (0.48 + 0.35 * organic);
      mr *= (1 - mudDark * 0.58);
      mg *= (1 - mudDark * 0.58);
      mb *= (1 - mudDark * 0.58);

      // 2) 腰部常年游客触碰区（0.95m ~ 1.72m）：漆面更光滑温润、色泽稍亮
      const waistTouch = Math.max(0, Math.min(1, (hLocal - 0.82) / 0.33)) * Math.max(0, Math.min(1, 1 - (hLocal - 1.48) / 0.40));
      mr = mr * (1 + 0.18 * waistTouch) + 0.032 * waistTouch * sunFacing;
      mg = mg * (1 + 0.16 * waistTouch) + 0.018 * waistTouch * sunFacing;
      mb = mb * (1 + 0.10 * waistTouch) + 0.008 * waistTouch * sunFacing;

      // 3) 顶部笠木与高处横梁重度积灰与深绿厚苔（hLocal > 3.25m）
      const topZone = Math.max(0, Math.min(1, (hLocal - 3.25) / 0.90));
      const capUp = Math.max(0, Math.min(1, (ny - 0.15) / 0.60));
      const heavyMoss = topZone * capUp * Math.max(0, Math.min(1, (organic - 0.24) / 0.38));
      mr = mr * (1 - topZone * 0.42) + 0.22 * (topZone * 0.42);
      mg = mg * (1 - topZone * 0.42) + 0.24 * (topZone * 0.42);
      mb = mb * (1 - topZone * 0.42) + 0.20 * (topZone * 0.42);
      mr = mr * (1 - heavyMoss * 0.82) + mc.r * 0.95 * (heavyMoss * 0.82);
      mg = mg * (1 - heavyMoss * 0.82) + mc.g * 1.05 * (heavyMoss * 0.82);
      mb = mb * (1 - heavyMoss * 0.82) + mc.b * 0.85 * (heavyMoss * 0.82);
    }
  }

  out[0] = srgbToLinear(mr) * lr;
  out[1] = srgbToLinear(mg) * lg;
  out[2] = srgbToLinear(mb) * lb;
  out[3] = 1;

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

  // 1) 水底河床与鹅卵石实时斯涅尔折射焦散（submergedCaustics：仅严格低于水面的部分生效）
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

  // 2) 分区水动力学清澈山涧 + 树木/朱红鸟居波光倒影 + 迎石激浪/八字分流/小瀑布水跃/卡门涡街漩涡
  if (material.userData && material.userData.waterFlow && uniforms) {
    const overlayMode = uniforms.uOverlayMode ? uniforms.uOverlayMode.value : 0;
    const sc = uniforms.uShallowColor.value;
    const dc = uniforms.uDeepColor.value;
    const hz = evaluateHydroZone(wxWorld, wzWorld);
    const slopeTilt = Math.max(0, Math.min(1, (1 - Math.abs(ny)) * 4.8));

    if (overlayMode > 0.5 && overlayMode < 1.5) {
      // 小瀑布跌水与迎石分流丝缕水线（平缓深潭处自动消隐）
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

      // 分区微表面波浪法线：平缓深潭极其澄澈平滑（amp 0.04），湍流与分流区呈现细腻V字波纹与漩涡切向涟漪
      const rippleAmp = 0.045 + 0.14 * Math.min(1, (hz.speed - 0.55) / 1.4) + 0.10 * hz.splitShear + 0.08 * Math.abs(hz.vorticity);
      const wnx = nx + Math.sin(wxWorld * 10.5 - hz.dirX * simSeconds * 6.0 + wzWorld * 5.2) * rippleAmp;
      const wnz = nz + Math.cos(wxWorld * 7.8 - wzWorld * 11.4 - simSeconds * 5.8) * rippleAmp;
      const wlen = Math.hypot(wnx, ny, wnz) || 1;
      const mnx = wnx / wlen, mny = ny / wlen, mnz = wnz / wlen;

      const ndv = Math.max(0.02, Math.abs(mnx * vxN + mny * vyN + mnz * vzN));
      const fresnel = Math.min(0.76, 0.04 + 0.70 * Math.pow(1 - ndv, 3.4));

      // 反射向量 R = reflect(-V, N)
      const dotVN = vxN * mnx + vyN * mny + vzN * mnz;
      const rx = 2 * dotVN * mnx - vxN;
      const ry = Math.max(0.08, Math.abs(2 * dotVN * mny - vyN));
      const rz = 2 * dotVN * mnz - vzN;

      // 森林树冠倒影与朱红色鸟居倒影光追
      const foliage = fbm2(wxWorld * 1.4 + rx * 2.5, wzWorld * 1.4 + rz * 2.5);
      let envR = 0.08 + 0.24 * foliage * (0.4 + 0.6 * sunLit);
      let envG = 0.22 + 0.38 * foliage * (0.4 + 0.6 * sunLit);
      let envB = 0.12 + 0.18 * foliage * (0.4 + 0.6 * sunLit);

      // 特定角度反射朱红鸟居（当视线/波面朝向鸟居方位时呈现破碎的朱红波光倒影）
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

      // 1) 迎石驻波水花与小瀑布跌水水跃白沫（仅在岩石迎水面与瀑布落水潭激荡出晶莹水花）
      const foamNoise = fbm2(wxWorld * 6.8 - hz.dirX * simSeconds * 4.5, wzWorld * 6.8 - hz.dirZ * simSeconds * 4.5);
      const splashFoam = Math.min(0.88, (hz.splash * 1.15 + hz.cascadeMask * 0.55) * (0.55 + 0.65 * foamNoise));

      // 2) 岩石两侧八字分流V字波纹与石后卡门涡街漩涡丝缕
      const splitChevron = hz.splitShear * Math.max(0, Math.sin(wxWorld * 22.0 + wzWorld * 14.0 - simSeconds * 9.5)) * 0.42;
      const vortexAngle = Math.atan2(wzWorld * 3.2, wxWorld * 3.2) + simSeconds * 3.8 * Math.sign(hz.vorticity || 1);
      const eddySwirl = Math.abs(hz.vorticity) * Math.max(0, Math.sin(vortexAngle * 2.0 + foamNoise * 5.0)) * 0.48;
      const whitewater = Math.min(0.85, splashFoam + splitChevron + eddySwirl);

      // 3) 阳光直射处的粼粼波光（Solar Glitter）
      const hx = vxN + toSun.x, hy = vyN + toSun.y, hzSun = vzN + toSun.z;
      const hlen = Math.hypot(hx, hy, hzSun) || 1;
      const ndh = Math.max(0, (mnx * hx + mny * hy + mnz * hzSun) / hlen);
      const waveGlintField = fbm2(wxWorld * 9.5 + simSeconds * 1.4, wzWorld * 8.2 - simSeconds * 2.6);
      const sparkle = Math.pow(Math.max(0, (waveGlintField - 0.53) * 2.35), 2.1);
      const glint = (Math.pow(ndh, 36) * 1.25 + sparkle * (1.25 + 0.55 * hz.speed)) * sunLit;

      const wr = sc.r * 0.65 + dc.r * 0.35;
      const wg = sc.g * 0.65 + dc.g * 0.35;
      const wb = sc.b * 0.65 + dc.b * 0.35;
      const shadeMod = 0.68 + 0.42 * sunLit;

      let baseR = (srgbToLinear(wr * (1 - fresnel) + envR * fresnel) + glint * 1.15) * shadeMod;
      let baseG = (srgbToLinear(wg * (1 - fresnel) + envG * fresnel) + glint * 1.10) * shadeMod;
      let baseB = (srgbToLinear(wb * (1 - fresnel) + envB * fresnel) + glint * 0.92) * shadeMod;

      // 叠加迎石激浪/瀑布水跃/漩涡晶莹泡沫色
      out[0] = baseR * (1 - whitewater * 0.68) + srgbToLinear(0.86) * (whitewater * 0.68);
      out[1] = baseG * (1 - whitewater * 0.68) + srgbToLinear(0.95) * (whitewater * 0.68);
      out[2] = baseB * (1 - whitewater * 0.68) + srgbToLinear(0.93) * (whitewater * 0.68);
      out[3] = Math.min(0.74, (0.18 + fresnel * 0.34 + whitewater * 0.38 + Math.min(0.28, glint * 0.38)) * (0.85 + 0.15 * slopeTilt));
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

            // 采样屏幕空间折射河床与真实水深（1:1 对应 WebGL WATER_FLOW_FRAG 折射与冷翠消光）
            const wWaveX = Math.sin(pwx * 9.5 + pwz * 6.2 - simSeconds * 4.8) * 4.2;
            const wWaveY = Math.cos(pwx * 7.8 - pwz * 10.4 - simSeconds * 5.6) * 4.2;
            const rpx = Math.max(0, Math.min(RW - 1, Math.round(px + wWaveX)));
            const rpy = Math.max(0, Math.min(RH - 1, Math.round(py + wWaveY)));
            const rIdx = rpy * RW + rpx;
            const bedD = depth[rIdx] < Infinity && depth[rIdx] > z ? depth[rIdx] : depth[idx];
            const wDepth = Math.max(0.09, Math.min(0.52, (bedD - z) * 0.55 + 0.08));
            const useIdx = depth[rIdx] > z ? rIdx : idx;
            const br = color[useIdx * 3], bg = color[useIdx * 3 + 1], bb = color[useIdx * 3 + 2];

            // 清澈冷翠水体消光（全河宽具备饱满清澈的冷翠水色，同时透出泥沙、卵石与树影明暗）
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

/* ------------------------------------------------------------------ 天空（采样 scene.background 幽深森林群山全景图） */
const skyScratch = new Float64Array(3);
const skyTex = scene.background;
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
    const wx = viewEls[0] * dx + viewEls[1] * dy + viewEls[2] * dz;
    const wy = viewEls[4] * dx + viewEls[5] * dy + viewEls[6] * dz;
    const wz = viewEls[8] * dx + viewEls[9] * dy + viewEls[10] * dz;
    const u = Math.atan2(wz, wx) / (Math.PI * 2) + 0.5;
    const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, wy))) / Math.PI;
    sampleMap(skyTex, u, v, skyScratch);
    color[idx * 3] = srgbToLinear(skyScratch[0]);
    color[idx * 3 + 1] = srgbToLinear(skyScratch[1]);
    color[idx * 3 + 2] = srgbToLinear(skyScratch[2]);
  }
}

/* ------------------------------------------------------------------ 雾 + 色调压缩 + 调色 */
const fogK = LIGHT.fogDensity * LIGHT.fogDensity;
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
    if (d !== Infinity) {
      const f = 1 - Math.exp(-fogK * d * d);
      cr += (FOG[0] - cr) * f;
      cg += (FOG[1] - cg) * f;
      cb += (FOG[2] - cb) * f;
    }

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

    const fx = ((sx + 0.5) / W) * 2 - 1;
    const fy = ((sy + 0.5) / H) * 2 - 1;
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
console.log(`画面 ${W}x${H}（超采样 ${SS}x -> ${RW}x${RH}）| 机位 az=${azDeg} el=${elDeg} r=${radius} target=(${target.x}, ${target.y}, ${target.z}) | 输出 ${outPath}`);
