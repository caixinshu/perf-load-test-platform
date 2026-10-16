// perf/scripts/05-soak-test.js
// Day 5：稳定性测试（Soak Test，又叫"浸泡测试"）
// 目的：用中等负载"长时间"运行，发现短时测试看不出来的"慢性病"：
//       内存泄漏、连接泄漏、句柄泄漏、响应时间随时间缓慢上升、数据量累积导致的退化。
//
// 为什么必须跑得久：
//   内存泄漏是"每个请求漏一点点"，跑 1 分钟看不出来，跑几小时就会 OOM；
//   连接泄漏同理，短跑完全暴露不出问题。
//
// 时长策略：本地学习用 10 分钟（默认），正式环境跑数小时甚至整夜。
//          可用环境变量覆盖：k6 run -e SOAK_DURATION=30m perf/scripts/05-soak-test.js

import http from 'k6/http';
import { check, sleep } from 'k6';

const SOAK_DURATION = __ENV.SOAK_DURATION || '10m';

export const options = {
  vus: 20,               // 恒定中等负载：并发不高，靠"时间长度"暴露问题
  duration: SOAK_DURATION,
  thresholds: {
    // 稳定性测试的阈值通常比负载测试略宽：目标是"别随时间恶化"，不是"极致低延迟"
    http_req_failed: ['rate<0.01'],   // 长时间运行失败率仍 < 1%
    http_req_duration: ['p(95)<800'], // p95 稳定在 800ms 以内
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

export default function () {
  // 混合读写：读为主，掺入少量写，模拟真实用户的长期使用
  const list = http.get(`${BASE_URL}/items`, { tags: { name: 'listItems' } });
  check(list, { 'listItems 200': (r) => r.status === 200 });
  sleep(1);

  const payload = JSON.stringify({ name: `soak_${randomString(6)}`, price: 5.5 });
  const create = http.post(`${BASE_URL}/items`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'createItem' },
  });
  check(create, { 'createItem 200': (r) => r.status === 200 });
  sleep(4);
}
