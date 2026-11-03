// 右下角圆球形设置图标与圆角矩形动态参数控制面板（第三优先级）：
// - 默认收起在画面右下角，仅显示一个低调精致的 44x44px 圆球形设置图标，不干扰画面观赏；
// - 点击圆球平滑展开圆角矩形毛玻璃控制面板，所有参数均以当前「雨后深林静谧效果」为默认基准；
// - 支持动态昼夜切换（预设时段 / 24h 时间轴 / 自动昼夜循环）、SSAO 闭塞强度、分层高度雾浓度与流速、
//   鸟居焦点景深 DOF 强度、Bloom 辉光强度、山林微风摆动强度实时调节与一键重置。
import { POST } from './config.js';

function formatHour(h) {
  const totalMin = Math.floor(((h % 24) + 24) % 24 * 60);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function periodBadge(h) {
  if (h >= 5.0 && h < 8.5) return '清晨 · 朝雾漫射';
  if (h >= 8.5 && h < 11.5) return '雨后 · 静谧深林';
  if (h >= 11.5 && h < 16.0) return '正午 · 林隙暖阳';
  if (h >= 16.0 && h < 19.5) return '黄昏 · 暮色残照';
  return '深夜 · 幽谷月华';
}

export function createSettingsPanel({ post, dayNight, animations }) {
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
      border: 1px solid rgba(220, 235, 224, 0.28);
      background: radial-gradient(circle at 32% 28%, rgba(46, 68, 56, 0.92), rgba(18, 28, 23, 0.95));
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45), inset 0 1px 1px rgba(255, 255, 255, 0.18);
      color: #e6efe8;
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
      border-color: rgba(217, 72, 46, 0.72);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55), 0 0 12px rgba(208, 62, 38, 0.35);
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
      width: 310px;
      padding: 16px 18px;
      border-radius: 18px;
      background: rgba(16, 25, 21, 0.86);
      border: 1px solid rgba(200, 222, 208, 0.18);
      box-shadow: 0 16px 42px rgba(0, 0, 0, 0.58), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      color: #dfeae2;
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
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .torii-panel-title {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: #f0f5f1;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .torii-panel-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #d8432e;
      box-shadow: 0 0 8px rgba(216, 67, 46, 0.8);
    }
    .torii-panel-badge {
      font-size: 11px;
      color: #9cb8a5;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 8px;
      border-radius: 999px;
    }
    .torii-presets {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 5px;
      margin-bottom: 12px;
    }
    .torii-preset-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #c9d8cd;
      border-radius: 8px;
      padding: 5px 0;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.18s ease;
    }
    .torii-preset-btn:hover {
      background: rgba(255, 255, 255, 0.13);
      color: #ffffff;
    }
    .torii-preset-btn.active {
      background: rgba(208, 64, 42, 0.28);
      border-color: rgba(224, 82, 58, 0.75);
      color: #fff5f2;
      font-weight: 600;
    }
    .torii-row {
      margin-bottom: 10px;
    }
    .torii-row-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
      color: #b8ccc0;
      margin-bottom: 4px;
    }
    .torii-row-val {
      font-variant-numeric: tabular-nums;
      color: #e4efe7;
      font-size: 11px;
    }
    .torii-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 5px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
      outline: none;
      cursor: pointer;
    }
    .torii-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: #e8f2ec;
      border: 2px solid #d44732;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
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
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      gap: 8px;
    }
    .torii-toggle-btn, .torii-reset-btn {
      flex: 1;
      padding: 6px 10px;
      border-radius: 9px;
      font-size: 11.5px;
      cursor: pointer;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.07);
      color: #d6e4da;
      transition: all 0.18s ease;
    }
    .torii-toggle-btn.active {
      background: rgba(68, 138, 96, 0.34);
      border-color: rgba(110, 196, 142, 0.68);
      color: #edfff3;
    }
    .torii-toggle-btn:hover, .torii-reset-btn:hover {
      background: rgba(255, 255, 255, 0.15);
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

  // 顶部标题栏
  const header = document.createElement('div');
  header.className = 'torii-panel-header';
  const title = document.createElement('div');
  title.className = 'torii-panel-title';
  const dot = document.createElement('span');
  dot.className = 'torii-panel-dot';
  const titleText = document.createElement('span');
  titleText.textContent = '神社境域 · 氛围与光影控制';
  title.appendChild(dot);
  title.appendChild(titleText);

  const badge = document.createElement('div');
  badge.className = 'torii-panel-badge';
  badge.textContent = periodBadge(10.5);
  header.appendChild(title);
  header.appendChild(badge);
  panel.appendChild(header);

  // 时段快捷预设行
  const presetsWrap = document.createElement('div');
  presetsWrap.className = 'torii-presets';
  const presetDefs = [
    { id: 'default', label: '雨后默认', hour: 10.5 },
    { id: 'midnight', label: '深夜', hour: 0.0 },
    { id: 'dawn', label: '清晨', hour: 6.0 },
    { id: 'noon', label: '正午', hour: 13.0 },
    { id: 'dusk', label: '黄昏', hour: 18.0 }
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
    label: '昼夜时刻（日照 / 月光过渡）',
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

  // 2) SSAO 闭塞阴影强度
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

  // 3) 分层动态高度雾浓度
  const fogDensityRow = makeSliderRow({
    label: '分层高度雾浓度（低谷浓 / 高处淡）',
    min: 0,
    max: 0.85,
    step: 0.01,
    value: POST.heightFog.density,
    onInput: (v) => {
      if (dayNight) dayNight.setFogOverride(v);
      if (post) post.setHeightFogDensity(v);
    }
  });

  // 4) 高度雾噪声流动速度
  const fogSpeedRow = makeSliderRow({
    label: '山谷雾气扰动流速',
    min: 0,
    max: 0.8,
    step: 0.01,
    value: POST.heightFog.speed,
    onInput: (v) => {
      if (post) post.setFogSpeed(v);
    }
  });

  // 5) 鸟居焦点景深 DOF 强度
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

  // 6) Bloom 辉光强度
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

  // 7) 植被与注连绳纸垂微风摆动强度
  const windRow = makeSliderRow({
    label: '林木与注连绳纸垂微风摆幅',
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

  // 底部按钮栏：自动昼夜循环 + 一键恢复默认基准
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
    updateCycleBtn();
    highlightPreset('default');
    timeRow.setValue(10.5);
    ssaoRow.setValue(1.0);
    fogDensityRow.setValue(0.24);
    fogSpeedRow.setValue(0.35);
    dofRow.setValue(1.0);
    bloomRow.setValue(0.24);
    windRow.setValue(1.0);
    if (post) {
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
      if (post) {
        fogDensityRow.setValue(post.passes.ssaoFog.material.uniforms.uFogDensity.value);
        bloomRow.setValue(post.passes.composite.material.uniforms.uBloomStrength.value);
      }
    });
  }

  // 右下角圆球形设置按钮
  const orbBtn = document.createElement('button');
  orbBtn.type = 'button';
  orbBtn.className = 'torii-orb-btn';
  orbBtn.title = '展开/收起光影与昼夜设置';
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
