// 灯光：雨后阴天漫射主光 Key + 半球 Fill + 冷色 Rim + 弱环境光 + 参道对称春日木灯笼暖黄微光点光源
import * as THREE from 'three';
import { LIGHT, PAD } from './config.js';
import { getShrineLanternWorldPositions } from './assets/torii.js';
import { LANTERN_GLOW_MATERIALS } from './materials.js';

const DEG = Math.PI / 180;

/** 由方位角/仰角求光照方向（从光源指向场景） */
export function lightDirection(azimuthDeg, elevationDeg) {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  const cx = Math.cos(el);
  return new THREE.Vector3(
    -Math.cos(az) * cx,
    -Math.sin(el),
    -Math.sin(az) * cx
  ).normalize();
}

/** 主光方向（全工程唯一来源：着色器透光 / 老化 / 青苔迎风面都读这一个） */
export function sunDirection() {
  return lightDirection(LIGHT.sunAzimuthDeg, LIGHT.sunElevationDeg);
}

export function shadowFrustum(direction, options = {}) {
  const {
    halfSpan = PAD.half,
    yMin = LIGHT.shadowSceneBottom,
    yMax = LIGHT.shadowSceneTop,
    margin = LIGHT.shadowFitMargin,
    distance = LIGHT.shadowDistance,
    targetY = SHADOW_TARGET_Y
  } = options;

  const d = direction.clone().normalize();
  const right = new THREE.Vector3(-d.z, 0, d.x).normalize();
  const up = new THREE.Vector3().crossVectors(right, d).normalize();

  const halfRight = halfSpan * (Math.abs(right.x) + Math.abs(right.z));
  const upHorizontal = halfSpan * (Math.abs(up.x) + Math.abs(up.z));
  const top = upHorizontal + Math.max(0, up.y) * yMax + Math.min(0, up.y) * yMin;
  const bottom = -upHorizontal + Math.min(0, up.y) * yMax + Math.max(0, up.y) * yMin;

  const horizontal = halfSpan * (Math.abs(d.x) + Math.abs(d.z));
  const depthMax = horizontal + (d.y > 0 ? d.y * yMax : d.y * yMin) - d.y * targetY;
  const depthMin = -horizontal + (d.y > 0 ? d.y * yMin : d.y * yMax) - d.y * targetY;

  return {
    left: -halfRight - margin,
    right: halfRight + margin,
    top: top + margin,
    bottom: bottom - margin,
    near: Math.max(0.1, distance + depthMin - margin),
    far: distance + depthMax + margin,
    rightAxis: right,
    upAxis: up,
    direction: d
  };
}

/**
 * 建立全部灯光（含鸟居前左右对称春日木灯笼的暖黄微光点光源）。
 * @param {THREE.Scene} scene
 */
export function createLighting(scene) {
  const group = new THREE.Group();
  group.name = 'lighting';

  // Key：雨后阴天漫射主光
  const key = new THREE.DirectionalLight(LIGHT.sunColor, LIGHT.sunIntensity);
  key.name = 'sunKey';
  const dir = sunDirection();
  placeDirectional(key, dir, LIGHT.shadowDistance);
  key.castShadow = true;
  key.shadow.mapSize.set(LIGHT.shadowMapSize, LIGHT.shadowMapSize);
  fitShadowCamera(key, dir);
  key.shadow.bias = LIGHT.shadowBias;
  key.shadow.normalBias = LIGHT.shadowNormalBias;
  key.shadow.radius = LIGHT.shadowRadius;
  group.add(key, key.target);

  // Fill：天空 / 地面半球补光
  const fill = new THREE.HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemiIntensity);
  fill.name = 'skyFill';
  fill.position.set(0, 18, 0);
  group.add(fill);

  // Rim：来自东北背部的冷色轮廓光
  const rim = new THREE.DirectionalLight(LIGHT.rimColor, LIGHT.rimIntensity);
  rim.name = 'coolRim';
  placeDirectional(rim, lightDirection(LIGHT.rimAzimuthDeg, LIGHT.rimElevationDeg), 30);
  group.add(rim, rim.target);

  // 极弱环境光：保证暗部不糊死
  const ambient = new THREE.AmbientLight(LIGHT.ambientColor, LIGHT.ambientIntensity);
  ambient.name = 'baseAmbient';
  group.add(ambient);

  // 参道鸟居前左右对称春日木灯笼的暖黄微光点光源（柔和收敛范围，避免大面积染色周围树叶）
  const lanternLights = [];
  let lanternBrightness = 0.15;
  for (const pos of getShrineLanternWorldPositions()) {
    const pt = new THREE.PointLight(0xffb454, lanternBrightness * 0.72, 2.8, 2.0);
    pt.name = `lanternLight-${pos.side}`;
    pt.position.set(pos.x, pos.y, pos.z);
    pt.castShadow = false;
    group.add(pt);
    lanternLights.push(pt);
  }

  function setLanternBrightness(v) {
    lanternBrightness = Math.max(0, Math.min(2.5, Number(v) || 0));
    for (const pt of lanternLights) {
      pt.intensity = lanternBrightness * 0.72;
    }
    for (const mat of LANTERN_GLOW_MATERIALS) {
      mat.emissiveIntensity = 0.06 + lanternBrightness * 0.55;
    }
  }

  scene.add(group);

  return {
    group,
    key,
    fill,
    rim,
    ambient,
    lanternLights,
    sunDirection: dir.clone(),
    fitShadow() {
      fitShadowCamera(key, sunDirection());
      return shadowFrustum(sunDirection());
    },
    setSunIntensity(v) {
      key.intensity = v;
    },
    getLanternBrightness() {
      return lanternBrightness;
    },
    setLanternBrightness
  };
}

function placeDirectional(light, direction, distance) {
  light.target.position.set(0, SHADOW_TARGET_Y, 0);
  light.position.set(
    -direction.x * distance,
    -direction.y * distance + SHADOW_TARGET_Y,
    -direction.z * distance
  );
  light.target.updateMatrixWorld();
}

const SHADOW_TARGET_Y = 0.4;

function fitShadowCamera(light, direction) {
  const f = shadowFrustum(direction);
  light.shadow.camera.left = f.left;
  light.shadow.camera.right = f.right;
  light.shadow.camera.top = f.top;
  light.shadow.camera.bottom = f.bottom;
  light.shadow.camera.near = f.near;
  light.shadow.camera.far = f.far;
  light.shadow.camera.updateProjectionMatrix();
  return f;
}

export function shadowCoverage(light) {
  const cam = light.shadow.camera;
  return {
    width: cam.right - cam.left,
    height: cam.top - cam.bottom,
    near: cam.near,
    far: cam.far,
    texelSize: (cam.right - cam.left) / light.shadow.mapSize.x,
    padSize: PAD.size
  };
}
