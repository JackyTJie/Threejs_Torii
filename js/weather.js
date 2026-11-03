// 气象系统（可切换彩蛋）：
// 支持一键切换三种完整联动的天气模式：
//   1. 'clear'（雨后初霁）：默认基准，空气澄澈，林间丁达尔体积光束（God Ray）与微尘清晰，石阶带雨后微湿积水；
//   2. 'rain'（细雨霏霏）：发丝级纤细雨丝粒子下落 + 石阶与水面微细雨滴涟漪 + 全局物体表面变湿、反射率增强 + 山谷雾气变浓 + 实时触发 SWE 溪流雨滴波纹；
//   3. 'fog'（深山浓雾）：浓雾模式，能见度极低，远景密林隐入深山云雾，仅近处朱红鸟居与暖光木灯笼在雾中浮现，氛围感拉满。
import * as THREE from 'three';
import { pathBoundsAt, stepTopY, frontZ, PATH, streamCenterX, waterY } from './layout.js';
import { SUN_LINKED_MATERIALS } from './toon.js';

export const WEATHER_MODES = [
  { id: 'clear', label: '雨后初霁', code: 0.0, wetness: 0.22 },
  { id: 'rain', label: '细雨霏霏', code: 1.0, wetness: 0.95 },
  { id: 'fog', label: '深山浓雾', code: 2.0, wetness: 0.45 }
];

const RAIN_COUNT = 520;
const SPLASH_COUNT = 36;

export function createWeatherSystem({ scene, post, swe }) {
  let currentMode = 'clear';
  let elapsed = 0;

  const root = new THREE.Group();
  root.name = 'weatherEffects';
  root.visible = false;
  root.userData.noOutline = true;

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const rainQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.03, 0.22, -0.06));
  const scl = new THREE.Vector3();

  // 1) 发丝级纤细雨丝（宽度仅 1.6mm，长度 18cm，轻盈柔雾感，且避开近机位镜头前防止显大）
  const rainGeo = new THREE.PlaneGeometry(0.0016, 0.18);
  const rainMat = new THREE.MeshBasicMaterial({
    color: 0xc8e4dc,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  rainMat.name = 'mistRainStreak';
  const rainInst = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
  rainInst.name = 'weather-rain-streaks';
  rainInst.frustumCulled = false;
  rainInst.userData.noOutline = true;
  rainInst.userData.noCast = true;

  const rainMeta = [];
  for (let i = 0; i < RAIN_COUNT; i++) {
    const x = ((i * 1.371) % 16.0) - 8.0;
    const y = (i * 0.793) % 11.2;
    // 限制 z <= 11.2，避免雨丝贴近相机镜头（z ≈ 14.2）产生粗白线
    const z = -6.5 + ((i * 2.137) % 17.5);
    const speed = 8.2 + (i % 7) * 0.55;
    const scaleY = 0.65 + (i % 5) * 0.10;
    rainMeta.push({ x, y, z, speed, scaleY });
    pos.set(x, y, z);
    scl.set(1, scaleY, 1);
    m4.compose(pos, rainQuat, scl);
    rainInst.setMatrixAt(i, m4);
  }
  rainInst.instanceMatrix.needsUpdate = true;
  root.add(rainInst);

  // 2) 极微细雨滴水花点（半径仅 3.5~6.5mm，随扩散迅速缩灭，绝无地面白圆圈/圆饼感）
  const splashGeo = new THREE.RingGeometry(0.0035, 0.0065, 12);
  splashGeo.rotateX(-Math.PI / 2);
  const splashMat = new THREE.MeshBasicMaterial({
    color: 0xd2ebe5,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  splashMat.name = 'puddleSplashRing';
  const splashInst = new THREE.InstancedMesh(splashGeo, splashMat, SPLASH_COUNT);
  splashInst.name = 'weather-rain-splashes';
  splashInst.frustumCulled = false;
  splashInst.userData.noOutline = true;
  splashInst.userData.noCast = true;

  const splashMeta = [];
  for (let i = 0; i < SPLASH_COUNT; i++) {
    const isStep = i < 24;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    if (isStep) {
      const k = Math.floor((i / 24) * PATH.steps);
      const zf = frontZ(k);
      sz = zf - (0.12 + (i % 3) * 0.11);
      const { x0, x1 } = pathBoundsAt(sz);
      sx = x0 + 0.25 + ((i * 0.37) % 1) * (x1 - x0 - 0.5);
      sy = stepTopY(k) + 0.008;
    } else {
      sz = -2.0 + ((i - 24) / 12) * 12.0;
      sx = streamCenterX(sz) + ((i % 3) - 1) * 0.32;
      sy = waterY(sz) + 0.008;
    }
    splashMeta.push({
      x: sx,
      y: sy,
      z: sz,
      phase: (i / SPLASH_COUNT) * Math.PI * 2,
      speed: 3.2 + (i % 5) * 0.45
    });
    pos.set(sx, sy, sz);
    scl.setScalar(0.3);
    m4.compose(pos, quat, scl);
    splashInst.setMatrixAt(i, m4);
  }
  splashInst.instanceMatrix.needsUpdate = true;
  root.add(splashInst);

  if (scene) scene.add(root);

  function applyWetnessAndMode(spec) {
    for (const mat of SUN_LINKED_MATERIALS) {
      const u = mat.userData && mat.userData.uniforms;
      if (u && u.uWeatherWetness) {
        u.uWeatherWetness.value = spec.wetness;
      }
    }
    if (post && post.setWeatherMode) {
      post.setWeatherMode(spec.code);
    }
  }

  function setMode(modeId) {
    const found = WEATHER_MODES.find((m) => m.id === modeId) || WEATHER_MODES[0];
    currentMode = found.id;
    const isRain = currentMode === 'rain';
    root.visible = isRain;
    rainInst.visible = isRain;
    splashInst.visible = isRain;
    applyWetnessAndMode(found);
    return found;
  }
  setMode('clear');

  function step(dt, totalTime) {
    elapsed = totalTime !== undefined ? totalTime : elapsed + dt;
    for (const mat of SUN_LINKED_MATERIALS) {
      const u = mat.userData && mat.userData.uniforms;
      if (u && u.uWeatherTime) {
        u.uWeatherTime.value = elapsed;
      }
    }

    if (currentMode !== 'rain' || !Number.isFinite(dt) || dt <= 0) return;

    // 推进细雨雨丝下落
    for (let i = 0; i < RAIN_COUNT; i++) {
      const m = rainMeta[i];
      m.y -= m.speed * dt;
      m.x -= 0.45 * dt;
      if (m.y < 0.1) {
        m.y = 10.2 + (i % 7) * 0.32;
        m.x = ((i * 1.37) % 16) - 8.0;
      }
      pos.set(m.x, m.y, m.z);
      scl.set(1, m.scaleY, 1);
      m4.compose(pos, rainQuat, scl);
      rainInst.setMatrixAt(i, m4);
    }
    rainInst.instanceMatrix.needsUpdate = true;

    // 推进微细雨滴触地涟漪（触地微闪即消散）
    for (let i = 0; i < SPLASH_COUNT; i++) {
      const sm = splashMeta[i];
      const cyc = (elapsed * sm.speed + sm.phase) % 1.0;
      const radiusScale = Math.sin(cyc * Math.PI) * (0.45 + 0.55 * (1 - cyc));
      pos.set(sm.x, sm.y, sm.z);
      scl.set(radiusScale, 1, radiusScale);
      m4.compose(pos, quat, scl);
      splashInst.setMatrixAt(i, m4);
    }
    splashInst.instanceMatrix.needsUpdate = true;

    // 细雨落入山涧实时激发 SWE 浅水波纹
    if (swe && Math.random() < 0.45) {
      const rz = -3.0 + Math.random() * 14.0;
      const rx = streamCenterX(rz) + (Math.random() - 0.5) * 0.9;
      swe.addDrop(rx, rz, 0.0065, 0.28);
    }
  }

  return {
    get mode() {
      return currentMode;
    },
    setMode,
    step,
    resetDefault() {
      return setMode('clear');
    }
  };
}
