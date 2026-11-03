import { installDomStub } from './dom-stub.mjs';
installDomStub();
const { TWIGS, streamDistance, streamBankHalf, terrainHeight, insideCorridorCheck } = await import('../js/layout.js');
const L = await import('../js/layout.js');
for (const f of TWIGS) {
  const d = streamDistance(f.x, f.z);
  const lim = Math.max(L.streamBankHalf(f.z) - 0.05, L.STREAM.clearMargin);
  const corridor = f.x >= L.PATH.x0 && f.x <= L.PATH.x1 && f.z >= L.PATH.corridorZ0 && f.z <= L.PATH.corridorZ1;
  const boxes = L.toriiClearanceBoxes();
  const torii = boxes.some((b) => f.x >= b.x0 && f.x <= b.x1 && f.z >= b.z0 && f.z <= b.z1);
  console.log(
    `(${f.x.toFixed(2)}, ${f.z.toFixed(2)})  ground=${L.terrainHeight(f.x, f.z).toFixed(3)}  d=${d.toFixed(2)} lim=${lim.toFixed(2)} ${d < lim ? 'R3-FAIL' : 'ok'}  corridor=${corridor ? 'R2-FAIL' : 'ok'} torii=${torii ? 'R4-FAIL' : 'ok'}`
  );
}
