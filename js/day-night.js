// 动态昼夜切换系统（第三优先级）：
// 支持「雨后深林默认基准」与「深夜 → 清晨 → 正午 → 黄昏 → 深夜」24 小时连续插值循环。
// 同步联动：天空背景色调、主光源（日间太阳光 / 夜间冷蓝月光）方位角/仰角/色温/亮度、
// 半球补光、轮廓光、分层高度雾颜色与浓度、Bloom 辉光强度、以及水体/叶片/鸟居红漆着色器光照方向。
import * as THREE from 'three';
import { LIGHT, POST } from './config.js';
import { lightDirection, shadowFrustum } from './lighting.js';
import { SUN_LINKED_MATERIALS } from './toon.js';

const SHADOW_TARGET_Y = 0.4;

/**
 * 24 小时关键帧表（hour ∈ [0, 24]）：
 * 其中 10.5h 锚定为当前「雨后深林静谧基准」，保证默认状态下 100% 保持原片氛围。
 */
export const DAY_NIGHT_KEYFRAMES = [
  {
    id: 'midnight',
    label: '深夜',
    hour: 0.0,
    isNight: true,
    sunAzimuthDeg: 205,
    sunElevationDeg: 46,
    sunColor: 0x7aa6dc,
    sunIntensity: 0.58,
    hemiSky: 0x24384d,
    hemiGround: 0x0e1820,
    hemiIntensity: 0.48,
    rimColor: 0x5c88b8,
    rimIntensity: 0.34,
    ambientColor: 0x182636,
    ambientIntensity: 0.14,
    fogColorLow: 0x102026,
    fogColorHigh: 0x1d343e,
    fogDensity: 0.32,
    bloomStrength: 0.25
  },
  {
    id: 'dawn',
    label: '清晨',
    hour: 6.0,
    isNight: false,
    sunAzimuthDeg: 108,
    sunElevationDeg: 24,
    sunColor: 0xffcfa3,
    sunIntensity: 1.38,
    hemiSky: 0x8ea89c,
    hemiGround: 0x2b362b,
    hemiIntensity: 0.72,
    rimColor: 0x9ec4b0,
    rimIntensity: 0.38,
    ambientColor: 0x3b4d42,
    ambientIntensity: 0.22,
    fogColorLow: 0x2a4538,
    fogColorHigh: 0x5d7d6c,
    fogDensity: 0.34,
    bloomStrength: 0.26
  },
  {
    id: 'default',
    label: '雨后基准',
    hour: 10.5,
    isNight: false,
    sunAzimuthDeg: LIGHT.sunAzimuthDeg,
    sunElevationDeg: LIGHT.sunElevationDeg,
    sunColor: LIGHT.sunColor,
    sunIntensity: LIGHT.sunIntensity,
    hemiSky: LIGHT.hemiSky,
    hemiGround: LIGHT.hemiGround,
    hemiIntensity: LIGHT.hemiIntensity,
    rimColor: LIGHT.rimColor,
    rimIntensity: LIGHT.rimIntensity,
    ambientColor: LIGHT.ambientColor,
    ambientIntensity: LIGHT.ambientIntensity,
    fogColorLow: POST.heightFog.color,
    fogColorHigh: POST.heightFog.sunTint,
    fogDensity: POST.heightFog.density,
    bloomStrength: POST.bloom.strength
  },
  {
    id: 'noon',
    label: '正午',
    hour: 13.0,
    isNight: false,
    sunAzimuthDeg: 162,
    sunElevationDeg: 62,
    sunColor: 0xf5f7eb,
    sunIntensity: 1.85,
    hemiSky: 0x9fc2ab,
    hemiGround: 0x31402a,
    hemiIntensity: 0.82,
    rimColor: 0x9abfa4,
    rimIntensity: 0.36,
    ambientColor: 0x3e523d,
    ambientIntensity: 0.26,
    fogColorLow: 0x1d3629,
    fogColorHigh: 0x426652,
    fogDensity: 0.18,
    bloomStrength: 0.22
  },
  {
    id: 'dusk',
    label: '黄昏',
    hour: 18.0,
    isNight: false,
    sunAzimuthDeg: 242,
    sunElevationDeg: 21,
    sunColor: 0xff8c52,
    sunIntensity: 1.42,
    hemiSky: 0x8a6d62,
    hemiGround: 0x2c231e,
    hemiIntensity: 0.62,
    rimColor: 0xd98a5c,
    rimIntensity: 0.42,
    ambientColor: 0x3d2c26,
    ambientIntensity: 0.20,
    fogColorLow: 0x2b241f,
    fogColorHigh: 0x61483a,
    fogDensity: 0.28,
    bloomStrength: 0.28
  },
  {
    id: 'midnightEnd',
    label: '深夜',
    hour: 24.0,
    isNight: true,
    sunAzimuthDeg: 205,
    sunElevationDeg: 46,
    sunColor: 0x7aa6dc,
    sunIntensity: 0.58,
    hemiSky: 0x24384d,
    hemiGround: 0x0e1820,
    hemiIntensity: 0.48,
    rimColor: 0x5c88b8,
    rimIntensity: 0.34,
    ambientColor: 0x182636,
    ambientIntensity: 0.14,
    fogColorLow: 0x102026,
    fogColorHigh: 0x1d343e,
    fogDensity: 0.32,
    bloomStrength: 0.25
  }
];

const cTmpA = new THREE.Color();
const cTmpB = new THREE.Color();

function lerpColorHex(hexA, hexB, t) {
  cTmpA.setHex(hexA);
  cTmpB.setHex(hexB);
  cTmpA.lerp(cTmpB, t);
  return cTmpA.getHex();
}

function smoothstep01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** 根据 0~24 小时插值计算出当前时刻的光影雾气状态 */
export function sampleDayNightState(hour) {
  const h = ((hour % 24) + 24) % 24;
  let k0 = DAY_NIGHT_KEYFRAMES[0];
  let k1 = DAY_NIGHT_KEYFRAMES[DAY_NIGHT_KEYFRAMES.length - 1];
  for (let i = 0; i < DAY_NIGHT_KEYFRAMES.length - 1; i++) {
    if (h >= DAY_NIGHT_KEYFRAMES[i].hour && h <= DAY_NIGHT_KEYFRAMES[i + 1].hour) {
      k0 = DAY_NIGHT_KEYFRAMES[i];
      k1 = DAY_NIGHT_KEYFRAMES[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, k1.hour - k0.hour);
  const t = smoothstep01((h - k0.hour) / span);
  const lerp = (a, b) => a + (b - a) * t;

  return {
    hour: h,
    isNight: h < 5.0 || h >= 19.5,
    sunAzimuthDeg: lerp(k0.sunAzimuthDeg, k1.sunAzimuthDeg),
    sunElevationDeg: lerp(k0.sunElevationDeg, k1.sunElevationDeg),
    sunColor: lerpColorHex(k0.sunColor, k1.sunColor, t),
    sunIntensity: lerp(k0.sunIntensity, k1.sunIntensity),
    hemiSky: lerpColorHex(k0.hemiSky, k1.hemiSky, t),
    hemiGround: lerpColorHex(k0.hemiGround, k1.hemiGround, t),
    hemiIntensity: lerp(k0.hemiIntensity, k1.hemiIntensity),
    rimColor: lerpColorHex(k0.rimColor, k1.rimColor, t),
    rimIntensity: lerp(k0.rimIntensity, k1.rimIntensity),
    ambientColor: lerpColorHex(k0.ambientColor, k1.ambientColor, t),
    ambientIntensity: lerp(k0.ambientIntensity, k1.ambientIntensity),
    fogColorLow: lerpColorHex(k0.fogColorLow, k1.fogColorLow, t),
    fogColorHigh: lerpColorHex(k0.fogColorHigh, k1.fogColorHigh, t),
    fogDensity: lerp(k0.fogDensity, k1.fogDensity),
    bloomStrength: lerp(k0.bloomStrength, k1.bloomStrength)
  };
}

/**
 * 创建动态昼夜切换控制器
 * @param {{scene:THREE.Scene, lighting:object, post:object}} ctx
 */
export function createDayNightSystem({ scene, lighting, post }) {
  const DEFAULT_HOUR = 10.5;
  let currentHour = DEFAULT_HOUR;
  let autoCycle = false;
  let cycleSpeed = 0.85; // 每秒推进的小时数（默认约 28 秒走完一昼夜）
  let userFogOverride = null;
  let userBloomOverride = null;
  const listeners = new Set();

  function applyState(state) {
    // 1) 更新主光源（日间太阳光 / 夜间月光）方向、色温、亮度与阴影视锥
    const dir = lightDirection(state.sunAzimuthDeg, state.sunElevationDeg);
    if (lighting && lighting.key) {
      const key = lighting.key;
      key.color.setHex(state.sunColor);
      key.intensity = state.sunIntensity;
      key.target.position.set(0, SHADOW_TARGET_Y, 0);
      key.position.set(
        -dir.x * LIGHT.shadowDistance,
        -dir.y * LIGHT.shadowDistance + SHADOW_TARGET_Y,
        -dir.z * LIGHT.shadowDistance
      );
      key.target.updateMatrixWorld();
      const f = shadowFrustum(dir);
      key.shadow.camera.left = f.left;
      key.shadow.camera.right = f.right;
      key.shadow.camera.top = f.top;
      key.shadow.camera.bottom = f.bottom;
      key.shadow.camera.near = f.near;
      key.shadow.camera.far = f.far;
      key.shadow.camera.updateProjectionMatrix();
      if (lighting.sunDirection) lighting.sunDirection.copy(dir);
    }

    // 2) 更新半球补光、冷暖轮廓光、基础环境光
    if (lighting && lighting.fill) {
      lighting.fill.color.setHex(state.hemiSky);
      lighting.fill.groundColor.setHex(state.hemiGround);
      lighting.fill.intensity = state.hemiIntensity;
    }
    if (lighting && lighting.rim) {
      lighting.rim.color.setHex(state.rimColor);
      lighting.rim.intensity = state.rimIntensity;
    }
    if (lighting && lighting.ambient) {
      lighting.ambient.color.setHex(state.ambientColor);
      lighting.ambient.intensity = state.ambientIntensity;
    }

    // 3) 同步场景雾与后处理分层高度雾颜色/浓度、Bloom 辉光
    if (scene && scene.fog) {
      scene.fog.color.setHex(state.fogColorHigh);
    }
    if (post) {
      post.setFogColors(state.fogColorLow, state.fogColorHigh);
      post.setHeightFogDensity(userFogOverride !== null ? userFogOverride : state.fogDensity);
      post.setBloomStrength(userBloomOverride !== null ? userBloomOverride : state.bloomStrength);
    }

    // 4) 同步所有挂有主光方向的自定义材质（叶片透光、水体波光反射、河床焦散、鸟居红漆微高光、向溪背阴青苔）
    for (const mat of SUN_LINKED_MATERIALS) {
      const u = mat.userData && mat.userData.uniforms;
      if (!u) continue;
      if (u.uSunDir && u.uSunDir.value) u.uSunDir.value.copy(dir);
      if (u.uMossSunDir && u.uMossSunDir.value) u.uMossSunDir.value.copy(dir);
      if (u.uSpecSunDir && u.uSpecSunDir.value) u.uSpecSunDir.value.copy(dir);
      if (u.uWaterSunDir && u.uWaterSunDir.value) u.uWaterSunDir.value.copy(dir);
      if (u.uCausticLightDir && u.uCausticLightDir.value) u.uCausticLightDir.value.copy(dir);
      if (u.uTranslucencySunTint && u.uTranslucencySunTint.value) {
        u.uTranslucencySunTint.value.setHex(state.sunColor);
      }
    }

    for (const fn of listeners) fn(state);
  }

  function setHour(h, { clearOverrides = false } = {}) {
    if (clearOverrides) {
      userFogOverride = null;
      userBloomOverride = null;
    }
    currentHour = ((Number(h) % 24) + 24) % 24;
    const state = sampleDayNightState(currentHour);
    applyState(state);
    return state;
  }

  function setPreset(presetId) {
    const found = DAY_NIGHT_KEYFRAMES.find((k) => k.id === presetId);
    if (!found) return null;
    userFogOverride = null;
    userBloomOverride = null;
    return setHour(found.hour);
  }

  function step(dt) {
    if (!autoCycle || !Number.isFinite(dt) || dt <= 0) return;
    setHour(currentHour + dt * cycleSpeed);
  }

  function resetDefault() {
    autoCycle = false;
    userFogOverride = null;
    userBloomOverride = null;
    return setHour(DEFAULT_HOUR);
  }

  return {
    get hour() {
      return currentHour;
    },
    get autoCycle() {
      return autoCycle;
    },
    set autoCycle(v) {
      autoCycle = Boolean(v);
    },
    get cycleSpeed() {
      return cycleSpeed;
    },
    set cycleSpeed(v) {
      cycleSpeed = Math.max(0.05, Math.min(4.0, Number(v) || 0.85));
    },
    setFogOverride(v) {
      userFogOverride = v;
    },
    setBloomOverride(v) {
      userBloomOverride = v;
    },
    setHour,
    setPreset,
    step,
    resetDefault,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
