import { installDomStub } from './dom-stub.mjs';
installDomStub();
const { createMaterialLibrary } = await import('../js/materials.js');
const M = createMaterialLibrary();
const { TREES, terrainHeight, CANOPY_SAFE } = await import('../js/layout.js');
const THREE = await import('three');
const groves = {
  kusunoki: (await import('../js/assets/tree-kusunoki.js')).default,
  kaede: (await import('../js/assets/tree-kaede.js')).default,
  sakaki: (await import('../js/assets/tree-sakaki.js')).default
};
for (const [species, factory] of Object.entries(groves)) {
  const g = factory(M);
  g.updateMatrixWorld(true);
  const gb = new THREE.Box3().setFromObject(g);
  console.log(`=== ${species} grove x[${gb.min.x.toFixed(2)},${gb.max.x.toFixed(2)}] y[${gb.min.y.toFixed(2)},${gb.max.y.toFixed(2)}] z[${gb.min.z.toFixed(2)},${gb.max.z.toFixed(2)}]`);
  let maxLocal = 0;
  for (const inst of g.children) {
    const b = new THREE.Box3().setFromObject(inst);
    const s = inst.scale.x;
    const ext = {
      xn: (inst.position.x - b.min.x) / s, xp: (b.max.x - inst.position.x) / s,
      zn: (inst.position.z - b.min.z) / s, zp: (b.max.z - inst.position.z) / s
    };
    maxLocal = Math.max(maxLocal, ext.xn, ext.xp, ext.zn, ext.zp);
    const over = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
    console.log(`  ${inst.name} pos(${inst.position.x},${inst.position.z}) s${s} ext x[-${ext.xn.toFixed(2)},+${ext.xp.toFixed(2)}] z[-${ext.zn.toFixed(2)},+${ext.zp.toFixed(2)}] topL ${((b.max.y-inst.position.y)/s).toFixed(2)} botL ${((b.min.y-inst.position.y)/s).toFixed(2)} ground ${inst.position.y.toFixed(2)} | maxAbs ${over.toFixed(2)}${over > CANOPY_SAFE ? ' << OVER' : ''}`);
  }
  console.log(`  max local half-extent = ${maxLocal.toFixed(3)}`);
}
