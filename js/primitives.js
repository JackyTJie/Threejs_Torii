// 基元与几何工具：曲线扫掠 / 车削 / 倒角板 / 叶片薄片 / 高度场地形 / 确定性随机
// 所有资产模块共用这里的构造器；每个资产仍各自生成独立几何，不做任何网格合并。
import * as THREE from 'three';

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ 随机 */

/** mulberry32：确定性伪随机，同一 seed 复现同一模型（审计可重放） */
export function rng(seed = 1) {
  let a = (seed | 0) || 1;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 三维整数哈希噪声 [0,1) */
export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 平滑三维值噪声 */
export function valueNoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w
  );
}

/** 分形叠加噪声 */
export function fbm3(x, y, z, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

/* ------------------------------------------------------------------ 组装 */

export function group(name) {
  const g = new THREE.Group();
  g.name = name;
  return g;
}

export function mesh(geometry, material, name = '') {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  return m;
}

export function setPos(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

export function rotY(object, radians) {
  object.rotation.y = radians;
  return object;
}

/** 统一摆放：位置 + 绕 Y 转角 + 可选缩放 */
export function place(object, { x = 0, y = 0, z = 0, ry = 0, scale = 1, sx, sy, sz } = {}) {
  object.position.set(x, y, z);
  object.rotation.y = ry;
  object.scale.set(sx ?? scale, sy ?? scale, sz ?? scale);
  return object;
}

/** 把资产整体移动到指定落点（资产内部以原点为基准建模时使用） */
export function anchor(object, x, y, z) {
  return setPos(object, x, y, z);
}

/* ------------------------------------------------------------------ 基元 */

export function box(w, h, d, material, name = 'box') {
  return mesh(new THREE.BoxGeometry(w, h, d), material, name);
}

/** 带落点的方块 */
export function boxAt(name, material, { x, y, z, w, h, d, ry = 0 }) {
  const m = box(w, h, d, material, name);
  return place(m, { x, y, z, ry });
}

export function plane(w, h, material, name = 'plane', widthSegments = 1, heightSegments = 1) {
  return mesh(new THREE.PlaneGeometry(w, h, widthSegments, heightSegments), material, name);
}

export function cylinder(rTop, rBottom, height, material, name = 'cylinder', segments = 16, openEnded = false) {
  return mesh(new THREE.CylinderGeometry(rTop, rBottom, height, segments, 1, openEnded), material, name);
}

export function cylinderAt(name, material, { x, y, z, rTop, rBottom, height, segments = 16, ry = 0, tiltX = 0, tiltZ = 0 }) {
  const m = cylinder(rTop, rBottom ?? rTop, height, material, name, segments);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.rotation.x = tiltX;
  m.rotation.z = tiltZ;
  return m;
}

/** 上细下粗的锥形杆（电线杆 / 立柱常用） */
export function taperedCylinder(name, material, { x, y, z, height, rBottom, rTop, segments = 14, tiltX = 0, tiltZ = 0, ry = 0 }) {
  const m = cylinder(rTop, rBottom, height, material, name, segments);
  m.position.set(x, y, z);
  m.rotation.set(tiltX, ry, tiltZ);
  return m;
}

export function sphere(r, material, name = 'sphere', widthSegments = 20, heightSegments = 14) {
  return mesh(new THREE.SphereGeometry(r, widthSegments, heightSegments), material, name);
}

export function cone(r, height, material, name = 'cone', segments = 14) {
  return mesh(new THREE.ConeGeometry(r, height, segments), material, name);
}

export function torus(r, tube, material, name = 'torus', radialSegments = 10, tubularSegments = 24) {
  return mesh(new THREE.TorusGeometry(r, tube, radialSegments, tubularSegments), material, name);
}

export function capsule(r, length, material, name = 'capsule', radialSegments = 10, capSegments = 6) {
  return mesh(new THREE.CapsuleGeometry(r, length, capSegments, radialSegments), material, name);
}

/* ------------------------------------------------------------------ 倒角 / 车削 / 挤出 */

/** 正方形平面轮廓的倒角（45° 切角）环 */
function chamferedRing(half, chamfer) {
  const c = Math.min(chamfer, half * 0.9);
  const h = half;
  return [
    [-h + c, -h], [h - c, -h], [h, -h + c], [h, h - c], [h - c, h],
    [-h + c, h], [-h, h - c], [-h, -h + c]
  ];
}

/** 倒角方板：顶底棱边各切 45°，用于底座 / 站台盖板 */
export function chamferedSlabGeometry(half, thickness, chamfer, bevelSegments = 2) {
  const shape = new THREE.Shape();
  const ring = chamferedRing(half, chamfer);
  shape.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
  shape.closePath();

  const flat = thickness / 2 - chamfer;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness - chamfer * 2, bevelEnabled: false });
  geo.translate(0, 0, -flat);

  // 顶 / 底倒角带：从内缩的平整面斜接到全尺寸棱线
  mergeInto(geo, buildBevelRing(ring, chamfer, thickness / 2, -1, bevelSegments));
  mergeInto(geo, buildBevelRing(ring, chamfer, -thickness / 2, +1, bevelSegments));
  geo.computeVertexNormals();
  return geo;
}

/** 生成一圈 45° 倒角带（非索引三角） */
function buildBevelRing(ring, chamfer, flatOffset, sign, segments) {
  const pos = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % n];
    for (let s = 0; s < segments; s++) {
      const t0 = s / segments;
      const t1 = (s + 1) / segments;
      const z0 = flatOffset + sign * chamfer * t0;
      const z1 = flatOffset + sign * chamfer * t1;
      const o0 = chamfer * (1 - t0);
      const o1 = chamfer * (1 - t1);
      const a0 = insetPoint(ring, i, o0);
      const b0 = insetPoint(ring, (i + 1) % n, o0);
      const a1 = insetPoint(ring, i, o1);
      const b1 = insetPoint(ring, (i + 1) % n, o1);
      if (sign >= 0) {
        pos.push(a0[0], a0[1], z0, b0[0], b0[1], z0, b1[0], b1[1], z1);
        pos.push(a0[0], a0[1], z0, b1[0], b1[1], z1, a1[0], a1[1], z1);
      } else {
        pos.push(a0[0], a0[1], z0, b1[0], b1[1], z1, b0[0], b0[1], z0);
        pos.push(a0[0], a0[1], z0, a1[0], a1[1], z1, b1[0], b1[1], z1);
      }
    }
  }
  return pos;
}

/** 沿轮廓内法线方向内缩（用于倒角带逐层收缩） */
function insetPoint(ring, index, offset) {
  const n = ring.length;
  const prev = ring[(index - 1 + n) % n];
  const cur = ring[index];
  const next = ring[(index + 1) % n];
  let nx = -(next[1] - cur[1]);
  let ny = next[0] - cur[0];
  const l = Math.hypot(nx, ny) || 1;
  nx /= l;
  ny /= l;
  let px = -(cur[1] - prev[1]);
  let py = cur[0] - prev[0];
  const lp = Math.hypot(px, py) || 1;
  px /= lp;
  py /= lp;
  let ix = nx + px;
  let iy = ny + py;
  const li = Math.hypot(ix, iy) || 1;
  ix /= li;
  iy /= li;
  return [cur[0] + ix * offset, cur[1] + iy * offset];
}

/** 把一组非索引三角追加进目标几何 */
/**
 * 把一批非索引三角并入目标几何。
 *
 * 关键：并入前必须先把索引「展开」成逐面顶点。直接置 index = null 会让渲染器按
 * 连续三点取面，原本被多个面共享的顶点会被错排成另一套三角形（面朝向、面积全乱），
 * 审计里表现为整块网格成片「法线朝内」。所有属性（position / normal / uv）都要按
 * 同一索引序列展开，否则展开后顶点数变了而属性还是旧的。
 */
function mergeInto(target, positions) {
  const index = target.getIndex();
  const merged = {};
  if (index) {
    for (const [name, attr] of Object.entries(target.attributes)) {
      const itemSize = attr.itemSize;
      const out = new Float32Array((index.count / 3) * 3 * itemSize);
      let o = 0;
      for (let i = 0; i + 2 < index.count; i += 3) {
        for (const vi of [index.getX(i), index.getX(i + 1), index.getX(i + 2)]) {
          for (let k = 0; k < itemSize; k++) out[o++] = attr.getComponent(vi, k);
        }
      }
      merged[name] = new THREE.Float32BufferAttribute(out, itemSize);
    }
    target.index = null;
  } else {
    for (const [name, attr] of Object.entries(target.attributes)) merged[name] = attr;
  }

  const pos = merged.position;
  const arr = Array.from(pos.array);
  for (const v of positions) arr.push(v);
  target.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  for (const [name, attr] of Object.entries(merged)) {
    if (name !== 'position') target.setAttribute(name, attr);
  }
}

/** 圆角矩形 Shape（挤出成面板 / 箱体） */
export function roundedRectShape(w, h, radius) {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(radius, Math.min(hw, hh) * 0.95);
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hw, hh - r);
  s.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hw + r, hh);
  s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hh + r);
  s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  s.closePath();
  return s;
}

/** 倒角方盒（用圆角轮廓挤出，保留完整细节，不做减面） */
export function roundedBoxGeometry(w, h, d, radius = 0.03) {
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, radius), { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  geo.computeVertexNormals();
  return geo;
}

export function extrudeShape(name, material, shape, depth) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return mesh(geo, material, name);
}

/** 车削：profile = [{x, y}] 绕 Y 轴回转 */
export function lathe(name, material, profile, segments = 20) {
  const pts = profile.map((p) => new THREE.Vector2(p.x ?? p[0], p.y ?? p[1]));
  return mesh(new THREE.LatheGeometry(pts, segments), material, name);
}

/* ------------------------------------------------------------------ 曲线扫掠 */

/** 沿曲线建立平行输运坐标系（切线 / 侧法线 / 竖法线） */
function sweepFrames(curve, segments) {
  const frames = [];
  const pts = [];
  for (let i = 0; i <= segments; i++) pts.push(curve.getPoint(i / segments, new THREE.Vector3()));
  let prevNormal = null;
  for (let i = 0; i <= segments; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const tangent = new THREE.Vector3().subVectors(next, prev);
    if (tangent.lengthSq() < 1e-12) tangent.set(1, 0, 0);
    tangent.normalize();
    let side = new THREE.Vector3(0, 1, 0).cross(tangent);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    if (prevNormal && prevNormal.dot(side) < 0) side.multiplyScalar(-1);
    prevNormal = side;
    const up = new THREE.Vector3().crossVectors(tangent, side).normalize();
    frames.push({ point: pts[i], tangent, side, up });
  }
  return frames;
}

/**
 * 沿曲线扫掠二维轮廓（u 沿侧法线、v 沿竖法线）。
 * 用于轨条、扶手、檐口、椽条等变截面长构件。
 */
export function sweepProfileGeometry(curve, profile, segments = 24, { capEnds = true } = {}) {
  const frames = sweepFrames(curve, segments);
  const n = profile.length;
  const pos = [];
  const push = (frame, u, v) => {
    pos.push(
      frame.point.x + frame.side.x * u + frame.up.x * v,
      frame.point.y + frame.side.y * u + frame.up.y * v,
      frame.point.z + frame.side.z * u + frame.up.z * v
    );
  };
  for (let i = 0; i < segments; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    for (let j = 0; j < n; j++) {
      const [u0, v0] = profile[j];
      const [u1, v1] = profile[(j + 1) % n];
      push(f0, u0, v0); push(f1, u0, v0); push(f1, u1, v1);
      push(f0, u0, v0); push(f1, u1, v1); push(f0, u1, v1);
    }
  }
  if (capEnds) {
    // 轮廓按 (u,v) 顺时针给出外法线；端盖需按相反扇向封口
    for (const [frame, reverse] of [[frames[0], false], [frames[segments], true]]) {
      const center = { point: frame.point, side: frame.side, up: frame.up };
      for (let j = 0; j < n; j++) {
        const [u0, v0] = profile[j];
        const [u1, v1] = profile[(j + 1) % n];
        if (reverse) {
          push(center, 0, 0); push(frame, u1, v1); push(frame, u0, v0);
        } else {
          push(center, 0, 0); push(frame, u0, v0); push(frame, u1, v1);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * 闭合回转体：LatheGeometry 的首末环（半径 eps）汇聚到轴上一点封口，
 * 消除极点小孔与退化三角，使网格成为真正的边流形封闭壳体（可做有向体积判据）。
 * 端盖缠绕方向按实际顶点位置判定，不依赖回转参数化方向。
 */
export function closedLathe(name, material, profile, segments = 24, eps = 0.004) {
  const pts = profile.map((p) => new THREE.Vector2(Math.max(eps, p.x ?? p[0]), p.y ?? p[1]));
  const n = pts.length;
  const src = new THREE.LatheGeometry(pts, segments);
  const pos = src.getAttribute('position');
  const idx = src.getIndex();
  const old = pos.count;
  const positions = new Float32Array((old + 2) * 3);
  positions.set(pos.array);
  positions[old * 3 + 1] = pts[0].y;
  positions[(old + 1) * 3 + 1] = pts[n - 1].y;
  const indices = Array.from(idx.array);

  /** 沿首 / 末环的纵向边界环铺扇形端盖；法向 y 分量与期望朝向不符时翻转扇向 */
  const cap = (ringOffset, apex, outwardY) => {
    const at = (i) => {
      const k = i * n + ringOffset;
      return [pos.getX(k), pos.getZ(k)];
    };
    const a = at(0);
    const b = at(1);
    const ny = a[1] * b[0] - a[0] * b[1];
    const flip = Math.sign(ny) !== Math.sign(outwardY);
    for (let i = 0; i < segments; i++) {
      const i0 = i * n + ringOffset;
      const i1 = (i + 1) * n + ringOffset;
      if (flip) indices.push(apex, i1, i0);
      else indices.push(apex, i0, i1);
    }
  };

  cap(0, old, -1);
  cap(n - 1, old + 1, 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return mesh(geo, material, name);
}

/** 折线 / 样条曲线扫掠矩形截面（宽 × 厚） */
export function curvedStripGeometry(points, width, thickness, segments = 24) {
  const curve = points.length === 2
    ? new THREE.LineCurve3(points[0], points[1])
    : new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  const half = width / 2;
  const halfT = thickness / 2;
  const profile = [[-half, -halfT], [-half, halfT], [half, halfT], [half, -halfT]];
  return sweepProfileGeometry(curve, profile, segments);
}

/** 简化钢轨截面（轨头 / 轨腰 / 轨底），原点位于轨底中心 */
// 顺时针（u 侧向 / v 竖向）给出外法线
export const RAIL_PROFILE = [
  [-0.055, 0.0], [-0.021, 0.046], [-0.012, 0.1], [-0.036, 0.116], [-0.036, 0.15],
  [0.036, 0.15], [0.036, 0.116], [0.012, 0.1], [0.021, 0.046], [0.055, 0.03], [0.055, 0.0]
];

/** 悬垂电线：两端点 + 垂度 → 二次贝塞尔管 */
export function saggingCable(name, material, a, b, sag, radius = 0.014, segments = 24) {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  return mesh(new THREE.TubeGeometry(curve, segments, radius, 6, false), material, name);
}

/** 沿点列生成圆管（扶手 / 管线 / 枝干） */
/**
 * 圆弧带（泥除け / 箍 / 轮圈）：沿半径方向为厚度、沿 z 轴方向为宽度，闭合实体。
 * 侧壁缠绕按右手定则给出外法线；两端盖扇向按实际顶点法向判定。
 */
export function arcBand(name, material, { radius, a0, a1, width, thickness, segments = 16, center = [0, 0, 0] }) {
  const [cx, cy, cz] = center;
  const hw = width / 2;
  const r0 = radius;
  const r1 = radius + thickness;
  const n = segments + 1;
  const pos = [];
  const idx = [];
  const corner = (a, r, w) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz + w];
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i / (n - 1));
    pos.push(...corner(a, r0, -hw), ...corner(a, r1, -hw), ...corner(a, r1, hw), ...corner(a, r0, hw));
  }
  for (let i = 0; i < n - 1; i++) {
    const b = i * 4;
    const nb = (i + 1) * 4;
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4;
      const A = b + j;
      const B = b + k;
      const C = nb + k;
      const D = nb + j;
      idx.push(A, D, C, A, C, B);
    }
  }
  const capAt = (i) => {
    const base = i * 4;
    const a = a0 + (a1 - a0) * (i / (n - 1));
    const cIdx = pos.length / 3;
    pos.push(cx + Math.cos(a) * (r0 + r1) / 2, cy + Math.sin(a) * (r0 + r1) / 2, cz);
    const tangent = [-Math.sin(a), Math.cos(a), 0];
    const want = i === 0 ? -1 : 1; // 起始端盖朝 -切向，末端朝 +切向
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4;
      const P = base + j;
      const Q = base + k;
      const c = [pos[cIdx * 3], pos[cIdx * 3 + 1], pos[cIdx * 3 + 2]];
      const p = [pos[P * 3] - c[0], pos[P * 3 + 1] - c[1], pos[P * 3 + 2] - c[2]];
      const q = [pos[Q * 3] - c[0], pos[Q * 3 + 1] - c[1], pos[Q * 3 + 2] - c[2]];
      const nrm = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      const dot = (nrm[0] * tangent[0] + nrm[1] * tangent[1] + nrm[2] * tangent[2]) * want;
      if (dot > 0) idx.push(cIdx, P, Q);
      else idx.push(cIdx, Q, P);
    }
  };
  capAt(0);
  capAt(n - 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return mesh(geo, material, name);
}

export function tubeFromPoints(name, material, points, radius = 0.05, segments = 24, radialSegments = 8) {
  const curve = points.length === 2
    ? new THREE.LineCurve3(points[0], points[1])
    : new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  return mesh(new THREE.TubeGeometry(curve, segments, radius, radialSegments, false), material, name);
}

/* ------------------------------------------------------------------ 地形 / 岩石 */

/** 高度场地块（cols × rows 网格，逐点取 heightFn） */
export function terrainPatchGeometry({ x0, x1, z0, z1, cols, rows, heightFn }) {
  const pos = [];
  const idx = [];
  for (let iz = 0; iz <= rows; iz++) {
    const z = z0 + (z1 - z0) * (iz / rows);
    for (let ix = 0; ix <= cols; ix++) {
      const x = x0 + (x1 - x0) * (ix / cols);
      pos.push(x, heightFn(x, z), z);
    }
  }
  const row = cols + 1;
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const a = iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, c, b);
      idx.push(b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 噪声扰动岩石（保留完整三角，不减面） */
/** 按 fbm 位移 + 纵向压扁造一块岩石；amp 为径向位移振幅（米） */
function buildRock(radius, seed, { widthSegments, heightSegments, flatten, amp }) {
  const geo = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const dir = v.clone().normalize();
    const n = fbm3(dir.x * 2.4 + seed, dir.y * 2.4, dir.z * 2.4, 4);
    const k = 1 + (n - 0.5) * 2 * (amp / radius);
    v.multiplyScalar(k);
    v.y *= flatten;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.translate(0, radius * flatten * 0.35, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 折叠三角计数：面法线与平滑顶点法线明显反向（cos < -0.35）的三角形个数。
 * 判据与 tools/scene-audit.mjs 的面反转判据一致，让建模端自己守住同一底线。
 */
function foldedTriangleCount(geo) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const index = geo.getIndex();
  if (!pos || !nor) return 0;
  const tris = index ? index.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const face = new THREE.Vector3();
  const vn = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let bad = 0;
  for (let i = 0; i + 2 < tris; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    face.crossVectors(ab, ac);
    const area = face.length();
    if (area < 1e-12) continue;
    face.multiplyScalar(1 / area);
    vn.set(0, 0, 0);
    vn.fromBufferAttribute(nor, ia);
    tmp.fromBufferAttribute(nor, ib);
    vn.add(tmp);
    tmp.fromBufferAttribute(nor, ic);
    vn.add(tmp);
    const vnLen = vn.length();
    if (vnLen < 1e-12) continue;
    if (face.dot(vn) / vnLen < -0.35) bad += 1;
  }
  return bad;
}

/**
 * 岩石 / 苔块 / 碎石几何（球面 + fbm 位移 + 纵向压扁），返回未加 Mesh 的几何体。
 *
 * 振幅自动收敛：径向位移一旦接近相邻顶点的纵向间距，曲面就会翻折出自交三角——薄壳尤其
 * 明显（压扁到 5% 的苔衣在 wobble 0.34 下有 7 个折叠三角）。这里从 wobble 起建，出现折叠
 * 就按 0.72 缩小振幅重建，直到没有折叠；最终振幅记在 userData.rockAmp 便于核对造型意图。
 */
export function rockGeometry(radius, seed, { widthSegments = 18, heightSegments = 12, wobble = 0.22, flatten = 0.78, detail = 0 } = {}) {
  void detail;
  let amp = radius * wobble;
  let geo = buildRock(radius, seed, { widthSegments, heightSegments, flatten, amp });
  for (let attempt = 0; attempt < 8 && foldedTriangleCount(geo) > 0; attempt++) {
    amp *= 0.72;
    geo = buildRock(radius, seed, { widthSegments, heightSegments, flatten, amp });
  }
  geo.userData.rockAmp = amp;
  return geo;
}

/* ------------------------------------------------------------------ 叶片薄片 */

/** 叶形轮廓极径函数：maple 多裂、beech 椭圆带细齿 */
function leafRadius(kind, angle) {
  if (kind === 'maple') {
    const lobes = 5;
    const base = 0.62 + 0.38 * Math.abs(Math.cos((angle * lobes) / 2));
    const tip = 1 + 0.35 * Math.pow(Math.abs(Math.cos((angle * lobes) / 2)), 6);
    return base * tip;
  }
  if (kind === 'beech') {
    return 0.78 + 0.22 * Math.abs(Math.sin(angle * 7)) * 0.35 + 0.2 * Math.abs(Math.cos(angle));
  }
  return 0.85 + 0.15 * Math.abs(Math.cos(angle * 4));
}

/** 叶片轮廓点列（XY 平面，叶尖朝 +Y） */
export function leafOutline(kind = 'maple', size = 0.1, steps = 26) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = leafRadius(kind, a) * size;
    pts.push([Math.cos(a) * r * 0.85, Math.sin(a) * r + size * 0.15]);
  }
  return pts;
}

/**
 * 落叶薄片几何：真实薄实体（上下面 + 周缘），带纵向卷曲与横向拱曲。
 * 不是贴图面片 —— 每片都是独立闭合几何体。
 */
export function leafSheetGeometry({ kind = 'maple', size = 0.1, thickness = 0.0035, curl = 0.28, steps = 26 } = {}) {
  const outline = leafOutline(kind, size, steps);
  const n = outline.length;
  const halfT = thickness / 2;
  const pos = [];

  const bend = (x, y) => {
    const r = Math.min(1, Math.hypot(x, y) / (size * 1.1));
    return (curl * size) * (r * r * 0.9 - 0.18 * (y / size)) + (curl * size * 0.25) * Math.sin(x * 9 / size);
  };

  const center = { x: 0, y: size * 0.12 };
  const cz = bend(center.x, center.y);

  for (let i = 0; i < n; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % n];
    const az = bend(ax, ay);
    const bz = bend(bx, by);
    // 上面
    pos.push(center.x, center.y, cz + halfT, ax, ay, az + halfT, bx, by, bz + halfT);
    // 下面（反向）
    pos.push(center.x, center.y, cz - halfT, bx, by, bz - halfT, ax, ay, az - halfT);
    // 周缘（顺时针给出外法线）
    pos.push(ax, ay, az - halfT, bx, by, bz + halfT, ax, ay, az + halfT);
    pos.push(ax, ay, az - halfT, bx, by, bz - halfT, bx, by, bz + halfT);
  }

  // 叶柄
  const stalk = size * 0.42;
  const s0 = [center.x, center.y, cz];
  const s1 = [center.x, center.y - stalk, cz - curl * size * 0.35];
  const w = thickness * 1.6;
  pos.push(s0[0] - w, s0[1], s0[2], s1[0] - w, s1[1], s1[2], s1[0] + w, s1[1], s1[2]);
  pos.push(s0[0] - w, s0[1], s0[2], s1[0] + w, s1[1], s1[2], s0[0] + w, s0[1], s0[2]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** 树叶片簇用的窄长薄片（带主脉拱曲） */
export function leafBladeGeometry({ length = 0.16, width = 0.12, thickness = 0.004, arch = 0.3, steps = 8 } = {}) {
  const pos = [];
  const halfT = thickness / 2;
  const zAt = (u, v) => arch * length * (1 - (u * u + v * v));
  for (let i = 0; i < steps; i++) {
    const u0 = -1 + (2 * i) / steps;
    const u1 = -1 + (2 * (i + 1)) / steps;
    const w0 = Math.sqrt(Math.max(0, 1 - u0 * u0)) * width * 0.5;
    const w1 = Math.sqrt(Math.max(0, 1 - u1 * u1)) * width * 0.5;
    const x0 = u0 * length * 0.5;
    const x1 = u1 * length * 0.5;
    const z0 = zAt(u0, 0);
    const z1 = zAt(u1, 0);
    pos.push(x0, -w0, z0 + halfT, x1, -w1, z1 + halfT, x1, w1, z1 + halfT);
    pos.push(x0, -w0, z0 + halfT, x1, w1, z1 + halfT, x0, w0, z0 + halfT);
    pos.push(x0, -w0, z0 - halfT, x1, w1, z1 - halfT, x1, -w1, z1 - halfT);
    pos.push(x0, -w0, z0 - halfT, x0, w0, z0 + halfT, x1, w1, z1 + halfT);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ 常用构件 */

/** 带框面板：外框 + 内嵌板（窗 / 门 / 公告牌通用） */
export function panelWithFrame(name, materials, { width, height, frame = 0.07, depth = 0.05, panelInset = 0.012, mullions = 0 }) {
  const g = group(name);
  const frameMat = materials.frame;
  const panelMat = materials.panel;
  const halfW = width / 2;
  const halfH = height / 2;

  const addFrameBar = (barName, w, h, x, y) => {
    g.add(boxAt(barName, frameMat, { x, y, z: 0, w, h, d: depth }));
  };
  addFrameBar(`${name}-frame-top`, width, frame, 0, halfH - frame / 2);
  addFrameBar(`${name}-frame-bottom`, width, frame, 0, -halfH + frame / 2);
  addFrameBar(`${name}-frame-left`, frame, height - frame * 2, -halfW + frame / 2, 0);
  addFrameBar(`${name}-frame-right`, frame, height - frame * 2, halfW - frame / 2, 0);

  const innerW = width - frame * 2;
  const innerH = height - frame * 2;
  if (panelMat) {
    const panel = boxAt(`${name}-panel`, panelMat, {
      x: 0, y: 0, z: 0, w: innerW, h: innerH, d: Math.max(0.006, depth - panelInset * 2)
    });
    g.add(panel);
  }
  for (let i = 1; i <= mullions; i++) {
    const x = -innerW / 2 + (innerW * i) / (mullions + 1);
    g.add(boxAt(`${name}-mullion-${i}`, frameMat, { x, y: 0, z: 0, w: frame * 0.6, h: innerH, d: depth * 1.05 }));
  }
  return g;
}

/** 六角螺栓头 + 垫圈（小五金，独立网格） */
export function bolt(name, material, { x, y, z, r = 0.018, height = 0.012, segments = 6 }) {
  const m = cylinder(r, r, height, material, name, segments);
  m.position.set(x, y, z);
  return m;
}

/** 车轮：轮圈 + 辐条（自行车 / 手推车用） */
export function wheel(name, materials, { radius = 0.32, width = 0.028, spokes = 12, hubRadius = 0.035 }) {
  const g = group(name);
  g.add(torus(radius, width * 0.5, materials.tyre, `${name}-tyre`, 8, 28));
  g.add(torus(radius - width * 0.6, width * 0.35, materials.rim, `${name}-rim`, 6, 28));
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const spoke = cylinder(width * 0.22, width * 0.22, radius - width, materials.spoke, `${name}-spoke-${i}`, 6);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = a;
    spoke.position.set(Math.cos(a) * (radius - width) * 0.5, Math.sin(a) * (radius - width) * 0.5, 0);
    spoke.rotation.set(0, 0, a + Math.PI / 2);
    g.add(spoke);
  }
  const hub = cylinder(hubRadius, hubRadius, width * 1.6, materials.hub, `${name}-hub`, 10);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  return g;
}

/** 铸铁格栅：条栅 + 边框（排水沟盖 / 炉排） */
export function grate(name, material, { width = 0.4, length = 0.6, bars = 6, barWidth = 0.03, barHeight = 0.022 }) {
  const g = group(name);
  const frameT = 0.028;
  g.add(boxAt(`${name}-frame-long-a`, material, { x: 0, y: 0, z: length / 2 - frameT / 2, w: width, h: barHeight, d: frameT }));
  g.add(boxAt(`${name}-frame-long-b`, material, { x: 0, y: 0, z: -length / 2 + frameT / 2, w: width, h: barHeight, d: frameT }));
  g.add(boxAt(`${name}-frame-side-a`, material, { x: -width / 2 + frameT / 2, y: 0, z: 0, w: frameT, h: barHeight, d: length }));
  g.add(boxAt(`${name}-frame-side-b`, material, { x: width / 2 - frameT / 2, y: 0, z: 0, w: frameT, h: barHeight, d: length }));
  const usable = length - frameT * 2;
  for (let i = 0; i < bars; i++) {
    const z = -usable / 2 + (usable * (i + 0.5)) / bars;
    g.add(boxAt(`${name}-bar-${i}`, material, { x: 0, y: barHeight * 0.35, z, w: width - frameT * 2, h: barHeight, d: barWidth }));
  }
  return g;
}

/** 一排独立木板（站台面缝 / 木地板 / 长椅座板） */
export function plankSeries(name, material, { x0, x1, z0, z1, plankWidth, gap, thickness, along = 'x', stagger = 0 }) {
  const g = group(name);
  const span = along === 'x' ? x1 - x0 : z1 - z0;
  const pitch = plankWidth + gap;
  const count = Math.max(1, Math.floor(span / pitch));
  const rand = rng(stagger || 7);
  for (let i = 0; i < count; i++) {
    const c = -span / 2 + pitch * (i + 0.5);
    const wear = 1 - rand() * 0.06;
    if (along === 'x') {
      const m = boxAt(`${name}-plank-${i}`, material, {
        x: (x0 + x1) / 2 + c, y: 0, z: (z0 + z1) / 2,
        w: plankWidth * wear, h: thickness, d: (z1 - z0)
      });
      g.add(m);
    } else {
      g.add(boxAt(`${name}-plank-${i}`, material, {
        x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2 + c,
        w: (x1 - x0), h: thickness, d: plankWidth * wear
      }));
    }
  }
  return g;
}

/** 阶梯序列：n 级独立踏步 */
export function stairRun(name, material, { steps, stepRise, stepTread, width, direction = 1, originX = 0, originY = 0, originZ = 0, along = 'x' }) {
  const g = group(name);
  for (let i = 0; i < steps; i++) {
    const y = originY + stepRise * (i + 0.5);
    if (along === 'x') {
      const x = originX + direction * stepTread * (i + 0.5);
      g.add(boxAt(`${name}-step-${i}`, material, { x, y, z: originZ, w: stepTread, h: stepRise, d: width }));
    } else {
      const z = originZ + direction * stepTread * (i + 0.5);
      g.add(boxAt(`${name}-step-${i}`, material, { x: originX, y, z, w: width, h: stepRise, d: stepTread }));
    }
  }
  return g;
}

/** 沿曲线排布构件（枕木 / 护栏柱 / 瓦行）：每个实例独立网格 */
export function distributeAlongTrack(namePrefix, material, { xFrom, xTo, pitch, builder }) {
  const g = group(namePrefix);
  let i = 0;
  for (let x = xFrom; x <= xTo; x += pitch, i++) {
    const item = builder(x, i);
    if (item) g.add(item);
  }
  return g;
}

export { DEG };

/* -------------------------------------------------- 石板 / 凸轮廓拉伸 */

/** 按期望外法线定向铺一个三角（非索引，逐面独立顶点） */
function orientTriangle(out, a, b, c, outward) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx * outward[0] + ny * outward[1] + nz * outward[2] < 0) {
    out.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
  } else {
    out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
}

/**
 * 石板几何：ring 为 XZ 平面内的凸多边形轮廓 [[x, z], …]，顶面 y = 0、底面 y = -thickness。
 * 顶/底扇形 + 侧壁四边形，逐面独立顶点（非索引）⇒ computeVertexNormals 给出面法线，
 * 90° 棱边保持锐利（ExtrudeGeometry 会共享顶盖与侧壁顶点，把石棱糊成圆角）。
 * 闭合流形：每条边恰好被两个三角共用。
 */
export function slabGeometry(ring, thickness) {
  const n = ring.length;
  if (n < 3) throw new Error('slabGeometry: 轮廓至少需要 3 个顶点');
  let cx = 0;
  let cz = 0;
  for (const [x, z] of ring) {
    cx += x;
    cz += z;
  }
  cx /= n;
  cz /= n;
  if (thickness <= 0) throw new Error('slabGeometry: thickness 必须为正');

  const pos = [];
  const apexTop = [cx, 0, cz];
  const apexBottom = [cx, -thickness, cz];
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % n];
    orientTriangle(pos, apexTop, [ax, 0, az], [bx, 0, bz], [0, 1, 0]);
    orientTriangle(pos, apexBottom, [bx, -thickness, bz], [ax, -thickness, az], [0, -1, 0]);

    const dx = bx - ax;
    const dz = bz - az;
    let nx = dz;
    let nz = -dx;
    if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const aT = [ax, 0, az];
    const bT = [bx, 0, bz];
    const aB = [ax, -thickness, az];
    const bB = [bx, -thickness, bz];
    orientTriangle(pos, aT, aB, bT, [nx, 0, nz]);
    orientTriangle(pos, bT, aB, bB, [nx, 0, nz]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * 三平面铺 uv：按每个三角的面法线主轴选投影面，uv = (局部坐标 + offset) / tile。
 * 用于 slabGeometry / terrainPatchGeometry 这类不产生 uv 的自建几何
 * （textures.js 的贴图一律 repeat(1,1)，所以平铺尺寸必须在资产里按世界米算）。
 */
export function triplanarUv(geo, tile, offset = [0, 0, 0]) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  if (!pos || !nrm) throw new Error('triplanarUv: 几何缺少 position / normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i + 2 < pos.count; i += 3) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 3; k++) {
      nx += nrm.getX(i + k);
      ny += nrm.getY(i + k);
      nz += nrm.getZ(i + k);
    }
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let main;
    if (ay >= ax && ay >= az) main = 'y';
    else if (ax >= az) main = 'x';
    else main = 'z';
    for (let k = 0; k < 3; k++) {
      const v = i + k;
      const x = pos.getX(v) + offset[0];
      const y = pos.getY(v) + offset[1];
      const z = pos.getZ(v) + offset[2];
      let u;
      let w;
      if (main === 'y') { u = x; w = z; }
      else if (main === 'x') { u = z; w = y; }
      else { u = x; w = y; }
      uv[v * 2] = u / tile;
      uv[v * 2 + 1] = w / tile;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
