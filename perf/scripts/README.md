# k6 压测脚本库

> 项目二 Week 1-3 全部压测脚本，按类型分类管理。所有脚本通过 `perf/scripts/config.js` 共享公共配置，
> 可通过 `-e` 环境变量覆盖 URL、VU 数、时长、目标路径等参数。

## 目录结构

```
perf/scripts/
├── config.js                      # 公共配置（BASE_URL / 默认 VU / 阈值）
├── run.ps1                        # PowerShell 一键压测
├── README.md                      # 本文件
├── base/                          # 基础测试类型（Week 1 + Week 2）
│   ├── baseline.js                # 性能基线（10 VU / 1min）
│   ├── 01-simple-get.js           # 冒烟测试（10 VU / 30s）
│   ├── 02-load-test.js            # 负载测试（20 VU / 3min，三段式）
│   ├── 03-smoke-test.js           # 冒烟（per-vu-iterations）
│   ├── 04-spike-test.js           # 尖峰测试（10→200→10）
│   ├── 05-soak-test.js            # 稳定性测试（10 VU / 2h）
│   ├── 07-cpu-stress.js           # CPU 瓶颈压测（/slow/cpu）
│   ├── 08-memory-leak.js          # 内存瓶颈压测（/slow/memory）
│   └── stress-test.js             # 极限压力测试（50→500 VU）
├── scenarios/                     # 场景脚本（混合 / 全链路 / DB）
│   ├── 06-multi-scenario.js       # 多场景组合（3 executor）
│   ├── full-link-load-test.js     # 全链路压测（browse/order/query）
│   └── db-stress-test.js          # 数据库压测（读写查搜混合）
├── distributed/                   # 分布式压测
│   └── 09-distributed-load-test.js # k6 集群分片（SHARD_ID/SHARD_COUNT）
└── data/                          # 测试数据（参数化 CSV/JSON）
```

## 快速开始

```powershell
# 冒烟测试
k6 run perf/scripts/base/01-simple-get.js

# 日常负载测试（20 VU / 3min，三段式 stages）
k6 run perf/scripts/base/02-load-test.js

# 指定被测地址
k6 run -e BASE_URL=http://192.168.1.100:8000 perf/scripts/base/02-load-test.js
```

## 脚本清单

### base/ — 基础 6 种测试类型 + 瓶颈靶子

| 脚本 | 测试类型 | 默认 VU | 时长 | 说明 |
|------|---------|---------|------|------|
| `baseline.js` | 基准测试 | 10 | 1min | 建性能基线（门禁用） |
| `01-simple-get.js` | 冒烟测试 | 10 | 30s | 第一个脚本，带门禁阈值 |
| `02-load-test.js` | 负载测试 | 20 | 3min | 三段式 stages + 多接口 + 标签 |
| `03-smoke-test.js` | 冒烟（per-vu-iterations） | 10 | 30 iter | 每 VU 固定迭代次数 |
| `04-spike-test.js` | 尖峰测试 | 10→200→10 | 各 30s | 突增回落 |
| `05-soak-test.js` | 稳定性测试 | 10 | 2h | 长时查泄漏 |
| `stress-test.js` | 极限压力 | 50→500 | 阶梯式 | 找 TPS 天花板 |
| `07-cpu-stress.js` | CPU 瓶颈 | 50 | 1min | 打 /slow/cpu，排除干扰 |
| `08-memory-leak.js` | 内存瓶颈 | 20 | 2min | 打 /slow/memory，查泄漏 |

### scenarios/ — 场景脚本

| 脚本 | 用途 | 场景 | 适用服务 |
|------|------|------|---------|
| `06-multi-scenario.js` | 多场景组合 | constant-vus + ramping-vus + per-vu-iterations | 单服务 |
| `full-link-load-test.js` | 全链路压测 | 60% browse / 25% order / 15% query，100→200 VU | 多服务（gateway+product+order） |
| `db-stress-test.js` | 数据库压测 | 40% getById / 30% list / 20% create / 10% search | product + PostgreSQL |

### distributed/ — 分布式压测

| 脚本 | 用途 | 说明 |
|------|------|------|
| `09-distributed-load-test.js` | k6 集群分片 | 通过 `SHARD_ID` / `SHARD_COUNT` 分配数据段，3 worker 并行 |

## 公共配置

`perf/scripts/config.js` 集中了 `BASE_URL`、默认 VU/duration、阈值等。脚本内用：
```javascript
import { CONFIG, envOr } from '../config.js';
const BASE_URL = envOr('BASE_URL', CONFIG.BASE_URL);
```

## 输出

默认 `k6 run` 直接在终端打印 summary。如需结构化结果：

```powershell
# JSON 行格式（实时点数据）
k6 run --out json=perf/results/raw.json perf/scripts/base/02-load-test.js

# summary export（汇总 JSON，推 Grafana 用）
k6 run --summary-export=perf/results/summary.json perf/scripts/base/02-load-test.js
```

`perf/results/` 在 `.gitignore` 里，不入库。

## 运行示例

```powershell
# A/B 对比（CPU 优化验证）
k6 run -e VUS=50 -e DURATION=60s -e TARGET_PATH="/slow/cpu?rounds=100" perf/scripts/base/07-cpu-stress.js
k6 run -e VUS=50 -e DURATION=60s -e TARGET_PATH="/slow/cpu/opt/cache?rounds=100" perf/scripts/base/07-cpu-stress.js

# 全链路压测
k6 run perf/scripts/scenarios/full-link-load-test.js

# 分布式压测（需配合 docker-compose.distributed.yml）
docker compose -f docker-compose.distributed.yml up --abort-on-container-exit
```
