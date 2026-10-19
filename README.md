# 性能测试与全链路压测平台

> 项目二 · k6 + Prometheus + Grafana 性能测试体系

## 项目概述

基于 k6 压测工具、Prometheus 指标采集、Grafana 可视化，搭建从压测脚本到监控告警的全链路性能测试平台。

## 技术栈

| 工具 | 用途 |
|------|------|
| k6 | 压测工具（JavaScript 脚本） |
| Prometheus | 指标采集时序数据库 |
| Grafana | 监控可视化面板 |
| node_exporter | 主机指标采集 |
| Docker + Docker Compose | 环境管理 |

## k6 安装指南

### Windows

```bash
# 方式一：winget（推荐）
winget install k6.k6

# 方式二：Chocolatey
choco install k6

# 方式三：从 GitHub Releases 下载 msi
# https://github.com/grafana/k6/releases

# 验证安装
k6 version
```

### macOS

```bash
brew install k6
```

### Linux (Debian/Ubuntu)

```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com --recv-keys C5AD17C9B7BDB5F1
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install -y k6
```

### Docker

```bash
docker run --rm grafana/k6:latest k6 version
```

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
# 启动被测服务 + 运行压测
docker compose --profile perf up --abort-on-container-exit

# 只启动被测服务
docker compose up -d api

# 启动监控栈（Prometheus + Grafana + node_exporter）
docker compose --profile monitoring up -d

# 验证服务
curl http://localhost:8000/health
```

### 方式二：本地 k6 + Docker 服务

```bash
# 1. 启动被测服务
docker compose up -d api

# 2. 运行压测
k6 run perf/scripts/01-simple-get.js     # 快速冒烟：10 VU / 30s
k6 run perf/scripts/02-load-test.js      # 完整负载：20 VU / 3min（stages 三段式）

# 3. 输出结构化结果
k6 run --summary-export=perf/results/summary.json perf/scripts/02-load-test.js
k6 run --out json=perf/results/result.json perf/scripts/01-simple-get.js
```

### 方式三：本地 k6 + 本地 Python 服务（不需要 Docker）

```bash
# 1. 启动被测服务（Windows PowerShell）
cd quality-pipeline-demo
$env:DB_PATH = "f:\apk\其他\todo\quality-pipeline-demo\demo.db"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 2. 另开一个终端运行压测
k6 run -e BASE_URL=http://localhost:8000 perf/scripts/02-load-test.js
```

> 所有压测脚本都支持用 `-e BASE_URL=...` 覆盖被测地址，方便指向不同环境。

## 目录结构

```
perf-load-test-platform/
├── .github/
│   └── workflows/
│       └── perf-test.yml            # k6 CI 性能测试流水线
├── perf/
│   ├── docs/                        # 性能测试学习笔记
│   │   ├── 01_core_metrics.md       # 6大核心指标
│   │   ├── 02_percentiles.md         # 百分位响应时间
│   │   ├── 03_test_types.md          # 6种测试类型
│   │   ├── 04_test_workflow.md       # 8步测试流程
│   │   ├── 05_bottlenecks.md         # 6类性能瓶颈
│   │   ├── 06_k6_metrics_guide.md    # k6 指标解读笔记
│   │   ├── 07_k6_stages_and_modules.md # stages 加压模式 + 模块 + 首次负载实测
│   │   ├── 08_performance_analysis.md  # 性能指标解读与分析（5步法 + 基线 + 压力结论）
│   │   ├── 09_scenarios_and_executors.md # 多场景脚本（scenarios + 7种 executor）
│   │   ├── 10_baseline_and_gating.md   # 基线建立与性能门禁（受控测量 + 门禁推导）
│   │   └── 11_monitoring_observability.md # 监控与可观测性（Prometheus + Grafana）
│   ├── scripts/                     # k6 压测脚本
│   │   ├── 01-simple-get.js          # 第一个压测脚本（冒烟，带性能门禁）
│   │   ├── 02-load-test.js           # 完整负载测试（多接口 + 参数化 + 标签 + 门禁）
│   │   ├── baseline.js               # 基准测试（10 VU，建基线）
│   │   ├── stress-test.js            # 压力测试（50→500 VU，找极限）
│   │   ├── 03-smoke-test.js          # 冒烟测试（per-vu-iterations）
│   │   ├── 04-spike-test.js          # 尖峰测试（10→200 VU 突增回落）
│   │   ├── 05-soak-test.js           # 稳定性测试（长时查泄漏）
│   │   └── 06-multi-scenario.js      # 多场景组合（3 种 executor + 分场景阈值）
│   ├── monitoring/                  # 监控栈配置（Day 7）
│   │   ├── prometheus/prometheus.yml # 抓取 node_exporter + 自身
│   │   └── grafana/
│   │       ├── provisioning/         # 数据源 + 面板自动加载
│   │       └── dashboards/k6-load-test.json # k6 压测实时面板
│   ├── results/                     # 压测结果（gitignore）
│   └── data/                        # 测试数据
├── docker-compose.yml               # 环境编排
├── .gitignore
└── README.md
```

## CI/CD

采用**分层执行**，避免每次提交都跑满负载：

| Job | 脚本 | 负载 | 触发条件 | 是否阻断流水线 |
|-----|------|------|----------|----------------|
| `k6-smoke-test` | `01-simple-get.js` | 10 VU / 30s | push、PR | ✅ 是（门禁 p95<100ms） |
| `k6-load-test` | `02-load-test.js` | 20 VU / 3min | 定时、手动 | ✅ 是（Day 6 转正，门禁 p95<1.6s） |
| `k6-load-test-prometheus` | `01-simple-get.js` + remote write | 10 VU / 30s | 仅手动 | ❌ 否（Day 7 灰度接入） |

**门禁值必须来自实测基线**：`门禁 = 基线 × 1.5`。
Day 6 已完成受控测量（固定 200 条数据、每轮重置、连跑 3 次），得到基线 p95 = **26ms**（冒烟）/ **1.02s**（负载），
据此定出门禁并去掉观察期的 `continue-on-error`。这与项目一中代码扫描先用 `continue-on-error` 灰度接入是同一个思路，
区别只在于"灰度期要用来攒基线数据"。推导过程与全部原始数据见 [`10_baseline_and_gating.md`](perf/docs/10_baseline_and_gating.md)。

压测结果（含 `summary.json`）会上传为 Artifact，可在 Actions 页面下载查看。

### 首次负载测试实测结果（20 VU × 3min，Day 3）

| 指标 | 实测值 | 当时阈值 | 判定 |
|------|--------|---------|------|
| `http_req_duration` | p(95)=1.27s | <500ms | ✗ |
| `http_req_failed` | 0.53% | <1% | ✓ |
| `checks` | 99.49% | >99% | ✓ |

读接口 100% 通过，失败全部集中在写路径——详情见 [`07_k6_stages_and_modules.md`](perf/docs/07_k6_stages_and_modules.md) 第八节。
当时的 500ms 是"期望 SLA"，不是实测基线；Day 6 已换成基于基线的门禁（`10_baseline_and_gating.md`）。

### Day 4 基线与压力测试结论

- **性能基线**（10 VU / 1min，3 次取稳定值）：TPS ≈ **10 req/s**，p50 ≈ 57ms，p95 ≈ 446ms，错误率 0%，checks 100%。
- **系统极限**（50→500 VU 阶梯）：极限 TPS ≈ **30 req/s**，拐点在 **50 VU**（此后 TPS 不再增长，p95 线性上升）。全程 0 失败，属软瓶颈（SQLite 每请求新建连接 + 文件锁串行化）。
- 完整分析框架、百分位表与现象判断思路见 [`08_performance_analysis.md`](perf/docs/08_performance_analysis.md)。

### Day 5 多场景压测结论

补齐冒烟、尖峰、稳定性三类脚本，并用 k6 `scenarios` + 多种 `executor` 实现多场景组合压测：

| 脚本 | 类型 | 实测结论 |
|------|------|----------|
| [`03-smoke-test.js`](perf/scripts/03-smoke-test.js) | 冒烟 | checks 100%、失败率 0%，读写链路全通 |
| [`04-spike-test.js`](perf/scripts/04-spike-test.js) | 尖峰（10→200 VU） | 失败率 0%，但 **p95 从 ~140ms 飙到 4.39s**；尖峰期吞吐不升反降（≈25 req/s），属并发过载 |
| [`05-soak-test.js`](perf/scripts/05-soak-test.js) | 稳定性（20 VU） | 3 分钟 0 失败、p95=262ms；暴露内存泄漏需跑数小时 |
| [`06-multi-scenario.js`](perf/scripts/06-multi-scenario.js) | 多场景组合 | 3 场景 3 executor + 分场景阈值，全部通过 |

完整讲解（7 种 executor、按场景设阈值、`dropped_iterations`）见 [`09_scenarios_and_executors.md`](perf/docs/09_scenarios_and_executors.md)。

### Day 6 基线建立与性能门禁结论

门禁值不再拍脑袋，改为 `实测基线 × 1.5`。测量过程中发现并修正了一个关键问题：

**第一次测量（未控住数据集）——基线在漂移**
`02-load-test.js` 每个迭代写入 2 条数据，而 `GET /items` 是全表返回、无分页，于是每一轮的数据集都比上一轮大：

| 轮次 | 开跑数据量 | p95 | TPS | 失败率 |
|------|-----------|-----|-----|--------|
| 1 | 1619 条 | 1.27 s | 12.46 | 0.17% |
| 2 | 2751 条 | 1.81 s | 11.70 | 0.23% |
| 3 | 3825 条 | 1.66 s | 11.48 | 0.14% |

p95 偏差 **±42%**，远超稳定线——**上升的不是系统劣化，而是测试输入变了**。

**第二次测量（固定 200 条、每轮重置）——基线稳定**

| 脚本 | 基线 p95 | 基线 TPS | 失败率 | checks | 3 次偏差 |
|------|---------|---------|--------|--------|---------|
| [`01-simple-get.js`](perf/scripts/01-simple-get.js) | **26 ms** | 9.8 | 0% | 100% | p95 绝对差 13ms |
| [`02-load-test.js`](perf/scripts/02-load-test.js) | **1.02 s** | 13.2 | ≤0.08% | ≥99.92% | p95 **±1%** |

对照之下，p95 从 1.58s 降到 1.02s，方差从 ±42% 收到 ±1%——数据集就是这轮测试最强的自变量。

**门禁落地**

| 脚本 | 门禁 | 说明 |
|------|------|------|
| `01-simple-get.js` | p95<100ms / 失败率<1% / checks>99% | 基线 26ms×1.5=39ms，低于单机噪声幅度（±62%），改用**最小容差 100ms** |
| `02-load-test.js` | p95<1.6s / 失败率<1% / checks>99% | 基线 1.02s×1.5≈1.53s，向上取整 1.6s |

同时把 `01-simple-get.js` 里 `响应时间 < 200ms` 的逐请求断言从 `checks` 移到了 `thresholds`——
**checks 管"功能对不对"，thresholds 管"快不快"**，混在一起出了问题无法定位。
CI 中 `k6-load-test` 已移除 `continue-on-error`，门禁正式生效。

> 注意：1.6s 是**防劣化门禁**，不是对外 SLA（SLA 仍是 p95<500ms，当前未达标，根因是写路径的 SQLite 单写者文件锁）。
> Week 2 优化完成后必须回头收紧门禁，否则它就变成了技术债的免罪符。

完整方法论（控制变量、基线漂移定位、最小容差规则、基线维护触发条件）见 [`10_baseline_and_gating.md`](perf/docs/10_baseline_and_gating.md)。

### Day 7 监控与可观测性结论

引入 **Prometheus + Grafana + node_exporter** 监控栈，让压测指标从"结束才看到的汇总"变成"过程中可见的曲线"：

```
k6（请求侧）      ──remote write──▶  Prometheus  ──▶  Grafana（同一时间轴）
node_exporter（主机侧）──scrape──▶        │
```

| 产出 | 说明 |
|------|------|
| [`docker-compose.yml`](docker-compose.yml) | 新增 `monitoring` profile：prometheus / grafana / node-exporter |
| [`perf/monitoring/prometheus/prometheus.yml`](perf/monitoring/prometheus/prometheus.yml) | 抓取 node_exporter + 自身 |
| [`perf/monitoring/grafana/`](perf/monitoring/grafana/) | 数据源与面板自动加载（provisioning） |
| [`k6-load-test.json`](perf/monitoring/grafana/dashboards/k6-load-test.json) | 8 个 panel：VUs / p95 / TPS / 失败率 + 4 张趋势图（按 `name` 标签下钻到接口） |
| `.github/workflows/perf-test.yml` | 新增可选 job `k6-load-test-prometheus`（手动触发、灰度接入），k6 用 `--out experimental-prometheus-rw` 推指标，并断言指标真的进了 Prometheus |

关键技术点：**Trend 指标走 native histogram**（`K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true` + Prometheus `--enable-feature=native-histograms`）——
默认模式下 `http_req_duration` 只能退化成预先指定的单值（如 `k6_http_req_duration_p99`），
只有直方图才能用 `histogram_quantile()` 算任意百分位。

> **本机没有 Docker**，所以监控栈只能做到"配置就绪 + 语法校验"，端到端链路放在 CI 上验证。
> 运行命令、面板设计、指标名映射、常见坑速查见 [`11_monitoring_observability.md`](perf/docs/11_monitoring_observability.md)。

## 进度

- [x] Week 1 Day 1: 性能测试基础概念
- [x] Week 1 Day 2: k6 工具安装与环境搭建
- [x] Week 1 Day 3: 第一个完整压测脚本
- [x] Week 1 Day 4: 性能指标解读与分析
- [x] Week 1 Day 5: 多场景压测脚本
- [x] Week 1 Day 6-7: 基线建立 + 监控环境
