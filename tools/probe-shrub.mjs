import { installDomStub } from './dom-stub.mjs';
installDomStub();
const THREE = await import('three');
const { createMaterialLibrary } = await import('../js/materials.js');
const mod = await import('../js/assets/tree-shrub.js');
const M = createMaterialLibrary();

let r0 = Infinity, r1 = -Infinity, top = -Infinity, bot = Infinity;
let meshTotal = 0;
for (let s = 0; s < 40; s += 1) {
  const u = mod.createShrub(M, { seed: 4211 + s * 137, scale: 1, name: `probe-${s}` });
  u.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(u);
  r0 = Math.min(r0, box.min.x, box.min.z);
  r1 = Math.max(r1, box.max.x, box.max.z);
  top = Math.max(top, box.max.y);
  bot = Math.min(bot, box.min.y);
  let n = 0;
  u.traverse((o) => { if (o.isMesh) n += 1; });
  meshTotal += n;
}
console.log('unit shrub over 40 seeds:');
console.log('  horizontal half-extent min', r0.toFixed(4), ' max', r1.toFixed(4));
console.log('  top', top.toFixed(4), ' bottom', bot.toFixed(4));
console.log('  avg meshes per shrub', (meshTotal / 40).toFixed(1));
