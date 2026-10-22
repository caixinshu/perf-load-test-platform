// perf/scripts/08-memory-leak.js
// Week 2 Day 11：内存瓶颈分析实战
// 目的：用 20 个 VU 持续打压 /slow/memory（每次请求向全局列表泄漏 100KB），
//      观察「进程 RSS 近似线性上涨、清理后回落」的典型内存泄漏特征，
//      并用 memory_profiler / mprof 定位泄漏代码行。
//
// 观察点（USE 方法 - 内存资源）：
//   - Utilization：进程 RSS 持续上涨（接口返回的 cache_mb 同步上涨）
//   - 清理验证   ：压测结束后 POST /slow/memory/clear，RSS 应明显回落
//
// 配套操作：
//   python -m memory_profiler driver.py   → 逐行内存增量（定位泄漏行）
//   mprof run python -m uvicorn ...       → 内存趋势图（压测期间上涨曲线）
//
// 注意：本脚本不设性能阈值——慢接口故意泄漏，是 Day 12 优化的靶子。

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    memory_leak: {
      // constant-vus：固定 20 个 VU 跑 2 分钟，让泄漏量足够明显
      executor: 'constant-vus',
      vus: 20,
      duration: '2m',
    },
  },
  // 不设 thresholds：这是瓶颈制造脚本，不是门禁脚本
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  // size_kb=100 → 每请求泄漏 100KB；20 VU × 2min 预计泄漏数百 MB
  const res = http.get(`${BASE_URL}/slow/memory?size_kb=100`, {
    tags: { name: 'slowMemory' },
  });
  check(res, {
    'slow/memory 返回 200': (r) => r.status === 200,
    '泄漏量单调上涨': (r) => {
      try {
        return JSON.parse(r.body).cache_mb > 0;
      } catch (e) {
        return false;
      }
    },
  });
  // 不 sleep：泄漏越快，趋势越明显
}
