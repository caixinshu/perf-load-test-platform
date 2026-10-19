// perf/scripts/01-simple-get.js
// Day 2: 第一个 k6 压测脚本（10 VU / 30s，模拟用户浏览商品列表）
// Day 6: 加入性能门禁 thresholds —— 门禁值来自实测基线（见 perf/docs/10_baseline_and_gating.md）
//
// 门禁推导：
//   基线（10 VU / 30s，固定 200 条数据，3 次取稳定值）：p(95) ≈ 26ms，失败率 0%，checks 100%
//   按「基线 × 1.5」应是 39ms，但基线绝对值太小（同脚本三次 p95 波动 20.5→33.3ms），
//   比值法在低延迟场景会被单机噪声淹没，因此叠加"最小容差"：门禁取 100ms（约基线 3.9 倍）。
//   100ms 仍能拦住真实劣化——Day 6 未受控测量中，数据量涨到 1619 条时 p95 会冲到 326ms。

import http from 'k6/http';
import { check, sleep } from 'k6';

// 测试选项
export const options = {
  // 虚拟用户数
  vus: 10,
  // 持续时间
  duration: '30s',

  // 阈值：不满足则 k6 以非零退出码结束，在 CI 中即构成性能门禁
  // 注意：延迟判定只放在 thresholds，checks 只用来判"功能对不对"，
  //      两者混在一起会让 checks 通过率同时受延迟影响，无法定位问题。
  thresholds: {
    http_req_duration: ['p(95)<100'], // 门禁：95% 请求 < 100ms
    http_req_failed: ['rate<0.01'],   // 门禁：请求失败率 < 1%
    checks: ['rate>0.99'],            // 门禁：功能断言通过率 > 99%
  },
};

// 支持通过环境变量覆盖被测地址：k6 run -e BASE_URL=http://host:port xx.js
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

// 默认函数：每个 VU 循环执行
export default function () {
  // 发送 GET 请求
  const res = http.get(`${BASE_URL}/items`, { tags: { name: 'listItems' } });

  // 断言检查（功能正确性）
  check(res, {
    '状态码是 200': (r) => r.status === 200,
    '返回数据是数组': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body);
      } catch (e) {
        return false;
      }
    },
  });

  // 思考时间：模拟用户操作间隔
  sleep(1);
}
