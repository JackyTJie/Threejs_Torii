// 初始加载界面（简笔鸟居 + 底部起绕圆形浅绿进度条 + 系统亮暗黑白自适应）
// 与右下角圆球形控制面板（默认英文 + 中英一键切换 + 简洁单词单行对齐不换行）：
// - createLoadingScreen(): 在 #torii-loader 中挂载极简线条鸟居与从底部(6点钟方向)绕一圈的浅绿色圆形进度条，
//   背景自动跟随系统/浏览器 prefers-color-scheme 匹配纯白或纯黑，绕满一圈后平滑淡出进入场景；
// - createSettingsPanel(): 右下角青绿色玻璃拟态控制面板，支持 EN/中文 切换（默认 EN），
//   所有按钮与滑块均采用简洁英文词汇与单行网格对齐（white-space: nowrap），杜绝换行。
import { POST } from './config.js';

const CIRCUMFERENCE = 2 * Math.PI * 82; // r = 82 => ~515.22

/**
 * 创建初始网页加载界面：
 * - 中间为简笔明神鸟居（上翘笠木、岛木、额束、贯、双柱与柱础）
 * - 外圈为浅绿色圆形进度条，从圆形底部（6点钟方向，rotate(90deg)）开始顺时针绕一圈回到圆形底部代表 100% 加载完成
 * - 背景根据系统或浏览器亮暗模式自动匹配白色（#ffffff）或黑色（#080b09）
 */
export function createLoadingScreen() {
  if (
    typeof document === 'undefined' ||
    !document.body ||
    typeof document.createElement !== 'function'
  ) {
    return {
      setProgress() {},
      finish() {},
      dispose() {}
    };
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .torii-loader-wrap {
      position: relative;
      width: 184px;
      height: 184px;
      display: flex;
      align-items: center;
      justify-content: center;
      filter: drop-shadow(0 0 14px var(--loader-glow, rgba(126, 212, 152, 0.24)));
      transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease;
    }
    #torii-loader.is-done .torii-loader-wrap {
      transform: scale(1.06);
      opacity: 0;
    }
    .torii-loader-svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .torii-loader-track {
      fill: none;
      stroke: var(--loader-track, rgba(126, 212, 152, 0.18));
      stroke-width: 2.6;
    }
    .torii-loader-arc {
      fill: none;
      stroke: var(--loader-accent, #7ed498);
      stroke-width: 3.4;
      stroke-linecap: round;
      stroke-dasharray: ${CIRCUMFERENCE.toFixed(2)};
      stroke-dashoffset: ${CIRCUMFERENCE.toFixed(2)};
      transition: stroke-dashoffset 0.16s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .torii-loader-glyph {
      fill: none;
      stroke: var(--loader-accent, #7ed498);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `;
  if (document.head && typeof document.head.appendChild === 'function') {
    document.head.appendChild(styleEl);
  }

  let host = typeof document.getElementById === 'function' ? document.getElementById('torii-loader') : null;
  if (!host) {
    host = document.createElement('div');
    host.id = 'torii-loader';
    document.body.appendChild(host);
  }

  const wrap = document.createElement('div');
  wrap.className = 'torii-loader-wrap';
  // rotate(90 100 100) 将圆形起点定位在正下方（6点钟方向），进度从底部绕一圈回到正下方
  wrap.innerHTML = `
    <svg class="torii-loader-svg" viewBox="0 0 200 200" aria-hidden="true">
      <circle class="torii-loader-track" cx="100" cy="100" r="82" />
      <circle class="torii-loader-arc" cx="100" cy="100" r="82" transform="rotate(90 100 100)" />
      <g class="torii-loader-glyph">
        <!-- 笠木（微翘上弧顶梁） -->
        <path d="M 52 70 Q 100 79 148 70" stroke-width="3.6" />
        <path d="M 56 75.5 Q 100 83 144 75.5" stroke-width="2.2" />
        <!-- 贯（下横梁） -->
        <line x1="60" y1="92" x2="140" y2="92" stroke-width="2.8" />
        <!-- 额束（中央竖牌） -->
        <line x1="100" y1="78.5" x2="100" y2="92" stroke-width="2.6" />
        <!-- 左右立柱（略带内倾收分） -->
        <line x1="74" y1="77" x2="71.5" y2="136" stroke-width="3.4" />
        <line x1="126" y1="77" x2="128.5" y2="136" stroke-width="3.4" />
        <!-- 柱础（龟腹底座） -->
        <line x1="66.5" y1="136" x2="76.5" y2="136" stroke-width="3.2" />
        <line x1="123.5" y1="136" x2="133.5" y2="136" stroke-width="3.2" />
      </g>
    </svg>
  `;
  host.appendChild(wrap);

  const arcEl = wrap.querySelector ? wrap.querySelector('.torii-loader-arc') : null;
  let currentProgress = 0;
  let finished = false;

  function setProgress(value) {
    if (finished) return;
    currentProgress = Math.max(currentProgress, Math.max(0, Math.min(1, Number(value) || 0)));
    if (arcEl && arcEl.style) {
      const offset = CIRCUMFERENCE * (1 - currentProgress);
      arcEl.style.strokeDashoffset = offset.toFixed(2);
    }
  }

  function finish() {
    if (finished) return;
    setProgress(1);
    finished = true;
    const hide = () => {
      if (host && host.classList) host.classList.add('is-done');
      if (typeof setTimeout === 'function') {
        setTimeout(() => {
          if (host && host.parentNode) host.parentNode.removeChild(host);
        }, 620);
      }
    };
    if (typeof setTimeout === 'function') {
      setTimeout(hide, 220);
    } else {
      hide();
    }
  }

  function dispose() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
  }

  setProgress(0.06);
  return {
    get progress() {
      return currentProgress;
    },
    setProgress,
    finish,
    dispose
  };
}

function formatHour(h) {
  const totalMin = Math.floor(((h % 24) + 24) % 24 * 60);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

const I18N = {
  en: {
    title: 'Inari Shrine',
    langBtn: '中文',
    orbTitle: 'Toggle Controls',
    periods: {
      blueDawn: 'Blue Hour',
      dawn: 'Dawn',
      postRain: 'Fresh',
      noon: 'Noon',
      dusk: 'Dusk',
      twilight: 'Twilight',
      moonlight: 'Moonlight',
      midnight: 'Midnight'
    },
    presets: {
      default: 'Fresh',
      midnight: 'Night',
      blueDawn: 'Blue',
      dawn: 'Dawn',
      noon: 'Noon',
      dusk: 'Dusk',
      moonlight: 'Moon'
    },
    weather: {
      clear: 'Clear',
      rain: 'Rain',
      fog: 'Mist'
    },
    sliders: {
      time: 'Time',
      godRay: 'Sunbeam',
      lantern: 'Lantern',
      fogDensity: 'Fog',
      fogSpeed: 'Drift',
      ssao: 'SSAO',
      dof: 'Focus',
      bloom: 'Bloom',
      wind: 'Wind'
    },
    autoOn: 'Auto: ON',
    autoOff: 'Auto: OFF',
    reset: 'Reset'
  },
  zh: {
    title: '稻荷山境',
    langBtn: 'EN',
    orbTitle: '展开/收起设置面板',
    periods: {
      blueDawn: '蓝调时刻',
      dawn: '清晨朝雾',
      postRain: '雨后深林',
      noon: '正午暖阳',
      dusk: '黄昏夕照',
      twilight: '暮色残照',
      moonlight: '冷银月夜',
      midnight: '星河深夜'
    },
    presets: {
      default: '雨后',
      midnight: '深夜',
      blueDawn: '蓝调',
      dawn: '清晨',
      noon: '正午',
      dusk: '黄昏',
      moonlight: '月夜'
    },
    weather: {
      clear: '初霁',
      rain: '细雨',
      fog: '浓雾'
    },
    sliders: {
      time: '时刻',
      godRay: '光束',
      lantern: '灯笼',
      fogDensity: '雾浓',
      fogSpeed: '雾速',
      ssao: '遮蔽',
      dof: '景深',
      bloom: '辉光',
      wind: '微风'
    },
    autoOn: '自动: 开',
    autoOff: '自动: 关',
    reset: '重置'
  }
};

function periodKey(h) {
  if (h >= 4.5 && h < 5.7) return 'blueDawn';
  if (h >= 5.7 && h < 8.5) return 'dawn';
  if (h >= 8.5 && h < 11.5) return 'postRain';
  if (h >= 11.5 && h < 16.2) return 'noon';
  if (h >= 16.2 && h < 18.6) return 'dusk';
  if (h >= 18.6 && h < 19.6) return 'twilight';
  if (h >= 19.6 && h < 22.5) return 'moonlight';
  return 'midnight';
}

export function createSettingsPanel({ post, lighting, dayNight, weather, animations }) {
  if (
    typeof document === 'undefined' ||
    !document.body ||
    typeof document.body.appendChild !== 'function'
  ) {
    return { dispose() {} };
  }

  let lang = 'en'; // 默认英语（Default English）

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .torii-ui-root {
      position: fixed;
      right: 22px;
      bottom: 22px;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", "PingFang SC", sans-serif;
      user-select: none;
      -webkit-user-select: none;
      pointer-events: none;
    }
    .torii-orb-btn {
      pointer-events: auto;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 1px solid rgba(45, 212, 191, 0.38);
      background: radial-gradient(circle at 32% 28%, rgba(28, 72, 66, 0.92), rgba(12, 28, 25, 0.96));
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45), inset 0 1px 1px rgba(153, 246, 228, 0.22);
      color: #ccfbf1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      margin-left: auto;
      transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.25s ease, box-shadow 0.25s ease;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    .torii-orb-btn:hover {
      transform: scale(1.07);
      border-color: rgba(45, 212, 191, 0.85);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55), 0 0 14px rgba(45, 212, 191, 0.42);
    }
    .torii-orb-btn svg {
      width: 20px;
      height: 20px;
      transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .torii-ui-root.open .torii-orb-btn svg {
      transform: rotate(90deg);
    }
    .torii-panel {
      pointer-events: none;
      position: absolute;
      right: 0;
      bottom: 56px;
      width: 320px;
      padding: 14px 16px;
      border-radius: 16px;
      background: rgba(12, 24, 22, 0.90);
      border: 1px solid rgba(45, 212, 191, 0.24);
      box-shadow: 0 16px 42px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(153, 246, 228, 0.12);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      color: #dfeae6;
      opacity: 0;
      transform: translateY(10px) scale(0.96);
      transform-origin: bottom right;
      transition: opacity 0.24s ease, transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
      box-sizing: border-box;
    }
    .torii-ui-root.open .torii-panel {
      pointer-events: auto;
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .torii-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(45, 212, 191, 0.14);
      white-space: nowrap;
    }
    .torii-panel-title {
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: 0.03em;
      color: #f0fdfa;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .torii-panel-dot {
      flex-shrink: 0;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #2dd4bf;
      box-shadow: 0 0 8px rgba(45, 212, 191, 0.85);
    }
    .torii-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .torii-panel-badge {
      font-size: 10.5px;
      color: #5eead4;
      background: rgba(45, 212, 191, 0.12);
      border: 1px solid rgba(45, 212, 191, 0.22);
      padding: 2px 8px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .torii-lang-btn {
      font-size: 10.5px;
      font-weight: 600;
      color: #ccfbf1;
      background: rgba(20, 184, 166, 0.18);
      border: 1px solid rgba(45, 212, 191, 0.38);
      padding: 2px 8px;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.16s ease;
    }
    .torii-lang-btn:hover {
      background: rgba(20, 184, 166, 0.34);
      border-color: rgba(45, 212, 191, 0.82);
      color: #ffffff;
    }
    .torii-presets {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 4px;
      margin-bottom: 8px;
    }
    .torii-weather-bar {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 5px;
      margin-bottom: 10px;
    }
    .torii-preset-btn, .torii-weather-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.10);
      color: #c5dcd7;
      border-radius: 7px;
      padding: 5px 2px;
      font-size: 10.5px;
      line-height: 1.2;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .torii-preset-btn:hover, .torii-weather-btn:hover {
      background: rgba(45, 212, 191, 0.15);
      border-color: rgba(45, 212, 191, 0.42);
      color: #ffffff;
    }
    .torii-preset-btn.active, .torii-weather-btn.active {
      background: rgba(20, 184, 166, 0.28);
      border-color: rgba(45, 212, 191, 0.82);
      color: #ecfdf5;
      box-shadow: 0 0 10px rgba(45, 212, 191, 0.22);
      font-weight: 600;
    }
    .torii-row {
      display: grid;
      grid-template-columns: 58px 1fr 40px;
      align-items: center;
      gap: 8px;
      height: 22px;
      margin-bottom: 4px;
      white-space: nowrap;
    }
    .torii-row-lbl {
      font-size: 11px;
      color: #b4d0c9;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .torii-row-val {
      font-variant-numeric: tabular-nums;
      color: #99f6e4;
      font-size: 10.5px;
      text-align: right;
      white-space: nowrap;
    }
    .torii-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 4px;
      margin: 0;
      border-radius: 999px;
      background: rgba(45, 212, 191, 0.18);
      outline: none;
      cursor: pointer;
    }
    .torii-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #f0fdfa;
      border: 2px solid #14b8a6;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45), 0 0 5px rgba(45, 212, 191, 0.45);
      cursor: pointer;
      transition: transform 0.15s ease;
    }
    .torii-slider::-webkit-slider-thumb:hover {
      transform: scale(1.18);
    }
    .torii-footer {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: center;
      margin-top: 9px;
      padding-top: 8px;
      border-top: 1px solid rgba(45, 212, 191, 0.14);
      gap: 6px;
    }
    .torii-toggle-btn, .torii-reset-btn {
      padding: 5px 8px;
      border-radius: 8px;
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
      cursor: pointer;
      border: 1px solid rgba(45, 212, 191, 0.22);
      background: rgba(20, 184, 166, 0.10);
      color: #ccfbf1;
      transition: all 0.18s ease;
    }
    .torii-toggle-btn.active {
      background: rgba(20, 184, 166, 0.34);
      border-color: rgba(45, 212, 191, 0.85);
      color: #f0fdfa;
      box-shadow: 0 0 12px rgba(45, 212, 191, 0.25);
    }
    .torii-toggle-btn:hover, .torii-reset-btn:hover {
      background: rgba(20, 184, 166, 0.24);
      border-color: rgba(45, 212, 191, 0.65);
      color: #ffffff;
    }
  `;
  if (document.head && typeof document.head.appendChild === 'function') {
    document.head.appendChild(styleEl);
  }

  const root = document.createElement('div');
  root.className = 'torii-ui-root';

  const panel = document.createElement('div');
  panel.className = 'torii-panel';

  const header = document.createElement('div');
  header.className = 'torii-panel-header';
  const title = document.createElement('div');
  title.className = 'torii-panel-title';
  const dot = document.createElement('span');
  dot.className = 'torii-panel-dot';
  const titleText = document.createElement('span');
  title.appendChild(dot);
  title.appendChild(titleText);

  const headerActions = document.createElement('div');
  headerActions.className = 'torii-header-actions';

  const badge = document.createElement('div');
  badge.className = 'torii-panel-badge';

  const langBtn = document.createElement('button');
  langBtn.type = 'button';
  langBtn.className = 'torii-lang-btn';

  headerActions.appendChild(badge);
  headerActions.appendChild(langBtn);
  header.appendChild(title);
  header.appendChild(headerActions);
  panel.appendChild(header);

  // 昼夜天光预设栏（7时段，单行对齐）
  const presetsWrap = document.createElement('div');
  presetsWrap.className = 'torii-presets';
  const presetIds = ['default', 'midnight', 'blueDawn', 'dawn', 'noon', 'dusk', 'moonlight'];
  const presetBtns = new Map();
  for (const id of presetIds) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `torii-preset-btn${id === 'default' ? ' active' : ''}`;
    b.addEventListener('click', () => {
      if (dayNight) {
        dayNight.autoCycle = false;
        updateCycleBtn();
        dayNight.setPreset(id);
      }
      highlightPreset(id);
    });
    presetBtns.set(id, b);
    presetsWrap.appendChild(b);
  }
  panel.appendChild(presetsWrap);

  function setClassActive(el, cls, active) {
    if (!el || !el.classList) return;
    if (typeof el.classList.toggle === 'function') {
      el.classList.toggle(cls, active);
    } else if (active && typeof el.classList.add === 'function') {
      el.classList.add(cls);
    } else if (!active && typeof el.classList.remove === 'function') {
      el.classList.remove(cls);
    }
  }

  function highlightPreset(activeId) {
    for (const [id, btn] of presetBtns) {
      setClassActive(btn, 'active', id === activeId);
    }
  }

  // 气象系统栏（3列，单行对齐）
  const weatherBar = document.createElement('div');
  weatherBar.className = 'torii-weather-bar';
  const weatherIds = ['clear', 'rain', 'fog'];
  const weatherBtns = new Map();
  for (const wid of weatherIds) {
    const wb = document.createElement('button');
    wb.type = 'button';
    wb.className = `torii-weather-btn${wid === 'clear' ? ' active' : ''}`;
    wb.addEventListener('click', () => {
      if (weather && weather.setMode) weather.setMode(wid);
      highlightWeather(wid);
    });
    weatherBtns.set(wid, wb);
    weatherBar.appendChild(wb);
  }
  panel.appendChild(weatherBar);

  function highlightWeather(activeId) {
    for (const [id, btn] of weatherBtns) {
      setClassActive(btn, 'active', id === activeId);
    }
  }

  // 单行三列滑块行：[简洁标签] [滑块] [数值]
  const sliderRows = new Map();
  function makeSliderRow({ key, min, max, step, value, format = (v) => Number(v).toFixed(2), onInput }) {
    const row = document.createElement('div');
    row.className = 'torii-row';
    const lbl = document.createElement('span');
    lbl.className = 'torii-row-lbl';
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'torii-slider';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const val = document.createElement('span');
    val.className = 'torii-row-val';
    val.textContent = format(value);

    input.addEventListener('input', () => {
      const num = parseFloat(input.value);
      val.textContent = format(num);
      onInput(num);
    });

    row.appendChild(lbl);
    row.appendChild(input);
    row.appendChild(val);
    panel.appendChild(row);

    const item = {
      lbl,
      input,
      val,
      setValue(v) {
        input.value = String(v);
        val.textContent = format(v);
      }
    };
    sliderRows.set(key, item);
    return item;
  }

  const timeRow = makeSliderRow({
    key: 'time',
    min: 0,
    max: 24,
    step: 0.05,
    value: 10.5,
    format: (v) => formatHour(v),
    onInput: (v) => {
      highlightPreset('');
      if (dayNight) dayNight.setHour(v);
    }
  });

  const godRayRow = makeSliderRow({
    key: 'godRay',
    min: 0,
    max: 2.2,
    step: 0.05,
    value: post && post.getGodRayStrength ? post.getGodRayStrength() : 1.0,
    onInput: (v) => {
      if (post && post.setGodRayStrength) post.setGodRayStrength(v);
    }
  });

  const lanternRow = makeSliderRow({
    key: 'lantern',
    min: 0,
    max: 2.0,
    step: 0.05,
    value: lighting && lighting.getLanternBrightness ? lighting.getLanternBrightness() : 0.38,
    onInput: (v) => {
      if (dayNight && dayNight.setLanternOverride) dayNight.setLanternOverride(v);
      else if (lighting && lighting.setLanternBrightness) lighting.setLanternBrightness(v);
    }
  });

  const fogDensityRow = makeSliderRow({
    key: 'fogDensity',
    min: 0,
    max: 0.85,
    step: 0.01,
    value: POST.heightFog.density,
    onInput: (v) => {
      if (dayNight) dayNight.setFogOverride(v);
      if (post) post.setHeightFogDensity(v);
    }
  });

  const fogSpeedRow = makeSliderRow({
    key: 'fogSpeed',
    min: 0,
    max: 0.8,
    step: 0.01,
    value: POST.heightFog.speed,
    onInput: (v) => {
      if (post) post.setFogSpeed(v);
    }
  });

  const ssaoRow = makeSliderRow({
    key: 'ssao',
    min: 0,
    max: 1.5,
    step: 0.02,
    value: POST.ssao.strength,
    onInput: (v) => {
      if (post) post.setSsaoStrength(v);
    }
  });

  const dofRow = makeSliderRow({
    key: 'dof',
    min: 0,
    max: 2.0,
    step: 0.05,
    value: 1.0,
    onInput: (v) => {
      if (post) post.setDofScale(v);
    }
  });

  const bloomRow = makeSliderRow({
    key: 'bloom',
    min: 0,
    max: 0.65,
    step: 0.01,
    value: POST.bloom.strength,
    onInput: (v) => {
      if (dayNight) dayNight.setBloomOverride(v);
      if (post) post.setBloomStrength(v);
    }
  });

  const windRow = makeSliderRow({
    key: 'wind',
    min: 0,
    max: 1.8,
    step: 0.05,
    value: 1.0,
    onInput: (v) => {
      if (animations && animations.treeSway && animations.treeSway.setWindScale) {
        animations.treeSway.setWindScale(v);
      }
    }
  });

  const footer = document.createElement('div');
  footer.className = 'torii-footer';

  const cycleBtn = document.createElement('button');
  cycleBtn.type = 'button';
  cycleBtn.className = 'torii-toggle-btn';

  function updateCycleBtn() {
    const dict = I18N[lang];
    const on = Boolean(dayNight && dayNight.autoCycle);
    setClassActive(cycleBtn, 'active', on);
    cycleBtn.textContent = on ? dict.autoOn : dict.autoOff;
  }

  cycleBtn.addEventListener('click', () => {
    if (!dayNight) return;
    dayNight.autoCycle = !dayNight.autoCycle;
    updateCycleBtn();
    if (dayNight.autoCycle) highlightPreset('');
  });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'torii-reset-btn';
  resetBtn.addEventListener('click', () => {
    if (dayNight) dayNight.resetDefault();
    if (weather && weather.resetDefault) weather.resetDefault();
    updateCycleBtn();
    highlightPreset('default');
    highlightWeather('clear');
    timeRow.setValue(10.5);
    godRayRow.setValue(1.0);
    lanternRow.setValue(0.38);
    ssaoRow.setValue(1.0);
    fogDensityRow.setValue(0.24);
    fogSpeedRow.setValue(0.35);
    dofRow.setValue(1.0);
    bloomRow.setValue(0.24);
    windRow.setValue(1.0);
    if (post) {
      post.setGodRayStrength(1.0);
      post.setSsaoStrength(1.0);
      post.setHeightFogDensity(0.24);
      post.setFogSpeed(0.35);
      post.setDofScale(1.0);
      post.setBloomStrength(0.24);
    }
    if (animations && animations.treeSway && animations.treeSway.setWindScale) {
      animations.treeSway.setWindScale(1.0);
    }
  });

  footer.appendChild(cycleBtn);
  footer.appendChild(resetBtn);
  panel.appendChild(footer);

  const orbBtn = document.createElement('button');
  orbBtn.type = 'button';
  orbBtn.className = 'torii-orb-btn';
  orbBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3.2"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
  `;

  function applyLanguage() {
    const dict = I18N[lang];
    titleText.textContent = dict.title;
    langBtn.textContent = dict.langBtn;
    orbBtn.title = dict.orbTitle;
    const curHour = dayNight ? dayNight.hour : 10.5;
    badge.textContent = dict.periods[periodKey(curHour)];
    for (const [id, btn] of presetBtns) {
      btn.textContent = dict.presets[id];
    }
    for (const [wid, wb] of weatherBtns) {
      wb.textContent = dict.weather[wid];
    }
    for (const [k, row] of sliderRows) {
      row.lbl.textContent = dict.sliders[k];
    }
    resetBtn.textContent = dict.reset;
    updateCycleBtn();
  }

  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    lang = lang === 'en' ? 'zh' : 'en';
    applyLanguage();
  });

  applyLanguage();

  let unsub = null;
  if (dayNight && dayNight.onChange) {
    unsub = dayNight.onChange((state) => {
      timeRow.setValue(state.hour);
      badge.textContent = I18N[lang].periods[periodKey(state.hour)];
      if (lighting && lighting.getLanternBrightness) {
        lanternRow.setValue(lighting.getLanternBrightness());
      }
      if (post) {
        fogDensityRow.setValue(post.passes.ssaoFog.material.uniforms.uFogDensity.value);
        bloomRow.setValue(post.passes.composite.material.uniforms.uBloomStrength.value);
      }
    });
  }

  orbBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (root.classList) root.classList.toggle('open');
  });

  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('pointermove', (e) => e.stopPropagation());
  panel.addEventListener('wheel', (e) => e.stopPropagation());

  root.appendChild(panel);
  root.appendChild(orbBtn);
  document.body.appendChild(root);

  return {
    root,
    panel,
    orbBtn,
    get lang() {
      return lang;
    },
    setLang(nextLang) {
      if (nextLang === 'en' || nextLang === 'zh') {
        lang = nextLang;
        applyLanguage();
      }
    },
    open() {
      if (root.classList) root.classList.add('open');
    },
    close() {
      if (root.classList) root.classList.remove('open');
    },
    dispose() {
      if (unsub) unsub();
      if (root.parentNode) root.parentNode.removeChild(root);
      if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    }
  };
}
