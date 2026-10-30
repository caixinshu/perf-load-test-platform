// ============================================================
// 数据库压测脚本（Week 3 Day 19）
//
// 混合场景：
//   - 40% 查询单个商品（走主键索引）
//   - 30% 分页列表（ORDER BY + LIMIT/OFFSET）
//   - 20% 创建商品（写入）
//   - 10% 模糊搜索（LIKE '%xxx%'，无索引，触发慢查询）
//
// 通过网关访问，真实经过 gateway → product-service → db
// ============================================================
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomIntBetween, randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.GATEWAY_URL || 'http://api-gateway:8000';

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // 爬升
    { duration: '2m', target: 100 },   // 稳定
    { duration: '1m', target: 200 },   // 加压
    { duration: '2m', target: 200 },   // 高压
    { duration: '30s', target: 0 },    // 下降
  ],
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    http_req_failed: ['rate<0.05'],
  },
  tags: {
    test_name: 'db-stress-test',
  },
};

export default function () {
  const action = Math.random();

  // 40% - 查询单个商品（走主键索引，最快）
  if (action < 0.4) {
    const id = randomIntBetween(1, 1000);
    const res = http.get(`${BASE_URL}/products/${id}`, {
      tags: { name: 'getById', scenario: 'read' },
    });
    check(res, {
      'getById 状态码200/404': (r) => r.status === 200 || r.status === 404,
    });
  }
  // 30% - 分页列表（ORDER BY + LIMIT/OFFSET）
  else if (action < 0.7) {
    const page = randomIntBetween(1, 50);
    const res = http.get(`${BASE_URL}/products?page=${page}&page_size=100`, {
      tags: { name: 'listPaged', scenario: 'read' },
    });
    check(res, {
      'listPaged 状态码200': (r) => r.status === 200,
    });
  }
  // 20% - 创建商品（写入）
  else if (action < 0.9) {
    const payload = JSON.stringify({
      name: `stress_${randomString(8)}`,
      price: Math.random() * 1000,
      stock: randomIntBetween(1, 1000),
    });
    const res = http.post(`${BASE_URL}/products`, payload, {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'createProduct', scenario: 'write' },
    });
    check(res, {
      'createProduct 状态码200': (r) => r.status === 200,
    });
  }
  // 10% - 模糊搜索（LIKE '%xxx%'，无索引，慢查询）
  else {
    const res = http.get(`${BASE_URL}/products?search=test`, {
      tags: { name: 'searchProduct', scenario: 'slow' },
    });
    check(res, {
      'searchProduct 状态码200': (r) => r.status === 200,
    });
  }

  sleep(0.3);
}
