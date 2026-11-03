// 小溪缓慢流动（S7.4）：水面顶点位移 + 逐帧法线重算。
//
// 做法与理由：
//   - 位移在 CPU 上按解析波场施加到 `stream-water` 网格（userData.waterSurface = true）。
//     水体是 MeshPhysicalMaterial（transmission / clearcoat），走着色器注入需要同时改
//     主渲染与阴影两套 program，风险高；解析位移 + computeVertexNormals 让高光与折射
//     随波面真实变化，且水面只有 242 个顶点，逐帧重算代价可忽略。
//   - 波场沿「顺流弧长 s」推进相位 → 波纹向下游走；横向按离岸距离二次衰减到 0，
//     保证水面边缘始终贴在护岸挡墙上（不产生边缘翘起 / 脱离）。
//   - 涵洞内水面是一块 14 mm 厚的水板（`culvert-water`，涵内不见直射光），
//     不做顶点波，只做 ±3 mm 的极缓起伏，暗示水在涵内继续流。
//
// 参数全部来自 ANIM.stream：displacementMax / wavelengthMin / wavelengthMax / speed / rippleSpeed。
import * as THREE from 'three';
import { ANIM } from '../config.js';
import { STREAM_PATH, streamDistance, streamTAt, streamWidthAt } from '../layout.js';
import { registerAnimation } from './registry.js';

export const STREAM_FLOW_NAME = 'streamFlow';

/** 涵内水板的起伏幅度（米）：远小于明渠波高，避免水板顶穿涵底 / 露出洞口 */
const CULVERT_BOB = 0.003;

/** 纵向端点衰减长度（米）：每段首末起 1.0 m 内水面不起伏 */
const TAPER_LENGTH = 1.0;

/** 溪流中心线全长（米）：把归一化 t 换算成顺流弧长，波速才有物理意义 */
function pathLength() {
  let total = 0;
  for (let i = 0; i + 1 < STREAM_PATH.length; i++) {
    total += Math.hypot(STREAM_PATH[i + 1].x - STREAM_PATH[i].x, STREAM_PATH[i + 1].z - STREAM_PATH[i].z);
  }
  return total;
}

const PATH_LEN = pathLength();

/** 顺流弧长（米） */
export function streamArcLength(z) {
  return streamTAt(z) * PATH_LEN;
}

/** 横向衰减：到中心线的「垂直距离」/ 半宽 */
function lateralTaper(x, z) {
  const half = Math.max(0.2, streamWidthAt(streamTAt(z)) / 2);
  // ribbon 的左右顶点是沿法向偏移的（x 与 z 同时变），必须用同一种距离度量。
  // 用 (x - centerX(z)) 会把边缘点的横向比例算成 < 1，实测岸边漏出 1.3 cm 起伏，水面被护岸掀开。
  const lateral = THREE.MathUtils.clamp(streamDistance(x, z) / half, -1, 1);
  return Math.max(0, 1 - lateral * lateral); // 岸边权重 0 → 水面贴在护岸顶面上
}

/** 波场本体（不含衰减）：漂浮落叶等也用它对齐水面高度 */
export function waterWave(x, z, time, params = ANIM.stream) {
  const lateral = THREE.MathUtils.clamp(
    streamDistance(x, z) / Math.max(0.2, streamWidthAt(streamTAt(z)) / 2), -1, 1
  );
  const s = streamArcLength(z);
  const k1 = (Math.PI * 2) / params.wavelengthMax; // 长波：整体水面缓慢涌向下游
  const k2 = (Math.PI * 2) / params.wavelengthMin; // 短波：细碎涟漪
  const w1 = k1 * params.speed;
  const w2 = k2 * params.rippleSpeed;

  const long = Math.sin(s * k1 - time * w1) * 0.62;
  const short = Math.sin(s * k2 + lateral * 2.4 - time * w2) * 0.26;
  // 横向相位错开，避免整条溪图像一条平移的带
  const cross = Math.sin(lateral * 3.1 + s * 0.55 - time * params.rippleSpeed * 1.9) * 0.12;

  return (long + short + cross) * params.displacementMax;
}

/**
 * 含岸边衰减的水面位移（任意点查询用；网格逐顶点衰减在 createStreamFlow 内预计算）。
 * @param {number} x 世界 x
 * @param {number} z 世界 z
 * @param {number} time 动画时钟
 * @param {object} params ANIM.stream
 */
export function waterDisplacement(x, z, time, params = ANIM.stream) {
  const taper = lateralTaper(x, z);
  if (taper <= 0.001) return 0;
  return waterWave(x, z, time, params) * taper;
}

/**
 * 逐顶点权重（安装时算一次，逐帧不再求距）：横向衰减 × 纵向端点衰减。
 *
 * 横向：1 − (离岸距离 / 半宽)²，岸列权重 0 → 水面边缘始终贴在护岸顶面上。
 *   这要求水面横断面有内部列（stream.js 的 WATER_COLS）：只有左右两列时每一列权重都是 0，
 *   整片水面一动不动，行波只会在被底座边缘夹回来的个别顶点上漏出一点（实测 0.0098 m）。
 * 纵向：每段首末权重 0，向内 TAPER_LENGTH 米线性升到 1 —— 涵洞洞口与底座边缘的切口不起伏，
 *   避免水板在洞口处与涵内水板上下错开。按物理长度取，不随网格密度变化。
 */
function vertexWeights(surface) {
  const position = surface.attribute;
  const columns = Math.max(1, surface.columns);
  const weights = new Float32Array(position.count);
  const stations = Math.floor(position.count / columns);

  // 站点平均间距（米）：用相邻站点中心距求，纵向衰减才有固定的物理长度
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
    // 横向衰减直接取建模列比（1 − ratio²），不重新求距离：
    // 求距离时 streamTAt(z) 反解出的 t 与站点真实 t 有偏差、折线转角处垂距也小于法向偏移，
    // 实测岸列会漏出 9 mm 起伏，水面从护岸顶面上掀开。
    const ratio = surface.ratios ? surface.ratios[i % columns] : null;
    let weight = ratio !== null ? Math.max(0, 1 - ratio * ratio) : lateralTaper(position.getX(i), position.getZ(i));
    const station = Math.floor(i / columns);
    const fromEnd = Math.min(station, stations - 1 - station) * spacing;
    weight *= THREE.MathUtils.clamp(fromEnd / TAPER_LENGTH, 0, 1);
    weights[i] = weight;
  }
  return weights;
}

/**
 * 收集可流动水面。
 * @param {Array<THREE.Object3D>} roots 溪流 / 涵洞等资产根
 */
export function collectWaterSurfaces(roots) {
  const surfaces = [];
  const culvertSlabs = [];
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
      } else if (node.name === 'culvert-water') {
        culvertSlabs.push({ mesh: node, baseY: node.position.y });
      }
    });
  }
  return { surfaces, culvertSlabs };
}

/**
 * 建立溪流流动动画。
 * @param {Array<THREE.Object3D>} roots 含水面的资产根（stream / culvert）
 * @param {{strength?:number}} options 波强缩放（0–1，调校用）
 * @returns {{update:(ctx:object)=>void, surfaces:Array<object>, culvertSlabs:Array<object>}}
 */
export function createStreamFlow(roots, options = {}) {
  const params = ANIM.stream;
  const strength = THREE.MathUtils.clamp(options.strength ?? 1, 0, 1);
  const { surfaces, culvertSlabs } = collectWaterSurfaces(roots);

  function update({ time }) {
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
        // 顶点局部坐标即世界坐标（stream.js 的水面网格无平移 / 旋转）；
        // 仍走 matrixWorld 取点，资产单独挪位后依然正确。
        surface.scratch.set(base[k], base[k + 1], base[k + 2]).applyMatrix4(mesh.matrixWorld);
        array[k + 1] = base[k + 1] + waterWave(surface.scratch.x, surface.scratch.z, time, params) * weights[i] * strength;
      }
      surface.attribute.needsUpdate = true;
      mesh.geometry.computeVertexNormals(); // 波面法线随之变化，高光与折射才会跟着走
    }

    for (const slab of culvertSlabs) {
      slab.mesh.position.y = slab.baseY + Math.sin(time * params.rippleSpeed * 2.2) * CULVERT_BOB * strength;
    }
  }

  registerAnimation(STREAM_FLOW_NAME, update);
  return { update, surfaces, culvertSlabs };
}
