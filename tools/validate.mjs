#!/usr/bin/env node
// 静态校验：模块加载(语法) / 模块图 / 导出匹配 / three API / DOM 白名单 / 无 UI 检查
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { installDomStub } from './dom-stub.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'js');

const errors = [];
const warnings = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// 去注释；产出两份视图：code 保留字符串（解析 import/export），masked 抹掉字符串内容（API / 未用导入检查）
function stripCode(src) {
  let code = '';
  let masked = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') {
          code += '\n';
          masked += '\n';
        }
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const begin = i;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        if (src[i] === '\n' && quote !== '`') {
          i++;
          break;
        }
        i++;
      }
      code += src.slice(begin, i);
      masked += quote === '`' ? '``' : quote === '"' ? '""' : "''";
      continue;
    }
    code += c;
    masked += c;
    i++;
  }
  return { code, masked };
}

const IMPORT_RE = /(^|[\n;])import\s+([\s\S]*?)\s*from\s*(['"])([^'"]+)\3/g;
const BARE_IMPORT_RE = /(^|[\n;])import\s+(['"])([^'"]+)\2/g;

function parseImports(code) {
  const imports = [];
  let m;
  const re = new RegExp(IMPORT_RE.source, 'g');
  while ((m = re.exec(code))) {
    const clause = m[2].trim();
    const entry = { spec: m[4], defaultName: null, namespace: null, named: [] };
    const braceRe = /\{([^}]*)\}/g;
    let bm;
    while ((bm = braceRe.exec(clause))) {
      for (let raw of bm[1].split(',')) {
        raw = raw.trim();
        if (!raw) continue;
        const asMatch = raw.split(/\s+as\s+/);
        entry.named.push({ imported: asMatch[0].trim(), local: (asMatch[1] || asMatch[0]).trim() });
      }
    }
    const rest = clause.replace(braceRe, ' ').split(',').map((s) => s.trim()).filter(Boolean);
    if (rest.length) {
      const head = rest[0];
      if (/^\*\s+as\s+/.test(head)) entry.namespace = head.replace(/^\*\s+as\s+/, '').trim();
      else entry.defaultName = head;
    }
    imports.push(entry);
  }
  const bare = new RegExp(BARE_IMPORT_RE.source, 'g');
  while ((m = bare.exec(code))) imports.push({ spec: m[3], defaultName: null, namespace: null, named: [] });
  return imports;
}

function parseExports(code) {
  const names = new Set();
  let m;
  const res = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g,
    /export\s+class\s+([A-Za-z0-9_$]+)/g
  ];
  for (const re of res) {
    while ((m = re.exec(code))) names.add(m[1]);
  }
  const listRe = /export\s*\{([^}]*)\}/g;
  while ((m = listRe.exec(code))) {
    for (let raw of m[1].split(',')) {
      raw = raw.trim();
      if (!raw) continue;
      const asMatch = raw.split(/\s+as\s+/);
      names.add((asMatch[1] || asMatch[0]).trim());
    }
  }
  return { names, hasDefault: /export\s+default\b/.test(code) };
}

// three r160 已知导出（捕捉拼写错误 / 不存在的 API）
const KNOWN_THREE = new Set([
  'Vector2', 'Vector3', 'Box2', 'Box3', 'Sphere', 'Spherical', 'Euler', 'Quaternion', 'Matrix2', 'Matrix3',
  'Matrix4', 'Object3D', 'Group', 'Scene', 'Mesh', 'InstancedMesh', 'BatchedMesh', 'Line', 'LineSegments',
  'LineLoop', 'Points', 'Sprite', 'SkinnedMesh', 'Bone', 'Skeleton', 'Union', 'Intersection',
  'BufferGeometry', 'BufferAttribute', 'Float32BufferAttribute', 'Uint16BufferAttribute', 'Int32BufferAttribute',
  'BoxGeometry', 'PlaneGeometry', 'CircleGeometry', 'RingGeometry', 'CylinderGeometry', 'ConeGeometry',
  'SphereGeometry', 'TorusGeometry', 'TorusKnotGeometry', 'CapsuleGeometry', 'LatheGeometry', 'ShapeGeometry',
  'ExtrudeGeometry', 'TubeGeometry', 'PolyhedronGeometry', 'TetrahedronGeometry', 'OctahedronGeometry',
  'IcosahedronGeometry', 'DodecahedronGeometry', 'ParametricGeometry', 'WireframeGeometry', 'EdgesGeometry',
  'Shape', 'Path', 'Curve', 'Curves', 'CurvePath', 'Path', 'Font', 'CatmullRomCurve3', 'QuadraticBezierCurve3',
  'CubicBezierCurve3', 'LineCurve3', 'EllipseCurve', 'ArcCurve', 'SplineCurve', 'AbsorbentMaterial',
  'Color', 'ColorManagement', 'Material', 'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial',
  'MeshToonMaterial', 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshNormalMaterial', 'MeshDepthMaterial',
  'MeshDistanceMaterial', 'MeshMatcapMaterial', 'ShaderMaterial', 'RawShaderMaterial', 'PointsMaterial',
  'LineBasicMaterial', 'LineDashedMaterial', 'SpriteMaterial', 'ShadowMaterial', 'Sprite',
  'Texture', 'CanvasTexture', 'DataTexture', 'Data3DTexture', 'DataArrayTexture', 'CompressedTexture',
  'CubeTexture', 'CubeTextureLoader', 'DepthTexture', 'Source', 'TextureUtils', 'ImageUtils', 'TextureLoader',
  'WebGLRenderTarget', 'WebGLArrayRenderTarget', 'WebGLCubeRenderTarget', 'RenderTarget',
  'Fog', 'FogExp2', 'HemisphereLight', 'DirectionalLight', 'AmbientLight', 'PointLight', 'SpotLight',
  'RectAreaLight', 'LightProbe', 'Light', 'Camera', 'PerspectiveCamera', 'OrthographicCamera', 'ArrayCamera',
  'StereoCamera', 'CubeCamera', 'WebGLRenderer', 'PMREMGenerator', 'MathUtils', 'Clock', 'Layers',
  'UniformsUtils', 'Uniform', 'UniformsGroup', 'EquirectangularReflectionMapping', 'EquirectangularRefractionMapping',
  'CubeReflectionMapping', 'CubeRefractionMapping', 'InstancedBufferAttribute', 'InstancedBufferGeometry',
  'InstancedPoints', 'SRGBColorSpace', 'LinearSRGBColorSpace', 'WorkingColorSpace', 'NoColorSpace',
  'SRGBTransfer', 'LinearTransfer', 'SRGBTransferEOTF', 'SRGBTransferOETF',
  'NoToneMapping', 'LinearToneMapping', 'ReinhardToneMapping', 'CineonToneMapping', 'ACESFilmicToneMapping',
  'AgXToneMapping', 'NeutralToneMapping', 'CustomToneMapping',
  'FrontSide', 'BackSide', 'DoubleSide', 'NeverDepth', 'AlwaysDepth', 'LessDepth', 'LessEqualDepth',
  'EqualDepth', 'GreaterEqualDepth', 'GreaterDepth', 'NotEqualDepth', 'AdditiveEquation', 'SubtractEquation',
  'ReverseSubtractEquation', 'MinEquation', 'MaxEquation', 'AdditiveBlending', 'SubtractiveBlending',
  'MultiplyBlending', 'CustomBlending', 'NoBlending', 'NormalBlending', 'AlphaRatioBlending',
  'OneZeroBlendEquation', 'NormalBlendingFactor', 'AdditiveBlendingFactor',
  'BasicShadowMap', 'PCFShadowMap', 'PCFSoftShadowMap', 'VSMShadowMap', 'NoShadowmap',
  'NearestFilter', 'NearestMipmapNearestFilter', 'NearestMipmapLinearFilter', 'LinearFilter',
  'LinearMipmapNearestFilter', 'LinearMipmapLinearFilter', 'UnsignedByteType', 'ByteType', 'ShortType',
  'IntType', 'FloatType', 'HalfFloatType', 'UnsignedShortType', 'UnsignedIntType', 'UnsignedShort4444Type',
  'UnsignedShort5551Type', 'UnsignedInt5551Type', 'UnsignedInt4444Type', 'UnsignedInt248Type',
  'RGBAFormat', 'RGBFormat', 'RedFormat', 'RedIntegerFormat', 'RGFormat', 'AlphaFormat', 'LuminanceFormat',
  'LuminanceAlphaFormat', 'DepthFormat', 'DepthStencilFormat', 'RGBAIntegerFormat', 'RGBADepthPacking',
  'RepeatWrapping', 'ClampToEdgeWrapping', 'MirroredRepeatWrapping', 'StaticDrawUsage', 'DynamicDrawUsage',
  'StreamDrawUsage', 'InterleavedBuffer', 'InterleavedBufferAttribute', 'NoBlending'
]);

// 允许直接使用浏览器 DOM API 的模块（渲染 / 输入 / 画布纹理 / 入口）
const DOM_ALLOW = new Set([
  'js/renderer.js',
  'js/scene.js',
  'js/camera.js',
  'js/post-pipeline.js',
  'js/textures.js',
  'js/main.js'
]);

const DOM_PATTERNS = [
  ['document', /\bdocument\b/],
  ['window', /\bwindow\b/],
  ['performance', /\bperformance\b/],
  ['requestAnimationFrame', /\brequestAnimationFrame\b/],
  ['navigator', /\bnavigator\b/],
  ['localStorage', /\blocalStorage\b/]
];

const files = walk(SRC).sort();
const exportMap = new Map();
const modules = [];

for (const file of files) {
  const r = rel(file);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(r, `读取失败: ${e.message}`);
    continue;
  }
  const { code, masked } = stripCode(raw);
  const imports = parseImports(code);
  const exports = parseExports(code);
  modules.push({ file, r, raw, code, masked, imports, exports });
  exportMap.set(r, exports.names);
}

// 1) 本地 import 路径存在性 + 导出名匹配
for (const { r, imports } of modules) {
  const dir = path.dirname(path.join(ROOT, r));
  for (const imp of imports) {
    const spec = imp.spec;
    if (spec === 'three' || spec.startsWith('three/')) continue;
    if (!spec.startsWith('.')) {
      fail(r, `非相对 import（index.html importmap 未声明该裸模块）: '${spec}'`);
      continue;
    }
    const target = path.resolve(dir, spec);
    const targetRel = rel(target);
    if (!fs.existsSync(target)) {
      fail(r, `import 目标不存在: '${spec}' -> ${targetRel}`);
      continue;
    }
    if (!targetRel.startsWith('js/')) fail(r, `import 越出 js/ 范围: '${spec}' -> ${targetRel}`);
    const targetExports = exportMap.get(targetRel);
    if (!targetExports) {
      warn(r, `import 目标不在校验集合内: '${spec}'`);
      continue;
    }
    for (const { imported } of imp.named) {
      if (!targetExports.has(imported)) fail(r, `导入 '${imported}' 未被 ${targetRel} 导出`);
    }
  }
}

// 2) three API 名称
for (const { r, masked } of modules) {
  const nsRe = /\bTHREE\.([A-Za-z0-9_]+)/g;
  let m;
  const used = new Set();
  while ((m = nsRe.exec(masked))) used.add(m[1]);
  for (const name of used) {
    if (!KNOWN_THREE.has(name)) warn(r, `THREE.${name} 不在已知 three r160 导出清单中`);
  }
}

// 3) DOM API 白名单
for (const { r, masked } of modules) {
  if (DOM_ALLOW.has(r)) continue;
  for (const [label, re] of DOM_PATTERNS) {
    if (re.test(masked)) fail(r, `禁止在此模块使用浏览器 API: ${label}`);
  }
}

// 4) 资产模块必须导出 create* 工厂
const FACTORY_EXEMPT = new Set(['js/layout.js', 'js/scene-assembly.js', 'js/animations/registry.js']);
for (const { r, exports } of modules) {
  if (!r.startsWith('js/assets/')) continue;
  if (FACTORY_EXEMPT.has(r) || r.endsWith('interior-layout.js')) continue;
  if (![...exports.names].some((n) => /^create[A-Z]/.test(n))) {
    fail(r, `资产模块未导出 create* 工厂（导出: ${[...exports.names].join(', ') || '无'}）`);
  }
}

// 5) 未使用的命名导入
for (const { r, masked, imports } of modules) {
  const body = masked.replace(new RegExp(IMPORT_RE.source, 'g'), '').replace(new RegExp(BARE_IMPORT_RE.source, 'g'), '');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const imp of imports) {
    for (const { local } of imp.named) {
      if (!new RegExp(`\\b${esc(local)}\\b`).test(body)) warn(r, `未使用的导入: ${local}`);
    }
    if (imp.defaultName && !new RegExp(`\\b${esc(imp.defaultName)}\\b`).test(body)) {
      warn(r, `未使用的默认导入: ${imp.defaultName}`);
    }
  }
}

// 9) 跨模块符号必须显式导入（捕捉漏 import 造成的 ReferenceError）
const allExports = new Set([...exportMap.values()].flatMap((s) => [...s]));
for (const { r, masked, imports, exports } of modules) {
  const imported = new Set();
  for (const imp of imports) {
    for (const { local } of imp.named) imported.add(local);
    if (imp.defaultName) imported.add(imp.defaultName);
    if (imp.namespace) imported.add(imp.namespace);
  }
  const local = new Set(exports.names);
  for (const m of masked.matchAll(/(?:^|[\s;{(])(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) {
    local.add(m[1]);
  }
  for (const name of allExports) {
    if (imported.has(name) || local.has(name)) continue;
    const callRe = new RegExp(`(?<![.\\w])${name}\\s*\\(`);
    if (callRe.test(masked)) fail(r, `调用了未导入的模块符号: ${name}`);
  }
}

// 6) index.html：仅入口框架，无 UI / 无内联逻辑
const htmlPath = path.join(ROOT, 'index.html');
if (!fs.existsSync(htmlPath)) {
  fail('index.html', '入口缺失');
} else {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : '';
  const allowedTags = new Set(['canvas', 'script', 'div', 'noscript']);
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b/g;
  let m;
  while ((m = tagRe.exec(body))) {
    const tag = m[1].toLowerCase();
    if (!allowedTags.has(tag)) fail('index.html', `body 内出现 UI 元素 <${tag}>`);
  }
  const visible = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<canvas\b[^>]*\/?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '');
  if (visible) fail('index.html', `body 内存在可见文字: ${visible.slice(0, 60)}`);
  if (!/<script\s+type\s*=\s*["']module["']\s+src\s*=\s*["']\.?\/?js\/main\.js["']/.test(html)) {
    fail('index.html', '未以 module script 引入 js/main.js');
  }
  if (!/"imports"/.test(html) || !/three/.test(html)) fail('index.html', '缺少 three importmap');
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  while ((m = scriptRe.exec(html))) {
    const attrs = m[1];
    const inner = m[2].trim();
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (/type\s*=\s*["']importmap["']/.test(attrs)) continue;
    if (inner) fail('index.html', `存在内联脚本（模型与逻辑必须模块化）: ${inner.slice(0, 40)}`);
  }
  const styleBlocks = html.match(/<style[\s\S]*?<\/style>/gi) || [];
  for (const block of styleBlocks) {
    if (/@import|url\(["']?http/i.test(block)) warn('index.html', '样式内引用了外部资源');
  }
}

// 7) 禁止文字几何 / 字体加载（约定：场景内不使用任何文字字形）
for (const { r, masked } of modules) {
  if (/\bTextGeometry\b|\bFontLoader\b|\bloadFont\b|\bfontLoader\b/.test(masked)) fail(r, '使用了文字几何 / 字体加载');
}

// 8) 资产规模提示（质量优先：过小的资产文件可能细节不足）
for (const { r, raw } of modules) {
  if (!r.startsWith('js/assets/')) continue;
  const lines = raw.split('\n').length;
  if (lines >= 40) continue;
  // 组合器：本身不建模，只把已独立建模的资产装配成编组，允许短小
  const delegates = [...raw.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)].some(([, names, from]) => {
    if (!from.startsWith('.')) return false;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(r), from));
    if (!target.startsWith('js/assets/') || !modules.some((m) => m.r === target)) return false;
    return names.split(',').some((n) => /^\s*create[A-Za-z0-9_]*\s*$/.test(n));
  });
  if (delegates) continue;
  warn(r, `资产文件仅 ${lines} 行，确认细节是否充分`);
}

// 9) 模块加载（语法 + 链接 + 顶层执行）：以 DOM 桩在 Node 内真实 import
installDomStub();
let loaded = 0;
for (const { r } of modules) {
  try {
    await import(url.pathToFileURL(path.join(ROOT, r)).href);
    loaded++;
  } catch (e) {
    const kind = e instanceof SyntaxError ? '语法错误' : '加载/执行错误';
    fail(r, `${kind}: ${String(e.message).split('\n')[0]}`);
  }
}

console.log(`静态校验：${modules.length} 个模块（成功加载 ${loaded}）`);
if (warnings.length) {
  console.log(`\n警告 ${warnings.length} 项:`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log(`\n错误 ${errors.length} 项:`);
  for (const e of errors) console.log(`  x ${e}`);
  console.log('\n结果: FAIL');
  process.exit(1);
}
console.log('\n结果: PASS（加载 / 模块图 / 导出 / DOM 白名单 / 无 UI）');
