// ============================================================
// k6 公共配置
// 使用方式：k6 run -e BASE_URL=http://prod.example.com perf/scripts/xxx.js
// 脚本内用 __ENV.BASE_URL || CONFIG.BASE_URL 读默认值
// ============================================================

export const CONFIG = {
  // ---- 被测地址 ----
  BASE_URL: 'http://localhost:8000',

  // ---- 默认压测参数（可被 -e 参数覆盖） ----
  DEFAULT_VUS: 20,
  DEFAULT_DURATION: '1m',
  DEFAULT_THRESHOLDS: {
    // 默认只校验功能正确性，性能阈值由各脚本自行定义
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  },

  // ---- 常用 VU / duration 快捷值 ----
  QUICK: { vus: 5, duration: '10s' },      // 冒烟
  REGULAR: { vus: 20, duration: '1m' },     // 日常回归
  STRESS: { vus: 50, duration: '3m' },      // 压力
  SOAK: { vus: 10, duration: '30m' },       // 稳定性
  SPIKE_PEAK: { vus: 200, duration: '1m' }, // 尖峰
};

// ---- 辅助函数：从 __ENV 或 CONFIG 取值 ----
export function envOr(key, fallback) {
  if (__ENV[key] !== undefined && __ENV[key] !== '') return __ENV[key];
  return fallback;
}

// ---- 统一生成 k6 options.scenarios 中的 constant-vus 条目 ----
export function constantVus({ vus, duration, executor = 'constant-vus' }) {
  return { executor, vus: Number(vus), duration };
}
