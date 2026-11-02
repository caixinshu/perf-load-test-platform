// ============================================================
// perf/scenarios/baseline.js
// 基准性能测试 - 低负载，确认系统基线指标
// 用法: k6 run scenarios/baseline.js -e ENV=dev
// ============================================================
import { getScenario, getThresholds, currentEnv } from '../config/base.js';
import { initHttp, apiGet } from '../lib/http.js';
import { assertSuccess } from '../lib/utils.js';
import { sleep } from 'k6';

export const options = {
  ...getScenario('baseline'),
  thresholds: getThresholds('smoke'),
};

initHttp(currentEnv());

export default function () {
  const res = apiGet('/products/1');
  assertSuccess(res);
  sleep(1);
}
