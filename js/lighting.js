// 灯光：雨后阴天漫射主光 Key + 半球 Fill + 冷色 Rim + 弱环境光
import * as THREE from 'three';
import { LIGHT, PAD } from './config.js';

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

/**
 * 平行光阴影正交视锥：把「底座正方形 × 场景高度」这个盒子投影到光空间的
 * 右手轴 / 上手轴上，直接反算 left / right / top / bottom 与 near / far。
 *
 * 为什么不能给一个固定边长：正方形绕水平光行方向旋转后，
 * 在光空间横轴上的投影半宽 = half · (|r.x| + |r.z|)，本场景 16 × (0.4226 + 0.9063) = 21.26，
 * 写死一个略小的常数 → 底座四角（以及四角上的树）落在阴影贴图外，树影在角上凭空消失。
 * 上下方向还额外吃场景高度（实测最高树冠 18.14 m，见 config.shadowSceneTop）与底座厚度，
 * 因此 top / bottom 天然不对称：top = 13.09 + 0.788·yMax + margin，bottom = −13.09 − 1.261 + margin。
 */
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
  // 光空间横轴取水平方向（阴影里的竖直信息全部落在 up 轴上，横轴不含 y）
  const right = new THREE.Vector3(-d.z, 0, d.x).normalize();
  const up = new THREE.Vector3().crossVectors(right, d).normalize();

  const halfRight = halfSpan * (Math.abs(right.x) + Math.abs(right.z));
  const upHorizontal = halfSpan * (Math.abs(up.x) + Math.abs(up.z));
  const top = upHorizontal + Math.max(0, up.y) * yMax + Math.min(0, up.y) * yMin;
  const bottom = -upHorizontal + Math.min(0, up.y) * yMax + Math.max(0, up.y) * yMin;

  // 沿光行方向的深度范围（相机位于 target - d·distance）
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
 * 建立全部灯光。
 * @param {THREE.Scene} scene
 */
export function createLighting(scene) {
  const group = new THREE.Group();
  group.name = 'lighting';

  // Key：雨后阴天漫射主光（方位 155°，仰角 38°，见 config.LIGHT）
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

  // Fill：天空 / 地面半球补光，漫射感
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

  scene.add(group);

  return {
    group,
    key,
    fill,
    rim,
    ambient,
    sunDirection: dir.clone(),
    /** 重新贴合阴影视锥（改太阳角度或场景高度后调用） */
    fitShadow() {
      fitShadowCamera(key, sunDirection());
      return shadowFrustum(sunDirection());
    },
    setSunIntensity(v) {
      key.intensity = v;
    }
  };
}

/** 让平行光从指定方向照向场景中心（覆盖全底座） */
function placeDirectional(light, direction, distance) {
  light.target.position.set(0, SHADOW_TARGET_Y, 0);
  light.position.set(
    -direction.x * distance,
    -direction.y * distance + SHADOW_TARGET_Y,
    -direction.z * distance
  );
  light.target.updateMatrixWorld();
}

/** 阴影相机原点与 shadowFrustum 的假设必须一致：target = (0, SHADOW_TARGET_Y, 0) */
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

/** 阴影相机覆盖范围复核（Step 6 校验：阴影不应超出底座太多导致精度浪费） */
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
