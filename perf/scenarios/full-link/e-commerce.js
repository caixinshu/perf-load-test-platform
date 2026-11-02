// ============================================================
// perf/scenarios/full-link/e-commerce.js
// 电商全链路压测 - 浏览(60%) / 下单(25%) / 查单(15%)
// 用法: k6 run scenarios/full-link/e-commerce.js -e ENV=dev
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

  if (r < 0.6) {
    // 浏览商品列表 + 详情
    assertSuccess(apiGet('/products'));
    assertSuccess(apiGet(`/products/${randomInt(1, 100)}`));
  } else if (r < 0.85) {
    // 下单
    const order = {
      product_id: randomInt(1, 100),
      quantity: randomInt(1, 5),
    };
    assertSuccess(apiPost('/orders', order));
  } else {
    // 查询订单
    assertSuccess(apiGet(`/orders/${randomInt(1, 50)}`));
  }

  sleep(1);
}
