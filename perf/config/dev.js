// ============================================================
// perf/config/dev.js
// 开发环境配置（覆盖 base.js 的默认值）
// ============================================================
import { baseConfig } from './base.js';

export const devConfig = {
  ...baseConfig,
  environments: {
    ...baseConfig.environments,
    dev: {
      baseUrl: 'http://localhost:8000',
      database: 'postgres://demo:demo123@localhost:5432/demo',
      redisUrl: 'redis://localhost:6379/0',
    },
  },
  // 开发环境阈值可以更宽松
  thresholds: {
    ...baseConfig.thresholds,
    smoke: {
      http_req_duration: ['p(95)<1000'],
      http_req_failed: ['rate<0.1'],
    },
  },
};

export default devConfig;
