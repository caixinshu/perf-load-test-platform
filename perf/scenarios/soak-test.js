// ============================================================
// perf/scenarios/soak-test.js
// 稳定性测试 - 长时间低负载，排查内存泄漏/连接泄漏
// 用法: k6 run scenarios/soak-test.js -e ENV=dev
// ============================================================
import { getScenario, getThresholds, currentEnv } from '../config/base.js';
import { initHttp, apiGet } from '../lib/http.js';
import { assertSuccess, randomInt } from '../lib/utils.js';
import { sleep } from 'k6';

export const options = {
  ...getScenario('soak'),
  thresholds: getThresholds('load'),
};

initHttp(currentEnv());

export default function () {
  const id = randomInt(1, 100);
  assertSuccess(apiGet(`/products/${id}`));
  sleep(2);
}
