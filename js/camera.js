// 第三人称受限观景视角控制器（支持在参道旁侧观察 + 受限横向/纵向移动空间）：
// - 默认机位设在参道左侧溪谷畔（azimuth 98.8°），从路旁斜向观察弯曲石阶与鸟居，还原参考图构图；
// - 水平旋转：放宽至 [45°, 135°]（±45°），提供充裕的横向观察视野，禁止转至场景背面；
// - 横向与纵向移动：支持右键拖拽 / Shift+左键拖拽 / 双指平移 / 键盘 WASD 或方向键在受限走廊与溪谷范围内平移观察，
//   同时左键旋转时自动耦合轻微横向视点偏移，让用户在路的旁边自由移动观察而绝不穿出场景边界；
// - 垂直俯仰：[-10°, 45°]，含二分法地面防穿透保护。
import * as THREE from 'three';
import { CAMERA } from './config.js';
import { PATH, clamp, lerp, pathCenterX, terrainHeight } from './layout.js';

const DEG = Math.PI / 180;

export function createCameraRig(canvas) {
  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    (window.innerWidth || 1) / (window.innerHeight || 1),
    CAMERA.near,
    CAMERA.far
  );

  const baseTarget = new THREE.Vector3(CAMERA.target.x, CAMERA.target.y, CAMERA.target.z);
  const target = baseTarget.clone();
  let customTargetLocked = false;

  const minAz = (CAMERA.azimuthMin ?? 45) * DEG;
  const maxAz = (CAMERA.azimuthMax ?? 135) * DEG;
  const minEl = (CAMERA.elevationMin ?? -10) * DEG;
  const maxEl = (CAMERA.elevationMax ?? 45) * DEG;
  const panLimitX = CAMERA.panLimitX ?? 3.8;
  const panLimitZ = CAMERA.panLimitZ ?? 4.5;
  const panSpeed = CAMERA.panSpeed ?? 0.012;

  const desired = {
    azimuth: clamp(CAMERA.azimuthDeg * DEG, minAz, maxAz),
    elevation: clamp(CAMERA.elevationDeg * DEG, minEl, maxEl),
    radius: clamp(CAMERA.radius, CAMERA.radiusMin, CAMERA.radiusMax),
    panX: 0,
    panZ: 0
  };
  const current = { ...desired };

  let dragging = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;
  let pinchDistance = 0;
  let lastTouchX = 0;
  let lastTouchY = 0;

  const onContextMenu = (e) => {
    e.preventDefault();
  };

  const onPointerDown = (e) => {
    const isPanBtn = CAMERA.panEnabled && (e.button === 1 || e.button === 2 || e.shiftKey);
    if (e.button !== undefined && e.button !== 0 && !isPanBtn) return;
    dragging = true;
    panning = isPanBtn;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (panning || (CAMERA.panEnabled && e.shiftKey)) {
      const scale = panSpeed * (current.radius / CAMERA.radius);
      desired.panX = clamp(desired.panX - dx * scale, -panLimitX, panLimitX);
      desired.panZ = clamp(desired.panZ - dy * scale, -panLimitZ, panLimitZ);
    } else {
      desired.azimuth = clamp(desired.azimuth - dx * CAMERA.dragSpeed, minAz, maxAz);
      desired.elevation = clamp(desired.elevation + dy * CAMERA.dragSpeed, minEl, maxEl);
    }
  };

  const onPointerUp = (e) => {
    dragging = false;
    panning = false;
    canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e) => {
    e.preventDefault();
    desired.radius = clamp(
      desired.radius * Math.exp(e.deltaY * CAMERA.zoomSpeed),
      CAMERA.radiusMin,
      CAMERA.radiusMax
    );
  };

  const onKeyDown = (e) => {
    if (!CAMERA.panEnabled) return;
    const step = 0.32;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
      desired.panX = clamp(desired.panX - step, -panLimitX, panLimitX);
    } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
      desired.panX = clamp(desired.panX + step, -panLimitX, panLimitX);
    } else if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
      desired.panZ = clamp(desired.panZ - step, -panLimitZ, panLimitZ);
    } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
      desired.panZ = clamp(desired.panZ + step, -panLimitZ, panLimitZ);
    }
  };

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      pinchDistance = touchDistance(e.touches);
      lastTouchX = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
      lastTouchY = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
    }
  };

  const onTouchMove = (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const d = touchDistance(e.touches);
      if (pinchDistance > 0) {
        desired.radius = clamp(
          desired.radius * (pinchDistance / Math.max(d, 1)),
          CAMERA.radiusMin,
          CAMERA.radiusMax
        );
      }
      pinchDistance = d;
      if (CAMERA.panEnabled) {
        const cx = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
        const scale = panSpeed * 0.8;
        desired.panX = clamp(desired.panX - (cx - lastTouchX) * scale, -panLimitX, panLimitX);
        desired.panZ = clamp(desired.panZ - (cy - lastTouchY) * scale, -panLimitZ, panLimitZ);
        lastTouchX = cx;
        lastTouchY = cy;
      }
    }
  };

  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });

  function updateCoupledTarget(r) {
    if (customTargetLocked) return;
    // 随水平方位角自动附带微幅横向视点延展，使在路旁观察时构图更灵动自然
    const orbitSideShift = Math.sin(current.azimuth - Math.PI * 0.5) * 0.65;
    if (r <= CAMERA.radius) {
      const u = clamp((r - CAMERA.radiusMin) / Math.max(0.01, CAMERA.radius - CAMERA.radiusMin), 0, 1);
      const tz = clamp(lerp(9.5, baseTarget.z, u) + current.panZ, -4.2, PATH.zBottom);
      const nearX = pathCenterX(9.5) - 0.55;
      const tx = clamp(lerp(nearX, baseTarget.x, u) + current.panX + orbitSideShift, -3.8, 3.5);
      const ty = lerp(terrainHeight(tx, tz) + 0.55, baseTarget.y, u);
      target.set(tx, ty, tz);
    } else {
      const u = clamp((r - CAMERA.radius) / Math.max(0.01, CAMERA.radiusMax - CAMERA.radius), 0, 1);
      const tz = clamp(lerp(baseTarget.z, -1.2, u) + current.panZ * (1 - u * 0.6), -4.2, PATH.zBottom);
      const tx = clamp(baseTarget.x + current.panX * (1 - u * 0.5) + orbitSideShift * (1 - u * 0.5), -3.8, 3.5);
      const ty = lerp(baseTarget.y, 3.2, u);
      target.set(tx, ty, tz);
    }
  }

  /** 地面防穿透：二分法求不低于地面 + 0.30m 的最低仰角 */
  function safeElevation(az, el, r) {
    const posAt = (pitch) => {
      const ce = Math.cos(pitch);
      return {
        x: target.x + Math.cos(az) * ce * r,
        y: target.y + Math.sin(pitch) * r,
        z: target.z + Math.sin(az) * ce * r
      };
    };
    const p0 = posAt(el);
    const floor0 = terrainHeight(p0.x, p0.z) + 0.3;
    if (p0.y >= floor0) return el;

    let lo = el;
    let hi = maxEl;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) * 0.5;
      const pm = posAt(mid);
      if (pm.y >= terrainHeight(pm.x, pm.z) + 0.3) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  function apply(dt) {
    desired.azimuth = clamp(desired.azimuth, minAz, maxAz);
    desired.elevation = clamp(desired.elevation, minEl, maxEl);
    desired.radius = clamp(desired.radius, CAMERA.radiusMin, CAMERA.radiusMax);
    desired.panX = clamp(desired.panX, -panLimitX, panLimitX);
    desired.panZ = clamp(desired.panZ, -panLimitZ, panLimitZ);

    const k = dt >= 0.99 ? 1 : 1 - Math.exp(-Math.max(0, dt) * CAMERA.damping);
    current.azimuth += (desired.azimuth - current.azimuth) * k;
    current.elevation += (desired.elevation - current.elevation) * k;
    current.radius += (desired.radius - current.radius) * k;
    current.panX += (desired.panX - current.panX) * k;
    current.panZ += (desired.panZ - current.panZ) * k;

    updateCoupledTarget(current.radius);
    const effectiveEl = safeElevation(current.azimuth, current.elevation, current.radius);

    const ce = Math.cos(effectiveEl);
    camera.position.set(
      target.x + Math.cos(current.azimuth) * ce * current.radius,
      target.y + Math.sin(effectiveEl) * current.radius,
      target.z + Math.sin(current.azimuth) * ce * current.radius
    );
    camera.lookAt(target);

    camera.near = Math.max(0.05, Math.min(CAMERA.near, current.radius * 0.015));
    camera.far = CAMERA.far;
    camera.updateProjectionMatrix();
  }

  apply(1);

  return {
    camera,
    target,
    get radius() {
      return current.radius;
    },
    get azimuthDeg() {
      return current.azimuth / DEG;
    },
    get elevationDeg() {
      return current.elevation / DEG;
    },
    get focusDistance() {
      return camera.position.distanceTo(target);
    },
    setTarget(x, y, z) {
      customTargetLocked = true;
      target.set(
        clamp(x, -3.8, 3.8),
        y,
        clamp(z, -4.2, PATH.zBottom)
      );
    },
    setView({ azimuthDeg, elevationDeg, radius, panX, panZ }) {
      if (azimuthDeg !== undefined) desired.azimuth = clamp(azimuthDeg * DEG, minAz, maxAz);
      if (elevationDeg !== undefined) desired.elevation = clamp(elevationDeg * DEG, minEl, maxEl);
      if (radius !== undefined) desired.radius = clamp(radius, CAMERA.radiusMin, CAMERA.radiusMax);
      if (panX !== undefined) desired.panX = clamp(panX, -panLimitX, panLimitX);
      if (panZ !== undefined) desired.panZ = clamp(panZ, -panLimitZ, panLimitZ);
    },
    update: apply,
    resize() {
      camera.aspect = (window.innerWidth || 1) / (window.innerHeight || 1);
      camera.updateProjectionMatrix();
    },
    dispose() {
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
    }
  };
}

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}
