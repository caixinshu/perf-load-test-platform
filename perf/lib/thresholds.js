// ============================================================
// perf/lib/thresholds.js
// 阈值管理 - 基于场景级别生成 k6 thresholds
// 职责：从 config/base.js 读取阈值定义，组合/覆写后输出
// ============================================================
import { getThresholds } from '../config/base.js';

/**
 * 获取指定级别的阈值配置
 * @param {string} level - smoke / load / stress
 * @returns {object} k6 thresholds 配置
 */
export function thresholdsFor(level) {
  return getThresholds(level);
}

/**
 * 合并默认阈值与自定义阈值
 * @param {string} level - 基础级别
 * @param {object} overrides - 自定义阈值（会覆盖同名字段）
 * @returns {object} 合并后的 thresholds
 */
export function thresholdsWithOverrides(level, overrides = {}) {
  const base = getThresholds(level);
  return { ...base, ...overrides };
}

/**
 * 严格阈值（用于性能门禁 CI）
 * 比 load 级别更严格
 */
export function strictThresholds() {
  return {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.005'],
  };
}

/**
 * 宽松阈值（用于预发环境冒烟）
 */
export function looseThresholds() {
  return {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.1'],
  };
}

export default { thresholdsFor, thresholdsWithOverrides, strictThresholds, looseThresholds };
