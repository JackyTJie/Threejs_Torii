// 程序化纹理库：木纹 / 风化朱漆 / 树皮 / 石材 / 泥土 / 沙石 / 叶 / 青苔 / 水面 / 薄雾
// 全部离线生成（CanvasTexture / DataTexture），不依赖外部图片资源。
import * as THREE from 'three';
import { PALETTE } from './config.js';

const cache = new Map();

function cached(key, factory) {
  if (cache.has(key)) return cache.get(key);
  const value = factory();
  // 纹理身份：贴图名 = 生成参数键。审计据此区分「只有贴图不同」的两份材质，
  // 也让调试时能一眼看出某个材质用的是哪一张程序化贴图。
  if (value) value.name = key;
  cache.set(key, value);
  return value;
}

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function toTexture(canvas, { srgb = true, repeat = 1, anisotropy = 8 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = anisotropy;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------ 噪声 */

function hash2(x, y, seed = 0) {
  let h = x * 374761393 + y * 668265263 + seed * 2246822519;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, octaves = 4, seed = 0, lacunarity = 2.0, gain = 0.5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 977) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / Math.max(norm, 1e-6);
}

/** 周期性 fbm（用于可平铺纹理） */
function tileFbm(x, y, period, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const p = period * freq;
    const nx = valueNoise((x % p) / p * 64 * freq, (y % p) / p * 64 * freq, seed + i * 613);
    sum += nx * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / Math.max(norm, 1e-6);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function rgbOf(hex) {
  return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
}

/** 逐像素写入：painter(x, y) 返回 [r,g,b] */
function fillPixels(canvas, painter) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const image = ctx.createImageData(w, h);
  const data = image.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = painter(x, y, w, h);
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return ctx;
}

/* ------------------------------------------------------------------ 三渲二渐变带 */

/** 生成卡通色阶渐变贴图（MeshToonMaterial.gradientMap） */
export function gradientMap(steps = 4) {
  return cached(`grad-${steps}`, () => {
    const n = Math.max(2, steps | 0);
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      data[i] = Math.round((i / (n - 1)) * 255 * 0.92 + 22);
    }
    const texture = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  });
}

/* ------------------------------------------------------------------ 天空 */

/** 程序化阴天天空（等距柱状投影，供背景与 PMREM 环境）：雨后云层，无太阳光晕 */
export function skyCanvas(size = 1024) {
  return cached(`sky-${size}`, () => {
    const canvas = makeCanvas(size);
    const top = rgbOf(PALETTE.skyTop);
    const mid = rgbOf(PALETTE.skyMid);
    const horizon = rgbOf(PALETTE.skyHorizon);
    fillPixels(canvas, (x, y, w, h) => {
      const u = x / w;
      const v = y / h;
      let r;
      let g;
      let b;
      if (v < 0.45) {
        const t = v / 0.45;
        r = mix(top.r, mid.r, t);
        g = mix(top.g, mid.g, t);
        b = mix(top.b, mid.b, t);
      } else {
        const t = (v - 0.45) / 0.55;
        r = mix(mid.r, horizon.r, t);
        g = mix(mid.g, horizon.g, t);
        b = mix(mid.b, horizon.b, t);
      }
      // 雨后层云：横向拉长的厚云带 + 细碎云絮，压暗顶棚、提亮地平线
      const strata = fbm(u * 3.2 + v * 0.6, v * 7.5, 4, 21);
      const wisp = fbm(u * 18, v * 26, 3, 43);
      const cloud = clamp01((strata - 0.42) * 2.1) * (1 - v * 0.55);
      const shade = cloud * 26 + (wisp - 0.5) * 9;
      const lift = Math.pow(clamp01(v - 0.62) / 0.38, 1.7) * 14;
      return [
        clampByte(r - shade + lift),
        clampByte(g - shade * 0.92 + lift),
        clampByte(b - shade * 0.78 + lift * 0.8)
      ];
    });
    return canvas;
  });
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/* ------------------------------------------------------------------ 木材 */

/** 老木料：木纹、年轮错位、结节、磕碰 */
export function woodTexture({
  size = 1024,
  base = 0x9c7b58,
  dark = 0x6b523a,
  light = 0xb08f68,
  planks = 8,
  seed = 11
} = {}) {
  return cached(`wood-${size}-${base}-${planks}-${seed}`, () => {
    const canvas = makeCanvas(size);
    const cBase = rgbOf(base);
    const cDark = rgbOf(dark);
    const cLight = rgbOf(light);
    fillPixels(canvas, (x, y, w, h) => {
      const plankIndex = Math.floor(y / (h / planks));
      const plankSeed = plankIndex * 131;
      const localY = (y % (h / planks)) / (h / planks);
      const warp = fbm(x / w * 6, plankIndex * 3.7, 4, seed + plankSeed) * 26;
      const grain = Math.sin((x / w) * 46 + warp + plankIndex * 2.1) * 0.5 + 0.5;
      const fine = fbm(x / w * 90, y / h * 8 + plankIndex * 5, 3, seed + 31);
      const seam = localY < 0.035 || localY > 0.965 ? 1 : 0;
      const knot = Math.exp(-Math.pow((x / w - hash2(plankIndex, 3, seed)) * 26, 2) - Math.pow((localY - 0.5) * 16, 2));
      let t = grain * 0.45 + fine * 0.35 + knot * 0.4;
      let r = mix(cBase.r, cLight.r, Math.max(0, t - 0.45) * 1.6);
      let g = mix(cBase.g, cLight.g, Math.max(0, t - 0.45) * 1.6);
      let b = mix(cBase.b, cLight.b, Math.max(0, t - 0.45) * 1.6);
      r = mix(r, cDark.r, Math.max(0, 0.5 - t) * 1.1 + seam * 0.75);
      g = mix(g, cDark.g, Math.max(0, 0.5 - t) * 1.1 + seam * 0.75);
      b = mix(b, cDark.b, Math.max(0, 0.5 - t) * 1.1 + seam * 0.75);
      return [clampByte(r), clampByte(g), clampByte(b)];
    });
    return toTexture(canvas, { repeat: 1 });
  });
}

/** 风化漆面：掉漆露底、雨水冲刷痕、局部青苔 */
export function weatheredPaintTexture({
  size = 1024,
  paint = 0x9c7b58,
  bare = 0x8a6f52,
  moss = 0x5d7a4a,
  seed = 23
} = {}) {
  return cached(`paint-${size}-${paint}-${seed}`, () => {
    const canvas = makeCanvas(size);
    const cPaint = rgbOf(paint);
    const cBare = rgbOf(bare);
    const cMoss = rgbOf(moss);
    fillPixels(canvas, (x, y, w, h) => {
      const v = y / h;
      const u = x / w;
      const lossField = fbm(u * 7, v * 9, 5, seed);
      const streak = fbm(u * 26, v * 2.2, 3, seed + 51);
      const bottomBias = Math.pow(1 - v, 1.6);
      const loss = clamp01(lossField * 0.7 + streak * 0.35 + bottomBias * 0.45 - 0.52);
      const mossMask = clamp01((0.62 - v) * 1.8 * (0.45 + 0.55 * fbm(u * 14, v * 16, 4, seed + 91)) - 0.28);
      let r = mix(cPaint.r, cBare.r, loss);
      let g = mix(cPaint.g, cBare.g, loss);
      let b = mix(cPaint.b, cBare.b, loss);
      r = mix(r, cMoss.r, mossMask * 0.72);
      g = mix(g, cMoss.g, mossMask * 0.72);
      b = mix(b, cMoss.b, mossMask * 0.72);
      const dust = Math.pow(v, 2.2) * 12;
      return [clampByte(r + dust), clampByte(g + dust * 0.8), clampByte(b + dust * 0.5)];
    });
    return toTexture(canvas, { repeat: 1 });
  });
}

/* ------------------------------------------------------------------ 树皮 */

export function barkTexture({ size = 512, base = 0x5a4636, crack = 0x3f3126, light = 0x7a6248, seed = 41 } = {}) {
  return cached(`bark-${size}-${base}-${seed}`, () => {
    const canvas = makeCanvas(size);
    const cBase = rgbOf(base);
    const cCrack = rgbOf(crack);
    const cLight = rgbOf(light);
    fillPixels(canvas, (x, y, w, h) => {
      const u = x / w;
      const v = y / h;
      const ridge = Math.abs(Math.sin(u * 22 + fbm(u * 4, v * 10, 4, seed) * 6));
      const crackLine = Math.pow(1 - ridge, 6);
      const plate = fbm(u * 16, v * 40, 4, seed + 7);
      const t = clamp01(plate * 0.6 + ridge * 0.4);
      let r = mix(cBase.r, cLight.r, Math.max(0, t - 0.55) * 1.8);
      let g = mix(cBase.g, cLight.g, Math.max(0, t - 0.55) * 1.8);
      let b = mix(cBase.b, cLight.b, Math.max(0, t - 0.55) * 1.8);
      r = mix(r, cCrack.r, crackLine * 0.85);
      g = mix(g, cCrack.g, crackLine * 0.85);
      b = mix(b, cCrack.b, crackLine * 0.85);
      return [clampByte(r), clampByte(g), clampByte(b)];
    });
    return toTexture(canvas, { repeat: 1 });
  });
}

/* ------------------------------------------------------------------ 石材 / 砾石 */

/** 碎石 / 参道砾石：粗颗粒 + 尘土 */
export function gravelTexture({ size = 1024, stone = 0x8b8578, dust = 0xa39a8a, shade = 0x6f6a5f, density = 26 } = {}) {
  return cached(`gravel-${size}-${density}`, () => {
    const canvas = makeCanvas(size);
    const cStone = rgbOf(stone);
    const cDust = rgbOf(dust);
    const cShade = rgbOf(shade);
    fillPixels(canvas, (x, y, w, h) => {
      const cell = density;
      const cx = Math.floor((x / w) * cell);
      const cy = Math.floor((y / h) * cell);
      const fx = (x / w) * cell - cx;
      const fy = (y / h) * cell - cy;
      const jitterX = (hash2(cx, cy, 3) - 0.5) * 0.4;
      const jitterY = (hash2(cx, cy, 9) - 0.5) * 0.4;
      const dx = fx - 0.5 - jitterX;
      const dy = fy - 0.5 - jitterY;
      const r = Math.hypot(dx, dy);
      const radius = 0.28 + hash2(cx, cy, 17) * 0.16;
      const inside = r < radius ? 1 : 0;
      const facet = hash2(Math.floor(cx * 3 + fx * 3), Math.floor(cy * 3 + fy * 3), 23);
      const shadeK = inside ? 0.72 + facet * 0.5 : 0.42 + fbm(x / w * 12, y / h * 12, 4, 5) * 0.3;
      const dustMask = clamp01(1 - inside * 0.9) * clamp01(fbm(x / w * 8, y / h * 8, 4, 71) * 1.1 - 0.25);
      let rC = mix(cShade.r, cStone.r, shadeK);
      let gC = mix(cShade.g, cStone.g, shadeK);
      let bC = mix(cShade.b, cStone.b, shadeK);
      rC = mix(rC, cDust.r, dustMask * 0.55);
      gC = mix(gC, cDust.g, dustMask * 0.55);
      bC = mix(bC, cDust.b, dustMask * 0.55);
      return [clampByte(rC), clampByte(gC), clampByte(bC)];
    });
    return toTexture(canvas, { repeat: 1 });
  });
}

export function stoneTexture({ size = 512, base = 0x8d8b84, dark = 0x6c6a64, light = 0xa8a69d, seed = 13 } = {}) {
  return cached(`stone-${size}-${base}-${seed}`, () => {
    const canvas = makeCanvas(size);
    const cBase = rgbOf(base);
    const cDark = rgbOf(dark);
    const cLight = rgbOf(light);
    fillPixels(canvas, (x, y, w, h) => {
      const u = x / w;
      const v = y / h;
      const n = fbm(u * 10, v * 10, 5, seed);
      const vein = Math.abs(Math.sin((u + v) * 14 + n * 5));
      const t = clamp01(n * 0.7 + (1 - vein) * 0.3);
      let r = mix(cDark.r, cLight.r, t);
      let g = mix(cDark.g, cLight.g, t);
      let b = mix(cDark.b, cLight.b, t);
      const speck = hash2(Math.floor(u * 220), Math.floor(v * 220), seed + 5) > 0.965 ? 18 : 0;
      return [clampByte(r + speck), clampByte(g + speck), clampByte(b + speck)];
    });
    return toTexture(canvas, { repeat: 1 });
  });
}

/* ------------------------------------------------------------------ 泥土 / 沙石 */

/** 参道侧泥土地：潮湿深泥 + 碎石 + 碎落叶 + 凹凸肌理 */
export function soilTexture({
  size = 1024,
  base = PALETTE.soil,
  dark = PALETTE.soilDark,
  wet = PALETTE.soilWet,
  stone = PALETTE.stoneDark,
  litter = PALETTE.groundLeafDeep,
  seed = 101
} = {}) {
  return cached(`soil-${size}-${seed}`, () => {
    const canvas = makeCanvas(size);
    const cBase = rgbOf(base);
    const cDark = rgbOf(dark);
    const cWet = rgbOf(wet);
    const cStone = rgbOf(stone);
    const cLitter = rgbOf(litter);
    fillPixels(canvas, (x, y, w, h) => {
      const u = x / w;
      const v = y / h;
      const clod = fbm(u * 9, v * 9, 5, seed);
      const fine = fbm(u * 64, v * 64, 3, seed + 11);
      const damp = clamp01(fbm(u * 4.5, v * 4.5, 4, seed + 31) * 1.25 - 0.28);
      const cell = 42;
      const cx = Math.floor(u * cell);
      const cy = Math.floor(v * cell);
      const grit = hash2(cx, cy, seed + 5) > 0.82 ? 1 : 0;
      const gritFacet = hash2(cx * 3 + 1, cy * 3 + 2, seed + 7);
      const leafBit = clamp01(fbm(u * 22, v * 18, 3, seed + 61) - 0.66) * 2.6;
      let r = mix(cBase.r, cDark.r, clamp01(0.62 - clod) * 1.5);
      let g = mix(cBase.g, cDark.g, clamp01(0.62 - clod) * 1.5);
      let b = mix(cBase.b, cDark.b, clamp01(0.62 - clod) * 1.5);
      const bump = (clod - 0.5) * 22 + (fine - 0.5) * 11;
      r += bump; g += bump * 0.95; b += bump * 0.85;
      if (grit) {
        const k = 0.35 + gritFacet * 0.45;
        r = mix(r, cStone.r * k, 0.5); g = mix(g, cStone.g * k, 0.5); b = mix(b, cStone.b * k, 0.5);
      }
      r = mix(r, cLitter.r, leafBit * 0.55); g = mix(g, cLitter.g, leafBit * 0.55); b = mix(b, cLitter.b, leafBit * 0.55);
      r = mix(r, cWet.r, damp * 0.42); g = mix(g, cWet.g, damp * 0.42); b = mix(b, cWet.b, damp * 0.42);
      return [clampByte(r), clampByte(g), clampByte(b)];
    });
    return toTexture(canvas, { repeat: 1 });
  });
}

/** 溪底沙石：细砂 + 卵石颗粒 + 水流冲刷条纹 */
export function sandTexture({
  size = 1024,
  base = PALETTE.streamSand,
  dark = PALETTE.streamBed,
  stone = PALETTE.stone,
  seed = 113
} = {}) {
  return cached(`sand-${size}-${seed}`, () => {
    const canvas = makeCanvas(size);
    const cBase = rgbOf(base);
    const cDark = rgbOf(dark);
    const cStone = rgbOf(stone);
    fillPixels(canvas, (x, y, w, h) => {
      const u = x / w;
      const v = y / h;
      const flow = Math.sin(v * 34 + fbm(u * 5, v * 3, 4, seed) * 7) * 0.5 + 0.5;
      const grain = fbm(u * 110, v * 110, 3, seed + 17);
      const bed = fbm(u * 7, v * 7, 4, seed + 37);
      const pebble = hash2(Math.floor(u * 64), Math.floor(v * 64), seed + 23);
      const pebbleMask = pebble > 0.9 ? 1 : 0;
      let r = mix(cDark.r, cBase.r, clamp01(bed * 0.8 + flow * 0.3));
      let g = mix(cDark.g, cBase.g, clamp01(bed * 0.8 + flow * 0.3));
      let b = mix(cDark.b, cBase.b, clamp01(bed * 0.8 + flow * 0.3));
      const sparkle = (grain - 0.5) * 26;
      r += sparkle; g += sparkle * 0.96; b += sparkle * 0.88;
      if (pebbleMask) {
        const k = 0.7 + pebble * 0.5;
        r = mix(r, cStone.r * k, 0.62); g = mix(g, cStone.g * k, 0.62); b = mix(b, cStone.b * k, 0.62);
      }
      return [clampByte(r), clampByte(g), clampByte(b)];
    });
    return toTexture(canvas, { repeat: 1 });
  });
}

/* ------------------------------------------------------------------ 叶 / 青苔 */

export function leafTexture({ size = 256, base = 0xc4562f, edge = 0x8f3a20, vein = 0xe0a03a, lobes = 5 } = {}) {
  return cached(`leaf-${size}-${base}-${lobes}`, () => {
    const canvas = makeCanvas(size);
    const cBase = rgbOf(base);
    const cEdge = rgbOf(edge);
    const cVein = rgbOf(vein);
    fillPixels(canvas, (x, y, w, h) => {
      const u = (x / w) * 2 - 1;
      const v = (y / h) * 2 - 1;
      const angle = Math.atan2(v, u);
      const radius = Math.hypot(u, v);
      const lobe = 0.78 + 0.2 * Math.cos(angle * lobes);
      const inside = radius < lobe ? 1 : 0;
      const edgeBand = clamp01((lobe - radius) / 0.16);
      const veinLine = Math.abs(u) < 0.035 || Math.abs(Math.sin(v * 6 + 1.2) * 0.12 - u) < 0.02 ? 1 : 0;
      const dry = fbm(x / w * 12, y / h * 12, 4, 19);
      const t = clamp01(1 - edgeBand);
      let r = mix(cEdge.r, cBase.r, t);
      let g = mix(cEdge.g, cBase.g, t);
      let b = mix(cEdge.b, cBase.b, t);
      r = mix(r, cVein.r, veinLine * 0.55);
      g = mix(g, cVein.g, veinLine * 0.55);
      b = mix(b, cVein.b, veinLine * 0.55);
      const dryMask = clamp01(dry - 0.6) * 1.8;
      r = mix(r, cEdge.r * 0.8, dryMask);
      g = mix(g, cEdge.g * 0.8, dryMask);
      b = mix(b, cEdge.b * 0.8, dryMask);
      const a = inside;
      return a ? [clampByte(r), clampByte(g), clampByte(b)] : [0, 0, 0];
    });
    return toTexture(canvas, { repeat: 1 });
  });
}

export function mossTexture({ size = 512, base = 0x5d7a4a, wet = 0x46603a, seed = 71 } = {}) {
  return cached(`moss-${size}-${seed}`, () => {
    const canvas = makeCanvas(size);
    const cBase = rgbOf(base);
    const cWet = rgbOf(wet);
    fillPixels(canvas, (x, y, w, h) => {
      const u = x / w;
      const v = y / h;
      const tuft = fbm(u * 30, v * 30, 4, seed);
      const damp = fbm(u * 7, v * 7, 3, seed + 17);
      const t = clamp01(tuft * 1.2 - 0.25);
      const r = mix(cWet.r, cBase.r, t);
      const g = mix(cWet.g, cBase.g, t);
      const b = mix(cWet.b, cBase.b, t);
      const speck = hash2(Math.floor(u * 160), Math.floor(v * 160), seed) > 0.94 ? 14 : 0;
      return [clampByte(r + speck), clampByte(g + speck * 0.8), clampByte(b + speck * 0.5)];
    });
    return toTexture(canvas, { repeat: 1 });
  });
}

/* ------------------------------------------------------------------ 水 / 薄雾 */

/** 水面焦散 / 流动纹（作为 roughnessMap 与细节叠加） */
export function waterDetailTexture({ size = 512, seed = 97 } = {}) {
  return cached(`water-${size}-${seed}`, () => {
    const canvas = makeCanvas(size);
    fillPixels(canvas, (x, y, w, h) => {
      const u = x / w;
      const v = y / h;
      const ripple = Math.sin(u * 26 + fbm(u * 4, v * 4, 4, seed) * 5) * 0.5 + 0.5;
      const ripple2 = Math.sin(v * 19 - fbm(u * 5, v * 5, 4, seed + 9) * 4) * 0.5 + 0.5;
      const caustic = Math.pow(clamp01(ripple * ripple2 * 1.6 - 0.25), 1.6);
      const val = clampByte(120 + caustic * 135);
      return [val, val, val];
    });
    return toTexture(canvas, { srgb: false, repeat: 1 });
  });
}

/** 尘埃粒子精灵（软圆点，低不透明度） */
/** 林间薄雾幕：横向拉伸的浓淡絮状遮罩（alphaMap，灰度） */
export function mistVeilTexture({ size = 512, seed = 131 } = {}) {
  return cached(`mist-${size}-${seed}`, () => {
    const canvas = makeCanvas(size);
    fillPixels(canvas, (x, y, w, h) => {
      const u = x / w;
      const v = y / h;
      const band = fbm(u * 2.4, v * 11, 4, seed);
      const wisp = fbm(u * 9, v * 30, 3, seed + 19);
      const soft = 1 - Math.pow(Math.abs(v - 0.5) * 2, 2.2);
      const veil = clamp01((band * 0.72 + wisp * 0.34 - 0.34) * 1.9) * clamp01(soft * 1.25);
      const val = clampByte(30 + veil * 205);
      return [val, val, val];
    });
    return toTexture(canvas, { srgb: false, repeat: 1 });
  });
}

/** 通用灰度噪声（roughnessMap / bumpMap 用） */
export function noiseTexture({ size = 512, scale = 12, octaves = 4, seed = 5, contrast = 1 } = {}) {
  return cached(`noise-${size}-${scale}-${octaves}-${seed}-${contrast}`, () => {
    const canvas = makeCanvas(size);
    fillPixels(canvas, (x, y, w, h) => {
      const n = fbm((x / w) * scale, (y / h) * scale, octaves, seed);
      const v = clampByte(128 + (n - 0.5) * 255 * contrast);
      return [v, v, v];
    });
    return toTexture(canvas, { srgb: false, repeat: 1 });
  });
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export { cached as cachedTexture, fbm, valueNoise, hash2, toTexture, makeCanvas };
