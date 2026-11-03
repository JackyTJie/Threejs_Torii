// 本地 three 桩实现：仅用于离线静态审计与资产构建冒烟测试（不参与浏览器运行）
class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  clone() { return new Vector2(this.x, this.y); }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = this.y = this.z = s; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  lerpVectors(a, b, t) { this.x = a.x + (b.x - a.x) * t; this.y = a.y + (b.y - a.y) * t; this.z = a.z + (b.z - a.z) * t; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    return this.set(x, y, z);
  }
  crossVectors(a, b) {
    return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  getComponent(i) { return i === 0 ? this.x : i === 1 ? this.y : this.z; }
  setComponent(i, v) { if (i === 0) this.x = v; else if (i === 1) this.y = v; else this.z = v; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  applyQuaternion(q) {
    const x = this.x, y = this.y, z = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }
  // 真实 three: this.setFromMatrix4(new Matrix4().makeRotationAxis(axis, angle))
  applyAxisAngle(axis, angle) {
    return this.applyQuaternion(new Quaternion().setFromAxisAngle(axis, angle));
  }
  setFromMatrixPosition(m) { const e = m.elements; this.set(e[12], e[13], e[14]); return this; }
  fromBufferAttribute(attribute, index) {
    this.x = attribute.getX(index);
    this.y = attribute.getY(index);
    this.z = attribute.getZ(index);
    return this;
  }
  applyMatrix4(m) {
    const e = m.elements;
    const { x, y, z } = this;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
    return this.set(
      (e[0] * x + e[4] * y + e[8] * z + e[12]) / w,
      (e[1] * x + e[5] * y + e[9] * z + e[13]) / w,
      (e[2] * x + e[6] * y + e[10] * z + e[14]) / w
    );
  }
}
class Box3 {
  constructor(min, max) { this.min = min ? min.clone() : new Vector3(Infinity, Infinity, Infinity); this.max = max ? max.clone() : new Vector3(-Infinity, -Infinity, -Infinity); }
  set(min, max) { this.min.copy(min); this.max.copy(max); return this; }
  makeEmpty() { this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity); return this; }
  setFromPoints(pts) {
    this.makeEmpty();
    for (const p of pts) {
      this.min.x = Math.min(this.min.x, p.x); this.min.y = Math.min(this.min.y, p.y); this.min.z = Math.min(this.min.z, p.z);
      this.max.x = Math.max(this.max.x, p.x); this.max.y = Math.max(this.max.y, p.y); this.max.z = Math.max(this.max.z, p.z);
    }
    return this;
  }
  setFromBufferAttribute(attr) {
    for (let i = 0; i < attr.count; i++) this.expandByPoint(new Vector3(attr.getX(i), attr.getY(i), attr.getZ(i)));
    return this;
  }
  getSize(t) { return t.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z); }
  getCenter(t) { return t.set((this.max.x + this.min.x) / 2, (this.max.y + this.min.y) / 2, (this.max.z + this.min.z) / 2); }
  clone() { const b = new Box3(); b.min.copy(this.min); b.max.copy(this.max); return b; }
  isEmpty() { return this.max.x < this.min.x; }
  expandByPoint(v) { this.min.x = Math.min(this.min.x, v.x); this.min.y = Math.min(this.min.y, v.y); this.min.z = Math.min(this.min.z, v.z); this.max.x = Math.max(this.max.x, v.x); this.max.y = Math.max(this.max.y, v.y); this.max.z = Math.max(this.max.z, v.z); return this; }
  expandByVector(v) { this.min.sub(v); this.max.add(v); return this; }
  union(b) { this.min.x = Math.min(this.min.x, b.min.x); this.min.y = Math.min(this.min.y, b.min.y); this.min.z = Math.min(this.min.z, b.min.z); this.max.x = Math.max(this.max.x, b.max.x); this.max.y = Math.max(this.max.y, b.max.y); this.max.z = Math.max(this.max.z, b.max.z); return this; }
  intersectsBox(b) { return !(b.max.x < this.min.x || b.min.x > this.max.x || b.max.y < this.min.y || b.min.y > this.max.y || b.max.z < this.min.z || b.min.z > this.max.z); }
  containsPoint(v) { return v.x >= this.min.x && v.x <= this.max.x && v.y >= this.min.y && v.y <= this.max.y && v.z >= this.min.z && v.z <= this.max.z; }
  distanceToPoint(v) {
    const cx = Math.max(this.min.x, Math.min(v.x, this.max.x));
    const cy = Math.max(this.min.y, Math.min(v.y, this.max.y));
    const cz = Math.max(this.min.z, Math.min(v.z, this.max.z));
    return Math.hypot(v.x - cx, v.y - cy, v.z - cz);
  }
  distanceToBox(b) {
    const dx = Math.max(b.min.x - this.max.x, 0, this.min.x - b.max.x);
    const dy = Math.max(b.min.y - this.max.y, 0, this.min.y - b.max.y);
    const dz = Math.max(b.min.z - this.max.z, 0, this.min.z - b.max.z);
    return Math.hypot(dx, dy, dz);
  }
  intersect(b) {
    this.min.x = Math.max(this.min.x, b.min.x); this.min.y = Math.max(this.min.y, b.min.y); this.min.z = Math.max(this.min.z, b.min.z);
    this.max.x = Math.min(this.max.x, b.max.x); this.max.y = Math.min(this.max.y, b.max.y); this.max.z = Math.min(this.max.z, b.max.z);
    if (this.isEmpty()) this.set(new Vector3(Infinity, Infinity, Infinity), new Vector3(-Infinity, -Infinity, -Infinity));
    return this;
  }
  applyMatrix4(m) {
    if (this.isEmpty()) return this;
    const pts = [];
    for (const x of [this.min.x, this.max.x]) for (const y of [this.min.y, this.max.y]) for (const z of [this.min.z, this.max.z]) {
      pts.push(new Vector3(x, y, z).applyMatrix4(m));
    }
    return this.setFromPoints(pts);
  }
  setFromObject(object, precise = false) {
    object.updateWorldMatrix(false, true);
    this.makeEmpty();
    const v = new Vector3();
    object.traverse((node) => {
      if (!node.geometry) return;
      const geo = node.geometry;
      if (node.isInstancedMesh) {
        const mat = node.instanceMatrix.array;
        const local = new Box3();
        if (!geo.boundingBox) geo.computeBoundingBox();
        local.min.copy(geo.boundingBox.min); local.max.copy(geo.boundingBox.max);
        const localPts = [];
        for (const x of [local.min.x, local.max.x]) for (const y of [local.min.y, local.max.y]) for (const z of [local.min.z, local.max.z]) localPts.push(new Vector3(x, y, z));
        for (let i = 0; i < node.count; i++) {
          const im = new Matrix4().fromArray(mat, i * 16);
          const world = new Matrix4().multiplyMatrices(node.matrixWorld, im);
          for (const lp of localPts) { v.copy(lp).applyMatrix4(world); this.expandByPoint(v); }
        }
        return;
      }
      const pos = geo.attributes.position;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(node.matrixWorld);
        this.expandByPoint(v);
      }
    });
    return this;
  }
  makeEmpty() {
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this;
  }
}
class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this._x = x; this._y = y; this._z = z; this.order = order;
    const self = this;
    const link = (key) => ({
      enumerable: true,
      configurable: true,
      get: () => self['_' + key],
      set: (v) => { self['_' + key] = v; self._onChange(); }
    });
    Object.defineProperties(this, { x: link('x'), y: link('y'), z: link('z') });
  }
  set(x, y, z, order) {
    this._x = x; this._y = y; this._z = z;
    if (order) this.order = order;
    this._onChange();
    return this;
  }
  copy(e) { this._x = e.x; this._y = e.y; this._z = e.z; this.order = e.order; this._onChange(); return this; }
  clone() { return new Euler(this.x, this.y, this.z, this.order); }
  setFromQuaternion(q, order) { this._setFromQuaternion(q, order || this.order); this._onChange(); return this; }
  _setFromQuaternion(q, order) {
    const te = new Matrix4().compose(new Vector3(), q, new Vector3(1, 1, 1)).elements;
    const setXYZ = (ax, ay, az) => { this._x = ax; this._y = ay; this._z = az; };
    const m11 = te[0], m12 = te[4], m13 = te[8];
    const m21 = te[1], m22 = te[5], m23 = te[9];
    const m31 = te[2], m32 = te[6], m33 = te[10];
    const cl = (v) => Math.max(-1, Math.min(1, v));
    if (order === 'YXZ') {
      const ax = Math.asin(cl(-m23));
      if (Math.abs(m23) < 0.9999999) setXYZ(ax, Math.atan2(m13, m33), Math.atan2(m21, m22));
      else setXYZ(ax, Math.atan2(-m31, m11), 0);
    } else {
      const ay = Math.asin(cl(m13));
      if (Math.abs(m13) < 0.9999999) setXYZ(Math.atan2(-m23, m33), ay, Math.atan2(-m12, m11));
      else setXYZ(Math.atan2(m32, m22), ay, 0);
    }
    this.order = order;
    return this;
  }
  _onChange() { if (this._onChangeCallback) this._onChangeCallback(); }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  _set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  set(x, y, z, w) { this._set(x, y, z, w); this._onChange(); return this; }
  identity() { return this.set(0, 0, 0, 1); }
  copy(q) { return this.set(q.x, q.y, q.z, q.w); }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  _setFromRotationMatrix(m) {
    const te = m.elements;
    const m11 = te[0], m12 = te[4], m13 = te[8];
    const m21 = te[1], m22 = te[5], m23 = te[9];
    const m31 = te[2], m32 = te[6], m33 = te[10];
    const trace = m11 + m22 + m33;
    let s;
    if (trace > 0) {
      s = 0.5 / Math.sqrt(trace + 1.0);
      this._set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s);
    } else if (m11 > m22 && m11 > m33) {
      s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      this._set(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s);
    } else if (m22 > m33) {
      s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      this._set((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s);
    } else {
      s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      this._set((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s);
    }
    return this;
  }
  setFromRotationMatrix(m) { this._setFromRotationMatrix(m); this._onChange(); return this; }
  _setFromEuler(e) { return this._setFromRotationMatrix(new Matrix4().makeRotationFromEuler(e)); }
  setFromEuler(e) { this._setFromEuler(e); this._onChange(); return this; }
  setFromAxisAngle(axis, angle) {
    const half = angle / 2;
    const sn = Math.sin(half);
    this._set(axis.x * sn, axis.y * sn, axis.z * sn, Math.cos(half));
    this._onChange();
    return this;
  }
  multiplyQuaternions(a, b) {
    const qax = a.x, qay = a.y, qaz = a.z, qaw = a.w;
    const qbx = b.x, qby = b.y, qbz = b.z, qbw = b.w;
    this._set(
      qax * qbw + qaw * qbx + qay * qbz - qaz * qby,
      qay * qbw + qaw * qby + qaz * qbx - qax * qbz,
      qaz * qbw + qaw * qbz + qax * qby - qay * qbx,
      qaw * qbw - qax * qbx - qay * qby - qaz * qbz
    );
    this._onChange();
    return this;
  }
  multiply(q) { return this.multiplyQuaternions(this, q); }
  premultiply(q) { return this.multiplyQuaternions(q, this); }
  invert() { return this._set(-this.x, -this.y, -this.z, this.w); }
  conjugate() { return this._set(-this.x, -this.y, -this.z, this.w); }
  dot(q) { return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w; }
  angleTo(q) { return 2 * Math.acos(Math.min(1, Math.abs(this.dot(q)))); }
  normalize() {
    const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    return this._set(this.x / l, this.y / l, this.z / l, this.w / l);
  }
  slerp(q, t) {
    if (t === 0) return this;
    if (t === 1) return this.copy(q);
    const x = this.x, y = this.y, z = this.z, w = this.w;
    let cosHalf = w * q.w + x * q.x + y * q.y + z * q.z;
    let ax = q.x, ay = q.y, az = q.z, aw = q.w;
    if (cosHalf < 0) { cosHalf = -cosHalf; ax = -ax; ay = -ay; az = -az; aw = -aw; }
    if (cosHalf >= 1.0 - 1e-9) {
      return this._set(w + t * (aw - w), x + t * (ax - x), y + t * (ay - y), z + t * (az - z)).normalize();
    }
    const halfTheta = Math.acos(Math.max(-1, Math.min(1, cosHalf)));
    const sinHalf = Math.sqrt(1 - cosHalf * cosHalf);
    const sA = Math.sin((1 - t) * halfTheta) / sinHalf;
    const sB = Math.sin(t * halfTheta) / sinHalf;
    return this._set(w * sA + aw * sB, x * sA + ax * sB, y * sA + ay * sB, z * sA + az * sB);
  }
  setFromUnitVectors(from, to) {
    let r = from.dot(to) + 1;
    if (r < 1e-8) {
      r = 0;
      if (Math.abs(from.x) > Math.abs(from.z)) this._set(-from.y, from.x, 0, r);
      else this._set(0, -from.z, from.y, r);
    } else {
      this._set(
        from.y * to.z - from.z * to.y,
        from.z * to.x - from.x * to.z,
        from.x * to.y - from.y * to.x,
        r
      );
    }
    return this.normalize();
  }
  _onChange() { if (this._onChangeCallback) this._onChangeCallback(); }
}
class Matrix4 {
  constructor() {
    this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  copy(m) { this.elements = m.elements.slice(); return this; }
  clone() { const m = new Matrix4(); m.elements = this.elements.slice(); return m; }
  identity() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; return this; }
  fromArray(arr, offset = 0) { for (let i = 0; i < 16; i++) this.elements[i] = arr[i + offset]; return this; }
  toArray(arr = [], offset = 0) { for (let i = 0; i < 16; i++) arr[offset + i] = this.elements[i]; return arr; }
  compose(p, q, s) {
    const { x, y, z, w } = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = s.x, sy = s.y, sz = s.z;
    const e = this.elements;
    e[0] = (1 - (yy + zz)) * sx; e[1] = (xy + wz) * sx; e[2] = (xz - wy) * sx; e[3] = 0;
    e[4] = (xy - wz) * sy; e[5] = (1 - (xx + zz)) * sy; e[6] = (yz + wx) * sy; e[7] = 0;
    e[8] = (xz + wy) * sz; e[9] = (yz - wx) * sz; e[10] = (1 - (xx + yy)) * sz; e[11] = 0;
    e[12] = p.x; e[13] = p.y; e[14] = p.z; e[15] = 1;
    return this;
  }
  multiplyMatrices(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
    return this;
  }
  makeRotationFromEuler(euler) {
    const order = euler.order || 'XYZ';
    const ang = { X: euler.x, Y: euler.y, Z: euler.z };
    const acc = new Matrix4();
    for (const ch of order) {
      const c = Math.cos(ang[ch]);
      const sn = Math.sin(ang[ch]);
      const r = new Matrix4();
      if (ch === 'X') r.elements = [1, 0, 0, 0, 0, c, sn, 0, 0, -sn, c, 0, 0, 0, 0, 1];
      else if (ch === 'Y') r.elements = [c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, 0, 0, 0, 1];
      else r.elements = [c, sn, 0, 0, -sn, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      acc.multiplyMatrices(acc, r);
    }
    this.elements = acc.elements;
    return this;
  }
  makeRotationX(t) { return this.makeRotationFromEuler(new Euler(t, 0, 0)); }
  makeRotationY(t) { return this.makeRotationFromEuler(new Euler(0, t, 0)); }
  makeRotationZ(t) { return this.makeRotationFromEuler(new Euler(0, 0, t)); }
  makeTranslation(x, y, z) {
    this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
    return this;
  }
  makeScale(x, y, z) {
    this.elements = [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
    return this;
  }
  transpose() {
    const e = this.elements;
    let t;
    t = e[1]; e[1] = e[4]; e[4] = t;
    t = e[2]; e[2] = e[8]; e[8] = t;
    t = e[6]; e[6] = e[9]; e[9] = t;
    t = e[3]; e[3] = e[12]; e[12] = t;
    t = e[7]; e[7] = e[13]; e[13] = t;
    t = e[11]; e[11] = e[14]; e[14] = t;
    return this;
  }
  multiply(m) { return this.multiplyMatrices(this, m); }
  premultiply(m) { return this.multiplyMatrices(m, this); }
  setPosition(x, y, z) {
    const e = this.elements;
    if (x && typeof x === 'object') { e[12] = x.x; e[13] = x.y; e[14] = x.z; }
    else { e[12] = x; e[13] = y; e[14] = z; }
    return this;
  }
  scale(v) {
    const te = this.elements;
    te[0] *= v.x; te[1] *= v.x; te[2] *= v.x; te[3] *= v.x;
    te[4] *= v.y; te[5] *= v.y; te[6] *= v.y; te[7] *= v.y;
    te[8] *= v.z; te[9] *= v.z; te[10] *= v.z; te[11] *= v.z;
    return this;
  }
  extractRotation() {
    const te = this.elements;
    const sx = 1 / (Math.hypot(te[0], te[1], te[2]) || 1);
    const sy = 1 / (Math.hypot(te[4], te[5], te[6]) || 1);
    const sz = 1 / (Math.hypot(te[8], te[9], te[10]) || 1);
    te[0] *= sx; te[1] *= sx; te[2] *= sx;
    te[4] *= sy; te[5] *= sy; te[6] *= sy;
    te[8] *= sz; te[9] *= sz; te[10] *= sz;
    return this;
  }
  determinant() {
    const te = this.elements;
    const a11 = te[0], a12 = te[4], a13 = te[8], a14 = te[12];
    const a21 = te[1], a22 = te[5], a23 = te[9], a24 = te[13];
    const a31 = te[2], a32 = te[6], a33 = te[10], a34 = te[14];
    const a41 = te[3], a42 = te[7], a43 = te[11], a44 = te[15];
    return (
      a14 * a23 * a32 * a41 - a13 * a24 * a32 * a41 - a14 * a22 * a33 * a41 + a12 * a24 * a33 * a41 +
      a13 * a22 * a34 * a41 - a12 * a23 * a34 * a41 - a14 * a23 * a31 * a42 + a13 * a24 * a31 * a42 +
      a14 * a21 * a33 * a42 - a11 * a24 * a33 * a42 - a13 * a21 * a34 * a42 + a11 * a23 * a34 * a42 +
      a14 * a22 * a31 * a43 - a12 * a24 * a31 * a43 - a14 * a21 * a32 * a43 + a11 * a24 * a32 * a43 +
      a12 * a21 * a34 * a43 - a11 * a22 * a34 * a43 - a13 * a22 * a31 * a44 + a12 * a23 * a31 * a44 +
      a13 * a21 * a32 * a44 - a11 * a23 * a32 * a44 - a12 * a21 * a33 * a44 + a11 * a22 * a33 * a44
    );
  }
  invert() {
    // 仿射逆变换（本项目只用仿射矩阵）：L⁻¹ 用列叉积公式，平移部分 -L⁻¹t。
    // 旧实现的余子式索引有错（旋转矩阵求逆后左上 2x2 直接归零），会让法线矩阵把法线转反。
    const te = this.elements;
    const c0x = te[0], c0y = te[1], c0z = te[2];
    const c1x = te[4], c1y = te[5], c1z = te[6];
    const c2x = te[8], c2y = te[9], c2z = te[10];
    const r0x = c1y * c2z - c1z * c2y, r0y = c1z * c2x - c1x * c2z, r0z = c1x * c2y - c1y * c2x;
    const r1x = c2y * c0z - c2z * c0y, r1y = c2z * c0x - c2x * c0z, r1z = c2x * c0y - c2y * c0x;
    const r2x = c0y * c1z - c0z * c1y, r2y = c0z * c1x - c0x * c1z, r2z = c0x * c1y - c0y * c1x;
    const det = c0x * r0x + c0y * r0y + c0z * r0z;
    if (Math.abs(det) < 1e-12) return this.identity();
    const inv = 1 / det;
    // 列主序：inv[c * 4 + r] = L⁻¹[r][c]，L⁻¹ 的第 r 行 = r_r / det
    te[0] = r0x * inv; te[1] = r1x * inv; te[2] = r2x * inv; te[3] = 0;
    te[4] = r0y * inv; te[5] = r1y * inv; te[6] = r2y * inv; te[7] = 0;
    te[8] = r0z * inv; te[9] = r1z * inv; te[10] = r2z * inv; te[11] = 0;
    const tx = te[12], ty = te[13], tz = te[14];
    te[12] = -(r0x * tx + r0y * ty + r0z * tz) * inv;
    te[13] = -(r1x * tx + r1y * ty + r1z * tz) * inv;
    te[14] = -(r2x * tx + r2y * ty + r2z * tz) * inv;
    te[15] = 1;
    return this;
  }
  decompose(pos, quat, scl) {
    const te = this.elements;
    const sx = Math.hypot(te[0], te[1], te[2]);
    const sy = Math.hypot(te[4], te[5], te[6]);
    const sz = Math.hypot(te[8], te[9], te[10]);
    pos.set(te[12], te[13], te[14]);
    const m = new Matrix4().copy(this);
    const e = m.elements;
    if (sx) { e[0] /= sx; e[1] /= sx; e[2] /= sx; }
    if (sy) { e[4] /= sy; e[5] /= sy; e[6] /= sy; }
    if (sz) { e[8] /= sz; e[9] /= sz; e[10] /= sz; }
    quat.setFromRotationMatrix(m);
    scl.set(sx, sy, sz);
    return this;
  }
  lookAt(eye, target, up) {
    const z = new Vector3().subVectors(eye, target);
    if (z.lengthSq() === 0) z.z = 1;
    z.normalize();
    const x = new Vector3().crossVectors(up, z);
    if (x.lengthSq() === 0) {
      if (Math.abs(up.z) === 1) z.x += 1e-8; else z.z += 1e-8;
      z.normalize();
      x.crossVectors(up, z);
    }
    x.normalize();
    const y = new Vector3().crossVectors(z, x);
    return this.makeBasis(x, y, z);
  }
  makeBasis(xAxis, yAxis, zAxis) {
    const e = this.elements;
    e[0] = xAxis.x; e[4] = yAxis.x; e[8] = zAxis.x; e[12] = 0;
    e[1] = xAxis.y; e[5] = yAxis.y; e[9] = zAxis.y; e[13] = 0;
    e[2] = xAxis.z; e[6] = yAxis.z; e[10] = zAxis.z; e[14] = 0;
    e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
    return this;
  }
}
class Object3D {
  constructor() {
    this.isObject3D = true;
    this.children = [];
    this.parent = null;
    this.position = new Vector3();
    this.rotation = new Euler();
    this.quaternion = new Quaternion();
    this.rotation._onChangeCallback = () => this.quaternion._setFromEuler(this.rotation);
    this.quaternion._onChangeCallback = () => this.rotation._setFromQuaternion(this.quaternion, this.rotation.order);
    this.scale = new Vector3(1, 1, 1);
    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
    this.userData = {};
    this.name = '';
    this.visible = true;
    this.castShadow = false;
    this.receiveShadow = false;
    this.frustumCulled = true;
  }
  add(...objects) {
    for (const o of objects) {
      if (!o || !o.isObject3D) throw new Error(`add(): 非 Object3D 参数 (${o})`);
      if (o === this) throw new Error('add(): 不能添加自身');
      if (o.parent) o.parent.remove(o);
      o.parent = this;
      this.children.push(o);
    }
    return this;
  }
  remove(o) {
    const i = this.children.indexOf(o);
    if (i >= 0) { this.children.splice(i, 1); o.parent = null; }
    return this;
  }
  traverse(cb) {
    cb(this);
    for (const c of this.children) c.traverse(cb);
  }
  translateOnAxis(axis, distance) {
    return this.position.add(new Vector3(axis.x * distance, axis.y * distance, axis.z * distance)), this;
  }
  translateX(d) { return this.translateOnAxis(new Vector3(1, 0, 0), d); }
  translateY(d) { return this.translateOnAxis(new Vector3(0, 1, 0), d); }
  translateZ(d) { return this.translateOnAxis(new Vector3(0, 0, 1), d); }
  lookAt(target) {
    const z = new Vector3().subVectors(this.position, target);
    if (z.lengthSq() === 0) z.z = 1;
    z.normalize();
    const x = new Vector3().crossVectors(new Vector3(0, 1, 0), z).normalize();
    const y = new Vector3().crossVectors(z, x).normalize();
    const m = new Matrix4().makeBasis(x, y, z);
    this.quaternion.setFromRotationMatrix(m);
  }
  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
  }
  updateWorldMatrix(updateParents, updateChildren) {
    if (updateParents && this.parent) this.parent.updateWorldMatrix(true, false);
    this.updateMatrix();
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    else this.matrixWorld.copy(this.matrix);
    if (updateChildren) for (const c of this.children) c.updateWorldMatrix(false, true);
  }
  updateMatrixWorld(force) {
    this.updateMatrix();
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    else this.matrixWorld.copy(this.matrix);
    for (const c of this.children) c.updateMatrixWorld(true);
  }
  getWorldPosition(v = new Vector3()) {
    this.updateMatrixWorld(true);
    return v.setFromMatrixPosition(this.matrixWorld);
  }
  getWorldDirection(v = new Vector3()) {
    this.updateWorldMatrix(true, false);
    const e = this.matrixWorld.elements;
    return v.set(-e[8], -e[9], -e[10]).normalize();
  }
}
class Group extends Object3D { constructor() { super(); this.isGroup = true; } }
class Scene extends Object3D {
  constructor() { super(); this.isScene = true; this.background = null; this.environment = null; this.fog = null; }
}
class FakeAttribute {
  constructor(count) { this.count = count; this.needsUpdate = false; this.array = new Float32Array(count * 3); this.itemSize = 3; }
  getX(i) { return this.array[i * 3]; }
  getY(i) { return this.array[i * 3 + 1]; }
  getZ(i) { return this.array[i * 3 + 2]; }
  setX(i, v) { this.array[i * 3] = v; return this; }
  setY(i, v) { this.array[i * 3 + 1] = v; return this; }
  setZ(i, v) { this.array[i * 3 + 2] = v; return this; }
  setUsage(u) { this.usage = u; return this; }
}
class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = Math.floor(array.length / itemSize);
    this.needsUpdate = false;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  getComponent(i, component) { return this.array[i * this.itemSize + component]; }
  setComponent(i, component, value) { this.array[i * this.itemSize + component] = value; return this; }
  setX(i, v) { this.array[i * this.itemSize] = v; return this; }
  setY(i, v) { this.array[i * this.itemSize + 1] = v; return this; }
  setZ(i, v) { this.array[i * this.itemSize + 2] = v; return this; }
  setXY(i, x, y) { const o = i * this.itemSize; this.array[o] = x; this.array[o + 1] = y; return this; }
  setXYZ(i, x, y, z) { const o = i * this.itemSize; this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; return this; }
  setUsage(u) { this.usage = u; return this; }
  clone() { return new BufferAttribute(this.array.slice(), this.itemSize); }
}
class Float32BufferAttribute extends BufferAttribute {
  constructor(array, itemSize) {
    super(array instanceof Float32Array ? array : Float32Array.from(array), itemSize);
  }
}
class Uint16BufferAttribute extends BufferAttribute {
  constructor(array, itemSize) {
    super(array instanceof Uint16Array ? array : Uint16Array.from(array), itemSize);
  }
}
class BufferGeometry {
  constructor() {
    this.isBufferGeometry = true;
    this.attributes = {};
    this.index = null;
    this.groups = [];
    this.boundingBox = null;
    this.boundingSphere = null;
    this.parameters = null;
    this.name = '';
    this.userData = {}; // 真实 three 的 BufferGeometry 有 userData，模块用它挂建模元数据
  }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  getAttribute(name) {
    // 真实 three 的内置几何（Box / Plane / Cylinder / Sphere …）在构造时就写入解析法线，
    // 桩里各构造器只写了 position + index。这里在首次读取 normal 时按当前三角面补一次
    // 顶点法线：内置几何因此与真实 three 一致（构造顶点的几何顶点不跨面共享 ⇒ 立方体 /
    // 圆柱得到的就是解析面法线），资产层的 triplanarUv 与审计的 normalAudit 不再全线误报。
    if (name === 'normal' && !this.attributes.normal && this.attributes.position) this.computeVertexNormals();
    return this.attributes[name];
  }
  setIndex(index) {
    if (Array.isArray(index)) this.index = new Uint16BufferAttribute(index, 1);
    else this.index = index;
    return this;
  }
  getIndex() { return this.index; }
  setFromPoints(points) {
    const arr = [];
    for (const p of points) arr.push(p.x, p.y, p.z ?? 0);
    this.setAttribute('position', new Float32BufferAttribute(arr, 3));
    return this;
  }
  computeBoundingBox() {
    const pos = this.attributes.position;
    if (!pos) { this.boundingBox = new Box3(); return; }
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
    }
    this.boundingBox = new Box3().set(min, max);
  }
  computeBoundingSphere() {
    this.computeBoundingBox();
    const c = new Vector3();
    if (this.boundingBox) this.boundingBox.getCenter(c);
    this.boundingSphere = { center: c, radius: 1 };
  }
  applyMatrix4(m) {
    const pos = this.attributes.position;
    if (pos) {
      const v = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      pos.needsUpdate = true;
    }
    // 真实 three 用「法线矩阵 = (M⁻¹)ᵀ」变换 normal：非均匀缩放 / 剪切后法线才会重新贴合曲面。
    // 桩里漏掉这一步会让 geo.scale(...) 之后的法线与曲面朝向不符，法线审计出现成片假阳性。
    const nor = this.getAttribute('normal');
    if (nor) {
      // 列主序下 inv[c * 4 + r] = L⁻¹[r][c]，而 N = (L⁻¹)ᵀ 满足 N[r][c] = L⁻¹[c][r] = inv[r * 4 + c]
      const ie = m.clone().invert().elements;
      const n00 = ie[0], n01 = ie[1], n02 = ie[2];
      const n10 = ie[4], n11 = ie[5], n12 = ie[6];
      const n20 = ie[8], n21 = ie[9], n22 = ie[10];
      for (let i = 0; i < nor.count; i++) {
        const x = nor.getX(i), y = nor.getY(i), z = nor.getZ(i);
        if (x === 0 && y === 0 && z === 0) continue; // 未被任何三角形引用的顶点保持零法线（与真实 three 一致）
        const tx = n00 * x + n01 * y + n02 * z;
        const ty = n10 * x + n11 * y + n12 * z;
        const tz = n20 * x + n21 * y + n22 * z;
        const l = Math.hypot(tx, ty, tz);
        if (l < 1e-12) continue;
        nor.setXYZ(i, tx / l, ty / l, tz / l);
      }
      nor.needsUpdate = true;
    }
    this.boundingBox = null;
    return this;
  }
  translate(x, y, z) { return this.applyMatrix4(new Matrix4().makeTranslation(x, y, z)); }
  scale(x, y, z) { return this.applyMatrix4(new Matrix4().makeScale(x, y, z)); }
  rotateX(a) { return this.applyMatrix4(new Matrix4().makeRotationX(a)); }
  rotateY(a) { return this.applyMatrix4(new Matrix4().makeRotationY(a)); }
  rotateZ(a) { return this.applyMatrix4(new Matrix4().makeRotationZ(a)); }
  computeVertexNormals() {
    const pos = this.attributes.position;
    if (!pos) return this;
    const n = new Float32Array(pos.count * 3);
    const idx = this.index ? this.index.array : null;
    const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    const ab = new Vector3(), cb = new Vector3(), cr = new Vector3();
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      a.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
      b.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
      c.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
      ab.subVectors(b, a);
      cb.subVectors(c, a);
      cr.crossVectors(ab, cb);
      for (const i of [i0, i1, i2]) {
        n[i * 3] += cr.x; n[i * 3 + 1] += cr.y; n[i * 3 + 2] += cr.z;
      }
    }
    for (let i = 0; i < pos.count; i++) {
      const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1;
      n[i * 3] /= l; n[i * 3 + 1] /= l; n[i * 3 + 2] /= l;
    }
    this.attributes.normal = new BufferAttribute(n, 3);
    return this;
  }
  /** 桩内补齐内置几何应有的 uv / normal，贴近真实 three 的内置几何属性 */
  ensureDefaultAttributes() {
    const pos = this.attributes.position;
    if (!pos) return this;
    if (!this.attributes.normal) this.computeVertexNormals();
    if (!this.attributes.uv) {
      this.computeBoundingBox();
      const b = this.boundingBox;
      const sx = Math.max(b.max.x - b.min.x, 1e-6);
      const sy = Math.max(b.max.y - b.min.y, 1e-6);
      const sz = Math.max(b.max.z - b.min.z, 1e-6);
      const useY = sy >= sx && sy >= sz ? 0 : 1;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (useY) {
          uv[i * 2] = (x - b.min.x) / sx;
          uv[i * 2 + 1] = (z - b.min.z) / sz;
        } else {
          uv[i * 2] = (x - b.min.x) / sx;
          uv[i * 2 + 1] = (y - b.min.y) / sy;
        }
      }
      this.attributes.uv = new BufferAttribute(uv, 2);
    }
    return this;
  }
  clone() {
    const g = new BufferGeometry();
    for (const k of Object.keys(this.attributes)) g.attributes[k] = this.attributes[k].clone();
    if (this.index) g.index = this.index.clone();
    g.name = this.name;
    return g;
  }
  dispose() {}
}
function gridPositions(w, h, ws, hs, build) {
  ws = Math.max(1, ws | 0); hs = Math.max(1, hs | 0);
  const pos = [];
  for (let iy = 0; iy <= hs; iy++) {
    for (let ix = 0; ix <= ws; ix++) {
      const p = build(ix / ws, iy / hs);
      pos.push(p[0], p[1], p[2]);
    }
  }
  const idx = [];
  const row = ws + 1;
  for (let iy = 0; iy < hs; iy++) {
    for (let ix = 0; ix < ws; ix++) {
      const a = iy * row + ix, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  return { pos, idx };
}
class BoxGeometry extends BufferGeometry {
  constructor(w = 1, h = 1, d = 1) {
    super();
    // 六面：+Z / -Z / +X / -X / +Y / -Y，均按外向缠绕给出
    const faces = [
      (u, v) => [u * w - w / 2, v * h - h / 2, d / 2],
      (u, v) => [-u * w + w / 2, v * h - h / 2, -d / 2],
      (u, v) => [w / 2, u * h - h / 2, v * d - d / 2],
      (u, v) => [-w / 2, u * h - h / 2, -v * d + d / 2],
      (u, v) => [u * w - w / 2, h / 2, -v * d + d / 2],
      (u, v) => [u * w - w / 2, -h / 2, v * d - d / 2]
    ];
    const pos = [];
    const idx = [];
    let offset = 0;
    for (const f of faces) {
      const { pos: p, idx: i } = gridPositions(w, h, 1, 1, f);
      for (const v of p) pos.push(v);
      for (const k of i) idx.push(k + offset);
      offset += p.length / 3;
    }
    this.parameters = { width: w, height: h, depth: d };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
  }
}
class PlaneGeometry extends BufferGeometry {
  constructor(w = 1, h = 1, ws = 1, hs = 1) {
    super();
    const { pos, idx } = gridPositions(w, h, ws, hs, (u, v) => [(u - 0.5) * w, (v - 0.5) * h, 0]);
    this.parameters = { width: w, height: h, widthSegments: Math.max(1, ws | 0), heightSegments: Math.max(1, hs | 0) };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
  }
}
class CircleGeometry extends BufferGeometry {
  constructor(r = 1, segments = 32) {
    super();
    segments = Math.max(3, segments | 0);
    const pos = [0, 0, 0];
    const idx = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
    }
    for (let i = 0; i < segments; i++) idx.push(0, 1 + i, 2 + i);
    this.parameters = { radius: r, segments };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
  }
}
class RingGeometry extends BufferGeometry {
  constructor(inner = 0.5, outer = 1, thetaSegments = 32, phiSegments = 1) {
    super();
    thetaSegments = Math.max(3, thetaSegments | 0);
    phiSegments = Math.max(1, phiSegments | 0);
    const pos = [];
    const idx = [];
    for (let j = 0; j <= phiSegments; j++) {
      const r = inner + (outer - inner) * (j / phiSegments);
      for (let i = 0; i <= thetaSegments; i++) {
        const a = (i / thetaSegments) * Math.PI * 2;
        pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      }
    }
    const row = thetaSegments + 1;
    for (let j = 0; j < phiSegments; j++) {
      for (let i = 0; i < thetaSegments; i++) {
        const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    this.parameters = { innerRadius: inner, outerRadius: outer };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
  }
}
class CylinderGeometry extends BufferGeometry {
  constructor(rTop = 1, rBottom = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false) {
    super();
    radialSegments = Math.max(3, radialSegments | 0);
    heightSegments = Math.max(1, heightSegments | 0);
    const pos = [];
    const idx = [];
    for (let y = 0; y <= heightSegments; y++) {
      const t = y / heightSegments;
      const r = rBottom + (rTop - rBottom) * t;
      const py = (t - 0.5) * height;
      for (let x = 0; x <= radialSegments; x++) {
        const a = (x / radialSegments) * Math.PI * 2;
        pos.push(Math.cos(a) * r, py, Math.sin(a) * r);
      }
    }
    const row = radialSegments + 1;
    for (let y = 0; y < heightSegments; y++) {
      for (let x = 0; x < radialSegments; x++) {
        const a = y * row + x, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, d, b, a, c, d);
      }
    }
    if (!openEnded) {
      for (const [capR, capY, flip] of [[rTop, height / 2, 1], [rBottom, -height / 2, -1]]) {
        if (capR <= 1e-6) continue;
        const base = pos.length / 3;
        pos.push(0, capY, 0);
        for (let x = 0; x <= radialSegments; x++) {
          const a = (x / radialSegments) * Math.PI * 2;
          pos.push(Math.cos(a) * capR, capY, Math.sin(a) * capR);
        }
        for (let x = 0; x < radialSegments; x++) {
          if (flip > 0) idx.push(base, base + 2 + x, base + 1 + x);
          else idx.push(base, base + 1 + x, base + 2 + x);
        }
      }
    }
    this.parameters = { radiusTop: rTop, radiusBottom: rBottom, height, radialSegments };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
  }
}
class ConeGeometry extends BufferGeometry {
  constructor(r = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false) {
    super();
    const inner = new CylinderGeometry(0, r, height, radialSegments, heightSegments, openEnded);
    this.attributes = inner.attributes;
    this.index = inner.index;
    this.parameters = { radius: r, height, radialSegments };
  }
}
class CapsuleGeometry extends BufferGeometry {
  constructor(r = 1, length = 1, capSegments = 4, radialSegments = 8) {
    super();
    const inner = new CylinderGeometry(r, r, length, radialSegments, 1, true);
    const pos = Array.from(inner.attributes.position.array);
    const idx = Array.from(inner.index.array);
    const base = pos.length / 3;
    const cap = Math.max(1, capSegments | 0);
    for (const sign of [1, -1]) {
      const start = pos.length / 3;
      for (let j = 1; j <= cap; j++) {
        const phi = (j / cap) * (Math.PI / 2);
        const rr = Math.cos(phi) * r;
        const yy = sign * (length / 2 + Math.sin(phi) * r);
        for (let i = 0; i <= radialSegments; i++) {
          const a = (i / radialSegments) * Math.PI * 2;
          pos.push(Math.cos(a) * rr, yy, Math.sin(a) * rr);
        }
      }
      const tip = pos.length / 3;
      pos.push(0, sign * (length / 2 + r), 0);
      const row = radialSegments + 1;
      for (let j = 0; j < cap - 1; j++) {
        for (let i = 0; i < radialSegments; i++) {
          const a = start + j * row + i, b = a + 1, c = a + row, d = c + 1;
          if (sign > 0) idx.push(a, d, b, a, c, d);
          else idx.push(a, c, b, a, d, c);
        }
      }
      const last = start + (cap - 1) * row;
      for (let i = 0; i < radialSegments; i++) {
        if (sign > 0) idx.push(last + i + 1, last + i, tip);
        else idx.push(last + i, last + i + 1, tip);
      }
    }
    this.parameters = { radius: r, length };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
    void base;
  }
}
class SphereGeometry extends BufferGeometry {
  constructor(r = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) {
    super();
    widthSegments = Math.max(3, widthSegments | 0);
    heightSegments = Math.max(2, heightSegments | 0);
    const pos = [];
    const idx = [];
    for (let iy = 0; iy <= heightSegments; iy++) {
      const v = iy / heightSegments;
      const theta = thetaStart + v * thetaLength;
      for (let ix = 0; ix <= widthSegments; ix++) {
        const u = ix / widthSegments;
        const phi = phiStart + u * phiLength;
        const sx = -Math.cos(phi) * Math.sin(theta);
        const sy = -Math.cos(theta);
        const sz = Math.sin(phi) * Math.sin(theta);
        pos.push(sx * r, sy * r, sz * r);
      }
    }
    const row = widthSegments + 1;
    for (let iy = 0; iy < heightSegments; iy++) {
      for (let ix = 0; ix < widthSegments; ix++) {
        const a = iy * row + ix, b = a + 1, c = a + row, d = c + 1;
        if (iy !== 0 || thetaStart > 1e-6) idx.push(a, b, d);
        if (iy !== heightSegments - 1 || thetaStart + thetaLength < Math.PI - 1e-6) idx.push(a, d, c);
      }
    }
    this.parameters = { radius: r, widthSegments, heightSegments };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
  }
}
class TorusGeometry extends BufferGeometry {
  constructor(r = 1, tube = 0.1, radialSegments = 16, tubularSegments = 32, arc = Math.PI * 2) {
    super();
    radialSegments = Math.max(3, radialSegments | 0);
    tubularSegments = Math.max(3, tubularSegments | 0);
    const pos = [];
    const idx = [];
    for (let j = 0; j <= radialSegments; j++) {
      for (let i = 0; i <= tubularSegments; i++) {
        const u = (i / tubularSegments) * arc;
        const v = (j / radialSegments) * Math.PI * 2;
        const cx = Math.cos(u) * r;
        const cy = Math.sin(u) * r;
        const rr = r + Math.cos(v) * tube;
        pos.push(Math.cos(u) * rr, Math.sin(u) * rr, Math.sin(v) * tube);
      }
    }
    const row = tubularSegments + 1;
    for (let j = 0; j < radialSegments; j++) {
      for (let i = 0; i < tubularSegments; i++) {
        const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    this.parameters = { radius: r, tube, radialSegments, tubularSegments };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
  }
}
function polyhedron(vertices, faces, detail = 0) {
  const tris = [];
  for (const f of faces) tris.push([vertices[f[0]], vertices[f[1]], vertices[f[2]]]);
  const out = [];
  const subdivide = (tri, depth) => {
    if (depth <= 0) { out.push(tri); return; }
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const [a, b, c] = tri;
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    subdivide([a, ab, ca], depth - 1);
    subdivide([ab, b, bc], depth - 1);
    subdivide([ca, bc, c], depth - 1);
    subdivide([ab, bc, ca], depth - 1);
  };
  for (const t of tris) subdivide(t, Math.max(0, detail | 0));
  const pos = [];
  for (const t of out) for (const v of t) pos.push(v[0], v[1], v[2]);
  return pos;
}
class IcosahedronGeometry extends BufferGeometry {
  constructor(r = 1, detail = 0) {
    super();
    const t = (1 + Math.sqrt(5)) / 2;
    const raw = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
    ];
    const norm = raw.map((v) => {
      const l = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / l, v[1] / l, v[2] / l];
    });
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ];
    const pos = polyhedron(norm, faces, detail).map((v) => v * r);
    this.parameters = { radius: r, detail };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
  }
}
class OctahedronGeometry extends BufferGeometry {
  constructor(r = 1, detail = 0) {
    super();
    const v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const faces = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
    const pos = polyhedron(v, faces, detail).map((p) => p * r);
    this.parameters = { radius: r, detail };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
  }
}
class Shape {
  constructor() { this.points = []; this.curves = []; }
  moveTo(x, y) { this.points.push([x, y]); return this; }
  lineTo(x, y) { this.points.push([x, y]); return this; }
  quadraticCurveTo(cx, cy, x, y) { this.points.push([cx, cy]); this.points.push([x, y]); return this; }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) { this.points.push([c1x, c1y]); this.points.push([c2x, c2y]); this.points.push([x, y]); return this; }
  absarc(x, y, r, a0, a1) {
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      this.points.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    return this;
  }
  absellipse(x, y, rx, ry, a0 = 0, a1 = Math.PI * 2) {
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      this.points.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]);
    }
    return this;
  }
  arc(x, y, r, a0, a1, clockwise = false) {
    if (clockwise) { const t = a0; a0 = a1; a1 = t; }
    return this.absarc(x, y, r, a0, a1);
  }
  ellipse(x, y, rx, ry, a0 = 0, a1 = Math.PI * 2, clockwise = false) {
    if (clockwise) { const t = a0; a0 = a1; a1 = t; }
    return this.absellipse(x, y, rx, ry, a0, a1);
  }
  curveTo(a1, a2, a3, a4, a5) { return this.bezierCurveTo(a1, a2, a3, a4, a5); }
  splineThru(pts) {
    for (const pt of pts) this.points.push([pt[0] ?? pt.x, pt[1] ?? pt.y]);
    return this;
  }
  closePath() {
    this.closed = true;
    if (this.points.length) this.points.push([this.points[0][0], this.points[0][1]]);
    return this;
  }
  getPoints() { return this.points.map(([x, y]) => new Vector2(x, y)); }
  getSpacedPoints() { return this.getPoints(); }
}
function shapeRing(shape) {
  const EPS = 1e-9; // 弧段终点与 closePath 复制点在浮点上可能差 1e-17
  const same = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
  let ring = shape.points.map(([x, y]) => [x, y]);
  // 去掉与首点重合的尾点（closePath 与曲线终点都可能各留一个重复点）
  while (ring.length > 1 && same(ring[ring.length - 1], ring[0])) ring.pop();
  // 去掉相邻重复点（lineTo 与弧段起点重合会产生零长度边）
  const out = [];
  for (const p of ring) {
    if (out.length && same(out[out.length - 1], p)) continue;
    out.push(p);
  }
  if (out.length > 2 && same(out[out.length - 1], out[0])) out.pop();
  return out;
}
class ShapeGeometry extends BufferGeometry {
  constructor(shape) {
    super();
    const ring = shapeRing(shape);
    const n = ring.length;
    const pos = [];
    const idx = [];
    if (n < 3) {
      this.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      return this;
    }
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    cx /= n; cy /= n;
    pos.push(cx, cy, 0);
    for (const [x, y] of ring) pos.push(x, y, 0);
    for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
  }
}
class ExtrudeGeometry extends BufferGeometry {
  constructor(shape, opts = {}) {
    super();
    const depth = opts.depth ?? 1;
    const ring = shapeRing(shape);
    const n = ring.length;
    const pos = [];
    if (n < 3) {
      this.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      return this;
    }
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    cx /= n; cy /= n;
    // 顶点表 + 索引（与真实 ExtrudeGeometry 一致：非索引几何会被审计判为开口面片）
    const vkey = new Map();
    const verts = [];
    const idx = [];
    const vid = (x, y, z) => {
      const k = `${x}|${y}|${z}`;
      let id = vkey.get(k);
      if (id === undefined) { id = verts.length / 3; vkey.set(k, id); verts.push(x, y, z); }
      return id;
    };
    const tri = (a, b, c) => idx.push(a, b, c);
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const cT = vid(cx, cy, depth);
      const aT = vid(a[0], a[1], depth);
      const bT = vid(b[0], b[1], depth);
      tri(cT, aT, bT);
      const cB = vid(cx, cy, 0);
      const aB = vid(a[0], a[1], 0);
      const bB = vid(b[0], b[1], 0);
      tri(cB, bB, aB);
      tri(aB, bB, bT);
      tri(aB, bT, aT);
    }
    void pos;
    this.setAttribute('position', new Float32BufferAttribute(verts, 3));
    this.setIndex(idx);
  }
}
class CatmullRomCurve3 {
  constructor(points = [], closed = false, curveType = 'centripetal', tension = 0.5) {
    this.points = points;
    this.closed = closed;
    this.curveType = curveType;
    this.tension = tension;
  }
  getPoint(t, target = new Vector3()) {
    const pts = this.points;
    if (!pts.length) return target.set(0, 0, 0);
    if (pts.length === 1) return target.copy(pts[0]);
    const n = pts.length - 1;
    const s = Math.max(0, Math.min(1, t)) * n;
    let i = Math.floor(s);
    if (i >= n) i = n - 1;
    const lt = s - i;
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n, i + 2)];
    const t2 = lt * lt;
    const t3 = t2 * lt;
    const mix = (a, b, c, d) =>
      0.5 * (2 * b + (-a + c) * lt + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return target.set(mix(p0.x, p1.x, p2.x, p3.x), mix(p0.y, p1.y, p2.y, p3.y), mix(p0.z, p1.z, p2.z, p3.z));
  }
  getPointAt(t, target = new Vector3()) { return this.getPoint(t, target); }
  getTangent(t, target = new Vector3()) {
    const a = this.getPoint(Math.max(0, t - 0.01), new Vector3());
    const b = this.getPoint(Math.min(1, t + 0.01), new Vector3());
    return target.subVectors(b, a).normalize();
  }
  // 真实 three 里 getPointAt/getTangentAt 走弧长参数化；本 mock 的 getPointAt 等同 getPoint
  // （均匀参数），所以 getTangentAt 同样退回 getTangent，两者在 mock 内自洽。
  getTangentAt(t, target = new Vector3()) { return this.getTangent(t, target); }
  getPoints(divisions = 8) {
    const out = [];
    for (let i = 0; i <= divisions; i++) out.push(this.getPoint(i / divisions, new Vector3()));
    return out;
  }
  getSpacedPoints(divisions = 8) { return this.getPoints(divisions); }
}
class LineCurve3 {
  constructor(a = new Vector3(), b = new Vector3()) { this.v1 = a; this.v2 = b; this.points = [a, b]; }
  getPoint(t, target = new Vector3()) {
    return target.set(this.v1.x + (this.v2.x - this.v1.x) * t, this.v1.y + (this.v2.y - this.v1.y) * t, this.v1.z + (this.v2.z - this.v1.z) * t);
  }
  getPointAt(t, target) { return this.getPoint(t, target); }
  getTangent(t, target = new Vector3()) { return target.subVectors(this.v2, this.v1).normalize(); }
  getTangentAt(t, target) { return this.getTangent(t, target); }
}
class QuadraticBezierCurve3 {
  constructor(a = new Vector3(), b = new Vector3(), c = new Vector3()) { this.points = [a, b, c]; }
  getPoint(t, target = new Vector3()) {
    const [a, b, c] = this.points;
    const u = 1 - t;
    return target.set(
      u * u * a.x + 2 * u * t * b.x + t * t * c.x,
      u * u * a.y + 2 * u * t * b.y + t * t * c.y,
      u * u * a.z + 2 * u * t * b.z + t * t * c.z
    );
  }
  getPointAt(t, target) { return this.getPoint(t, target); }
  getTangent(t, target = new Vector3()) {
    const [a, b, c] = this.points;
    const u = 1 - t;
    return target.set(2 * u * (b.x - a.x) + 2 * t * (c.x - b.x),
      2 * u * (b.y - a.y) + 2 * t * (c.y - b.y),
      2 * u * (b.z - a.z) + 2 * t * (c.z - b.z)).normalize();
  }
  getTangentAt(t, target) { return this.getTangent(t, target); }
}
class CubicBezierCurve3 {
  constructor(a = new Vector3(), b = new Vector3(), c = new Vector3(), d = new Vector3()) { this.points = [a, b, c, d]; }
  getPoint(t, target = new Vector3()) {
    const [a, b, c, d] = this.points;
    const u = 1 - t;
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    return target.set(
      w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x,
      w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y,
      w0 * a.z + w1 * b.z + w2 * c.z + w3 * d.z
    );
  }
  getPointAt(t, target) { return this.getPoint(t, target); }
  getTangent(t, target = new Vector3()) {
    const [a, b, c, d] = this.points;
    const u = 1 - t;
    return target.set(3 * u * u * (b.x - a.x) + 6 * u * t * (c.x - b.x) + 3 * t * t * (d.x - c.x),
      3 * u * u * (b.y - a.y) + 6 * u * t * (c.y - b.y) + 3 * t * t * (d.y - c.y),
      3 * u * u * (b.z - a.z) + 6 * u * t * (c.z - b.z) + 3 * t * t * (d.z - c.z)).normalize();
  }
  getTangentAt(t, target) { return this.getTangent(t, target); }
}
class TubeGeometry extends BufferGeometry {
  constructor(curve, tubularSegments = 64, radius = 0.1, radialSegments = 8, closed = false) {
    super();
    tubularSegments = Math.max(2, tubularSegments | 0);
    radialSegments = Math.max(3, radialSegments | 0);
    const frames = [];
    const pts = [];
    for (let i = 0; i <= tubularSegments; i++) pts.push(curve.getPoint(i / tubularSegments, new Vector3()));
    // 平行输运坐标系（与 three 的 computeFrenetFrames 同法）。
    // 旧实现「与上一段法线反向就翻转」在竖直段 / 急弯处会让坐标系跳变，管壁翻折自交
    // （实测煙突弯头 7 个三角形法线朝内）。
    const tangents = [];
    for (let i = 0; i <= tubularSegments; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const t = new Vector3().subVectors(next, prev);
      if (t.lengthSq() < 1e-12) t.set(0, 1, 0);
      tangents.push(t.normalize());
    }
    // 初法线：取与首切线夹角最大的坐标轴，保证第一次叉积不退化
    let seed = new Vector3();
    let min = Infinity;
    const t0 = tangents[0];
    if (Math.abs(t0.x) <= min) { min = Math.abs(t0.x); seed.set(1, 0, 0); }
    if (Math.abs(t0.y) <= min) { min = Math.abs(t0.y); seed.set(0, 1, 0); }
    if (Math.abs(t0.z) <= min) { seed.set(0, 0, 1); }
    const vec = new Vector3().crossVectors(t0, seed).normalize();
    const normals = [new Vector3().crossVectors(t0, vec).normalize()];
    const binormals = [new Vector3().crossVectors(t0, normals[0]).normalize()];
    const rotAbout = (v, axis, angle) => {
      // Rodrigues 旋转：绕 axis 转 angle
      const c = Math.cos(angle);
      const s2 = Math.sin(angle);
      const kxv = new Vector3().crossVectors(axis, v);
      const kd = axis.dot(v);
      return new Vector3(
        v.x * c + kxv.x * s2 + axis.x * kd * (1 - c),
        v.y * c + kxv.y * s2 + axis.y * kd * (1 - c),
        v.z * c + kxv.z * s2 + axis.z * kd * (1 - c)
      );
    };
    for (let i = 1; i <= tubularSegments; i++) {
      let n = normals[i - 1].clone();
      const axis = new Vector3().crossVectors(tangents[i - 1], tangents[i]);
      if (axis.length() > 1e-9) {
        axis.normalize();
        const theta = Math.acos(Math.max(-1, Math.min(1, tangents[i - 1].dot(tangents[i]))));
        n = rotAbout(n, axis, theta).normalize();
      }
      normals.push(n);
      binormals.push(new Vector3().crossVectors(tangents[i], n).normalize());
    }
    for (let i = 0; i <= tubularSegments; i++) {
      frames.push({ point: pts[i], normal: normals[i], binormal: binormals[i], tangent: tangents[i] });
    }
    const pos = [];
    const idx = [];
    for (let i = 0; i <= tubularSegments; i++) {
      const f = frames[i];
      for (let j = 0; j <= radialSegments; j++) {
        const v = (j / radialSegments) * Math.PI * 2;
        const cx = Math.cos(v) * radius;
        const cy = Math.sin(v) * radius;
        pos.push(
          f.point.x + cx * f.normal.x + cy * f.binormal.x,
          f.point.y + cx * f.normal.y + cy * f.binormal.y,
          f.point.z + cx * f.normal.z + cy * f.binormal.z
        );
      }
    }
    const row = radialSegments + 1;
    for (let i = 0; i < tubularSegments; i++) {
      for (let j = 0; j < radialSegments; j++) {
        const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    this.parameters = { tubularSegments, radius, radialSegments, closed };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
  }
}
class LatheGeometry extends BufferGeometry {
  constructor(points = [], segments = 12, phiStart = 0, phiLength = Math.PI * 2) {
    super();
    segments = Math.max(3, segments | 0);
    const n = points.length;
    const pos = [];
    const idx = [];
    for (let i = 0; i <= segments; i++) {
      const phi = phiStart + (i / segments) * phiLength;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      for (let j = 0; j < n; j++) {
        pos.push(points[j].x * c, points[j].y, points[j].x * s);
      }
    }
    const row = n;
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = i * row + j, b = a + row, c = a + row + 1, d = a + 1;
        idx.push(a, d, b);
        idx.push(b, d, c);
      }
    }
    this.parameters = { points, segments, phiStart, phiLength };
    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
  }
}
class Color {
  constructor(c = 0xffffff) { this.isColor = true; this.set(c); }
  set(c) {
    if (typeof c === 'number') { this.r = ((c >> 16) & 255) / 255; this.g = ((c >> 8) & 255) / 255; this.b = (c & 255) / 255; this.hex = c; }
    else if (c && c.isColor) { this.r = c.r; this.g = c.g; this.b = c.b; this.hex = c.hex; }
    else if (typeof c === 'string') { this.hex = parseInt(c.replace('#', '0x'), 16); }
    if (this.hex !== undefined && this.r === undefined) {
      this.r = ((this.hex >> 16) & 255) / 255; this.g = ((this.hex >> 8) & 255) / 255; this.b = (this.hex & 255) / 255;
    }
    return this;
  }
  setHex(c) { return this.set(c); }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  setHSL(h, sl, l) { this.hsl = { h, s: sl, l }; return this; }
  setStyle(s) { return this.set(String(s).replace('#', '0x')); }
  copy(c) { return this.set(c); }
  clone() { return new Color(this.hex); }
  getHex() { return this.hex; }
  getHexString() { return (this.hex || 0).toString(16).padStart(6, '0'); }
  getStyle() { return '#' + (this.hex || 0).toString(16).padStart(6, '0'); }
  equals(c) { return !!c && c.r === this.r && c.g === this.g && c.b === this.b; }
  add(c) { this.r += c.r; this.g += c.g; this.b += c.b; return this; }
  addScalar(v) { this.r += v; this.g += v; this.b += v; return this; }
  sub(c) { this.r -= c.r; this.g -= c.g; this.b -= c.b; return this; }
  multiply(c) { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this; }
  multiplyScalar(v) { this.r *= v; this.g *= v; this.b *= v; return this; }
  lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
  lerpColors(a, b, t) { this.r = a.r + (b.r - a.r) * t; this.g = a.g + (b.g - a.g) * t; this.b = a.b + (b.b - a.b) * t; return this; }
  offsetHSL(h, sl, l) { this.r += h; this.g += sl; this.b += l; return this; }
  offsetRGB(x, y, z) { this.r += x; this.g += y; this.b += z; return this; }
  darken(v) { return this.multiplyScalar(1 - v); }
  lighten(v) { return this.multiplyScalar(1 + v); }
  convertSRGBToLinear() { return this; }
  convertLinearToSRGB() { return this; }
}
class Material {
  constructor(params = {}) {
    // 真实 three.js 的 Material 有 type / isMaterial，审计脚本靠这两个字段分类材质
    this.type = 'Material';
    this.isMaterial = true;
    Object.assign(this, params);
    if (params.color !== undefined) this.color = new Color(params.color);
    if (params.emissive !== undefined) this.emissive = new Color(params.emissive);
    if (this.side === undefined) this.side = 0;
    if (this.transparent === undefined) this.transparent = false;
    if (this.opacity === undefined) this.opacity = 1;
    if (this.needsUpdate === undefined) this.needsUpdate = false;
    if (this.userData === undefined) this.userData = {};
  }
  clone() {
    const c = new this.constructor();
    Object.assign(c, this);
    if (this.color) c.color = this.color.clone();
    if (this.emissive) c.emissive = this.emissive.clone();
    c.userData = Object.assign({}, this.userData);
    return c;
  }
  dispose() {}
}
class MeshToonMaterial extends Material { constructor(p) { super(p); this.type = 'MeshToonMaterial'; this.isMeshToonMaterial = true; } }
class MeshStandardMaterial extends Material { constructor(p) { super(p); this.type = 'MeshStandardMaterial'; this.isMeshStandardMaterial = true; } }
class MeshPhysicalMaterial extends Material { constructor(p) { super(p); this.type = 'MeshPhysicalMaterial'; this.isMeshPhysicalMaterial = true; } }
class MeshBasicMaterial extends Material { constructor(p) { super(p); this.type = 'MeshBasicMaterial'; this.isMeshBasicMaterial = true; } }
class ShaderMaterial extends Material { constructor(p) { super(p); this.type = 'ShaderMaterial'; this.isShaderMaterial = true; } }
class Points extends Object3D {
  constructor(geometry, material) {
    super();
    this.isPoints = true;
    this.geometry = geometry;
    this.material = material;
  }
}
class PointsMaterial extends Material {
  constructor(p) { super(p); this.type = 'PointsMaterial'; this.isPointsMaterial = true; }
}
class LineBasicMaterial extends Material {
  constructor(p) { super(p); this.type = 'LineBasicMaterial'; this.isLineBasicMaterial = true; }
}
class Line extends Object3D {
  constructor(geometry, material) {
    super();
    this.isLine = true;
    this.geometry = geometry;
    this.material = material;
  }
}
class Texture {
  constructor() {
    this.repeat = new Vector2(1, 1);
    this.offset = new Vector2(0, 0);
    this.wrapS = 1000; this.wrapT = 1000;
    this.magFilter = 1006; this.minFilter = 1008;
    this.colorSpace = ''; this.anisotropy = 1; this.needsUpdate = false; this.mapping = 300;
  }
  clone() {
    const c = new this.constructor();
    Object.assign(c, this);
    c.repeat = this.repeat.clone();
    c.offset = this.offset.clone();
    return c;
  }
  dispose() {}
}
class CanvasTexture extends Texture { constructor(canvas) { super(); this.image = canvas; } }
class DataTexture extends Texture { constructor(data, w, h, format) { super(); this.image = { data, width: w, height: h }; } }
class DepthTexture extends Texture { constructor(w, h) { super(); this.image = { width: w, height: h }; } }
class WebGLRenderTarget {
  constructor(w = 1, h = 1, opts = {}) {
    this.width = w; this.height = h; this.options = opts;
    this.texture = new Texture();
    this.depthTexture = opts.depthTexture || null;
    if (opts.format !== undefined) this.texture.format = opts.format;
    if (opts.type !== undefined) this.texture.type = opts.type;
  }
  setSize(w, h) { this.width = w; this.height = h; }
  dispose() {}
}
class FogExp2 { constructor(color, density) { this.color = new Color(color); this.density = density; } }
class Light extends Object3D {
  constructor(color = 0xffffff, intensity = 1) { super(); this.isLight = true; this.color = new Color(color); this.intensity = intensity; }
}
class DirectionalLight extends Light {
  constructor(c, i) {
    super(c, i);
    this.isDirectionalLight = true;
    this.target = new Object3D();
    this.shadow = {
      mapSize: new Vector2(1024, 1024),
      camera: new OrthographicCamera(-1, 1, 1, -1, 0.1, 100),
      bias: 0, normalBias: 0, radius: 1
    };
  }
}
class HemisphereLight extends Light { constructor(sky, ground, i) { super(sky, i); this.isHemisphereLight = true; this.groundColor = new Color(ground); } }
class AmbientLight extends Light { constructor(c, i) { super(c, i); this.isAmbientLight = true; } }
class PointLight extends Light {
  constructor(c, i, distance = 0, decay = 2) { super(c, i); this.isPointLight = true; this.distance = distance; this.decay = decay; }
}
class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    if (!geometry || !geometry.isBufferGeometry !== false && !geometry.attributes) throw new Error('Mesh(): geometry 无效');
    if (!material) throw new Error('Mesh(): material 缺失');
    this.isMesh = true;
    if (geometry.ensureDefaultAttributes) geometry.ensureDefaultAttributes();
    this.geometry = geometry;
    this.material = material;
  }
}
class InstancedMesh extends Mesh {
  constructor(geometry, material, count) {
    super(geometry, material);
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      throw new Error('InstancedMesh(geometry, material, count): count 必须是正整数，收到 ' + JSON.stringify(count));
    }
    this.isInstancedMesh = true;
    this.count = count;
    this.instanceMatrix = { array: new Float32Array(count * 16), needsUpdate: false, setUsage() { return this; } };
    this.instanceColor = null;
  }
  setMatrixAt(i, matrix) {
    if (i < 0 || i >= this.count) throw new Error(`setMatrixAt(): 索引越界 ${i}`);
    matrix.elements.forEach((v, k) => { this.instanceMatrix.array[i * 16 + k] = v; });
  }
  getMatrixAt(i, matrix) {
    if (i < 0 || i >= this.count) throw new Error(`getMatrixAt(): 索引越界 ${i}`);
    return matrix.fromArray(this.instanceMatrix.array, i * 16);
  }
  setColorAt(i, color) {
    if (!this.instanceColor) this.instanceColor = { array: new Float32Array(this.count * 3), needsUpdate: false };
    this.instanceColor.array[i * 3] = color.r;
    this.instanceColor.array[i * 3 + 1] = color.g;
    this.instanceColor.array[i * 3 + 2] = color.b;
  }
}
class Camera extends Object3D {
  constructor() { super(); this.isCamera = true; this.near = 0.1; this.far = 1000; }
  updateProjectionMatrix() { this.projectionUpdated = true; }
}
class PerspectiveCamera extends Camera {
  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super();
    this.isPerspectiveCamera = true;
    this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
  }
}
class OrthographicCamera extends Camera {
  constructor(l = -1, r = 1, t = 1, b = -1, near = 0.1, far = 200) { super(); this.isOrthographicCamera = true; }
}
class WebGLRenderer {
  constructor(params = {}) {
    this.domElement = params.canvas || null;
    this.shadowMap = { enabled: false, type: 0 };
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.outputColorSpace = '';
    this.info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } };
    this._pr = 1;
    this._size = { x: 1600, y: 900 };
    this.renderCount = 0;
  }
  setPixelRatio(v) { this._pr = v; }
  getPixelRatio() { return this._pr; }
  setSize(w, h) { this._size.x = w; this._size.y = h; }
  getSize(v) { v.set(this._size.x, this._size.y); return v; }
  setRenderTarget() {}
  clear() {}
  render(scene, camera) {
    if (!scene || !camera) throw new Error('render(): 需要 scene 与 camera');
    this.renderCount++;
  }
  dispose() {}
}
class PMREMGenerator {
  constructor() {}
  compileEquirectangularShader() {}
  fromEquirectangular() { return { texture: new Texture() }; }
  fromScene() { return { texture: new Texture() }; }
  dispose() {}
}
const MathUtils = {
  degToRad: (d) => (d * Math.PI) / 180,
  radToDeg: (r) => (r * 180) / Math.PI,
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  clamp01: (v) => Math.max(0, Math.min(1, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  randFloat: (a, b) => a + Math.random() * (b - a)
};
class Clock {
  constructor(autoStart = true) {
    this.autoStart = autoStart;
    this.startTime = 0; this.oldTime = 0; this.elapsedTime = 0; this.running = false;
  }
  start() { this.startTime = 0; this.oldTime = 0; this.elapsedTime = 0; this.running = true; }
  getDelta() {
    if (!this.running) { if (this.autoStart) this.start(); return 0; }
    const now = Date.now();
    const diff = (now - this.oldTime) / 1000;
    this.oldTime = now;
    this.elapsedTime += diff;
    return diff;
  }
  getElapsedTime() { this.getDelta(); return this.elapsedTime; }
}
class SpotLight extends Light {
  constructor(color, intensity, distance = 0, angle = Math.PI / 3, penumbra = 0, decay = 2) {
    super(color, intensity);
    this.isSpotLight = true;
    this.distance = distance; this.angle = angle; this.penumbra = penumbra; this.decay = decay;
    this.target = new Object3D();
    this.shadow = { mapSize: new Vector2(1024, 1024), camera: { near: 0.1, far: 100, fov: 50 }, bias: 0, normalBias: 0, radius: 1 };
  }
}
class MeshLambertMaterial extends Material { constructor(p) { super(p); this.isMeshLambertMaterial = true; } }
class SpriteMaterial extends Material { constructor(p) { super(p); this.isSpriteMaterial = true; } }
class Vector4 {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  clone() { return new Vector4(this.x, this.y, this.z, this.w); }
}
const UniformsUtils = {
  merge: (uniforms) => {
    const out = {};
    for (const u of uniforms) {
      for (const k of Object.keys(u)) {
        const v = u[k];
        out[k] = v && v.value !== undefined ? { value: v.value } : { value: v };
      }
    }
    return out;
  },
  clone: (src) => UniformsUtils.merge([src])
};
export {
  Clock, SpotLight, MeshLambertMaterial, SpriteMaterial, Vector4, UniformsUtils,
  Vector2, Vector3, Box3, Euler, Quaternion, Matrix4, Object3D, Group, Scene, Mesh, InstancedMesh,
  BufferAttribute, Float32BufferAttribute, Uint16BufferAttribute,
  BufferGeometry, BoxGeometry, PlaneGeometry, CircleGeometry, RingGeometry, CylinderGeometry,
  SphereGeometry, ConeGeometry, CapsuleGeometry, TorusGeometry, IcosahedronGeometry, OctahedronGeometry,
  Shape, ShapeGeometry, ExtrudeGeometry,
  CatmullRomCurve3, LineCurve3, QuadraticBezierCurve3, CubicBezierCurve3,
  TubeGeometry, LatheGeometry, Color, Material, MeshToonMaterial,
  MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, ShaderMaterial, Texture,
  CanvasTexture, DataTexture, DepthTexture, WebGLRenderTarget, FogExp2, Light, DirectionalLight,
  HemisphereLight, AmbientLight, PointLight, Camera, PerspectiveCamera, OrthographicCamera,
  WebGLRenderer, PMREMGenerator, MathUtils, FakeAttribute,
  Points, PointsMaterial, Line, LineBasicMaterial
};
export const SRGBColorSpace = 'srgb';
export const NoColorSpace = '';
export const LinearSRGBColorSpace = 'srgb-linear';
export const LinearFilter = 1006;
export const NearestFilter = 1003;
export const RGBAFormat = 1023;
export const RedFormat = 1028;
export const DepthFormat = 1026;
export const HalfFloatType = 1016;
export const UnsignedByteType = 1009;
export const UnsignedIntType = 1014;
export const FloatType = 1015;
export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;
export const BasicShadowMap = 0;
export const PCFShadowMap = 1;
export const PCFSoftShadowMap = 2;
export const NoToneMapping = 0;
export const ACESFilmicToneMapping = 4;
export const ReinhardToneMapping = 2;
export const RepeatWrapping = 1000;
export const ClampToEdgeWrapping = 1001;
export const StaticDrawUsage = 35044;
export const DynamicDrawUsage = 35048;
export const NormalBlending = 1;
export const MultiplyBlending = 4;
export const AdditiveBlending = 2;
export const EquirectangularReflectionMapping = 303;
