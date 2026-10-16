// perf/scripts/03-smoke-test.js
// Day 5：冒烟测试（Smoke Test）
// 目的：用极小负载（1 VU）快速走通全部接口，先自检"脚本没写错、服务是活的"，
//      再去做负载/压力测试。否则可能把"脚本参数写错"误判成"系统性能差"。
// 特点：低负载、短时长、覆盖全部接口、阈值严格（必须全绿）。
//
// 关键点：用 scenarios 的 per-vu-iterations executor —— 固定跑 N 次迭代，
//        而不是按时间跑，保证每个接口都被确定地执行到。

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    smoke: {
      // executor: 一个 VU 跑固定次数的迭代，跑完即结束——最适合冒烟
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 5, // 1 个 VU × 5 次迭代
    },
  },
  // 冒烟必须全绿：出现任何失败都说明脚本或服务有问题，立刻停下来排查
  thresholds: {
    http_req_failed: ['rate<0.01'], // 失败率 < 1%
    checks: ['rate>0.99'],          // 断言通过率 > 99%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

// 自包含随机字符串生成（不依赖在线 CDN，避免 TLS 握手超时，见 docs/07）
function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function () {
  // 1. 健康检查（最轻量，验证服务活着）
  const health = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
  check(health, { 'health 返回 200': (r) => r.status === 200 });
  sleep(0.2);

  // 2. 列表查询（读接口）
  const list = http.get(`${BASE_URL}/items`, { tags: { name: 'listItems' } });
  check(list, {
    '列表返回 200': (r) => r.status === 200,
    '列表返回是数组': (r) => {
      try {
        return Array.isArray(JSON.parse(r.body));
      } catch (e) {
        return false;
      }
    },
  });
  sleep(0.2);

  // 3. 创建商品（写接口）
  const payload = JSON.stringify({ name: `smoke_${randomString(6)}`, price: 9.9 });
  const create = http.post(`${BASE_URL}/items`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'createItem' },
  });
  check(create, { '创建返回 200': (r) => r.status === 200 });
  sleep(0.2);

  // 4. 按 id 查询刚创建的商品（验证写读链路连通）
  let itemId = null;
  try {
    itemId = JSON.parse(create.body).id;
  } catch (e) {
    itemId = null;
  }
  const getOne = http.get(`${BASE_URL}/items/${itemId}`, { tags: { name: 'getItemById' } });
  check(getOne, { '查询单个商品返回 200': (r) => r.status === 200 });
}
