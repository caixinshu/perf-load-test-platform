# k6 压测脚本库

> 项目二 Week 1 + Week 2 全部压测脚本。所有脚本通过 `perf/scripts/config.js` 共享公共配置，
> 可通过 `-e` 环境变量覆盖 URL、VU 数、时长、目标路径等参数。

## 快速开始

```powershell
# 冒烟测试
k6 run perf/scripts/01-simple-get.js

# 日常负载测试（20 VU / 3min，三段式 stages）
k6 run perf/scripts/02-load-test.js

# 指定被测地址
k6 run -e BASE_URL=http://192.168.1.100:8000 perf/scripts/02-load-test.js
```

## 脚本清单

### Week 1 · 基础 6 种测试类型

| 脚本 | 测试类型 | 默认 VU | 时长 | 说明 |
|------|---------|---------|------|------|
| `01-simple-get.js` | 冒烟测试 | 10 | 30s | 第一个脚本，带门禁阈值 |
| `02-load-test.js` | 负载测试 | 20 | 3min | 三段式 stages + 多接口 + 标签 |
| `03-smoke-test.js` | 冒烟（per-vu-iterations） | 10 | 30 iter | 每 VU 固定迭代次数 |
| `04-spike-test.js` | 尖峰测试 | 10→200→10 | 各 30s | 突增回落 |
| `05-soak-test.js` | 稳定性测试 | 10 | 2h | 长时查泄漏 |
| `06-multi-scenario.js` | 多场景组合 | 3 种 executor | 各 1min | constant-vus + ramping-vus + per-vu-iterations |

### Week 2 · 瓶颈制造 + 优化 A/B（靶子脚本）

> 这两个脚本**故意只打一个接口**，排除干扰让瓶颈形态纯净。Week 2 Day 13 后一般不再用。

| 脚本 | 用途 | 参数覆盖 | 说明 |
|------|------|---------|------|
| `07-cpu-stress.js` | CPU 瓶颈压测 | `VUS` / `DURATION` / `TARGET_PATH` | 默认 50 VU / 1min 打 `/slow/cpu` |
| `08-memory-leak.js` | 内存瓶颈压测 | `VUS` / `DURATION` / `TARGET_PATH` | 默认 20 VU / 2min 打 `/slow/memory` |

**A/B 对比示例（Day 12 优化验证）**：
```powershell
# baseline（原始慢接口）
k6 run -e VUS=50 -e DURATION=60s -e TARGET_PATH="/slow/cpu?rounds=100" perf/scripts/07-cpu-stress.js

# cache 优化（同一脚本仅换 TARGET_PATH）
k6 run -e VUS=50 -e DURATION=60s -e TARGET_PATH="/slow/cpu/opt/cache?rounds=100" perf/scripts/07-cpu-stress.js
```

### 辅助脚本

| 脚本 | 用途 |
|------|------|
| `baseline.js` | 10 VU 建性能基线（Day 10 门禁用） |
| `stress-test.js` | 50→500 VU 找极限 |

## 公共配置

`perf/scripts/config.js` 集中了 `BASE_URL`、默认 VU/duration、阈值等。脚本内用：
```javascript
import { CONFIG, envOr } from './config.js';
const BASE_URL = envOr('BASE_URL', CONFIG.BASE_URL);
```

## 输出

默认 `k6 run` 直接在终端打印 summary。如需结构化结果：

```powershell
# JSON 行格式（实时点数据）
k6 run --out json=perf/results/raw.json perf/scripts/02-load-test.js

# summary export（汇总 JSON，Day 9 推 Grafana 用）
k6 run --summary-export=perf/results/summary.json perf/scripts/02-load-test.js
```

`perf/results/` 在 `.gitignore` 里，不入库。
