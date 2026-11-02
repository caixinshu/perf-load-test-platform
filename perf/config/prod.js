// ============================================================
// perf/config/prod.js
// 生产环境配置
// 注意：生产环境阈值更严格，且 baseUrl 指向真实生产地址
// ============================================================
import { baseConfig } from './base.js';

export const prodConfig = {
  ...baseConfig,
  environments: {
    ...baseConfig.environments,
    prod: {
      baseUrl: 'https://api.example.com',
      database: 'postgres://demo:demo123@prod-db:5432/demo',
      redisUrl: 'redis://prod-redis:6379/0',
    },
  },
  // 生产环境阈值最严格
  thresholds: {
    ...baseConfig.thresholds,
    load: {
      http_req_duration: ['p(95)<200', 'p(99)<500'],
      http_req_failed: ['rate<0.005'],
    },
  },
};

export default prodConfig;
