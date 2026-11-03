import { installDomStub } from './dom-stub.mjs';
installDomStub();
const { createMaterialLibrary } = await import('../js/materials.js');
const M = createMaterialLibrary();
const THREE = await import('three');
for (const [species, path] of [['kusunoki', '../js/assets/tree-kusunoki.js'], ['kaede', '../js/assets/tree-kaede.js'], ['sakaki', '../js/assets/tree-sakaki.js']]) {
  const g = (await import(path)).default(M);
  g.updateMatrixWorld(true);
  let lowest = Infinity, highest = -Infinity;
  for (const inst of g.children) {
    const s = inst.scale.x;
    inst.traverse((n) => {
      if (n.userData && n.userData.leafCluster) {
        const b = new THREE.Box3().setFromObject(n);
        lowest = Math.min(lowest, (b.min.y - inst.position.y) / s);
        highest = Math.max(highest, (b.max.y - inst.position.y) / s);
      }
    });
  }
  console.log(`${species}: cluster y[${lowest.toFixed(2)}, ${highest.toFixed(2)}]`);
}
