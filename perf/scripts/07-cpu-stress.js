// perf/scripts/07-cpu-stress.js
// Week 2 Day 11：CPU 瓶颈分析实战
// 目的：用 50 个 VU 持续打压 /slow/cpu（sha256 循环哈希，纯计算无 IO），
//      观察「CPU 顶满 100% + TPS 封顶」的典型 CPU 瓶颈特征，
//      并在压测期间用 py-spy record 采样生成火焰图，定位热点函数。
//
// 观察点（USE 方法 - CPU 资源）：
//   - Utilization：进程 CPU 使用率是否顶到单核 100%
//   - Saturation ：加 VU 后 TPS 不再增长（饱和）
//   - 响应时间  ：p95 随 VU 线性恶化（排队等待 CPU）
//
// 配套操作：
//   py-spy record -o flame_cpu.svg --pid <uvicorn-pid> --duration 60
//   或 py-spy record -o flame_cpu.svg -- python -m uvicorn app.main:app --port 8000
//
// 注意：本脚本不设性能阈值——慢接口故意写得低效，是 Day 12 优化的靶子。

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    cpu_stress: {
      // constant-vus：固定 50 个 VU 跑 1 分钟，保证 CPU 持续饱和
      executor: 'constant-vus',
      vus: 50,
      duration: '1m',
    },
  },
  // 不设 thresholds：这是瓶颈制造脚本，不是门禁脚本
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  // rounds=100 → 10 万次 sha256，单次请求约几十~上百 ms
  const res = http.get(`${BASE_URL}/slow/cpu?rounds=100`, {
    tags: { name: 'slowCpu' },
  });
  check(res, { 'slow/cpu 返回 200': (r) => r.status === 200 });
  // 不 sleep：让 VU 无缝衔接请求，尽快把 CPU 压满
}
