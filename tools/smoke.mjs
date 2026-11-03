#!/usr/bin/env node
// 运行时冒烟检查：渲染器 + 场景 + 灯光 + 受限相机 + 后处理 + 材质库 + 描边壳体
import { installDomStub, makeCanvas } from './dom-stub.mjs';

installDomStub();

const { createRenderer, resizeRenderer, drawingBufferSize } = await import('../js/renderer.js');
const { createScene } = await import('../js/scene.js');
const { createLighting, shadowCoverage } = await import('../js/lighting.js');
const { createCameraRig } = await import('../js/camera.js');
const { createPostPipeline } = await import('../js/post-pipeline.js');
const { createMaterialLibrary } = await import('../js/materials.js');
const { finishAsset, sunDirectionVector } = await import('../js/toon.js');
const { box } = await import('../js/primitives.js');
const { CAMERA, PAD } = await import('../js/config.js');

const errors = [];
const fail = (m) => errors.push(m);

const canvas = makeCanvas(1600, 900);
const renderer = createRenderer(canvas);
const scene = createScene({ renderer });
const lighting = createLighting(scene);
const rig = createCameraRig(canvas);
const post = createPostPipeline(renderer, scene, rig.camera);
const M = createMaterialLibrary();

// 占位体：确认描边 / 阴影策略 / 材质库可用
const probe = box(2, 1, 2, M.stoneStepLower, 'probe');
probe.position.set(0, 0.5, 0);
const shells = finishAsset(probe);
if (shells.length !== 1) fail(`finishAsset 未生成描边壳体（得到 ${shells.length}）`);

resizeRenderer(renderer);
rig.update(0.016);
rig.camera.updateProjectionMatrix();
post.resize(drawingBufferSize(renderer).width, drawingBufferSize(renderer).height);
post.render(0);
renderer.render(scene, rig.camera);

const sunA = sunDirectionVector();
const sunB = lighting.sunDirection;
if (sunA.distanceTo(sunB) > 1e-6) fail('toon 与 lighting 的太阳方向不一致');

const cov = shadowCoverage(lighting.key);
if (cov.width < PAD.size * 0.9) fail(`阴影相机覆盖 ${cov.width} 小于底座 ${PAD.size}`);

if (rig.camera.fov !== CAMERA.fov) fail('相机 fov 与配置不一致');
if (CAMERA.azimuthMin < 40 || CAMERA.azimuthMax > 140) fail('水平旋转角度超出受限范围 [40°, 140°]');
if (CAMERA.elevationMin !== -10 || CAMERA.elevationMax !== 45) fail('垂直俯仰角度未约束在 [-10°, 45°]');

console.log('=== 场景运行时 smoke ===');
console.log(`渲染次数: ${renderer.renderCount} | 像素比: ${renderer.getPixelRatio()}`);
console.log(`太阳方向: (${sunA.x.toFixed(3)}, ${sunA.y.toFixed(3)}, ${sunA.z.toFixed(3)})`);
console.log(`阴影覆盖: ${cov.width.toFixed(2)} x ${cov.height.toFixed(2)} | 描边壳: ${shells.length}`);
console.log(`相机: r=${rig.radius.toFixed(2)} fov=${rig.camera.fov} az=[${CAMERA.azimuthMin},${CAMERA.azimuthMax}] el=[${CAMERA.elevationMin},${CAMERA.elevationMax}]`);

if (errors.length) {
  console.log('\n错误:');
  for (const e of errors) console.log(`  x ${e}`);
  console.log('\n结果: FAIL');
  process.exit(1);
}
console.log('\n结果: PASS（渲染器 / 场景 / 灯光 / 受限相机 / 后处理 / 材质 / 描边）');
