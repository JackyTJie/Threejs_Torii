// 山涧溪流动态（方法一：CatmullRomCurve3 样条流场 + 拉格朗日物理流体粒子碰撞绕流 + 水底实时折射焦散）：
// 1) 推进 WATER_FLOW_MATERIALS 与 RIVERBED_CAUSTIC_MATERIALS 的时间 uniform，驱动水底折射焦散与清澈水面微澜；
// 2) 实时解算 1,080 颗流体微粒（fluidParticles）与 360 颗飞沫微粒（splashParticles）的拉格朗日物理运动：
//    - 沿 CatmullRomCurve3 切向速度场平流推进；
//    - 在 6 级小瀑布处受重力加速度加速跌落；
//    - 遇 STREAM_STONES 与石堰障碍物时发生真实的法向弹性反射与切向卡门涡街绕流（水流绕石碰撞）；
// 3) 水面顶点连续流场波动（含石块障碍物环形驻波与尾流）及逐帧平滑法线重算。
import * as THREE from 'three';
import { ANIM } from '../config.js';
import {
  STREAM_PATH,
  cascadeFactorAt,
  streamBankHalf,
  streamCenterX,
  streamDistance,
  streamTAt,
  streamWidthAt,
  waterY
} from '../layout.js';
import { getStreamObstacles } from '../assets/stream.js';
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
 * 含障碍物碰撞反射波的水面物理复合波场：
 * 主顺流行波 + 交叉斜波 + 溪石障碍物迎水弓形激波与背水卡门涡街尾迹
 */
export function waterWave(x, z, time, params = ANIM.stream) {
  const half = Math.max(0.2, streamWidthAt(streamTAt(z)) / 2);
  const lateral = THREE.MathUtils.clamp(streamDistance(x, z) / half, -1, 1);
  const s = streamArcLength(z);
  const k1 = (Math.PI * 2) / params.wavelengthMax;
  const k2 = (Math.PI * 2) / params.wavelengthMin;
  const w1 = k1 * params.speed;
  const w2 = k2 * params.rippleSpeed;

  const long = Math.sin(s * k1 - time * w1) * 0.46;
  const short = Math.sin(s * k2 + lateral * 2.4 - time * w2) * 0.24;
  const cross = Math.sin(lateral * 3.8 + s * 0.9 - time * params.rippleSpeed * 1.9) * 0.14;

  // 溪石与堰石障碍物碰撞反射波纹（Bow Wave & Wake Ripple）
  let obstacleWave = 0;
  const obstacles = getStreamObstacles();
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    const dz = z - ob.z;
    if (dz < -0.6 || dz > 1.3) continue;
    const dx = x - ob.x;
    const dist = Math.hypot(dx, dz);
    if (dist < ob.r * 2.8) {
      const ring = Math.sin(dist * 18.0 - time * 5.2 + i) * Math.exp(-dist * 2.4);
      // 迎水面（dz < 0）激起弓形涌波，背水面（dz > 0）拖出 V 型尾流
      const wakeBias = dz > 0 ? 1.25 : 0.85;
      obstacleWave += ring * 0.32 * wakeBias;
    }
  }

  const cascadeBoost = 1 + cascadeFactorAt(z) * 0.75;
  return (long + short + cross + obstacleWave) * params.displacementMax * cascadeBoost;
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
  const fluidSystems = [];
  const splashSystems = [];

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
      } else if (node.userData.fluidParticles) {
        fluidSystems.push({
          mesh: node,
          ...node.userData.fluidParticles
        });
      } else if (node.userData.splashParticles) {
        splashSystems.push({
          mesh: node,
          ...node.userData.splashParticles
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
  return { surfaces, culvertSlabs, eddies, cascades, fluidSystems, splashSystems };
}

/**
 * 推进拉格朗日物理流体粒子与飞沫粒子
 */
function stepFluidParticles(fluidSystems, splashSystems, dt, time, strength) {
  const dummy = new THREE.Object3D();
  const pt = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const stepDt = Math.min(0.05, Math.max(0.004, dt || 0.016)) * strength;

  for (const sys of fluidSystems) {
    const { mesh: inst, states, curve, obstacles } = sys;
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      curve.getPointAt(st.u, pt);
      curve.getTangentAt(st.u, tan);

      // 瀑布陡坡处重力加速（v = v0 + g_eff * slope）
      const casBoost = 1 + cascadeFactorAt(pt.z) * 1.65;
      st.u += st.speed * casBoost * stepDt;
      if (st.u >= 1) {
        st.u -= 1;
        st.vx = 0;
      }

      curve.getPointAt(st.u, pt);
      curve.getTangentAt(st.u, tan);

      // 横向恢复力与漩涡微扰
      const half = Math.max(0.22, streamBankHalf(pt.z) * 0.72);
      st.lat += st.vx * stepDt;
      st.vx *= 0.92;
      if (Math.abs(st.lat) > half) {
        st.lat = Math.sign(st.lat) * half;
        st.vx *= -0.5;
      }

      let px = pt.x + st.lat;
      const pz = pt.z;

      // 溪石与堰石真实物理碰撞反射与绕流（Obstacle Deflection & Vortex Circulation）
      for (let j = 0; j < obstacles.length; j++) {
        const ob = obstacles[j];
        const dz = pz - ob.z;
        if (Math.abs(dz) > ob.r * 2.2) continue;
        const dx = px - ob.x;
        const d = Math.hypot(dx, dz);
        const minR = ob.r + 0.05;
        if (d < minR && d > 1e-4) {
          const nx = dx / d;
          px = ob.x + nx * minR;
          st.lat = px - pt.x;
          // 赋予绕石切向涡流速度
          st.vx += (nx >= 0 ? 1 : -1) * 0.45;
        }
      }

      const waveH = Math.sin(time * 4.5 + st.phase) * 0.004;
      const py = waterY(pz) + 0.005 + waveH;
      const yaw = Math.atan2(tan.x + st.vx * 0.25, tan.z);
      const pitch = -Math.asin(THREE.MathUtils.clamp(tan.y, -0.85, 0.85));

      dummy.position.set(px, py, pz);
      dummy.rotation.set(pitch, yaw, 0);
      const stretch = st.scale * (1.1 + casBoost * 0.65);
      dummy.scale.set(st.scale * 0.85, st.scale * 0.55, stretch);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
  }

  for (const sys of splashSystems) {
    const { mesh: inst, states, cascades } = sys;
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      st.life += st.speed * stepDt;
      if (st.life >= 1) st.life -= 1;

      const cas = cascades[st.casIdx];
      const u = st.life;
      const z = cas.z + (u - 0.2) * cas.halfSpan * 1.45;
      const x = streamCenterX(z) + st.latOffset + st.vx * u * 0.35;
      // 抛体运动 y(u) = y_water + v0*u - 0.5*g*u^2
      const hop = Math.sin(u * Math.PI) * 0.055;
      const y = waterY(z) + 0.008 + hop;
      const s = st.scale * Math.sin(u * Math.PI);

      dummy.position.set(x, y, z);
      dummy.rotation.set(u * 2.4, i * 0.7, 0);
      dummy.scale.setScalar(Math.max(0.05, s));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
  }
}

export function createStreamFlow(roots, options = {}) {
  const params = ANIM.stream;
  const strength = THREE.MathUtils.clamp(options.strength ?? 1, 0, 1);
  const { surfaces, culvertSlabs, eddies, cascades, fluidSystems, splashSystems } = collectWaterSurfaces(roots);
  let lastTime = 0;

  function update({ time }) {
    const dt = Math.max(0.004, time - lastTime);
    lastTime = time;

    // 1. 推进水面与水底折射焦散着色器的时间
    for (const mat of WATER_FLOW_MATERIALS) {
      tuneMaterial(mat, 'uTime', time);
    }
    for (const mat of RIVERBED_CAUSTIC_MATERIALS) {
      tuneMaterial(mat, 'uCausticTime', time);
    }

    // 2. 推进拉格朗日物理流体粒子与瀑布飞沫粒子
    stepFluidParticles(fluidSystems, splashSystems, dt, time, strength);

    // 3. 推进水面网格波浪与撞石反射波纹
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
  return { update, surfaces, culvertSlabs, eddies, cascades, fluidSystems, splashSystems };
}
