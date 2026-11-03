// 山涧溪流动态（S7.4）：
// 1) 水面多波叠加顶点位移 + 跌水激荡高频起伏 + 逐帧法线重算；
// 2) 推进 WATER_FLOW_MATERIALS 的 uTime uniform，驱动 Voronoi 粼粼波光焦散、漩涡与瀑布白沫流动；
// 3) 驱动瀑下深潭与石畔漩涡环（userData.eddySpin）的旋转与呼吸脉动，以及瀑布水帘（userData.cascadeCurtain）的激荡微振。
import * as THREE from 'three';
import { ANIM } from '../config.js';
import { STREAM_PATH, cascadeFactorAt, streamDistance, streamTAt, streamWidthAt } from '../layout.js';
import { WATER_FLOW_MATERIALS, tuneMaterial } from '../toon.js';
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

/** 复合波场：主顺流涌波 + 交叉细碎涟漪 + 漩涡回流波 + 瀑布跌水激荡 */
export function waterWave(x, z, time, params = ANIM.stream) {
  const half = Math.max(0.2, streamWidthAt(streamTAt(z)) / 2);
  const lateral = THREE.MathUtils.clamp(streamDistance(x, z) / half, -1, 1);
  const s = streamArcLength(z);
  const k1 = (Math.PI * 2) / params.wavelengthMax;
  const k2 = (Math.PI * 2) / params.wavelengthMin;
  const w1 = k1 * params.speed;
  const w2 = k2 * params.rippleSpeed;

  const long = Math.sin(s * k1 - time * w1) * 0.52;
  const short = Math.sin(s * k2 + lateral * 2.8 - time * w2) * 0.28;
  const cross = Math.sin(lateral * 4.2 + s * 0.85 - time * params.rippleSpeed * 2.1) * 0.16;
  // 漩涡驻波与瀑布跌水段高频激荡
  const eddy = Math.cos(Math.hypot(x * 2.4, z * 2.4) * 3.2 - time * 3.4) * 0.12;
  const cascadeBoost = 1 + cascadeFactorAt(z) * 0.85;

  return (long + short + cross + eddy) * params.displacementMax * cascadeBoost;
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
  return { surfaces, culvertSlabs, eddies, cascades };
}

export function createStreamFlow(roots, options = {}) {
  const params = ANIM.stream;
  const strength = THREE.MathUtils.clamp(options.strength ?? 1, 0, 1);
  const { surfaces, culvertSlabs, eddies, cascades } = collectWaterSurfaces(roots);

  function update({ time }) {
    // 推进所有水体着色器的 uTime，使焦散波光、漩涡与瀑布白沫实时流动
    for (const mat of WATER_FLOW_MATERIALS) {
      tuneMaterial(mat, 'uTime', time);
    }

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
  return { update, surfaces, culvertSlabs, eddies, cascades };
}
