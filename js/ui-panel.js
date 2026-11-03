// 右下角圆球形设置图标与圆角矩形动态参数控制面板（青绿色主题色 + 气象系统彩蛋 + 全天时瑞利大气与体积光控制）：
// - 主题色全面采用清透青绿色（#2dd4bf / #14b8a6），贴合深林幽谷氛围；
// - 支持 7 大昼夜时段一键切换（雨后 / 深夜 / 蓝调 / 清晨 / 正午 / 黄昏 / 月夜）与 24h 无级流转；
// - 支持 3 大气象系统彩蛋一键切换（雨后初霁 / 细雨霏霏 / 深山浓雾）；
// - 支持林间丁达尔体积光束（God Ray）、参道木灯笼暖光亮度、3D 体积雾浓度與流速、SSAO、DOF、Bloom 与微风摆幅调节。
import { POST } from './config.js';
import { WEATHER_MODES } from './weather.js';

function formatHour(h) {
  const totalMin = Math.floor(((h % 24) + 24) % 24 * 60);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function periodBadge(h) {
  if (h >= 4.5 && h < 5.7) return '蓝调 · 紫霭微明';
  if (h >= 5.7 && h < 8.5) return '清晨 · 朝雾漫射';
  if (h >= 8.5 && h < 11.5) return '雨后 · 静谧深林';
  if (h >= 11.5 && h < 16.2) return '正午 · 林隙暖阳';
  if (h >= 16.2 && h < 18.6) return '黄昏 · 光影隧道';
  if (h >= 18.6 && h < 19.6) return '暮色 · 蓝调残照';
  if (h >= 19.6 && h < 22.5) return '月夜 · 冷银月华';
  return '深夜 · 星河天幕';
}

export function createSettingsPanel({ post, lighting, dayNight, weather, animations }) {
  if (
    typeof document === 'undefined' ||
    !document.body ||
    typeof document.body.appendChild !== 'function'
  ) {
    return { dispose() {} };
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .torii-ui-root {
      position: fixed;
      right: 22px;
      bottom: 22px;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans", "Noto Sans CJK JP", sans-serif;
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
      width: 332px;
      padding: 15px 17px;
      border-radius: 18px;
      background: rgba(12, 24, 22, 0.88);
      border: 1px solid rgba(45, 212, 191, 0.24);
      box-shadow: 0 16px 42px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(153, 246, 228, 0.12);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      color: #dfeae6;
      opacity: 0;
      transform: translateY(10px) scale(0.96);
      transform-origin: bottom right;
      transition: opacity 0.24s ease, transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
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
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(45, 212, 191, 0.14);
    }
    .torii-panel-title {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: #f0fdfa;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .torii-panel-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #2dd4bf;
      box-shadow: 0 0 8px rgba(45, 212, 191, 0.85);
    }
    .torii-panel-badge {
      font-size: 11px;
      color: #5eead4;
      background: rgba(45, 212, 191, 0.12);
      border: 1px solid rgba(45, 212, 191, 0.22);
      padding: 2px 8px;
      border-radius: 999px;
    }
    .torii-section-label {
      font-size: 10.5px;
      color: #7ab8ae;
      letter-spacing: 0.04em;
      margin-bottom: 5px;
    }
    .torii-presets {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
      margin-bottom: 10px;
    }
    .torii-weather-bar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 11px;
    }
    .torii-preset-btn, .torii-weather-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #c5dcd7;
      border-radius: 8px;
      padding: 5px 0;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.18s ease;
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
      margin-bottom: 8px;
    }
    .torii-row-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.2px;
      color: #b4d0c9;
      margin-bottom: 3px;
    }
    .torii-row-val {
      font-variant-numeric: tabular-nums;
      color: #99f6e4;
      font-size: 11px;
    }
    .torii-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 5px;
      border-radius: 999px;
      background: rgba(45, 212, 191, 0.16);
      outline: none;
      cursor: pointer;
    }
    .torii-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: #f0fdfa;
      border: 2px solid #14b8a6;
      box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45), 0 0 6px rgba(45, 212, 191, 0.45);
      cursor: pointer;
      transition: transform 0.15s ease;
    }
    .torii-slider::-webkit-slider-thumb:hover {
      transform: scale(1.18);
    }
    .torii-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
      padding-top: 9px;
      border-top: 1px solid rgba(45, 212, 191, 0.14);
      gap: 8px;
    }
    .torii-toggle-btn, .torii-reset-btn {
      flex: 1;
      padding: 6px 10px;
      border-radius: 9px;
      font-size: 11.5px;
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
  titleText.textContent = '稻荷山境 · 大气光影与气象系统';
  title.appendChild(dot);
  title.appendChild(titleText);

  const badge = document.createElement('div');
  badge.className = 'torii-panel-badge';
  badge.textContent = periodBadge(10.5);
  header.appendChild(title);
  header.appendChild(badge);
  panel.appendChild(header);

  // 昼夜天光预设栏（7时段）
  const presetsWrap = document.createElement('div');
  presetsWrap.className = 'torii-presets';
  const presetDefs = [
    { id: 'default', label: '雨后', hour: 10.5 },
    { id: 'midnight', label: '深夜', hour: 0.0 },
    { id: 'blueDawn', label: '蓝调', hour: 5.15 },
    { id: 'dawn', label: '清晨', hour: 6.3 },
    { id: 'noon', label: '正午', hour: 13.0 },
    { id: 'dusk', label: '黄昏', hour: 17.65 },
    { id: 'moonlight', label: '月夜', hour: 21.2 }
  ];
  const presetBtns = new Map();
  for (const p of presetDefs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `torii-preset-btn${p.id === 'default' ? ' active' : ''}`;
    b.textContent = p.label;
    b.addEventListener('click', () => {
      if (dayNight) {
        dayNight.autoCycle = false;
        updateCycleBtn();
        dayNight.setPreset(p.id);
      }
      highlightPreset(p.id);
    });
    presetBtns.set(p.id, b);
    presetsWrap.appendChild(b);
  }
  panel.appendChild(presetsWrap);

  function highlightPreset(activeId) {
    for (const [id, btn] of presetBtns) {
      if (btn.classList) btn.classList.toggle('active', id === activeId);
    }
  }

  // 气象系统（可切换彩蛋：雨后初霁 / 细雨霏霏 / 深山浓雾）
  const weatherBar = document.createElement('div');
  weatherBar.className = 'torii-weather-bar';
  const weatherBtns = new Map();
  for (const w of WEATHER_MODES) {
    const wb = document.createElement('button');
    wb.type = 'button';
    wb.className = `torii-weather-btn${w.id === 'clear' ? ' active' : ''}`;
    wb.textContent = w.label;
    wb.addEventListener('click', () => {
      if (weather && weather.setMode) weather.setMode(w.id);
      highlightWeather(w.id);
    });
    weatherBtns.set(w.id, wb);
    weatherBar.appendChild(wb);
  }
  panel.appendChild(weatherBar);

  function highlightWeather(activeId) {
    for (const [id, btn] of weatherBtns) {
      if (btn.classList) btn.classList.toggle('active', id === activeId);
    }
  }

  function makeSliderRow({ label, min, max, step, value, format = (v) => Number(v).toFixed(2), onInput }) {
    const row = document.createElement('div');
    row.className = 'torii-row';
    const head = document.createElement('div');
    head.className = 'torii-row-head';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'torii-row-val';
    val.textContent = format(value);
    head.appendChild(lbl);
    head.appendChild(val);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'torii-slider';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const num = parseFloat(input.value);
      val.textContent = format(num);
      onInput(num);
    });

    row.appendChild(head);
    row.appendChild(input);
    panel.appendChild(row);
    return {
      input,
      val,
      setValue(v) {
        input.value = String(v);
        val.textContent = format(v);
      }
    };
  }

  // 1) 昼夜时刻滑块
  const timeRow = makeSliderRow({
    label: '全天时瑞利大气时刻（24h）',
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

  // 2) 林间丁达尔体积光（God Ray）强度
  const godRayRow = makeSliderRow({
    label: '林间丁达尔体积光束（God Ray）',
    min: 0,
    max: 2.2,
    step: 0.05,
    value: post && post.getGodRayStrength ? post.getGodRayStrength() : 1.0,
    onInput: (v) => {
      if (post && post.setGodRayStrength) post.setGodRayStrength(v);
    }
  });

  // 3) 参道春日木灯笼暖黄微光亮度滑块
  const lanternRow = makeSliderRow({
    label: '参道灯笼暖光与地面格子光斑',
    min: 0,
    max: 2.0,
    step: 0.05,
    value: lighting && lighting.getLanternBrightness ? lighting.getLanternBrightness() : 0.38,
    onInput: (v) => {
      if (dayNight && dayNight.setLanternOverride) dayNight.setLanternOverride(v);
      else if (lighting && lighting.setLanternBrightness) lighting.setLanternBrightness(v);
    }
  });

  // 4) 3D 体积雾浓度
  const fogDensityRow = makeSliderRow({
    label: '三维体积雾浓度（谷底浓 / 林冠淡）',
    min: 0,
    max: 0.85,
    step: 0.01,
    value: POST.heightFog.density,
    onInput: (v) => {
      if (dayNight) dayNight.setFogOverride(v);
      if (post) post.setHeightFogDensity(v);
    }
  });

  // 5) 体积雾流动速度
  const fogSpeedRow = makeSliderRow({
    label: '三维体积雾沿参道漂移流速',
    min: 0,
    max: 0.8,
    step: 0.01,
    value: POST.heightFog.speed,
    onInput: (v) => {
      if (post) post.setFogSpeed(v);
    }
  });

  // 6) SSAO 闭塞阴影强度
  const ssaoRow = makeSliderRow({
    label: 'SSAO 环境光遮蔽（叶隙 / 石缝）',
    min: 0,
    max: 1.5,
    step: 0.02,
    value: POST.ssao.strength,
    onInput: (v) => {
      if (post) post.setSsaoStrength(v);
    }
  });

  // 7) 鸟居焦点景深 DOF 强度
  const dofRow = makeSliderRow({
    label: '鸟居焦点景深虚化（DOF）',
    min: 0,
    max: 2.0,
    step: 0.05,
    value: 1.0,
    onInput: (v) => {
      if (post) post.setDofScale(v);
    }
  });

  // 8) Bloom 辉光与山林微风摆动
  const bloomRow = makeSliderRow({
    label: '暗部透气辉光（Bloom）',
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
    label: '山林枝叶微风摆幅',
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
  cycleBtn.textContent = '昼夜自动流转: 关';
  function updateCycleBtn() {
    const on = Boolean(dayNight && dayNight.autoCycle);
    if (cycleBtn.classList) cycleBtn.classList.toggle('active', on);
    cycleBtn.textContent = on ? '昼夜自动流转: 开' : '昼夜自动流转: 关';
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
  resetBtn.textContent = '恢复默认基准';
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

  let unsub = null;
  if (dayNight && dayNight.onChange) {
    unsub = dayNight.onChange((state) => {
      timeRow.setValue(state.hour);
      badge.textContent = periodBadge(state.hour);
      if (lighting && lighting.getLanternBrightness) {
        lanternRow.setValue(lighting.getLanternBrightness());
      }
      if (post) {
        fogDensityRow.setValue(post.passes.ssaoFog.material.uniforms.uFogDensity.value);
        bloomRow.setValue(post.passes.composite.material.uniforms.uBloomStrength.value);
      }
    });
  }

  const orbBtn = document.createElement('button');
  orbBtn.type = 'button';
  orbBtn.className = 'torii-orb-btn';
  orbBtn.title = '展开/收起大气光影与气象设置';
  orbBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3.2"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
  `;
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
