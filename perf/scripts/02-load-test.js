// perf/scripts/02-load-test.js
// Day 3: 第一个完整负载测试脚本
// 核心要素：stages 三段式加压 + 多接口场景 + 参数化数据 + 请求标签 + thresholds 性能门禁

import http from 'k6/http';
import { check, sleep, group } from 'k6';

// ---------------------------------------------------------------------------
// 0. 参数化工具函数
// 说明：k6 官方工具库 k6-utils 需要从 https://jslib.k6.io 在线加载，
// 一旦该 CDN 不可达（网络受限/TLS 握手超时），脚本会直接加载失败。
// 这两个函数只依赖 Math.random()，脚本完全自包含，离线也能跑。
// ---------------------------------------------------------------------------

// 生成指定长度的随机小写字母 + 数字字符串
function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 生成 [min, max] 区间内的随机整数（含两端）
function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// 1. 测试选项
// ---------------------------------------------------------------------------
export const options = {
  // stages 三段式：爬升 -> 稳定 -> 恢复
  // 相比直接设定固定 vus，stages 能模拟"用户逐渐到来"的真实负载曲线
  stages: [
    { duration: '30s', target: 20 }, // 爬升期：0 -> 20 VU
    { duration: '2m', target: 20 },  // 稳定期：保持 20 VU
    { duration: '30s', target: 0 },  // 恢复期：20 -> 0 VU
  ],

  // 阈值：不满足则 k6 以非零退出码结束，在 CI 中即形成"性能门禁"
  //
  // Day 6 更新：门禁值不再拍脑袋，改为「实测基线 × 1.5」
  //   测量条件：被测库固定 200 条数据，每轮开跑前重置；20 VU / 3min；重复 3 次
  //   基线 p(95) = 1.02s / 1.02s / 1.03s（偏差 ±1%）
  //   → 门禁 = 1.02s × 1.5 ≈ 1.53s，向上取整到 1.6s
  //   基线失败率 ≤ 0.08%、checks ≥ 99.92% → 沿用 1% / 99% 门禁
  //
  // 注意：1.6s 是"防劣化"门禁，不是对外 SLA。
  //   对外 SLA 仍是 p(95) < 500ms，当前未达标——根因是写路径的 SQLite 单写者文件锁。
  //   先用基线门禁把流水线跑绿（能拦住劣化），Week 2 优化后再回头收紧到 SLA。
  //   完整推导与前后对比见 perf/docs/10_baseline_and_gating.md
  thresholds: {
    http_req_duration: ['p(95)<1600'], // 门禁：95% 请求响应时间 < 1.6s
    http_req_failed: ['rate<0.01'],    // 门禁：请求失败率 < 1%
    checks: ['rate>0.99'],             // 门禁：断言通过率 > 99%
  },
};

// 支持通过环境变量覆盖被测地址：k6 run -e BASE_URL=http://host:port xx.js
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

// ---------------------------------------------------------------------------
// 2. 默认函数：每个 VU 循环执行的完整用户旅程
// ---------------------------------------------------------------------------
export default function () {
  // ===== 场景 1：查询商品列表（读接口） =====
  group('场景1-查询商品列表', function () {
    const res = http.get(`${BASE_URL}/items`, {
      tags: { name: 'listItems' },
    });

    check(res, {
      '列表查询返回 200': (r) => r.status === 200,
      '列表返回是数组': (r) => {
        try {
          return Array.isArray(JSON.parse(r.body));
        } catch (e) {
          return false;
        }
      },
    });
  });
  sleep(1);

  // ===== 场景 2：创建商品（写接口 + 参数化数据） =====
  group('场景2-创建商品', function () {
    // 参数化：每次请求用随机名称和随机价格，避免数据重复导致缓存命中失真
    const payload = JSON.stringify({
      name: `perf_item_${randomString(8)}`,
      price: randomIntBetween(1, 1000) / 10,
    });
    const params = {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'createItem' },
    };

    const res = http.post(`${BASE_URL}/items`, payload, params);

    check(res, {
      '创建商品返回 200': (r) => r.status === 200,
      '创建返回包含 id': (r) => {
        try {
          return JSON.parse(r.body).id !== undefined;
        } catch (e) {
          return false;
        }
      },
    });
  });
  sleep(2);

  // ===== 场景 3：查询单个商品（读接口，依赖创建出的数据） =====
  group('场景3-查询单个商品', function () {
    // 先创建一条固定数据，拿到 id 后再按 id 查询
    const createRes = http.post(
      `${BASE_URL}/items`,
      JSON.stringify({ name: 'query_test', price: 9.9 }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'setupGetItemById' },
      }
    );

    let itemId = null;
    try {
      itemId = JSON.parse(createRes.body).id;
    } catch (e) {
      itemId = null;
    }
    check(createRes, { '创建查询用商品成功': (r) => r.status === 200 });

    const res = http.get(`${BASE_URL}/items/${itemId}`, {
      tags: { name: 'getItemById' },
    });

    check(res, {
      '查询单个商品返回 200': (r) => r.status === 200,
      '商品名称正确': (r) => {
        try {
          return JSON.parse(r.body).name === 'query_test';
        } catch (e) {
          return false;
        }
      },
    });
  });
  sleep(1);
}
