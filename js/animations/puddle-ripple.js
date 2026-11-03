// 地面积水洼微澜（LAYOUT_PLAN §12）：极缓慢的同心微扰动 + 水面法线微调，不破坏雨后静谧感。
import { ANIM } from '../config.js';
import { registerAnimation } from './registry.js';

export const PUDDLE_RIPPLE_NAME = 'puddleRipple';

/**
 * 收集场景内所有带 userData.puddleRipple 的积水网格。
 * @param {Array<import('three').Object3D>} roots
 */
export function collectPuddleSurfaces(roots) {
  const out = [];
  for (const root of roots) {
    if (!root) continue;
    root.traverse((node) => {
      if (!node.isMesh || !node.userData || !node.userData.puddleRipple) return;
      const pos = node.geometry && node.geometry.getAttribute('position');
      if (!pos) return;
      // 求积水圆盘中心（扇形圆盘的第 0 个顶点即中心点）
      const cx = pos.getX(0);
      const cz = pos.getZ(0);
      const info = node.userData.puddleRipple;
      const rMax = Math.max(0.1, info.r || 0.3);
      const rzMax = Math.max(0.1, info.rz || 0.2);

      // 计算各顶点相对圆盘中心的归一化椭圆半径，边缘顶点权重为 0（保证水边贴紧石板/泥地不翘起）
      const weights = new Float32Array(pos.count);
      const radii = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const dx = (pos.getX(i) - cx) / rMax;
        const dz = (pos.getZ(i) - cz) / rzMax;
        const u = Math.min(1, Math.hypot(dx, dz));
        radii[i] = u;
        weights[i] = Math.max(0, 1 - u * u);
      }

      out.push({
        mesh: node,
        attribute: pos,
        base: Float32Array.from(pos.array),
        weights,
        radii,
        phase: info.phase || 0,
        period: Math.max(2.0, info.period || 4.5),
        material: node.material
      });
    });
  }
  return out;
}

/**
 * 建立积水洼微澜动画。
 * @param {Array<import('three').Object3D>} roots
 */
export function createPuddleRipple(roots) {
  const puddles = collectPuddleSurfaces(roots);
  const ampMax = Math.min(0.004, ANIM.puddleRipple.amplitudeMax || 0.004);

  function update({ time }) {
    for (const p of puddles) {
      const arr = p.attribute.array;
      const base = p.base;
      const w = p.weights;
      const r = p.radii;
      const omega = (Math.PI * 2) / p.period;

      for (let i = 0; i < p.attribute.count; i++) {
        if (w[i] <= 0.001) continue;
        const ringWave = Math.sin(r[i] * 9.5 - time * omega + p.phase);
        const breather = Math.cos(time * omega * 0.62 + p.phase * 1.3);
        arr[i * 3 + 1] = base[i * 3 + 1] + (ringWave * 0.65 + breather * 0.35) * ampMax * w[i];
      }
      p.attribute.needsUpdate = true;
      p.mesh.geometry.computeVertexNormals();

      if (p.material && p.material.userData && p.material.userData.uniforms && p.material.userData.uniforms.uTime) {
        p.material.userData.uniforms.uTime.value = time;
      }
    }
  }

  registerAnimation(PUDDLE_RIPPLE_NAME, update);
  return { update, puddles };
}
