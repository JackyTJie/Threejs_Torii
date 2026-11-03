// 第三人称自由观景相机：拖拽 360° 环绕、无极缩放、俯仰不锁、碰撞默认关闭
import * as THREE from 'three';
import { CAMERA } from './config.js';

const DEG = Math.PI / 180;

/**
 * 创建相机与交互控制。不生成任何界面元素，只监听画布输入。
 * @param {HTMLCanvasElement} canvas
 */
export function createCameraRig(canvas) {
  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    (window.innerWidth || 1) / (window.innerHeight || 1),
    CAMERA.near,
    CAMERA.far
  );

  const target = new THREE.Vector3(CAMERA.target.x, CAMERA.target.y, CAMERA.target.z);
  const desired = {
    azimuth: CAMERA.azimuthDeg * DEG,
    elevation: CAMERA.elevationDeg * DEG,
    radius: CAMERA.radius
  };
  const current = { ...desired };

  const minEl = CAMERA.elevationMin * DEG;
  const maxEl = CAMERA.elevationMax * DEG;

  const keys = new Set();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastInput = 0;
  let pinchDistance = 0;

  const onPointerDown = (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    lastInput = 0;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    lastInput = 0;
    desired.azimuth -= dx * CAMERA.dragSpeed;
    desired.elevation = clamp(desired.elevation + dy * CAMERA.dragSpeed, minEl, maxEl);
  };

  const onPointerUp = (e) => {
    dragging = false;
    canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e) => {
    e.preventDefault();
    lastInput = 0;
    desired.radius = clamp(
      desired.radius * Math.exp(e.deltaY * CAMERA.zoomSpeed),
      CAMERA.radiusMin,
      CAMERA.radiusMax
    );
  };

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      pinchDistance = touchDistance(e.touches);
    }
  };

  const onTouchMove = (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const d = touchDistance(e.touches);
      if (pinchDistance > 0) {
        desired.radius = clamp(desired.radius * (pinchDistance / Math.max(d, 1)), CAMERA.radiusMin, CAMERA.radiusMax);
      }
      pinchDistance = d;
      lastInput = 0;
    }
  };

  const onKeyDown = (e) => {
    keys.add(e.key.toLowerCase());
    lastInput = 0;
  };
  const onKeyUp = (e) => keys.delete(e.key.toLowerCase());

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function apply(dt) {
    // 键盘平移观察点（不改变朝向，只移动注视中心）
    const panSpeed = desired.radius * CAMERA.panSpeed;
    let px = 0;
    let pz = 0;
    if (keys.has('w') || keys.has('arrowup')) pz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) pz += 1;
    if (keys.has('a') || keys.has('arrowleft')) px -= 1;
    if (keys.has('d') || keys.has('arrowright')) px += 1;
    if (px || pz) {
      lastInput = 0;
      const sinA = Math.sin(current.azimuth);
      const cosA = Math.cos(current.azimuth);
      target.x += (px * cosA - pz * sinA) * panSpeed * dt * 60;
      target.z += (px * sinA + pz * cosA) * panSpeed * dt * 60;
    }

    // 静置后极缓慢环绕，保持画面"活着"
    lastInput += dt;
    if (lastInput > CAMERA.idleDelay && !dragging) {
      desired.azimuth += CAMERA.idleDriftSpeed * dt;
    }

    const k = 1 - Math.exp(-dt * CAMERA.damping);
    current.azimuth += (desired.azimuth - current.azimuth) * k;
    current.elevation += (desired.elevation - current.elevation) * k;
    current.radius += (desired.radius - current.radius) * k;

    const ce = Math.cos(current.elevation);
    camera.position.set(
      target.x + Math.cos(current.azimuth) * ce * current.radius,
      target.y + Math.sin(current.elevation) * current.radius,
      target.z + Math.sin(current.azimuth) * ce * current.radius
    );
    camera.lookAt(target);

    // 动态近远平面：保证微距与全景都有足够深度精度
    camera.near = Math.max(0.02, current.radius * 0.01);
    camera.far = Math.max(120, current.radius * 6 + 120);
    camera.updateProjectionMatrix();
  }

  return {
    camera,
    target,
    get radius() {
      return current.radius;
    },
    get focusDistance() {
      return camera.position.distanceTo(target);
    },
    /** 由资产模块或调校脚本设定观察中心 */
    setTarget(x, y, z) {
      target.set(x, y, z);
    },
    /** 设定机位（用于固定构图或审计复现） */
    setView({ azimuthDeg, elevationDeg, radius }) {
      if (azimuthDeg !== undefined) desired.azimuth = azimuthDeg * DEG;
      if (elevationDeg !== undefined) desired.elevation = clamp(elevationDeg * DEG, minEl, maxEl);
      if (radius !== undefined) desired.radius = clamp(radius, CAMERA.radiusMin, CAMERA.radiusMax);
    },
    /** 俯仰范围放开（本项目不锁定俯仰） */
    releasePitchLimits() {
      desired.elevation = clamp(desired.elevation, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    },
    update: apply,
    resize() {
      camera.aspect = (window.innerWidth || 1) / (window.innerHeight || 1);
      camera.updateProjectionMatrix();
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    }
  };
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}
