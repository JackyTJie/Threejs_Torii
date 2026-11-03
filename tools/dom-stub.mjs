// 离线 DOM 桩：让 core/textures.js 与入口模块能在 Node 中构建（不参与浏览器运行）
function makeContext2D(canvas) {
  const gradient = { addColorStop() {} };
  const noop = () => {};
  return {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    filter: 'none',
    shadowBlur: 0,
    shadowColor: '#000',
    imageSmoothingEnabled: true,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fillText: noop,
    strokeText: noop,
    drawImage: noop,
    setTransform: noop,
    transform: noop,
    resetTransform: noop,
    setLineDash: noop,
    measureText: (t) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createConicGradient: () => gradient,
    createPattern: () => null,
    createImageData: (w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4)
    }),
    getImageData: (x, y, w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4)
    }),
    putImageData(imageData) {
      canvas._imageData = imageData;
    }
  };
}

export function makeCanvas(width = 512, height = 512) {
  const canvas = {
    width,
    height,
    _imageData: null,
    style: {},
    clientWidth: width,
    clientHeight: height,
    nodeName: 'CANVAS',
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    getContext(type) {
      if (type === '2d') return makeContext2D(canvas);
      return null;
    }
  };
  return canvas;
}

export function installDomStub() {
  const stage = makeCanvas(1600, 900);
  const listeners = [];
  const element = () => ({
    style: {},
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    setAttribute() {},
    getAttribute: () => null,
    textContent: ''
  });

  globalThis.document = {
    readyState: 'complete',
    documentElement: element(),
    body: element(),
    head: element(),
    createElement: (tag) => (String(tag).toLowerCase() === 'canvas' ? makeCanvas() : element()),
    createElementNS: (ns, tag) => (String(tag).toLowerCase() === 'canvas' ? makeCanvas() : element()),
    getElementById: (id) => (id === 'stage' ? stage : null),
    querySelector: () => stage,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };

  globalThis.window = {
    innerWidth: 1600,
    innerHeight: 900,
    devicePixelRatio: 2,
    addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }),
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({})
  };

  globalThis.performance = { now: () => 0 };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => 0;
  globalThis.addEventListener = globalThis.window.addEventListener;
  globalThis.removeEventListener = globalThis.window.removeEventListener;

  return { stage, listeners };
}
