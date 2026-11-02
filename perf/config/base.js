// ============================================================
// perf/config/base.js
// 性能测试框架 - 基础配置
// 包含：环境配置、多级阈值、场景参数
// 使用：import { getEnv, getThresholds, getScenario } from './base.js';
// ============================================================

export const baseConfig = {
  // 环境配置
  environments: {
    dev: {
      baseUrl: 'http://localhost:8000',
      database: 'postgres://demo:demo123@localhost:5432/demo',
      redisUrl: 'redis://localhost:6379/0',
    },
    staging: {
      baseUrl: 'https://staging-api.example.com',
      database: 'postgres://demo:demo123@staging-db:5432/demo',
      redisUrl: 'redis://staging-redis:6379/0',
    },
    prod: {
      baseUrl: 'https://api.example.com',
      database: 'postgres://demo:demo123@prod-db:5432/demo',
      redisUrl: 'redis://prod-redis:6379/0',
    },
  },

  // 性能阈值（按场景级别）
  thresholds: {
    // 冒烟级（PR 门禁用，宽松）
    smoke: {
      http_req_duration: ['p(95)<500'],
      http_req_failed: ['rate<0.05'],
    },
    // 负载级（正常业务）
    load: {
      http_req_duration: ['p(95)<300', 'p(99)<800'],
      http_req_failed: ['rate<0.01'],
    },
    // 压力级（极限情况，更宽松）
    stress: {
      http_req_duration: ['p(95)<1000'],
      http_req_failed: ['rate<0.05'],
    },
  },

  // 场景配置
  scenarios: {
    baseline: { vus: 10, duration: '1m' },
    load: {
      stages: [
        { duration: '30s', target: 50 },
        { duration: '2m', target: 50 },
        { duration: '30s', target: 0 },
      ],
    },
    stress: {
      stages: [
        { duration: '1m', target: 100 },
        { duration: '1m', target: 200 },
        { duration: '1m', target: 300 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 0 },
      ],
    },
    soak: { vus: 20, duration: '2h' },
  },
};

/**
 * 获取环境配置
 * @param {string} env - 环境名 (dev/staging/prod)
 * @returns {object} 环境配置
 */
export function getEnv(env = 'dev') {
  return baseConfig.environments[env] || baseConfig.environments.dev;
}

/**
 * 获取阈值配置
 * @param {string} level - 级别 (smoke/load/stress)
 * @returns {object} 阈值配置
 */
export function getThresholds(level = 'load') {
  return baseConfig.thresholds[level] || baseConfig.thresholds.load;
}

/**
 * 获取场景配置
 * @param {string} name - 场景名 (baseline/load/stress/soak)
 * @returns {object} 场景配置
 */
export function getScenario(name = 'baseline') {
  return baseConfig.scenarios[name] || baseConfig.scenarios.baseline;
}

/**
 * 从环境变量获取当前环境
 * k6 运行时用 -e ENV=staging 传入
 */
export function currentEnv() {
  return __ENV.ENV || 'dev';
}

export default baseConfig;
