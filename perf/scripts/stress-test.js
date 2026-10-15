// perf/scripts/stress-test.js
// Day 4 步骤4：压力测试脚本
// 目的：阶梯式加压（50 -> 100 -> 200 -> 300 -> 500 VU），找到系统的性能天花板。
// 压力测试不设阈值，目的是"看系统能撑到哪里"，而不是"门禁通过"。
//
// 观察三个拐点：
//   1. 响应时间拐点：在哪个 VU 级别，p(95) 开始急剧上升？
//   2. 错误率拐点：在哪个 VU 级别，http_req_failed 开始飙升？
//   3. 吞吐量拐点：在哪个 VU 级别，增加 VU 但 TPS 不再涨（到达极限）？

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // 阶梯加压：每级 1 分钟，逐步逼近极限
  stages: [
    { duration: '1m', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '1m', target: 200 },
    { duration: '1m', target: 300 },
    { duration: '1m', target: 500 },
    { duration: '30s', target: 0 }, // 恢复期：压垮后观察能否恢复
  ],
  // 故意不设 thresholds：压力测试就是要看系统在多高负载下开始出问题
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  // 只测纯读接口，排除写操作的影响，单独定位读路径的极限
  const res = http.get(`${BASE_URL}/items`, { tags: { name: 'listItems' } });
  check(res, { 'status 200': (r) => r.status === 200 });
  // 不加 sleep，让 VU 持续满负荷发请求，最大限度施压
}
