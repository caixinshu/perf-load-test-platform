// ============================================================
// 全链路压测脚本（Week 3 Day 18）
//
// 业务模型（混合场景，模拟真实用户行为比例）：
//   - 60% 浏览商品（列表 + 详情）
//   - 25% 下单购买（查商品 + 创建订单）
//   - 15% 查询订单
//
// 压测策略：阶梯式加压 100 → 200 VU，观察系统在不同负载下的表现
// ============================================================
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const GATEWAY_URL = __ENV.GATEWAY_URL || 'http://api-gateway:8000';

export const options = {
  stages: [
    { duration: '1m', target: 100 },   // 爬升：100 VU
    { duration: '3m', target: 100 },   // 稳定负载
    { duration: '1m', target: 200 },   // 加压到 200 VU
    { duration: '2m', target: 200 },   // 高压稳定
    { duration: '1m', target: 0 },     // 下降
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],   // 95分位 < 800ms
    http_req_failed: ['rate<0.03'],     // 错误率 < 3%
  },
  tags: {
    test_name: 'full-link-load-test',
  },
};

export default function () {
  const rand = Math.random();

  // 60% - 浏览商品
  if (rand < 0.6) {
    group('浏览商品', function () {
      // 列表页
      const page = randomIntBetween(1, 5);
      const listRes = http.get(`${GATEWAY_URL}/products?page=${page}&page_size=20`, {
        tags: { name: 'listProducts', scenario: 'browse' },
      });
      check(listRes, {
        '商品列表状态码200': (r) => r.status === 200,
      });
      sleep(1 + Math.random());

      // 详情页
      const productId = randomIntBetween(1, 100);
      const detailRes = http.get(`${GATEWAY_URL}/products/${productId}`, {
        tags: { name: 'getProduct', scenario: 'browse' },
      });
      check(detailRes, {
        '商品详情状态码200': (r) => r.status === 200,
      });
      sleep(0.5 + Math.random());
    });
  }
  // 25% - 下单购买
  else if (rand < 0.85) {
    group('下单购买', function () {
      // 先看商品详情
      const productId = randomIntBetween(1, 50);
      const detailRes = http.get(`${GATEWAY_URL}/products/${productId}`, {
        tags: { name: 'getProduct', scenario: 'order' },
      });
      check(detailRes, {
        '下单前查商品200': (r) => r.status === 200,
      });
      sleep(0.5);

      // 创建订单
      const qty = randomIntBetween(1, 3);
      const payload = JSON.stringify({
        product_id: productId,
        quantity: qty,
      });
      const orderRes = http.post(`${GATEWAY_URL}/orders`, payload, {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'createOrder', scenario: 'order' },
      });
      check(orderRes, {
        '下单状态码200': (r) => r.status === 200,
        '下单返回order_id': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.order_id > 0;
          } catch (e) {
            return false;
          }
        },
      });
      sleep(2 + Math.random());
    });
  }
  // 15% - 查询订单
  else {
    group('查询订单', function () {
      const orderId = randomIntBetween(1, 500);
      const orderRes = http.get(`${GATEWAY_URL}/orders/${orderId}`, {
        tags: { name: 'getOrder', scenario: 'query' },
      });
      check(orderRes, {
        '查订单状态码200/404': (r) => r.status === 200 || r.status === 404,
      });
      sleep(1 + Math.random());
    });
  }
}
