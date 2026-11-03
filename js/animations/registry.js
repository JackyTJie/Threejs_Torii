// 动画注册表（S7.1）：全部动态效果走同一条驱动循环。
//
// 约定：本模块不直接调用 requestAnimationFrame（浏览器 API 只允许出现在入口 /
// 渲染层，见 tools/validate.mjs 的 DOM 白名单）。入口 js/main.js 在自己的
// requestAnimationFrame 回调里调用 stepAnimations(deltaSeconds)，本模块负责
// 时间累积、delta 夹紧与逐条动画的有序调度。
//
// 动画参数一律来自 js/config.js 的 ANIM，模块内不硬编码强度。
import { ANIM } from '../config.js';

/** 单帧最大步进：切换标签页 / 断点后不补算大跳帧，避免落叶瞬移、水面跳波 */
const MAX_DELTA = 1 / 20;

/** 已注册动画：插入顺序即执行顺序 */
const entries = new Map();

/** 全局动画时钟（秒） */
let elapsed = 0;
let frameCount = 0;

/**
 * 注册一条动画。
 * @param {string} name 动画名（唯一，重复注册视为覆盖并保留原顺序）
 * @param {(ctx:{time:number,delta:number,frame:number,anim:object})=>void} update 每帧更新
 * @param {{enabled?:boolean}} options 初始开关
 * @returns {object} 动画条目（可用 setAnimationEnabled 单独关闭）
 */
export function registerAnimation(name, update, options = {}) {
  if (typeof update !== 'function') throw new Error(`registerAnimation(${name}): update 必须是函数`);
  const existing = entries.get(name);
  const entry = existing || { name, enabled: options.enabled !== false, lastError: null };
  entry.update = update;
  if (options.enabled !== undefined) entry.enabled = options.enabled !== false;
  entries.set(name, entry);
  return entry;
}

/** 注销一条动画（动画模块单独卸载时用） */
export function unregisterAnimation(name) {
  return entries.delete(name);
}

/** 单独开关某条动画（调校 / 排查时定位问题用） */
export function setAnimationEnabled(name, enabled) {
  const entry = entries.get(name);
  if (!entry) return false;
  entry.enabled = !!enabled;
  return true;
}

export function isAnimationEnabled(name) {
  const entry = entries.get(name);
  return !!entry && entry.enabled;
}

/** 已注册动画清单（名称 + 开关状态） */
export function listAnimations() {
  return [...entries.values()].map(({ name, enabled }) => ({ name, enabled }));
}

/** 全局动画时钟（秒），供需要绝对时间的模块（如光斑相位对齐）读取 */
export function animationElapsed() {
  return elapsed;
}

/** 清空全部动画并复位时钟（重建场景时用） */
export function clearAnimations() {
  entries.clear();
  elapsed = 0;
  frameCount = 0;
}

/**
 * 推进一帧：按注册顺序执行全部启用的动画。
 * 单条动画抛错只影响该条，不会中断整条循环（记录在 entry.lastError）。
 * @param {number} deltaSeconds 距上一帧的秒数
 * @returns {{frame:number,time:number,ran:number,errors:string[]}}
 */
export function stepAnimations(deltaSeconds) {
  const delta = Math.max(0, Math.min(MAX_DELTA, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
  elapsed += delta;
  frameCount += 1;
  const context = { time: elapsed, delta, frame: frameCount, anim: ANIM };
  const errors = [];
  let ran = 0;
  for (const entry of entries.values()) {
    if (!entry.enabled) continue;
    try {
      entry.update(context);
      ran += 1;
    } catch (error) {
      entry.lastError = error;
      errors.push(`${entry.name}: ${error.message}`);
    }
  }
  return { frame: frameCount, time: elapsed, ran, errors };
}

/** 风阵调制（ANIM.treeSway 同源）：所有「微风」类动画共用同一阵风曲线 */
export function windGustFactor(time) {
  const { windGust, windGustPeriod } = ANIM.treeSway;
  // 两个不同周期的正弦叠加，避免可感知的严格周期重复
  const slow = Math.sin((time / windGustPeriod) * Math.PI * 2);
  const fast = Math.sin((time / (windGustPeriod * 0.618) + 1.7) * Math.PI * 2);
  return 1 + windGust * (slow * 0.7 + fast * 0.3);
}
