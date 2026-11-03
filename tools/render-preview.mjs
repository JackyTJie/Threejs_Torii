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
    const mask = Math.min(1, hFade * ma * 0.65);
    const mc = uniforms.uMossColor.value;
    mr = mr * (1 - mask) + mc.r * mask;
    mg = mg * (1 - mask) + mc.g * mask;
    mb = mb * (1 - mask) + mc.b * mask;
  }

  out[0] = srgbToLinear(mr) * lr;
  out[1] = srgbToLinear(mg) * lg;
  out[2] = srgbToLinear(mb) * lb;
  out[3] = 1;

  if (uniforms && uniforms.uTranslucencyColor) {
    const tc = uniforms.uTranslucencyColor.value;
    const str = uniforms.uTranslucencyStrength.value * 0.28;
    out[0] += srgbToLinear(tc.r) * str;
    out[1] += srgbToLinear(tc.g) * str;
    out[2] += srgbToLinear(tc.b) * str;
  }

  // 1) 水底河床与鹅卵石实时斯涅尔折射焦散（submergedCaustics）
  if (material.userData && material.userData.submergedCaustics && wxWorld < -1.15 && wxWorld > -6.0) {
    const uNorm = Math.max(0, Math.min(1, (11.6 - wzWorld) / 20.8));
    const approxWy = 0.25 + 2.95 * Math.pow(uNorm, 1.08);
    const waterDepth = Math.max(0, Math.min(0.65, approxWy - wy + 0.14));
    if (waterDepth > 0.01) {
      const n1 = fbm2(wxWorld * 2.4, wzWorld * 2.1 - simSeconds * 1.8);
      const n2 = fbm2(wxWorld * 3.8 + 4.2, wzWorld * 3.2 - simSeconds * 2.4);
      const causticNet = Math.pow(Math.max(0, (n1 * 0.6 + n2 * 0.4) - 0.44) * 2.1, 1.8);
      const absorb = 1 - Math.exp(-waterDepth * 2.2);
      // 浅水透亮保留泥土/卵石原色并叠加灵动折射焦散光网，深潭微染冷翠色
      out[0] = out[0] * (1 - absorb * 0.28) + srgbToLinear(0.46) * causticNet * 0.42;
      out[1] = out[1] * (1 + absorb * 0.08) + srgbToLinear(0.72) * causticNet * 0.48;
      out[2] = out[2] * (1 + absorb * 0.04) + srgbToLinear(0.60) * causticNet * 0.45;
    }
  }

  // 2) 清澈光学水面与瀑布流管/流体粒子着色（无规则点阵，高透底，自然菲涅尔与流线水花）
  if (material.userData && material.userData.waterFlow && uniforms) {
    const overlayMode = uniforms.uOverlayMode ? uniforms.uOverlayMode.value : 0;
    const sc = uniforms.uShallowColor.value;
    const dc = uniforms.uDeepColor.value;
    const filament = fbm2(wxWorld * 3.2, wzWorld * 1.8 - simSeconds * 2.6);
    const slopeTilt = Math.max(0, Math.min(1, (1 - Math.abs(ny)) * 4.5));

    if (overlayMode > 2.5) {
      // 物理流体粒子 / 飞沫微粒
      out[0] = srgbToLinear(0.48);
      out[1] = srgbToLinear(0.64);
      out[2] = srgbToLinear(0.58);
      out[3] = 0.65;
    } else if (overlayMode > 1.5) {
      // 漩涡回流丝
      const dx = (u - 0.5) * 2;
      const dy = (v - 0.5) * 2;
      const dist = Math.hypot(dx, dy);
      const radial = Math.max(0, Math.min(1, (1.0 - dist) / 0.72)) * Math.max(0, Math.min(1, (dist - 0.06) / 0.2));
      out[0] = srgbToLinear(0.44);
      out[1] = srgbToLinear(0.58);
      out[2] = srgbToLinear(0.52);
      out[3] = radial * Math.max(0, (filament - 0.42) * 1.6);
    } else if (overlayMode > 0.5) {
      // CatmullRomCurve3 瀑布流管水束
      const threads = Math.max(0, Math.min(1, (filament - 0.36) * 1.7));
      out[0] = srgbToLinear(sc.r * 0.45 + 0.50 * 0.55);
      out[1] = srgbToLinear(sc.g * 0.45 + 0.64 * 0.55);
      out[2] = srgbToLinear(sc.b * 0.45 + 0.58 * 0.55);
      out[3] = 0.28 + 0.56 * threads;
    } else {
      // 主清澈水面：极高通透度（直视水下河床卵石与折射焦散），仅叠加柔和菲涅尔林冠天光与跌水丝状白沫
      const vx = camera.position.x - wxWorld;
      const vy = camera.position.y - wy;
      const vz = camera.position.z - wzWorld;
      const vlen = Math.hypot(vx, vy, vz) || 1;
      const ndv = Math.abs((nx * vx + ny * vy + nz * vz) / vlen);
      const fresnel = 0.02 + 0.42 * Math.pow(1 - Math.min(1, ndv), 4.2);
      const cascadeFoam = slopeTilt * Math.max(0, (filament - 0.45) * 1.8);
      const wr = dc.r * 0.5 + sc.r * 0.5;
      const wg = dc.g * 0.5 + sc.g * 0.5;
      const wb = dc.b * 0.5 + sc.b * 0.5;
      out[0] = srgbToLinear(wr * (1 - fresnel) + 0.20 * fresnel + 0.48 * cascadeFoam);
      out[1] = srgbToLinear(wg * (1 - fresnel) + 0.34 * fresnel + 0.62 * cascadeFoam);
      out[2] = srgbToLinear(wb * (1 - fresnel) + 0.27 * fresnel + 0.56 * cascadeFoam);
      out[3] = Math.min(0.68, 0.16 + fresnel * 0.45 + cascadeFoam * 0.52);
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
