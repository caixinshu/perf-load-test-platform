// ============================================================
// perf/config/staging.js
// 预发环境配置
// ============================================================
import { baseConfig } from './base.js';

export const stagingConfig = {
  ...baseConfig,
  environments: {
    ...baseConfig.environments,
    staging: {
      baseUrl: 'https://staging-api.example.com',
      database: 'postgres://demo:demo123@staging-db:5432/demo',
      redisUrl: 'redis://staging-redis:6379/0',
    },
  },
};

export default stagingConfig;
