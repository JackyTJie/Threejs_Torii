#!/usr/bin/env node
// 空场景跑通（S1.15）：渲染器 + 场景 + 灯光 + 相机 + 后处理，不含任何界面元素
import { installDomStub, makeCanvas } from './dom-stub.mjs';

installDomStub();

const THREE = await import('three');
const { createRenderer, resizeRenderer, drawingBufferSize } = await import('../js/renderer.js');
const { createScene } = await import('../js/scene.js');
const { createLighting, lightDirection, shadowCoverage } = await import('../js/lighting.js');
const { createCameraRig } = await import('../js/camera.js');
const { createPostPipeline } = await import('../js/post-pipeline.js');
const { createMaterialLibrary } = await import('../js/materials.js');
const { finishAsset, sunDirectionVector } = await import('../js/toon.js');
const { box } = await import('../js/primitives.js');
const { CAMERA, LIGHT, PAD } = await import('../js/config.js');

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
const probe = box(2, 1, 2, M.woodWall, 'probe');
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
if (CAMERA.collideWithScene) fail('相机碰撞应默认关闭');
if (CAMERA.elevationMin > -85 || CAMERA.elevationMax < 85) fail('俯仰范围未放开');

console.log('=== 空场景 smoke ===');
console.log(`渲染次数: ${renderer.renderCount} | 像素比: ${renderer.getPixelRatio()}`);
console.log(`太阳方向: (${sunA.x.toFixed(3)}, ${sunA.y.toFixed(3)}, ${sunA.z.toFixed(3)})`);
console.log(`阴影覆盖: ${cov.width} x ${cov.height} | 描边壳: ${shells.length}`);
console.log(`相机: r=${rig.radius.toFixed(2)} fov=${rig.camera.fov}`);

if (errors.length) {
  console.log('\n错误:');
  for (const e of errors) console.log(`  x ${e}`);
  console.log('\n结果: FAIL');
  process.exit(1);
}
console.log('\n结果: PASS（渲染器 / 场景 / 灯光 / 相机 / 后处理 / 材质 / 描边）');
