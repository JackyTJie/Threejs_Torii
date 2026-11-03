// 全天时动态昼夜与瑞利大气光影联动系统：
// 实现「深夜(纯黑深蓝星穹+黑山剪影) → 蓝调时刻(深蓝/紫粉橘) → 日出/清晨 → 雨后基准 → 正午 → 黄昏(金橘玫红光影隧道) → 暮色蓝调 → 月夜」完整 24 小时循环。
import * as THREE from 'three';
import { LIGHT, POST } from './config.js';
import { lightDirection, shadowFrustum } from './lighting.js';
import { SUN_LINKED_MATERIALS } from './toon.js';
import { MIST_MATERIALS } from './assets/mist.js';

const SHADOW_TARGET_Y = 0.4;

export const DAY_NIGHT_KEYFRAMES = [
  {
    id: 'midnight',
    label: '深夜',
    hour: 0.0,
    isNight: true,
    sunAzimuthDeg: 205,
    sunElevationDeg: 48,
    sunColor: 0x6b92c4,
    sunIntensity: 0.58,
    shadowRadius: 5.4,
    hemiSky: 0x22385c,
    hemiGround: 0x0e1828,
    hemiIntensity: 0.56,
    rimColor: 0x486e9e,
    rimIntensity: 0.28,
    ambientColor: 0x182844,
    ambientIntensity: 0.24,
    fogColorLow: 0x060d1a,
    fogColorHigh: 0x0c182e,
    fogDensity: 0.20,
    bloomStrength: 0.18,
    lanternBrightness: 0.45,
    moonPhase: 0.85
  },
  {
    id: 'blueDawn',
    label: '蓝调',
    hour: 5.15,
    isNight: false,
    sunAzimuthDeg: 98,
    sunElevationDeg: 14,
    sunColor: 0xd98cb8,
    sunIntensity: 0.92,
    shadowRadius: 4.8,
    hemiSky: 0x3b4d7a,
    hemiGround: 0x1c1e2e,
    hemiIntensity: 0.58,
    rimColor: 0xb87ca8,
    rimIntensity: 0.38,
    ambientColor: 0x242842,
    ambientIntensity: 0.20,
    fogColorLow: 0x1d2438,
    fogColorHigh: 0x5c4268,
    fogDensity: 0.34,
    bloomStrength: 0.22,
    lanternBrightness: 0.35,
    moonPhase: 0.65
  },
  {
    id: 'dawn',
    label: '清晨',
    hour: 6.3,
    isNight: false,
    sunAzimuthDeg: 108,
    sunElevationDeg: 19,
    sunColor: 0xffb878,
    sunIntensity: 1.46,
    shadowRadius: 4.4,
    hemiSky: 0x8ca69e,
    hemiGround: 0x2b342b,
    hemiIntensity: 0.72,
    rimColor: 0xffbe86,
    rimIntensity: 0.42,
    ambientColor: 0x3a483e,
    ambientIntensity: 0.22,
    fogColorLow: 0x2a3d34,
    fogColorHigh: 0x7a6855,
    fogDensity: 0.32,
    bloomStrength: 0.24,
    lanternBrightness: 0.16,
    moonPhase: 0.4
  },
  {
    id: 'default',
    label: '雨后',
    hour: 10.5,
    isNight: false,
    sunAzimuthDeg: LIGHT.sunAzimuthDeg,
    sunElevationDeg: LIGHT.sunElevationDeg,
    sunColor: LIGHT.sunColor,
    sunIntensity: LIGHT.sunIntensity,
    shadowRadius: LIGHT.shadowRadius,
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
    bloomStrength: POST.bloom.strength,
    lanternBrightness: 0.15,
    moonPhase: 0.2
  },
  {
    id: 'noon',
    label: '正午',
    hour: 13.0,
    isNight: false,
    sunAzimuthDeg: 162,
    sunElevationDeg: 64,
    sunColor: 0xf7faef,
    sunIntensity: 1.92,
    shadowRadius: 2.2,
    hemiSky: 0x9ec4d0,
    hemiGround: 0x2e4029,
    hemiIntensity: 0.84,
    rimColor: 0xa4ccb6,
    rimIntensity: 0.36,
    ambientColor: 0x3c523c,
    ambientIntensity: 0.26,
    fogColorLow: 0x1d3428,
    fogColorHigh: 0x486e5c,
    fogDensity: 0.16,
    bloomStrength: 0.20,
    lanternBrightness: 0.0,
    moonPhase: 0.1
  },
  {
    id: 'dusk',
    label: '黄昏',
    hour: 17.65,
    isNight: false,
    sunAzimuthDeg: 244,
    sunElevationDeg: 16,
    sunColor: 0xff7e3e,
    sunIntensity: 1.52,
    shadowRadius: 4.6,
    hemiSky: 0x8f6258,
    hemiGround: 0x2e211c,
    hemiIntensity: 0.64,
    rimColor: 0xff9458,
    rimIntensity: 0.46,
    ambientColor: 0x402a22,
    ambientIntensity: 0.20,
    fogColorLow: 0x2c221d,
    fogColorHigh: 0x784e3a,
    fogDensity: 0.28,
    bloomStrength: 0.25,
    lanternBrightness: 0.42,
    moonPhase: 0.5
  },
  {
    id: 'moonlight',
    label: '月夜',
    hour: 21.2,
    isNight: true,
    sunAzimuthDeg: 218,
    sunElevationDeg: 42,
    sunColor: 0x7ca2d4,
    sunIntensity: 0.68,
    shadowRadius: 4.8,
    hemiSky: 0x284268,
    hemiGround: 0x101c2e,
    hemiIntensity: 0.62,
    rimColor: 0x567eb0,
    rimIntensity: 0.32,
    ambientColor: 0x1c2e4a,
    ambientIntensity: 0.26,
    fogColorLow: 0x081122,
    fogColorHigh: 0x10203a,
    fogDensity: 0.20,
    bloomStrength: 0.18,
    lanternBrightness: 0.42,
    moonPhase: 1.0
  },
  {
    id: 'midnightEnd',
    label: '深夜',
    hour: 24.0,
    isNight: true,
    sunAzimuthDeg: 205,
    sunElevationDeg: 48,
    sunColor: 0x6b92c4,
    sunIntensity: 0.58,
    shadowRadius: 5.4,
    hemiSky: 0x22385c,
    hemiGround: 0x0e1828,
    hemiIntensity: 0.56,
    rimColor: 0x486e9e,
    rimIntensity: 0.28,
    ambientColor: 0x182844,
    ambientIntensity: 0.24,
    fogColorLow: 0x060d1a,
    fogColorHigh: 0x0c182e,
    fogDensity: 0.20,
    bloomStrength: 0.18,
    lanternBrightness: 0.45,
    moonPhase: 0.85
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
    isNight: h < 5.0 || h >= 19.2,
    sunAzimuthDeg: lerp(k0.sunAzimuthDeg, k1.sunAzimuthDeg),
    sunElevationDeg: lerp(k0.sunElevationDeg, k1.sunElevationDeg),
    sunColor: lerpColorHex(k0.sunColor, k1.sunColor, t),
    sunIntensity: lerp(k0.sunIntensity, k1.sunIntensity),
    shadowRadius: lerp(k0.shadowRadius ?? 3.5, k1.shadowRadius ?? 3.5),
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
    bloomStrength: lerp(k0.bloomStrength, k1.bloomStrength),
    lanternBrightness: lerp(k0.lanternBrightness, k1.lanternBrightness),
    moonPhase: lerp(k0.moonPhase ?? 0.8, k1.moonPhase ?? 0.8)
  };
}

export function createDayNightSystem({ scene, lighting, post }) {
  const DEFAULT_HOUR = 10.5;
  let currentHour = DEFAULT_HOUR;
  let autoCycle = false;
  let cycleSpeed = 0.85;
  let userFogOverride = null;
  let userBloomOverride = null;
  let userLanternOverride = null;
  const listeners = new Set();

  function applyState(state) {
    const dir = lightDirection(state.sunAzimuthDeg, state.sunElevationDeg);
    if (lighting && lighting.key) {
      const key = lighting.key;
      key.color.setHex(state.sunColor);
      key.intensity = state.sunIntensity;
      key.shadow.radius = state.shadowRadius;
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

    const lb = userLanternOverride !== null ? userLanternOverride : state.lanternBrightness;
    if (lighting && lighting.setLanternBrightness) {
      lighting.setLanternBrightness(lb);
    }

    if (scene && scene.fog) {
      scene.fog.color.setHex(state.fogColorHigh);
    }
    for (const mMat of MIST_MATERIALS) {
      mMat.color.setHex(state.fogColorHigh);
      const baseOp = mMat.userData.baseMistOpacity ?? 0.09;
      mMat.opacity = state.isNight ? baseOp * 0.18 : baseOp;
    }
    if (post) {
      post.setFogColors(state.fogColorLow, state.fogColorHigh);
      post.setHeightFogDensity(userFogOverride !== null ? userFogOverride : state.fogDensity);
      post.setBloomStrength(userBloomOverride !== null ? userBloomOverride : state.bloomStrength);
      if (post.setAtmosphereState) {
        post.setAtmosphereState({
          hour: state.hour,
          sunDir: dir,
          sunColor: state.sunColor,
          sunIntensity: state.sunIntensity,
          moonPhase: state.moonPhase,
          lanternIntensity: lb
        });
      }
    }

    for (const mat of SUN_LINKED_MATERIALS) {
      const u = mat.userData && mat.userData.uniforms;
      if (!u) continue;
      if (u.uSunDir && u.uSunDir.value) u.uSunDir.value.copy(dir);
      if (u.uMossSunDir && u.uMossSunDir.value) u.uMossSunDir.value.copy(dir);
      if (u.uSpecSunDir && u.uSpecSunDir.value) u.uSpecSunDir.value.copy(dir);
      if (u.uWaterSunDir && u.uWaterSunDir.value) u.uWaterSunDir.value.copy(dir);
      if (u.uWaterDayFactor) {
        u.uWaterDayFactor.value = state.isNight ? 0.18 : Math.min(1.0, Math.max(0.24, state.sunIntensity / 1.35));
      }
      if (u.uCausticLightDir && u.uCausticLightDir.value) u.uCausticLightDir.value.copy(dir);
      if (u.uTranslucencySunTint && u.uTranslucencySunTint.value) {
        u.uTranslucencySunTint.value.setHex(state.sunColor);
      }
      if (u.uLanternIntensity) {
        u.uLanternIntensity.value = lb;
      }
    }

    for (const fn of listeners) fn(state);
  }

  function setHour(h, { clearOverrides = false } = {}) {
    if (clearOverrides) {
      userFogOverride = null;
      userBloomOverride = null;
      userLanternOverride = null;
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
    userLanternOverride = null;
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
    userLanternOverride = null;
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
    setLanternOverride(v) {
      userLanternOverride = v;
      if (lighting && lighting.setLanternBrightness) lighting.setLanternBrightness(v);
      if (post && post.setAtmosphereState) post.setAtmosphereState({ lanternIntensity: v });
      for (const mat of SUN_LINKED_MATERIALS) {
        const u = mat.userData && mat.userData.uniforms;
        if (u && u.uLanternIntensity) u.uLanternIntensity.value = v;
      }
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
