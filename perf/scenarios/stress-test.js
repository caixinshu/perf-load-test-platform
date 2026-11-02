// ============================================================
// perf/scenarios/stress-test.js
// 压力测试 - 持续递增并发，寻找系统极限
// 用法: k6 run scenarios/stress-test.js -e ENV=dev
// ============================================================
import { getScenario, getThresholds, currentEnv } from '../config/base.js';
import { initHttp, apiGet, apiPost } from '../lib/http.js';
import { assertSuccess, randomInt } from '../lib/utils.js';
import { sleep } from 'k6';

export const options = {
  ...getScenario('stress'),
  thresholds: getThresholds('stress'),
};

initHttp(currentEnv());

export default function () {
  const id = randomInt(1, 100);
  const res = Math.random() < 0.5
    ? apiGet(`/products/${id}`)
    : apiPost('/orders', { product_id: id, quantity: randomInt(1, 3) });
  assertSuccess(res);
  sleep(0.5);
}
