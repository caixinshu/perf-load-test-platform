// ============================================================
// perf/scenarios/api/order.js
// 订单接口场景 - 下单 + 查单
// 用法: k6 run scenarios/api/order.js -e ENV=dev
// ============================================================
import { getScenario, getThresholds, currentEnv } from '../../config/base.js';
import { initHttp, apiGet, apiPost } from '../../lib/http.js';
import { assertSuccess, randomInt } from '../../lib/utils.js';
import { sleep } from 'k6';

export const options = {
  ...getScenario('load'),
  thresholds: getThresholds('load'),
};

initHttp(currentEnv());

export default function () {
  const r = Math.random();

  if (r < 0.7) {
    // 下单
    const order = {
      product_id: randomInt(1, 100),
      quantity: randomInt(1, 5),
    };
    assertSuccess(apiPost('/orders', order));
  } else {
    // 查单
    assertSuccess(apiGet(`/orders/${randomInt(1, 50)}`));
  }

  sleep(1);
}
