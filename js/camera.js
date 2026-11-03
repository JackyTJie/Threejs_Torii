// 第三人称受限观景视角控制器（支持在参道旁侧观察 + 严格锁死后向运动防超模）：
// - 默认机位设在参道左侧溪谷畔（azimuth 98.8°），从路旁斜向观察弯曲石阶与鸟居，还原参考图构图；
// - 水平旋转：约束在 [55°, 128°]，提供充裕的横向观察视野，禁止转至场景背面或露出林外；
// - 前后与左右移动硬性锁死：
//   * 向前（W / ArrowUp / 拖拽）：最多深入至鸟居下方台阶（panZMin = -4.2）；
//   * 向后（S / ArrowDown / 拖拽 / 滚轮拉远）：严格锁死在石阶底端前景林木内侧（panZMax = 0.0，radiusMax = 15.6，
//     且相机世界坐标 camera.position.z 强制 <= 14.65），绝不允许退到前景树干外或底座边界外（彻底杜绝超模穿帮）；
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

  const minAz = (CAMERA.azimuthMin ?? 55) * DEG;
  const maxAz = (CAMERA.azimuthMax ?? 128) * DEG;
  const minEl = (CAMERA.elevationMin ?? -10) * DEG;
  const maxEl = (CAMERA.elevationMax ?? 45) * DEG;
  const panXMin = CAMERA.panLimitXMin ?? -1.5;
  const panXMax = CAMERA.panLimitXMax ?? 2.3;
  const panZMin = CAMERA.panLimitZMin ?? -4.2;
  const panZMax = CAMERA.panLimitZMax ?? 0.0;
  const panSpeed = CAMERA.panSpeed ?? 0.012;
  const bounds = CAMERA.bounds || { xMin: -4.3, xMax: 3.2, zMin: -0.5, zMax: 14.65 };

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
      desired.panX = clamp(desired.panX - dx * scale, panXMin, panXMax);
      desired.panZ = clamp(desired.panZ - dy * scale, panZMin, panZMax);
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
    const step = 0.28;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
      desired.panX = clamp(desired.panX - step, panXMin, panXMax);
    } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
      desired.panX = clamp(desired.panX + step, panXMin, panXMax);
    } else if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
      desired.panZ = clamp(desired.panZ - step, panZMin, panZMax);
    } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
      desired.panZ = clamp(desired.panZ + step, panZMin, panZMax);
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
        desired.panX = clamp(desired.panX - (cx - lastTouchX) * scale, panXMin, panXMax);
        desired.panZ = clamp(desired.panZ - (cy - lastTouchY) * scale, panZMin, panZMax);
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
    const orbitSideShift = Math.sin(current.azimuth - Math.PI * 0.5) * 0.45;
    const u = clamp((r - CAMERA.radiusMin) / Math.max(0.01, CAMERA.radius - CAMERA.radiusMin), 0, 1);
    const tz = clamp(lerp(8.2, baseTarget.z, u) + current.panZ, -4.8, 8.2);
    const nearX = pathCenterX(8.2) - 0.45;
    const tx = clamp(lerp(nearX, baseTarget.x, u) + current.panX + orbitSideShift, -2.6, 2.4);
    const ty = lerp(terrainHeight(tx, tz) + 0.58, baseTarget.y, u);
    target.set(tx, ty, tz);
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
    const floor0 = terrainHeight(p0.x, p0.z) + 0.32;
    if (p0.y >= floor0) return el;

    let lo = el;
    let hi = maxEl;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) * 0.5;
      const pm = posAt(mid);
      if (pm.y >= terrainHeight(pm.x, pm.z) + 0.32) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  function apply(dt) {
    desired.azimuth = clamp(desired.azimuth, minAz, maxAz);
    desired.elevation = clamp(desired.elevation, minEl, maxEl);
    desired.radius = clamp(desired.radius, CAMERA.radiusMin, CAMERA.radiusMax);
    desired.panX = clamp(desired.panX, panXMin, panXMax);
    desired.panZ = clamp(desired.panZ, panZMin, panZMax);

    const k = dt >= 0.99 ? 1 : 1 - Math.exp(-Math.max(0, dt) * CAMERA.damping);
    current.azimuth += (desired.azimuth - current.azimuth) * k;
    current.elevation += (desired.elevation - current.elevation) * k;
    current.radius += (desired.radius - current.radius) * k;
    current.panX += (desired.panX - current.panX) * k;
    current.panZ += (desired.panZ - current.panZ) * k;

    updateCoupledTarget(current.radius);
    let effectiveEl = safeElevation(current.azimuth, current.elevation, current.radius);
    let ce = Math.cos(effectiveEl);
    const cosAz = Math.cos(current.azimuth);
    const sinAz = Math.sin(current.azimuth);

    // 硬性后退与边界锁死：若相机眼点 Z 超过前景边界 bounds.zMax（14.65m），立即锁死半径与 panZ
    let camZ = target.z + sinAz * ce * current.radius;
    if (camZ > bounds.zMax && sinAz * ce > 1e-4) {
      const maxAllowedRadius = clamp(
        (bounds.zMax - target.z) / (sinAz * ce),
        CAMERA.radiusMin,
        CAMERA.radiusMax
      );
      current.radius = Math.min(current.radius, maxAllowedRadius);
      desired.radius = Math.min(desired.radius, maxAllowedRadius);
      effectiveEl = safeElevation(current.azimuth, current.elevation, current.radius);
      ce = Math.cos(effectiveEl);
      camZ = target.z + sinAz * ce * current.radius;
      if (camZ > bounds.zMax) {
        const excessZ = camZ - bounds.zMax;
        target.z -= excessZ;
        current.panZ = clamp(current.panZ - excessZ, panZMin, panZMax);
        desired.panZ = clamp(desired.panZ - excessZ, panZMin, panZMax);
      }
    }

    const finalX = clamp(target.x + cosAz * ce * current.radius, bounds.xMin, bounds.xMax);
    const finalZ = clamp(target.z + sinAz * ce * current.radius, bounds.zMin, bounds.zMax);
    const minGroundY = terrainHeight(finalX, finalZ) + 0.32;
    const finalY = Math.max(minGroundY, target.y + Math.sin(effectiveEl) * current.radius);

    camera.position.set(finalX, finalY, finalZ);
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
        clamp(x, -2.8, 2.6),
        y,
        clamp(z, -4.8, PATH.zBottom)
      );
    },
    setView({ azimuthDeg, elevationDeg, radius, panX, panZ }) {
      if (azimuthDeg !== undefined) desired.azimuth = clamp(azimuthDeg * DEG, minAz, maxAz);
      if (elevationDeg !== undefined) desired.elevation = clamp(elevationDeg * DEG, minEl, maxEl);
      if (radius !== undefined) desired.radius = clamp(radius, CAMERA.radiusMin, CAMERA.radiusMax);
      if (panX !== undefined) desired.panX = clamp(panX, panXMin, panXMax);
      if (panZ !== undefined) desired.panZ = clamp(panZ, panZMin, panZMax);
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
