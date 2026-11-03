// 树木微风扰动（S7.3）：摆动「构件组」，不逐叶片计算。
//
// 建模阶段已留好枢轴（js/tree-kit.js / js/assets/shrub.js 的注释即为此约定）：
//   - 主枝 / 枝条 Group 的原点 = 枝基（userData.branchSway = { phase, period, amplitude, anchor }）
//   - 叶簇 Group 的原点 = 簇心（userData.leafCluster = { center, radius, phase, period, amplitude }）
// 因此本模块只需绕各自原点做小角度旋转，枝梢与整簇叶片随之轻柔摆动，
// 构件本身（独立 Mesh）不受影响，也不产生任何网格合并。
//
// 振幅上限严格受 ANIM.treeSway 约束（枝 0.035 / 叶簇 0.05 rad），阵风调制只在下限方向起作用，
// 保证「风力微弱、不剧烈摆动」。
import * as THREE from 'three';
import { ANIM } from '../config.js';
import { registerAnimation, windGustFactor } from './registry.js';
import { LEAF_FLUTTER_MATERIALS } from '../toon.js';

export const TREE_SWAY_NAME = 'treeSway';

/** 建模阶段 userData 里的原始振幅基准；ANIM.treeSway 的两个值作为全局旋钮（gain）缩放它们 */
const AUTHORED = { branch: 0.035, cluster: 0.05 };

/** 整株级别的极缓摆动（相对枝摆再乘 0.18）：让树不是「只有叶子在动」 */
const TRUNK_GAIN = 0.18;

const UP = new THREE.Vector3(0, 1, 0);

/** 由构件组内的子物体位置估算枝梢朝向（枝基 → 枝端），用于选摆动轴 */
function outwardDirection(node) {
  const sum = new THREE.Vector3();
  let n = 0;
  for (const child of node.children) {
    if (child.userData && child.userData.leafCluster) {
      sum.add(child.userData.leafCluster.center);
      n += 1;
      continue;
    }
    if (child.isMesh && !child.userData.isOutline) {
      sum.add(child.position);
      n += 1;
    }
  }
  if (!n) return null;
  sum.multiplyScalar(1 / n);
  if (sum.lengthSq() < 1e-6) return null;
  return sum.normalize();
}

/** 稳定伪随机（同一落点每次构建得到同一轴，避免重建场景时摆动方向跳变） */
function hashAngle(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return (h - Math.floor(h)) * Math.PI * 2;
}

/**
 * 收集可摆动构件。
 * @param {Array<THREE.Object3D>} roots 林组 / 灌木组等已放置的资产根
 * @returns {Array<object>} 摆动条目（node / baseQuat / axis / phase / period / amplitude / kind）
 */
export function collectSwayTargets(roots) {
  const out = [];
  for (const root of roots) {
    if (!root) continue;
    root.traverse((node) => {
      const branch = node.userData.branchSway;
      const cluster = node.userData.leafCluster;
      const tree = node.userData.treeHeight ? node.userData : null;
      if (!branch && !cluster && !tree) return;

      const baseQuat = node.quaternion.clone();
      const localOut = outwardDirection(node);
      // 摆动轴必须落在「父空间」：旋转是在父空间施加的，故把局部枝梢方向换算过去
      const outward = localOut ? localOut.clone().applyQuaternion(baseQuat) : null;
      let axis;
      if (outward && outward.lengthSq() > 1e-6) {
        axis = new THREE.Vector3().crossVectors(UP, outward.normalize());
        if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
        axis.normalize();
      } else {
        const a = hashAngle(node.position.x, node.position.z);
        axis = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      }

      if (branch) {
        out.push({
          node, baseQuat, axis, kind: 'branch',
          phase: branch.phase, period: branch.period,
          amplitude: branch.amplitude * (ANIM.treeSway.branchAmplitude / AUTHORED.branch)
        });
      }
      if (cluster) {
        out.push({
          node, baseQuat, axis, kind: 'cluster',
          phase: cluster.phase, period: cluster.period,
          amplitude: cluster.amplitude * (ANIM.treeSway.clusterAmplitude / AUTHORED.cluster)
        });
      }
      if (tree && !branch) {
        out.push({
          node, baseQuat, axis, kind: 'trunk',
          phase: hashAngle(node.position.x, node.position.z),
          period: 9.5 + (hashAngle(node.position.z, node.position.x) / (Math.PI * 2)) * 4,
          amplitude: ANIM.treeSway.branchAmplitude * TRUNK_GAIN
        });
      }
    });
  }
  return out;
}

/**
 * 建立枝叶微风摆动动画。
 * @param {Array<THREE.Object3D>} roots 需要摆动的资产根（mapleGrove / beechGrove / shrubPatch）
 * @param {{targets?:Array<object>, gustScale?:number}} options 复用已收集的摆动表 / 风力缩放（<=1）
 * @returns {{update:(ctx:object)=>void, targets:Array<object>}}
 */
export function createTreeSway(roots, options = {}) {
  const targets = options.targets ?? collectSwayTargets(roots);
  // 风力缩放只允许 <=1（AGENT.md：风力微弱），调大不会突破 ANIM 上限
  const gustScale = THREE.MathUtils.clamp(options.gustScale ?? 1, 0, 1);
  const caps = {
    branch: ANIM.treeSway.branchAmplitude,
    cluster: ANIM.treeSway.clusterAmplitude,
    trunk: ANIM.treeSway.branchAmplitude * TRUNK_GAIN
  };

  const swayQuat = new THREE.Quaternion();

  /**
   * GPU 侧单片叶微振（shaders/leaf-vertex.js）：材质在 materials.js 里已注册，
   * 这里只推进它们的 uTime / uGust —— 与上面的枝摆共用同一条阵风曲线，
   * 不会出现「枝在阵风里摇、叶在另一套风里抖」的分裂感。
   */
  function updateLeafFlutter({ time, gust }) {
    for (const material of LEAF_FLUTTER_MATERIALS) {
      const uniforms = material.userData.uniforms;
      if (!uniforms || !uniforms.uTime) continue;
      uniforms.uTime.value = time;
      uniforms.uGust.value = gust;
    }
  }

  function update({ time }) {
    const gust = 1 + (windGustFactor(time) - 1) * gustScale;
    updateLeafFlutter({ time, gust });
    for (const target of targets) {
      const cap = caps[target.kind] || caps.branch;
      const phase = (time / target.period) * Math.PI * 2 + target.phase;
      // 两个不同频率的正弦叠加：摆动不会呈现机械的严格周期
      const wave = Math.sin(phase) * 0.78 + Math.sin(phase * 1.37 + 0.9) * 0.22;
      const angle = THREE.MathUtils.clamp(target.amplitude * gust * wave, -cap, cap);
      swayQuat.setFromAxisAngle(target.axis, angle);
      target.node.quaternion.copy(target.baseQuat).premultiply(swayQuat);
    }
  }

  registerAnimation(TREE_SWAY_NAME, update);
  return { update, targets };
}
