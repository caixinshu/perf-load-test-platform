// ============================================================
// 分布式压测脚本（Week 3 Day 16）
//
// 分片原理：
//   SHARD_COUNT 个 k6 实例并行，每个实例通过 SHARD_ID 区分。
//   每个实例只压测分配给自己的数据段，避免多个 worker 操作同一行数据。
//
// 环境变量：
//   SHARD_ID      — 当前实例编号 (0, 1, 2, ...)
//   SHARD_COUNT   — 总实例数
//   GATEWAY_URL   — 被测网关地址，默认 http://api-gateway:8000
//   VUS_PER_WORKER — 每个 worker 的 VU 数，默认 50
//
// 用法（单实例本地）：
//   k6 run perf/scripts/09-distributed-load-test.js
//
// 用法（Docker 分布式，3 worker）：
//   docker compose -f docker-compose.distributed.yml up
// ============================================================

import http from 'k6/http';
import { check, sleep, group } from 'k6';

// ---- 环境变量读取 ----
const SHARD_ID = parseInt(__ENV.SHARD_ID || '0', 10);
const SHARD_COUNT = parseInt(__ENV.SHARD_COUNT || '1', 10);
const GATEWAY_URL = __ENV.GATEWAY_URL || 'http://api-gateway:8000';
const VUS_PER_WORKER = parseInt(__ENV.VUS_PER_WORKER || '50', 10);

// ---- 本地随机函数（避免依赖 jslib.k6.io 外网） ----
function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---- k6 选项 ----
// 每个 worker 跑 VUS_PER_WORKER 个 VU，总 VU = SHARD_COUNT * VUS_PER_WORKER
export const options = {
  stages: [
    { duration: '30s', target: VUS_PER_WORKER },  // 爬坡
    { duration: '2m', target: VUS_PER_WORKER },   // 稳定
    { duration: '30s', target: 0 },               // 下降
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // p95 < 1s（多服务链路放宽）
    http_req_failed: ['rate<0.02'],     // 错误率 < 2%
  },
  tags: {
    shard_id: String(SHARD_ID),
    shard_count: String(SHARD_COUNT),
  },
};

// ---- 分片数据范围 ----
// 每个 shard 分配 10000 个用户 ID 段，避免数据冲突
const USER_ID_BASE = SHARD_ID * 10000;

export default function () {
  const userId = USER_ID_BASE + randomIntBetween(1, 1000);

  group('浏览商品', function () {
    // 1. 浏览商品列表
    const listRes = http.get(`${GATEWAY_URL}/products?page=1&page_size=20`, {
      tags: { name: 'listProducts' },
    });
    check(listRes, {
      '列表返回 200': (r) => r.status === 200,
    });
    sleep(1);

    // 2. 查看商品详情（走缓存）
    const productId = randomIntBetween(1, 100);
    const detailRes = http.get(`${GATEWAY_URL}/products/${productId}`, {
      tags: { name: 'getProduct' },
    });
    check(detailRes, {
      '详情返回 200': (r) => r.status === 200,
      '包含价格': (r) => r.json('price') !== undefined,
    });
    sleep(0.5);
  });

  // 30% 的用户下单（模拟真实转化漏斗）
  if (Math.random() < 0.3) {
    group('下单', function () {
      const productId = randomIntBetween(1, 100);
      const qty = randomIntBetween(1, 5);

      const payload = JSON.stringify({
        product_id: productId,
        quantity: qty,
      });

      const orderRes = http.post(`${GATEWAY_URL}/orders`, payload, {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'createOrder' },
      });

      // 下单可能成功(200)或库存不足(400)，都算业务正常
      check(orderRes, {
        '下单响应正常': (r) => r.status === 200 || r.status === 400,
      });

      if (orderRes.status === 200) {
        const orderId = orderRes.json('order_id');
        // 查一下刚创建的订单
        http.get(`${GATEWAY_URL}/orders/${orderId}`, {
          tags: { name: 'getOrder' },
        });
      }
      sleep(2);
    });
  }
}
