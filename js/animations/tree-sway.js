// 树木与植被异步微风扰动（S7.3）：摆动「构件组」，并为每株乔木、灌木、蕨类、鸟居纸垂与单片叶赋予空间错相异步节奏。
import * as THREE from 'three';
import { ANIM } from '../config.js';
import { registerAnimation, windGustFactor } from './registry.js';
import { LEAF_FLUTTER_MATERIALS } from '../toon.js';

export const TREE_SWAY_NAME = 'treeSway';

const AUTHORED = { branch: 0.035, cluster: 0.05 };
const TRUNK_GAIN = 0.18;
const UP = new THREE.Vector3(0, 1, 0);

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

function hashAngle(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return (h - Math.floor(h)) * Math.PI * 2;
}

/**
 * 收集可摆动构件，并叠加世界坐标空间相位偏移，确保不同植株、不同高度层次摆动节奏绝不同步。
 */
export function collectSwayTargets(roots) {
  const out = [];
  const worldPos = new THREE.Vector3();
  for (const root of roots) {
    if (!root) continue;
    root.updateMatrixWorld(true);
    root.traverse((node) => {
      const branch = node.userData.branchSway;
      const cluster = node.userData.leafCluster;
      const tree = node.userData.treeHeight ? node.userData : null;
      if (!branch && !cluster && !tree) return;

      node.getWorldPosition(worldPos);
      // 空间行波相位：风沿山谷斜向吹拂，不同 (x, y, z) 位置的枝叶拥有连续错开的相位与微调周期
      const spatialPhase = worldPos.x * 0.83 + worldPos.z * 0.61 + worldPos.y * 0.37;
      const periodJitter = 0.88 + 0.24 * (hashAngle(worldPos.x + worldPos.y, worldPos.z) / (Math.PI * 2));

      const baseQuat = node.quaternion.clone();
      const localOut = outwardDirection(node);
      const outward = localOut ? localOut.clone().applyQuaternion(baseQuat) : null;
      let axis;
      if (outward && outward.lengthSq() > 1e-6) {
        axis = new THREE.Vector3().crossVectors(UP, outward.normalize());
        if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
        axis.normalize();
      } else {
        const a = hashAngle(worldPos.x, worldPos.z);
        axis = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      }

      if (branch) {
        out.push({
          node, baseQuat, axis, kind: 'branch',
          phase: branch.phase + spatialPhase,
          period: branch.period * periodJitter,
          amplitude: branch.amplitude * (ANIM.treeSway.branchAmplitude / AUTHORED.branch)
        });
      }
      if (cluster) {
        out.push({
          node, baseQuat, axis, kind: 'cluster',
          phase: cluster.phase + spatialPhase * 1.25,
          period: cluster.period * periodJitter,
          amplitude: cluster.amplitude * (ANIM.treeSway.clusterAmplitude / AUTHORED.cluster)
        });
      }
      if (tree && !branch) {
        out.push({
          node, baseQuat, axis, kind: 'trunk',
          phase: hashAngle(worldPos.x, worldPos.z) + spatialPhase * 0.5,
          period: (9.5 + (hashAngle(worldPos.z, worldPos.x) / (Math.PI * 2)) * 4) * periodJitter,
          amplitude: ANIM.treeSway.branchAmplitude * TRUNK_GAIN
        });
      }
    });
  }
  return out;
}

export function createTreeSway(roots, options = {}) {
  const targets = options.targets ?? collectSwayTargets(roots);
  let gustScale = THREE.MathUtils.clamp(options.gustScale ?? 1, 0, 2.0);
  const caps = {
    branch: ANIM.treeSway.branchAmplitude * 1.6,
    cluster: ANIM.treeSway.clusterAmplitude * 1.6,
    trunk: ANIM.treeSway.branchAmplitude * TRUNK_GAIN * 1.6
  };

  const swayQuat = new THREE.Quaternion();

  function updateLeafFlutter({ time, gust }) {
    for (const material of LEAF_FLUTTER_MATERIALS) {
      const uniforms = material.userData.uniforms;
      if (!uniforms || !uniforms.uTime) continue;
      uniforms.uTime.value = time;
      uniforms.uGust.value = gust;
    }
  }

  function update({ time }) {
    const gust = (0.35 + 0.65 * gustScale) * (1 + (windGustFactor(time) - 1) * Math.min(1, gustScale));
    updateLeafFlutter({ time, gust });
    for (const target of targets) {
      const cap = caps[target.kind] || caps.branch;
      const phase = (time / target.period) * Math.PI * 2 + target.phase;
      // 三个互质频率正弦叠加，形成自然非周期山林微风摇曳
      const wave = Math.sin(phase) * 0.68 + Math.sin(phase * 1.43 + 0.9) * 0.22 + Math.cos(phase * 2.17 + 2.1) * 0.10;
      const angle = THREE.MathUtils.clamp(target.amplitude * gust * wave, -cap, cap);
      swayQuat.setFromAxisAngle(target.axis, angle);
      target.node.quaternion.copy(target.baseQuat).premultiply(swayQuat);
    }
  }

  registerAnimation(TREE_SWAY_NAME, update);
  return {
    update,
    targets,
    setWindScale(s) {
      gustScale = THREE.MathUtils.clamp(s, 0, 2.0);
    },
    getWindScale() {
      return gustScale;
    }
  };
}
