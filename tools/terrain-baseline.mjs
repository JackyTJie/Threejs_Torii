import fs from 'node:fs';
import { installDomStub } from './dom-stub.mjs';
installDomStub();
const { terrainHeight } = await import('../js/layout.js');
const out = process.argv[2] || '/tmp/terrain.txt';
const lines = [];
let maxStep = 0, where = '';
for (let x = -21; x <= 21; x += 0.2) {
  for (let z = -21; z <= 21; z += 0.2) {
    lines.push(`${x.toFixed(2)},${z.toFixed(2)},${terrainHeight(x, z).toFixed(6)}`);
    for (const [dx, dz] of [[0.02, 0], [0, 0.02]]) {
      const d = Math.abs(terrainHeight(x + dx, z + dz) - terrainHeight(x, z));
      if (d > maxStep) { maxStep = d; where = `(${x.toFixed(2)},${z.toFixed(2)})→(${(x + dx).toFixed(2)},${(z + dz).toFixed(2)})`; }
    }
  }
}
fs.writeFileSync(out, lines.join('\n'));
console.log(`相邻 2 cm 最大高差 ${maxStep.toFixed(4)} m at ${where}  (${lines.length} samples → ${out})`);
