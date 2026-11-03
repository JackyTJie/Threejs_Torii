// 山涧溪流分区水动力学动态系统（Zoned Mountain Stream Flow & Floating Leaf Kinematics）：
// 彻底消除「大海长波浪」感，基于地形落差、6 级小瀑布（STREAM_CASCADES）与溪石（STREAM_STONES）位置，
// 在 CPU 网格与浮叶运动中同步解算五类水动力学分区：
//   1. 平缓深潭区（Calm Pools）：水面如镜、微澜极轻（起伏仅 1.5~2.5mm），凸显清澈见底与鸟居/树影倒影；
//   2. 束水湍急段（Rapid Chutes）：河道收窄或接近跌水口处流速加快，形成高频鱼鳞状急流细波；
//   3. 石头迎水激荡区（Upstream Bow-Wave Cushion）：石头正前方水体受阻隆起弧形水枕并激起高频飞溅涟漪；
//   4. 石头两侧八字分流区（Lateral Bifurcation Split-Flow）：流线沿势流偶极子向石头左右两侧加速分流并拉出八字波脊；
//   5. 石后卡门涡街与潭湾漩涡区（Kármán Vortex Street & Eddy Swirls）：石头背水侧交替脱落旋转凹陷涡核，浮叶在此盘旋打转。
import * as THREE from 'three';
import { ANIM } from '../config.js';
import {
  STREAM_CASCADES,
  STREAM_PATH,
  cascadeFactorAt,
  streamBankHalf,
  streamCenterX,
  streamDistance,
  streamTAt,
  streamWidthAt,
  valleyLevel,
  waterY
} from '../layout.js';
import { getStreamObstacles, getStreamSplineCurve } from '../assets/stream.js';
import { RIVERBED_CAUSTIC_MATERIALS, WATER_FLOW_MATERIALS, tuneMaterial } from '../toon.js';
import { registerAnimation } from './registry.js';

export const STREAM_FLOW_NAME = 'streamFlow';

const CULVERT_BOB = 0.003;
const TAPER_LENGTH = 0.85;

function pathLength() {
  let total = 0;
  for (let i = 0; i + 1 < STREAM_PATH.length; i++) {
    total += Math.hypot(STREAM_PATH[i + 1].x - STREAM_PATH[i].x, STREAM_PATH[i + 1].z - STREAM_PATH[i].z);
  }
  return total;
}

const PATH_LEN = pathLength();

export function streamArcLength(z) {
  return streamTAt(z) * PATH_LEN;
}

function lateralTaper(x, z) {
  const half = Math.max(0.2, streamWidthAt(streamTAt(z)) / 2);
  const lateral = THREE.MathUtils.clamp(streamDistance(x, z) / half, -1, 1);
  return Math.max(0, 1 - lateral * lateral);
}

/**
 * 计算任意位置 (x, z) 的局部切线流向、坡降落差、瀑布水跃、石头分流与漩涡分区状态
 */
export function evaluateHydroZone(x, z) {
  const dzEps = 0.15;
  const dxCenter = (streamCenterX(z + dzEps) - streamCenterX(z - dzEps)) / (2 * dzEps);
  const invLen = 1 / Math.hypot(dxCenter, 1);
  const tx = dxCenter * invLen;
  const tz = invLen;
  const nx = tz;
  const nz = -tx;

  const half = streamBankHalf(z);
  const dropSlope = Math.max(0, (valleyLevel(z - dzEps) - valleyLevel(z + dzEps)) / (2 * dzEps));
  const widthConstrict = Math.max(0, Math.min(1, (0.92 - half) / 0.28));
  const slopeFactor = Math.max(0, Math.min(1, (dropSlope - 0.085) / 0.45));

  let cascadePlunge = 0;
  let cascadeMask = 0;
  for (let i = 0; i < STREAM_CASCADES.length; i++) {
    const cas = STREAM_CASCADES[i];
    const relZ = z - cas.z;
    if (relZ >= -0.22 && relZ <= 0.62) {
      const m = Math.max(0, 1 - Math.abs(relZ - 0.08) / 0.34);
      cascadeMask = Math.max(cascadeMask, m);
      const p = 1 - Math.abs(relZ - 0.20) / 0.38;
      if (p > 0) cascadePlunge = Math.max(cascadePlunge, p * p);
    }
  }

  let bowWave = 0;
  let splitShear = 0;
  let vorticity = 0;
  let deflectX = 0;
  const obstacles = getStreamObstacles();
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    const dz = z - ob.z;
    if (dz < -0.75 || dz > 1.35) continue;
    const dx = x - ob.x;
    const dist = Math.hypot(dx, dz);
    const R = ob.r * 0.92;
    if (dist < R * 3.2) {
      const sPar = dx * tx + dz * tz;
      const sPerp = dx * nx + dz * nz;
      if (sPar < 0 && sPar > -R * 1.8) {
        bowWave += Math.exp(-dist * 3.0) * Math.max(0, 1 - Math.abs(sPerp) / (R * 1.25));
      }
      if (Math.abs(sPar) < R * 1.4 && Math.abs(sPerp) > R * 0.65 && Math.abs(sPerp) < R * 2.1) {
        const env = Math.exp(-Math.abs(Math.abs(sPerp) - R * 1.2) * 2.6) * Math.exp(-Math.abs(sPar) * 1.8);
        splitShear += env;
        deflectX += Math.sign(sPerp || 1) * env * 0.45;
      }
      if (sPar > R * 0.4 && sPar < R * 3.0 && Math.abs(sPerp) < R * 1.35) {
        const wakeEnv = Math.exp(-(sPar - R * 0.4) * 1.4) * (1 - Math.abs(sPerp) / (R * 1.35));
        vorticity += (sPerp >= 0 ? 1 : -1) * wakeEnv;
      }
    }
  }

  const dirX = Math.max(-0.85, Math.min(0.85, tx + deflectX));
  const dirZ = Math.sqrt(Math.max(0.15, 1 - dirX * dirX));
  const speed = 0.52 + slopeFactor * 0.75 + widthConstrict * 0.42 + cascadeMask * 0.65 + splitShear * 0.45;
  const plungePool = cascadePlunge;
  const splash = Math.min(1, bowWave * 0.95 + plungePool * 0.9 + cascadeMask * 0.55);

  return {
    tx, tz, nx, nz, half, widthConstrict, slopeFactor, cascadePlunge,
    dirX, dirZ, speed, splash, bowWave, plungePool, cascadeMask,
    splitShear: Math.min(1, splitShear),
    vorticity: Math.max(-1, Math.min(1, vorticity))
  };
}

/**
 * 分区水动力学复合波场（彻底消除全河道均一的大海长波浪）：
 * - 平缓深潭（Calm Pool）：起伏 < 2.5mm；
 * - 湍急段与八字分流（Rapid & Split-Flow）：高频斜向急流细波；
 * - 迎石驻波水枕与小瀑布跌水激荡（Bow Splash & Plunge Jump）：局部水枕隆起 + 高频水跃波；
 * - 石后卡门涡街漩涡（Kármán Vortex Street）：背水旋转凹陷涡列。
 */
export function waterWave(x, z, time, params = ANIM.stream) {
  const hydro = evaluateHydroZone(x, z);
  const s = streamArcLength(z);
  const lateral = x - streamCenterX(z);

  let bowWave = 0;
  let splitChevron = 0;
  let karmanVortex = 0;

  const obstacles = getStreamObstacles();
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    const dz = z - ob.z;
    if (dz < -0.75 || dz > 1.35) continue;
    const dx = x - ob.x;
    const dist = Math.hypot(dx, dz);
    const R = ob.r * 0.92;
    if (dist < R * 3.4) {
      const sPar = dx * hydro.tx + dz * hydro.tz;
      const sPerp = dx * hydro.nx + dz * hydro.nz;

      // 1) 石头迎水面（sPar < 0）：水体受阻抬升弧形驻波水枕（Bow Wave）+ 飞溅细波
      if (sPar < 0 && sPar > -R * 1.8) {
        const frontW = Math.exp(-dist * 3.0) * Math.max(0, 1 - Math.abs(sPerp) / (R * 1.25));
        const splashRip = Math.sin(dist * 24.0 - time * 11.5 + i) * 0.35;
        bowWave += frontW * (0.75 + splashRip);
      }

      // 2) 石头左右两侧（|sPerp| ∈ [0.8R, 2.0R]）：八字绕流分流水脊（Kelvin Split-Flow）
      if (Math.abs(sPar) < R * 1.4 && Math.abs(sPerp) > R * 0.75 && Math.abs(sPerp) < R * 2.1) {
        const wakePhase = (Math.abs(sPerp) - sPar * 0.48) * 20.0 - time * 8.5;
        const splitEnv = Math.exp(-Math.abs(Math.abs(sPerp) - R * 1.25) * 2.8) * Math.exp(-Math.abs(sPar) * 1.8);
        splitChevron += Math.cos(wakePhase) * splitEnv * 0.52;
      }

      // 3) 石头背水侧（sPar > 0）：卡门涡街交替旋转凹陷漩涡（Kármán Vortex Street）
      if (sPar > R * 0.5 && sPar < R * 3.2 && Math.abs(sPerp) < R * 1.35) {
        const wakeEnv = Math.exp(-(sPar - R * 0.5) * 1.4) * (1 - Math.abs(sPerp) / (R * 1.35));
        const vortexPhase = sPar * 14.5 - time * 7.2 + (sPerp >= 0 ? 0 : Math.PI);
        const swirlDimple = -0.38 + 0.45 * Math.sin(vortexPhase) * Math.cos(sPerp * 16.0);
        karmanVortex += swirlDimple * wakeEnv;
      }
    }
  }

  // 4) 瀑布落水潭冲击水跃（Plunge Pool Hydraulic Jump）
  const casFactor = cascadeFactorAt(z);
  const plungeWave = hydro.cascadePlunge * (
    Math.sin(x * 22.0 + z * 18.0 - time * 12.5) * 0.55 +
    Math.cos(x * 16.0 - z * 24.0 - time * 14.0) * 0.45
  ) * 0.68;

  // 5) 束水湍急段鱼鳞细波 vs 平缓深潭微澜（幅度严格受坡降与束水比控制，绝不在深潭产生大浪）
  const rapidIntensity = Math.min(1, hydro.slopeFactor * 0.65 + hydro.widthConstrict * 0.35 + casFactor * 0.75);
  const rapidRiffle = (
    Math.sin(s * 14.0 + Math.abs(lateral) * 11.5 - time * 7.8) * 0.55 +
    Math.cos(s * 19.5 - lateral * 14.2 - time * 9.6) * 0.45
  ) * (0.08 + 0.52 * rapidIntensity);

  const baseAmp = Math.max(0.014, params.displacementMax * 1.15);
  return (rapidRiffle + bowWave + splitChevron + karmanVortex + plungeWave) * baseAmp;
}

export function waterDisplacement(x, z, time, params = ANIM.stream) {
  const taper = lateralTaper(x, z);
  if (taper <= 0.001) return 0;
  return waterWave(x, z, time, params) * taper;
}

function vertexWeights(surface) {
  const position = surface.attribute;
  const columns = Math.max(1, surface.columns);
  const weights = new Float32Array(position.count);
  const stations = Math.floor(position.count / columns);

  let span = 0;
  for (let s = 0; s + columns < position.count; s += columns) {
    let cx = 0;
    let cz = 0;
    let nx = 0;
    let nz = 0;
    for (let c = 0; c < columns; c++) {
      cx += position.getX(s + c);
      cz += position.getZ(s + c);
      nx += position.getX(s + columns + c);
      nz += position.getZ(s + columns + c);
    }
    span += Math.hypot(nx / columns - cx / columns, nz / columns - cz / columns);
  }
  const spacing = stations > 1 ? span / (stations - 1) : 1;

  for (let i = 0; i < position.count; i++) {
    const ratio = surface.ratios ? surface.ratios[i % columns] : null;
    let weight = ratio !== null ? Math.max(0, 1 - ratio * ratio) : lateralTaper(position.getX(i), position.getZ(i));
    const station = Math.floor(i / columns);
    const fromEnd = Math.min(station, stations - 1 - station) * spacing;
    weight *= THREE.MathUtils.clamp(fromEnd / TAPER_LENGTH, 0, 1);
    weights[i] = weight;
  }
  return weights;
}

export function collectWaterSurfaces(roots) {
  const surfaces = [];
  const culvertSlabs = [];
  const eddies = [];
  const cascades = [];
  const floatingLeaves = [];

  for (const root of roots) {
    if (!root) continue;
    root.traverse((node) => {
      if (!node.isMesh) return;
      if (node.userData.waterSurface) {
        const position = node.geometry.getAttribute('position');
        if (!position) return;
        const surface = {
          mesh: node,
          attribute: position,
          columns: Math.max(1, node.userData.waterColumns || 2),
          ratios: node.userData.waterColumnRatios || null,
          base: Float32Array.from(position.array),
          scratch: new THREE.Vector3()
        };
        surface.weights = vertexWeights(surface);
        surfaces.push(surface);
      } else if (node.userData.floatingLeaf) {
        floatingLeaves.push({
          mesh: node,
          state: node.userData.floatingLeaf
        });
      } else if (node.userData.eddySpin) {
        eddies.push({
          mesh: node,
          baseY: node.position.y,
          speed: node.userData.eddySpin.speed || 0.9,
          phase: node.userData.eddySpin.phase || 0
        });
      } else if (node.userData.cascadeCurtain) {
        cascades.push({
          mesh: node,
          baseScaleY: node.scale.y,
          baseScaleX: node.scale.x,
          phase: node.userData.cascadeCurtain.phase || 0
        });
      } else if (node.name === 'culvert-water') {
        culvertSlabs.push({ mesh: node, baseY: node.position.y });
      }
    });
  }
  return { surfaces, culvertSlabs, eddies, cascades, floatingLeaves };
}

/**
 * 推进溪面漂浮落叶：
 * - 在平缓深潭缓慢悠然漂浮，在束水急流与小瀑布处加速下冲；
 * - 接近溪石时沿势流分流场自动向左右两侧分流绕行（Bifurcation Split-Flow）；
 * - 石畔漩涡叶在背水回流窝中随漩涡轻柔旋转。
 */
function stepFloatingLeaves(floatingLeaves, dt, time, strength, params) {
  if (!floatingLeaves.length) return;
  const curve = getStreamSplineCurve();
  const obstacles = getStreamObstacles();
  const pt = new THREE.Vector3();
  const stepDt = Math.min(0.05, Math.max(0.004, dt || 0.016)) * strength;
  const eps = 0.06;

  for (let i = 0; i < floatingLeaves.length; i++) {
    const { mesh: leaf, state: st } = floatingLeaves[i];
    let lx = leaf.position.x;
    let lz = leaf.position.z;

    if (st.mode === 'drift') {
      const hydro = evaluateHydroZone(lx, lz);
      const casBoost = 1 + cascadeFactorAt(lz) * 1.45 + hydro.slopeFactor * 0.65;
      st.u += st.speed * casBoost * stepDt;
      if (st.u >= 1) {
        st.u -= 1;
        st.vx = 0;
      }
      curve.getPointAt(st.u, pt);
      const half = Math.max(0.18, streamBankHalf(pt.z) * 0.62);
      st.lat += (st.vx + Math.sin(time * 1.4 + st.phase) * 0.025) * stepDt;
      st.vx *= 0.90;
      if (Math.abs(st.lat) > half) {
        st.lat = Math.sign(st.lat) * half;
        st.vx *= -0.5;
      }
      lx = pt.x + st.lat;
      lz = pt.z;

      // 势流分流与绕石避障：在石头迎水侧提前沿八字分流线向两侧滑开
      for (let j = 0; j < obstacles.length; j++) {
        const ob = obstacles[j];
        const dz = lz - ob.z;
        if (dz < -ob.r * 2.2 || dz > ob.r * 1.8) continue;
        const dx = lx - ob.x;
        const d = Math.hypot(dx, dz);
        const minR = ob.r + 0.075;
        if (d < ob.r * 1.85 && dz < 0) {
          const splitDir = dx >= 0 ? 1 : -1;
          st.vx += splitDir * 0.18 * (1 - d / (ob.r * 1.85));
        }
        if (d < minR && d > 1e-4) {
          const nx = dx / d;
          lx = ob.x + nx * minR;
          st.lat = lx - pt.x;
          st.vx += (nx >= 0 ? 1 : -1) * 0.28;
        }
      }
    } else {
      // 石畔漩涡浮叶：在背水回流涡旋区随漩涡盘旋打转
      const ang = time * st.orbitSpeed * 1.25 + st.phase;
      lx = st.anchorX + Math.cos(ang) * st.orbitR;
      lz = st.anchorZ + Math.sin(ang) * st.orbitR;
    }

    const hC = waterWave(lx, lz, time, params);
    const hR = waterWave(lx + eps, lz, time, params);
    const hU = waterWave(lx, lz + eps, time, params);
    const dHx = (hR - hC) / eps;
    const dHz = (hU - hC) / eps;

    const ly = waterY(lz) + hC * strength + 0.007;
    st.yaw += (st.mode === 'eddy' ? st.orbitSpeed * 0.65 : st.yawSpeed) * stepDt;

    leaf.position.set(lx, ly, lz);
    leaf.rotation.set(
      THREE.MathUtils.clamp(-dHz * 0.55 + Math.sin(time * 2.4 + st.phase) * 0.05, -0.32, 0.32),
      st.yaw,
      THREE.MathUtils.clamp(dHx * 0.55 + Math.cos(time * 2.1 + st.phase) * 0.05, -0.32, 0.32)
    );
  }
}

export function createStreamFlow(roots, options = {}) {
  const params = ANIM.stream;
  const strength = THREE.MathUtils.clamp(options.strength ?? 1, 0, 1);
  const { surfaces, culvertSlabs, eddies, cascades, floatingLeaves } = collectWaterSurfaces(roots);
  let lastTime = 0;

  function update({ time }) {
    const dt = Math.max(0.004, time - lastTime);
    lastTime = time;

    for (const mat of WATER_FLOW_MATERIALS) {
      tuneMaterial(mat, 'uTime', time);
    }
    for (const mat of RIVERBED_CAUSTIC_MATERIALS) {
      tuneMaterial(mat, 'uCausticTime', time);
    }

    stepFloatingLeaves(floatingLeaves, dt, time, strength, params);

    for (const surface of surfaces) {
      const array = surface.attribute.array;
      const base = surface.base;
      const weights = surface.weights;
      const mesh = surface.mesh;
      mesh.updateMatrixWorld(true);
      for (let i = 0; i < surface.attribute.count; i++) {
        const k = i * 3;
        if (weights[i] <= 0.0005) {
          array[k + 1] = base[k + 1];
          continue;
        }
        surface.scratch.set(base[k], base[k + 1], base[k + 2]).applyMatrix4(mesh.matrixWorld);
        array[k + 1] = base[k + 1] + waterWave(surface.scratch.x, surface.scratch.z, time, params) * weights[i] * strength;
      }
      surface.attribute.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }

    for (const eddy of eddies) {
      eddy.mesh.rotation.y = time * eddy.speed * strength + eddy.phase;
      const pulse = 1 + Math.sin(time * 2.2 + eddy.phase) * 0.06 * strength;
      eddy.mesh.scale.set(pulse, 1, pulse);
    }

    for (const c of cascades) {
      const flutter = 1 + Math.sin(time * 7.5 + c.phase) * 0.035 * strength;
      c.mesh.scale.x = c.baseScaleX * flutter;
    }

    for (const slab of culvertSlabs) {
      slab.mesh.position.y = slab.baseY + Math.sin(time * params.rippleSpeed * 2.2) * CULVERT_BOB * strength;
    }
  }

  registerAnimation(STREAM_FLOW_NAME, update);
  return { update, surfaces, culvertSlabs, eddies, cascades, floatingLeaves };
}
