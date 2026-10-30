// perf/scripts/baseline.js
// Day 4 步骤3：基准测试脚本
// 目的：用稳定配置（10 VU / 1 分钟）跑多次，取稳定值作为性能基线，
//      后续任何优化都和这个基线对比，判断优化是否真的有效。
//
// 为什么要跑 3 次：
//   性能测试有天然波动（GC、系统调度、网络抖动），单次结果有偶然性。
//   连续 3 次结果接近（偏差 <10%），说明数据稳定，可作为基线。

import http from 'k6/http';
import { check, sleep } from 'k6';

// 基准测试不设过严阈值，只设合理上限，避免基线数据本身被门禁误判
export const options = {
  vus: 10,
  duration: '1m',
  thresholds: {
    http_req_failed: ['rate<0.05'], // 失败率 < 5%（基准期放宽，便于发现真实错误）
    checks: ['rate>0.95'],
  },
};

// 支持环境变量覆盖被测地址
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  // 1. 健康检查（最轻量，纯读，无数据库写）
  const health = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
  check(health, { 'health 返回 200': (r) => r.status === 200 });
  sleep(0.5);

  // 2. 查询商品列表（读接口，涉及 SQLite 查询）
  const list = http.get(`${BASE_URL}/items`, { tags: { name: 'listItems' } });
  check(list, { '列表返回 200': (r) => r.status === 200 });
  sleep(1);

  // 3. 创建商品（写接口，涉及 SQLite 插入 + 提交）
  const payload = JSON.stringify({
    name: `baseline_${Date.now()}`,
    price: 9.9,
  });
  const create = http.post(`${BASE_URL}/items`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'createItem' },
  });
  check(create, { '创建返回 200': (r) => r.status === 200 });
  sleep(1);
}
