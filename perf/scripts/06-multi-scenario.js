// perf/scripts/06-multi-scenario.js
// Day 5：多场景组合压测（k6 scenarios + 多种 executor）
// 目的：用一个脚本同时模拟"多类真实流量"，而不是只压一个接口、一种节奏。
//      真实系统里，浏览（高频读）、下单（低频写）、健康探针（固定并发）是并存的。
//
// 核心技能 —— k6 的 scenarios + executor：
//   k6 提供 7 种 executor（执行器），不同 executor 决定"负载以什么方式施加"：
//     - constant-vus          ：固定并发数           —— 探针/长连接/恒定负载
//     - ramping-vus           ：VU 按曲线增减        —— 模拟用户逐渐到来/离开
//     - per-vu-iterations     ：每 VU 跑固定次数      —— 冒烟
//     - shared-iterations     ：多 VU 共享总次数      —— 一次性跑完
//     - constant-arrival-rate ：每秒发起固定请求数    —— 与 VU 数解耦，稳定压 TPS
//     - ramping-arrival-rate  ：每秒请求数按曲线增减  —— 精确控制到达率
//     - externally-controlled ：外部实时控制（如 HTTP API 动态调 VU）
//
// 本脚本用 3 种 executor 覆盖 3 类流量，并给每个场景打 scenario 标签，
// 从而可以对"不同场景"分别设置阈值 —— 这是多场景压测的关键能力。

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    // 场景 A：浏览（高频读）—— 用 constant-arrival-rate 精确控制"每秒 20 个请求"
    browse: {
      executor: 'constant-arrival-rate',
      rate: 20,          // 每秒发起 20 次请求
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 20, // 预分配 VU
      maxVUs: 60,          // 必要时最多扩到 60（到达率跟不上时 k6 自动加 VU）
      exec: 'browse',
      tags: { scenario: 'browse' }, // 场景标签：用于按场景过滤指标/设阈值
    },
    // 场景 B：下单（低频写）—— 用 ramping-vus 让 VU 数缓慢变化
    write: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 5 },  // 写请求慢慢爬升
        { duration: '30s', target: 10 },
        { duration: '15s', target: 0 },
      ],
      exec: 'write',
      tags: { scenario: 'write' },
    },
    // 场景 C：健康探针（固定并发）—— 模拟监控系统持续探测
    health: {
      executor: 'constant-vus',
      vus: 2,
      duration: '1m',
      exec: 'healthCheck',
      tags: { scenario: 'health' },
    },
  },

  // 按场景分别设阈值：不同场景的质量目标本就不同
  thresholds: {
    'http_req_duration{scenario:browse}': ['p(95)<500'],  // 浏览要快
    'http_req_failed{scenario:health}': ['rate<0.01'],    // 探针几乎不许失败
    'http_req_failed{scenario:write}': ['rate<0.1'],      // 写路径受 SQLite 锁影响，放宽
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ===== 场景 A：浏览商品列表 =====
export function browse() {
  const res = http.get(`${BASE_URL}/items`, { tags: { name: 'listItems' } });
  check(res, { 'browse 返回 200': (r) => r.status === 200 });
  sleep(0.5);
}

// ===== 场景 B：创建商品（写） =====
export function write() {
  const payload = JSON.stringify({ name: `multi_${randomString(6)}`, price: 12.5 });
  const res = http.post(`${BASE_URL}/items`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'createItem' },
  });
  check(res, { 'write 返回 200': (r) => r.status === 200 });
  sleep(1);
}

// ===== 场景 C：健康探针 =====
export function healthCheck() {
  const res = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
  check(res, { 'health 返回 200': (r) => r.status === 200 });
  sleep(2);
}
