// 林间薄雾缓慢流动漂移（LAYOUT_PLAN §12）：极慢水平漂移 + 呼吸感透明度微调。
import { ANIM } from '../config.js';
import { registerAnimation } from './registry.js';

export const MIST_DRIFT_NAME = 'mistDrift';

/**
 * 收集场景内所有带 userData.mistLayer 的薄雾面片。
 * @param {Array<import('three').Object3D>} roots
 */
export function collectMistLayers(roots) {
  const out = [];
  for (const root of roots) {
    if (!root) continue;
    root.traverse((node) => {
      if (!node.isMesh || !node.userData || !node.userData.mistLayer) return;
      out.push({ mesh: node, meta: node.userData.mistLayer });
    });
  }
  return out;
}

/**
 * 建立林间薄雾漂移动画。
 * @param {Array<import('three').Object3D>} roots
 */
export function createMistDrift(roots) {
  const layers = collectMistLayers(roots);
  const cfg = ANIM.mist;

  function update({ time }) {
    for (const { mesh, meta } of layers) {
      const phase = (time / meta.period) * Math.PI * 2 + meta.phase;
      const driftX = Math.sin(phase) * meta.driftSpan;
      const driftY = Math.cos(phase * 0.73 + 0.8) * meta.liftSpan;
      mesh.position.x = meta.baseX + driftX;
      mesh.position.y = meta.baseY + driftY;

      if (mesh.material) {
        const breathe = 0.5 + 0.5 * Math.sin(phase * 0.85 + 1.2);
        const opSpan = (cfg.opacityMax - cfg.opacityMin) * 0.45;
        mesh.material.opacity = Math.max(
          cfg.opacityMin,
          Math.min(cfg.opacityMax, meta.baseOpacity + (breathe - 0.5) * opSpan)
        );
      }
    }
  }

  registerAnimation(MIST_DRIFT_NAME, update);
  return { update, layers };
}
