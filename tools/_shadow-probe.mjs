import { LIGHT, PAD } from '../js/config.js';
import { shadowFrustum, sunDirection } from '../js/lighting.js';

const d = sunDirection();
const f = shadowFrustum(d);
console.log('PAD.half', PAD.half, 'PAD.size', PAD.size);
console.log('d', d.x.toFixed(4), d.y.toFixed(4), d.z.toFixed(4));
const right = f.rightAxis, up = f.upAxis;
console.log('right', right.x.toFixed(4), right.z.toFixed(4));
console.log('up', up.x.toFixed(4), up.y.toFixed(4), up.z.toFixed(4));
console.log('halfRight', (PAD.half*(Math.abs(right.x)+Math.abs(right.z))).toFixed(4));
console.log('upHorizontal', (PAD.half*(Math.abs(up.x)+Math.abs(up.z))).toFixed(4));
console.log('frustum', JSON.stringify({left:f.left,right:f.right,top:f.top,bottom:f.bottom,near:f.near,far:f.far}, (k,v)=>typeof v==='number'?+v.toFixed(4):v));
console.log('width', (f.right-f.left).toFixed(4), 'height', (f.top-f.bottom).toFixed(4));
console.log('texel mm', ((f.right-f.left)/LIGHT.shadowMapSize*1000).toFixed(3));
// worst-case box corner projection
const yMax = LIGHT.shadowSceneTop, yMin = LIGHT.shadowSceneBottom, m = LIGHT.shadowFitMargin;
const h = PAD.half;
let worst = -Infinity, worstPt = null;
for (const x of [-h, h]) for (const z of [-h, h]) for (const y of [yMin, yMax]) {
  const v = x*up.x + y*up.y + z*up.z;
  if (v > worst) { worst = v; worstPt = [x,y,z]; }
}
console.log('worst up-projection', worst.toFixed(4), 'at', worstPt, 'top bound', (f.top).toFixed(4), worst > f.top ? 'OVER' : 'ok');
