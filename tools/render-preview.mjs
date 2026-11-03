#!/usr/bin/env node
// S9.8 视觉排查：离线软件光栅化预览（不连浏览器、不需要 WebGL / socket）
//
// 为什么需要它：本沙箱不允许创建 socket，起不了本地 http 服务，浏览器里看不到画面。
// 于是把 js/scene-assembly.js 建出的真实场景（含全部描边壳体）在 Node 里做 z-buffer
// 光栅化输出 PNG，用来肉眼检查：穿模 / 描边断裂 / 材质配色错误 / 锯齿 / 动画过量。
//
// 它不是渲染器的替代品：没有阴影贴图、没有折射、没有完整 PBR、没有辉光；
// 抗锯齿用 SS x SS 超采样近似（真实管线是 MSAA + 描边壳体）。
// 它保证的是「摆位、朝向、壳体厚度、配色、层次」肉眼可查。
//
// 用法：
//   node tools/render-preview.mjs                         # 默认机位（CAMERA 默认值）
//   node tools/render-preview.mjs --az 205 --el 16 --r 14 --out /tmp/near.png
//   node tools/render-preview.mjs --el 78 --r 46 --out /tmp/top.png   # 俯视底座
//   node tools/render-preview.mjs --ss 3 --w 1600 --h 900 --dof 0
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
const W = Number(arg('w', 1280));
const H = Number(arg('h', 720));
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
const simSeconds = Number(arg('sim', 8));
const dofOn = arg('dof', '1') !== '0';
const showShells = arg('shells', '1') !== '0';
const outPath = arg('out', '/tmp/preview.png');

/* ------------------------------------------------------------------ 场景 */
const scene = createScene({ environment: false });
const lighting = createLighting(scene);
const materials = createMaterialLibrary();
const assembly = assembleScene(scene, materials);

// 推进动画若干秒：落叶在空中、水面有波形、枝叶偏离静止位（排查动画过量）
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
// 自检：注视点必须落在视图空间 (0, 0, -radius)，否则整套投影都是错的
{
  const t = new THREE.Vector3(target.x, target.y, target.z).applyMatrix4(viewMat);
  const err = Math.hypot(t.x, t.y, t.z + camera.position.distanceTo(target));
  if (err > 1e-6) throw new Error(`render-preview: 视图矩阵自检失败 (err=${err})`);
}

const projScale = 1 / Math.tan((camera.fov * DEG) / 2);
const aspect = RW / RH;

/* ------------------------------------------------------------------ 矩阵工具 */
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
// 每个像素属于哪个网格（S9.8 排查「谁把谁挡住了 / 壳体吞掉构件」）
const objId = new Int32Array(RW * RH).fill(-1);
const idInfo = [];

/* ------------------------------------------------------------------ 光照 */
const sunTravel = lighting.sunDirection; // 太阳 -> 场景
const toSun = { x: -sunTravel.x, y: -sunTravel.y, z: -sunTravel.z };
const rimTravel = (() => {
  const azr = LIGHT.rimAzimuthDeg * DEG;
  const elr = LIGHT.rimElevationDeg * DEG;
  return { x: -Math.cos(azr) * Math.cos(elr), y: -Math.sin(elr), z: -Math.sin(azr) * Math.cos(elr) };
})();
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
/** ACES 近似（与 RENDER.toneMapping = ACESFilmicToneMapping 同向） */
function aces(x) {
  const v = Math.max(0, x);
  return (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
}
const rgbOf = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const SUN = rgbOf(LIGHT.sunColor).map(srgbToLinear);
const HEMI_SKY_L = rgbOf(LIGHT.hemiSky);
const HEMI_GROUND_L = rgbOf(LIGHT.hemiGround);
const RIM = rgbOf(LIGHT.rimColor);
const AMB = rgbOf(LIGHT.ambientColor);
const HEMI_SKY = rgbOf(LIGHT.hemiSky).map(srgbToLinear);
const HEMI_GROUND = rgbOf(LIGHT.hemiGround).map(srgbToLinear);
const FOG = rgbOf(LIGHT.fogColor).map(srgbToLinear);
const OUTLINE_RGB = rgbOf(OUTLINE.color).map(srgbToLinear);

/** 卡通色阶：半兰伯特 -> gradientMap 取值（与 js/textures.js 的 gradientMap 同式） */
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

/* ------------------------------------------------------------------ 统计 */
const stats = {
  meshes: 0, shells: 0, instanced: 0, triangles: 0, culled: 0,
  skippedShader: 0, skippedNoOutline: 0, transparentMeshes: 0, additiveMeshes: 0, points: 0
};

/* ------------------------------------------------------------------ 着色 */
function shadeLit(material, nx, ny, nz, out) {
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
  out[0] = srgbToLinear(c.r) * lr;
  out[1] = srgbToLinear(c.g) * lg;
  out[2] = srgbToLinear(c.b) * lb;

  if (material.emissive && material.emissive.isColor) {
    const ei = material.emissiveIntensity === undefined ? 1 : material.emissiveIntensity;
    out[0] += srgbToLinear(material.emissive.r) * ei;
    out[1] += srgbToLinear(material.emissive.g) * ei;
    out[2] += srgbToLinear(material.emissive.b) * ei;
  }
  return out;
}

const shadeScratch = new Float64Array(3);

/* ------------------------------------------------------------------ 光栅化 */
const MAX_SAMPLES = 4096; // 保留：单三角覆盖上限的参考值（巨型面照常处理）

function rasterMesh(node, id) {
  const geo = node.geometry;
  if (!geo || !geo.attributes || !geo.attributes.position) return;
  const mat = node.material;
  if (!mat) return;

  const isShell = !!node.userData.isOutline;
  if (isShell && !showShells) return;

  const side = mat.side === undefined ? 0 : mat.side;
  const blending = mat.blending === undefined ? 1 : mat.blending;
  const transparent = !!mat.transparent;
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
  const index = geo.index ? geo.index.array : null;
  const vCount = posAttr.count !== undefined ? posAttr.count : pos.length / 3;
  const triCount = index ? (index.count !== undefined ? index.count : index.length) / 3 : vCount / 3;

  const worldEls = node.matrixWorld.elements;
  const viewOfMesh = mulMat(viewEls, worldEls);
  const instanceEls = node.isInstancedMesh ? node.instanceMatrix.array : null;
  const instances = node.isInstancedMesh ? node.count : 1;

  const vp = new Float64Array(vCount * 3);
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

    // 顶点变换：局部 -> 视图空间位置 + 世界空间法线
    let anyVisible = false;
    for (let i = 0; i < vCount; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const vx = viewM[0] * x + viewM[4] * y + viewM[8] * z + viewM[12];
      const vy = viewM[1] * x + viewM[5] * y + viewM[9] * z + viewM[13];
      const vz = viewM[2] * x + viewM[6] * y + viewM[10] * z + viewM[14];
      vp[i * 3] = vx; vp[i * 3 + 1] = vy; vp[i * 3 + 2] = vz;
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
    if (globalThis.__DBG > 0) {
      globalThis.__DBG -= 1;
      console.log('DBG', node.name, 'vCount', vCount, 'tri', triCount, 'hasIndex', !!index, 'posLen', pos.length, 'itemSize', pos.itemSize, 'transparent', transparent);
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

      // 视图空间几何法线（朝向判定 + 无 normal 属性时的着色法线）
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az_;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az_;
      let fx = e1y * e2z - e1z * e2y;
      let fy = e1z * e2x - e1x * e2z;
      let fz = e1x * e2y - e1y * e2x;
      const flen = Math.hypot(fx, fy, fz);
      if (flen < 1e-12) { stats.culled++; continue; }
      fx /= flen; fy /= flen; fz /= flen;
      const facing = fx * ax + fy * ay + fz * az_; // < 0 = 面向相机
      if (side === 0 && facing > 0) { stats.culled++; continue; }
      if (side === 1 && facing < 0) { stats.culled++; continue; }

      // 世界法线：视图法线经视图旋转的转置回到世界空间
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

      // 屏幕坐标
      const sa = 1 / (-az_), sb = 1 / (-bz), sc = 1 / (-cz);
      const pax = (0.5 + 0.5 * (ax * projScale / aspect) * sa) * RW;
      const pay = (0.5 - 0.5 * (ay * projScale) * sa) * RH;
      const pbx = (0.5 + 0.5 * (bx * projScale / aspect) * sb) * RW;
      const pby = (0.5 - 0.5 * (by * projScale) * sb) * RH;
      const pcx = (0.5 + 0.5 * (cx * projScale / aspect) * sc) * RW;
      const pcy = (0.5 - 0.5 * (cy * projScale) * sc) * RH;

      let minX = Math.max(0, Math.floor(Math.min(pax, pbx, pcx)));
      let maxX = Math.min(RW - 1, Math.ceil(Math.max(pax, pbx, pcx)));
      let minY = Math.max(0, Math.floor(Math.min(pay, pby, pcy)));
      let maxY = Math.min(RH - 1, Math.ceil(Math.max(pay, pby, pcy)));
      if (maxX < minX || maxY < minY) { stats.culled++; continue; }
      if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_SAMPLES * 64) {
        // 单个三角形覆盖过大（多半是天空 / 底座级别的巨型面），照常处理
      }

      // 着色（逐三角形一次，逐像素只做深度测试）
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
        r = srgbToLinear(c.r); g = srgbToLinear(c.g); b = srgbToLinear(c.b);
        alpha = opacity;
      } else {
        shadeLit(mat, wnx, wny, wnz, shadeScratch);
        r = shadeScratch[0]; g = shadeScratch[1]; b = shadeScratch[2];
        alpha = opacity;
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
          // 用重心坐标第三分量 = 1 - w0 - w1（比再算一次叉积便宜且不会累积误差）
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * (-az_) + w1 * (-bz) + w2 * (-cz);
          const idx = rowOff + px;
          if (z >= depth[idx]) continue;

          objId[idx] = id;
          if (blending === 2) {
            // 加色（光斑 / 灯罩发光 / 尘埃）
            color[idx * 3] += r * alpha;
            color[idx * 3 + 1] += g * alpha;
            color[idx * 3 + 2] += b * alpha;
            depth[idx] = z;
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
            depth[idx] = z;
          }
          stats.triangles++;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ 遍历与排序 */
globalThis.__DBG = Number(arg('dbg', 0));
/** 沿父链找到场景直属子节点 = 资产组名（审计与文档用的资产名） */
function assetRootName(node) {
  let cur = node;
  while (cur.parent && cur.parent !== scene) cur = cur.parent;
  return cur.name || '(unnamed asset)';
}
globalThis.__DBG = Number(arg('dbg', 0));
const opaqueMeshes = [];
const blendMeshes = [];
scene.traverse((node) => {
  if (!node.visible) return;
  if (node.isPoints) { blendMeshes.push({ node, points: true, dist: 0 }); return; }
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

// 1) 不透明：按距离从近到远（早深度剔除）
opaqueMeshes.sort((a, b) => a.dist - b.dist);
for (const item of opaqueMeshes) rasterMesh(item.node, item.id);

// 2) 半透明：按距离从远到近（正确叠加），加色最后
blendMeshes.sort((a, b) => b.dist - a.dist);
for (const item of blendMeshes) {
  if (item.points) continue;
  stats.transparentMeshes++;
  rasterMesh(item.node, item.id);
}

/* ------------------------------------------------------------------ 尘埃粒子 */
function drawPoints(node) {
  const mat = node.material;
  const pos = node.geometry.attributes.position.array;
  const count = node.geometry.attributes.position.count;
  const worldEls = node.matrixWorld.elements;
  const m = mulMat(viewEls, worldEls);
  const c = mat.color || { r: 1, g: 1, b: 1 };
  const pr = srgbToLinear(c.r), pg = srgbToLinear(c.g), pb = srgbToLinear(c.b);
  const alpha = (mat.opacity === undefined ? 1 : mat.opacity);
  const size = Math.max(1, Math.round(SS));
  stats.points += count;
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
    if (vz >= -camera.near) continue;
    const s = 1 / (-vz);
    const px = Math.round((0.5 + 0.5 * (vx * projScale / aspect) * s) * RW);
    const py = Math.round((0.5 - 0.5 * (vy * projScale) * s) * RH);
    if (px < 0 || py < 0 || px >= RW || py >= RH) continue;
    const hitDist = -vz;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const qx = px + dx, qy = py + dy;
        if (qx >= RW || qy >= RH) continue;
        const idx = qy * RW + qx;
        if (hitDist > depth[idx]) continue;
        color[idx * 3] += pr * alpha;
        color[idx * 3 + 1] += pg * alpha;
        color[idx * 3 + 2] += pb * alpha;
      }
    }
  }
}
for (const item of blendMeshes) if (item.points) drawPoints(item.node);

/* ------------------------------------------------------------------ 天空 */
const SKY_TOP = rgbOf(PALETTE.skyTop).map(srgbToLinear);
const SKY_MID = rgbOf(PALETTE.skyMid).map(srgbToLinear);
const SKY_HOR = rgbOf(PALETTE.skyHorizon).map(srgbToLinear);
function skyColor(dirY, out) {
  const t = Math.max(0, Math.min(1, dirY));
  if (t < 0.18) {
    const k = t / 0.18;
    out[0] = SKY_HOR[0] + (SKY_MID[0] - SKY_HOR[0]) * k;
    out[1] = SKY_HOR[1] + (SKY_MID[1] - SKY_HOR[1]) * k;
    out[2] = SKY_HOR[2] + (SKY_MID[2] - SKY_HOR[2]) * k;
  } else {
    const k = (t - 0.18) / 0.82;
    out[0] = SKY_MID[0] + (SKY_TOP[0] - SKY_MID[0]) * k;
    out[1] = SKY_MID[1] + (SKY_TOP[1] - SKY_MID[1]) * k;
    out[2] = SKY_MID[2] + (SKY_TOP[2] - SKY_MID[2]) * k;
  }
  return out;
}
const skyScratch = new Float64Array(3);
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
    // 视图 -> 世界：视图矩阵旋转部分转置
    const wx = viewEls[0] * dx + viewEls[1] * dy + viewEls[2] * dz;
    const wy = viewEls[4] * dx + viewEls[5] * dy + viewEls[6] * dz;
    const wz = viewEls[8] * dx + viewEls[9] * dy + viewEls[10] * dz;
    skyColor(wy, skyScratch);
    color[idx * 3] = skyScratch[0];
    color[idx * 3 + 1] = skyScratch[1];
    color[idx * 3 + 2] = skyScratch[2];
  }
}

/* ------------------------------------------------------------------ 雾 + 色调压缩 + 调色 */
const fogK = LIGHT.fogDensity * LIGHT.fogDensity;
const white2 = 3.6 * 3.6;
const grade = POST.grade;
const final = new Float32Array(W * H * 3);
for (let sy = 0; sy < RH; sy++) {
  for (let sx = 0; sx < RW; sx++) {
    const sIdx = sy * RW + sx;
    // 超采样盒式降采样（近似 MSAA）
    let cr = 0, cg = 0, cb = 0;
    for (let o = 0; o < SS * SS; o++) {
      const ox = sx + o % SS;
      const oy = sy + Math.floor(o / SS);
      const k = (oy * RW + ox) * 3;
      cr += color[k]; cg += color[k + 1]; cb += color[k + 2];
    }
    const n = SS * SS;
    cr /= n; cg /= n; cb /= n;

    const d = depth[sy * RW + sx];
    if (d !== Infinity) {
      const f = 1 - Math.exp(-fogK * d * d);
      cr += (FOG[0] - cr) * f;
      cg += (FOG[1] - cg) * f;
      cb += (FOG[2] - cb) * f;
    }

    // ACES 电影级色调映射（与渲染器配置一致）
    cr = aces(cr); cg = aces(cg); cb = aces(cb);

    // 暖秋日调色（与 js/shaders/grade-shader.js 同向：曝光 / 对比 / 饱和 / 暖偏 / 提亮）
    cr *= grade.exposure * grade.gain; cg *= grade.exposure * grade.gain; cb *= grade.exposure * grade.gain;
    const luma = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
    cr = luma + (cr - luma) * grade.saturation;
    cg = luma + (cg - luma) * grade.saturation;
    cb = luma + (cb - luma) * grade.saturation;
    cr += grade.warmth * 0.6; cg += grade.warmth * 0.12; cb -= grade.warmth * 0.5;
    cr = (cr - 0.5) * grade.contrast + 0.5;
    cg = (cg - 0.5) * grade.contrast + 0.5;
    cb = (cb - 0.5) * grade.contrast + 0.5;
    cr += grade.lift; cg += grade.lift; cb += grade.lift * 0.7;

    const fx = ((sx + 0.5) / W) * 2 - 1;
    const fy = ((sy + 0.5) / H) * 2 - 1;
    const r2 = fx * fx + fy * fy;
    const vig = 1 - grade.vignette * Math.max(0, r2 - grade.vignetteSoftness) / Math.max(1e-4, 2 - grade.vignetteSoftness);
    final[(sy * W + sx) * 3] = Math.max(0, Math.min(1, linearToSrgb(cr * vig)));
    final[(sy * W + sx) * 3 + 1] = Math.max(0, Math.min(1, linearToSrgb(cg * vig)));
    final[(sy * W + sx) * 3 + 2] = Math.max(0, Math.min(1, linearToSrgb(cb * vig)));
  }
}

/* ------------------------------------------------------------------ 景深（近似） */
if (dofOn && POST.dof.enabled) {
  const focusPoint = new THREE.Vector3(DOF_FOCUS.x, DOF_FOCUS.y, DOF_FOCUS.z);
  const focusDist = camera.position.distanceTo(focusPoint);
  const cfg = POST.dof;
  const coc = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const d = depth[py * RW + px];
      if (d === Infinity) { coc[py * W + px] = 0; continue; }
      const delta = d - focusDist;
      const weight = delta > 0 ? cfg.farWeight : cfg.nearWeight;
      const amount = Math.max(0, Math.abs(delta) - cfg.focusRange) * cfg.depthFalloff * weight;
      coc[py * W + px] = Math.max(0, Math.min(1, amount)) * Math.min(cfg.maxBlurPx, 10);
    }
  }
  const tmp = new Float32Array(W * H * 3);
  const taps = 7;
  // 横向 gather
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const idx = py * W + px;
      const rad = coc[idx];
      if (rad < 0.6) { tmp[idx * 3] = final[idx * 3]; tmp[idx * 3 + 1] = final[idx * 3 + 1]; tmp[idx * 3 + 2] = final[idx * 3 + 2]; continue; }
      let cr = 0, cg = 0, cb = 0, wsum = 0;
      for (let t = 0; t < taps; t++) {
        const off = Math.round(((t / (taps - 1)) * 2 - 1) * rad);
        const qx = Math.max(0, Math.min(W - 1, px + off));
        const qIdx = py * W + qx;
        const w = coc[qIdx] >= rad * 0.55 ? 1 : 0.35; // 焦内像素少参与
        cr += final[qIdx * 3] * w; cg += final[qIdx * 3 + 1] * w; cb += final[qIdx * 3 + 2] * w;
        wsum += w;
      }
      tmp[idx * 3] = cr / wsum; tmp[idx * 3 + 1] = cg / wsum; tmp[idx * 3 + 2] = cb / wsum;
    }
  }
  // 纵向 gather
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const idx = py * W + px;
      const rad = coc[idx];
      if (rad < 0.6) continue;
      let cr = 0, cg = 0, cb = 0, wsum = 0;
      for (let t = 0; t < taps; t++) {
        const off = Math.round(((t / (taps - 1)) * 2 - 1) * rad);
        const qy = Math.max(0, Math.min(H - 1, py + off));
        const qIdx = qy * W + px;
        const w = coc[qIdx] >= rad * 0.55 ? 1 : 0.35;
        cr += tmp[qIdx * 3] * w; cg += tmp[qIdx * 3 + 1] * w; cb += tmp[qIdx * 3 + 2] * w;
        wsum += w;
      }
      final[idx * 3] = cr / wsum; final[idx * 3 + 1] = cg / wsum; final[idx * 3 + 2] = cb / wsum;
    }
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

/* ------------------------------------------------------------------ ASCII 概览（终端里直接看构图） */
if (arg('ascii', '1') !== '0') {
  const cols = Number(arg('cols', 108));
  const rows = Math.max(12, Math.round(cols * (H / W) / 2));
  const ramp = ' .:-=+*#%@';
  const lines = [];
  for (let ry = 0; ry < rows; ry++) {
    let line = '';
    for (let rx = 0; rx < cols; rx++) {
      // 区域平均（避免单像素噪声）
      const x0 = Math.floor((rx / cols) * W), x1 = Math.max(x0 + 1, Math.floor(((rx + 1) / cols) * W));
      const y0 = Math.floor((ry / rows) * H), y1 = Math.max(y0 + 1, Math.floor(((ry + 1) / rows) * H));
      let lum = 0, n = 0;
      for (let yy = y0; yy < y1; yy += 2) {
        for (let xx = x0; xx < x1; xx += 2) {
          const k = (yy * W + xx) * 3;
          lum += 0.2126 * final[k] + 0.7152 * final[k + 1] + 0.0722 * final[k + 2];
          n++;
        }
      }
      lum = n ? lum / n : 0;
      const midX = Math.min(RW - 1, Math.floor(((rx + 0.5) / cols) * RW));
      const midY = Math.min(RH - 1, Math.floor(((ry + 0.5) / rows) * RH));
      if (depth[midY * RW + midX] === Infinity) { line += '.'; continue; }
      line += ramp[Math.max(1, Math.min(ramp.length - 1, Math.round(lum * (ramp.length - 1))))];
    }
    lines.push(line);
  }
  console.log('--- ASCII 概览（亮度 10 级：空格=最暗，@=最亮） ---');
  for (const l of lines) console.log(l);
}


console.log('=== 离线预览 ===');
console.log(`画面 ${W}x${H}（超采样 ${SS}x -> ${RW}x${RH}）| 机位 az=${azDeg} el=${elDeg} r=${radius} target=(${target.x}, ${target.y}, ${target.z})`);
console.log(`网格 ${stats.meshes}（描边壳体 ${stats.shells}）| 实例变换 ${stats.instanced} | 粒子 ${stats.points}`);
console.log(`写入像素 ${stats.triangles} | 剔除三角 ${stats.culled} | 半透明网格 ${stats.transparentMeshes} | 跳过无 uColor 的 ShaderMaterial ${stats.skippedShader}`);
{
  const counts = new Map();
  for (let i = 0; i < RW * RH; i++) {
    const id = objId[i];
    if (id < 0) continue;
    const key = idInfo[id].asset;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = RW * RH;
  console.log('--- 画面可见性（超采样像素占比，前 14 项） ---');
  const limit = Number(arg('top', 14));
  for (const [name, px] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
    console.log('  ' + ((px / total) * 100).toFixed(2).padStart(6) + ' %  ' + name);
  }
  const invisible = [...assembly.assets.keys()].filter((name) => !counts.has(name));
  if (invisible.length) console.log('  本机位完全不可见的资产：' + invisible.join(', '));
  let shellPixels = 0;
  for (let i = 0; i < RW * RH; i++) {
    const id = objId[i];
    if (id >= 0 && idInfo[id].shell) shellPixels += 1;
  }
  console.log('  描边壳体合计 ' + ((shellPixels / total) * 100).toFixed(2) + ' %（壳体只应出现在轮廓上，占比过高说明壳体吞掉构件）');
}
console.log(`焦点距离 ${camera.position.distanceTo(new THREE.Vector3(DOF_FOCUS.x, DOF_FOCUS.y, DOF_FOCUS.z)).toFixed(2)} m | 输出 ${outPath}`);
