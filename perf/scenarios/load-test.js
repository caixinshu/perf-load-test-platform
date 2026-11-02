// ============================================================
// perf/scenarios/load-test.js
// 负载测试 - 阶梯式加压，验证正常业务负载下的表现
// 用法: k6 run scenarios/load-test.js -e ENV=dev
// ============================================================
import { getScenario, getThresholds, currentEnv } from '../config/base.js';
import { initHttp, apiGet, apiPost } from '../lib/http.js';
import { assertSuccess, randomInt } from '../lib/utils.js';
import { sleep } from 'k6';

export const options = {
  ...getScenario('load'),
  thresholds: getThresholds('load'),
};

initHttp(currentEnv());

export default function () {
  // 60% 浏览商品，40% 下单
  if (Math.random() < 0.6) {
    const id = randomInt(1, 100);
    assertSuccess(apiGet(`/products/${id}`));
  } else {
    const id = randomInt(1, 100);
    assertSuccess(apiPost('/orders', { product_id: id, quantity: randomInt(1, 5) }));
  }
  sleep(1);
}
