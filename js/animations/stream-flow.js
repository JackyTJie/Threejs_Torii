// 山涧溪流动态（三维真实起伏波场 + 障碍物迎水弓形激波/背水涡街 + 溪面漂浮落叶随波起伏与漂流）：
// 1) 推进 WATER_FLOW_MATERIALS 与 RIVERBED_CAUSTIC_MATERIALS 的时间 uniform，驱动 GPU 浅水方程、斯涅尔折射、光追倒影与阳光波光；
// 2) 水面高密度顶点三维动态起伏（主顺流行波 + 交叉斜波 + 溪石/堰石迎水驻波抬升与背水 V 型尾流下陷），并逐帧重算平滑顶点法线；
// 3) 实时解算 42 片溪面漂浮秋叶（floatingLeaves）：
//    - 顺流漂动叶（drift）沿 CatmullRomCurve3 溪流路径漂流，遇溪石障碍物平滑绕流；
//    - 石畔回旋叶（eddy）在溪石旁的水湾处随微澜轻柔打转；
//    - 所有浮叶实时采样当前位置的三维水波高度 y = waterY(z) + waterWave(x, z, t) 与波面法线梯度（∂h/∂x, ∂h/∂z），
//      实现真正随流水高低起伏与倾侧摇曳的物理动态。
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
import { getStreamObstacles, getStreamSplineCurve } from '../assets/stream.js';
import { RIVERBED_CAUSTIC_MATERIALS, WATER_FLOW_MATERIALS, tuneMaterial } from '../toon.js';
import { registerAnimation } from './registry.js';

export const STREAM_FLOW_NAME = 'streamFlow';

const CULVERT_BOB = 0.004;
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
 * 含障碍物碰撞反射波与三维起伏波峰的水面物理复合波场：
 * 主顺流行波 + 交叉斜波 + 高频涟漪 + 溪石障碍物迎水弓形涌浪与背水卡门涡街尾迹
 */
export function waterWave(x, z, time, params = ANIM.stream) {
  const half = Math.max(0.2, streamWidthAt(streamTAt(z)) / 2);
  const lateral = THREE.MathUtils.clamp(streamDistance(x, z) / half, -1, 1);
  const s = streamArcLength(z);
  const k1 = (Math.PI * 2) / params.wavelengthMax;
  const k2 = (Math.PI * 2) / params.wavelengthMin;
  const w1 = k1 * params.speed * 1.45;
  const w2 = k2 * params.rippleSpeed * 1.35;

  const long = Math.sin(s * k1 - time * w1 + Math.sin(lateral * 2.2) * 0.6) * 0.58;
  const short = Math.sin(s * k2 + lateral * 2.8 - time * w2) * 0.34;
  const cross = Math.cos(lateral * 4.6 + s * 1.3 - time * params.rippleSpeed * 2.4) * 0.24;
  const chop = Math.sin(x * 7.8 + z * 6.4 - time * 4.8) * 0.16;

  // 溪石与堰石障碍物碰撞反射波纹（迎水侧抬升驻波枕，背水侧形成 V 型尾流波列）
  let obstacleWave = 0;
  const obstacles = getStreamObstacles();
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    const dz = z - ob.z;
    if (dz < -0.75 || dz > 1.45) continue;
    const dx = x - ob.x;
    const dist = Math.hypot(dx, dz);
    if (dist < ob.r * 3.0) {
      const ring = Math.sin(dist * 16.5 - time * 5.6 + i) * Math.exp(-dist * 2.1);
      // 迎水侧（dz < 0）水体受阻隆起（Bow Wave Pillow），背水侧（dz > 0）下陷并拖出涡街
      const bowLift = dz < 0
        ? Math.exp(-dist * 3.2) * 0.65
        : -Math.exp(-dist * 3.6) * 0.38;
      const wakeBias = dz > 0 ? 1.35 : 0.9;
      obstacleWave += (ring * 0.38 * wakeBias + bowLift);
    }
  }

  const cascadeBoost = 1 + cascadeFactorAt(z) * 0.95;
  const amp = Math.max(0.024, params.displacementMax * 1.65);
  return (long + short + cross + chop + obstacleWave) * amp * cascadeBoost;
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
 * 推进溪面漂浮落叶：随水流漂动、遇石绕行、并严格贴合三维水波高度与法线倾角上下起伏摇曳
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
      const casBoost = 1 + cascadeFactorAt(lz) * 1.35;
      st.u += st.speed * casBoost * stepDt;
      if (st.u >= 1) {
        st.u -= 1;
        st.vx = 0;
      }
      curve.getPointAt(st.u, pt);
      const half = Math.max(0.18, streamBankHalf(pt.z) * 0.62);
      st.lat += (st.vx + Math.sin(time * 1.4 + st.phase) * 0.03) * stepDt;
      st.vx *= 0.92;
      if (Math.abs(st.lat) > half) {
        st.lat = Math.sign(st.lat) * half;
        st.vx *= -0.5;
      }
      lx = pt.x + st.lat;
      lz = pt.z;

      // 遇溪石障碍物平滑绕流
      for (let j = 0; j < obstacles.length; j++) {
        const ob = obstacles[j];
        const dz = lz - ob.z;
        if (Math.abs(dz) > ob.r * 2.0) continue;
        const dx = lx - ob.x;
        const d = Math.hypot(dx, dz);
        const minR = ob.r + 0.07;
        if (d < minR && d > 1e-4) {
          const nx = dx / d;
          lx = ob.x + nx * minR;
          st.lat = lx - pt.x;
          st.vx += (nx >= 0 ? 1 : -1) * 0.25;
        }
      }
    } else {
      // 石畔回旋浮叶：在溪石旁随波浪微幅盘旋摆动
      const ang = time * st.orbitSpeed + st.phase;
      lx = st.anchorX + Math.cos(ang) * st.orbitR;
      lz = st.anchorZ + Math.sin(ang) * st.orbitR;
    }

    // 实时采样该点的三维波浪高度与有限差分斜率，让落叶随水波高低起伏并随波面倾斜
    const hC = waterWave(lx, lz, time, params);
    const hR = waterWave(lx + eps, lz, time, params);
    const hU = waterWave(lx, lz + eps, time, params);
    const dHx = (hR - hC) / eps;
    const dHz = (hU - hC) / eps;

    // 同步叠加 Shader 中 Gerstner 波的竖直起伏分量，使落叶与 GPU 水面波峰严丝合缝
    const gerstnerY =
      Math.sin(lz * 5.8 - time * 4.8 + Math.sin(lx * 3.2) * 0.85) * 0.018 +
      Math.sin(lx * 7.4 + lz * 4.3 - time * 3.9) * 0.012;

    const ly = waterY(lz) + (hC * 0.65 + gerstnerY * 0.85) * strength + 0.007;
    st.yaw += st.yawSpeed * stepDt;

    leaf.position.set(lx, ly, lz);
    leaf.rotation.set(
      THREE.MathUtils.clamp(-dHz * 0.55 + Math.sin(time * 2.8 + st.phase) * 0.08, -0.35, 0.35),
      st.yaw,
      THREE.MathUtils.clamp(dHx * 0.55 + Math.cos(time * 2.4 + st.phase) * 0.08, -0.35, 0.35)
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

    // 1. 推进水面与水底折射焦散着色器的时间
    for (const mat of WATER_FLOW_MATERIALS) {
      tuneMaterial(mat, 'uTime', time);
    }
    for (const mat of RIVERBED_CAUSTIC_MATERIALS) {
      tuneMaterial(mat, 'uCausticTime', time);
    }

    // 2. 推进溪面漂浮落叶随波高低起伏、倾侧摇曳与顺流漂动
    stepFloatingLeaves(floatingLeaves, dt, time, strength, params);

    // 3. 推进水面高密度网格三维波浪与撞石反射波纹
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
