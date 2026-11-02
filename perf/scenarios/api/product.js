// ============================================================
// perf/scenarios/api/product.js
// 商品接口 CRUD 场景
// 用法: k6 run scenarios/api/product.js -e ENV=dev
// ============================================================
import { getScenario, getThresholds, currentEnv } from '../../config/base.js';
import { initHttp, apiGet, apiPost, apiPut, apiDel } from '../../lib/http.js';
import { assertSuccess, randomInt, randomString } from '../../lib/utils.js';
import { sleep } from 'k6';

export const options = {
  ...getScenario('load'),
  thresholds: getThresholds('load'),
};

initHttp(currentEnv());

export default function () {
  const r = Math.random();

  if (r < 0.5) {
    // 读
    assertSuccess(apiGet(`/products/${randomInt(1, 100)}`));
  } else if (r < 0.75) {
    // 列表
    assertSuccess(apiGet('/products'));
  } else if (r < 0.9) {
    // 新增
    const body = {
      name: `prod-${randomString(6)}`,
      price: randomInt(10, 1000),
      stock: randomInt(1, 100),
    };
    assertSuccess(apiPost('/products', body));
  } else {
    // 更新/删除（少量）
    const id = randomInt(1, 100);
    if (Math.random() < 0.5) {
      apiPut(`/products/${id}`, { price: randomInt(10, 1000) });
    } else {
      apiDel(`/products/${id}`);
    }
  }

  sleep(1);
}
