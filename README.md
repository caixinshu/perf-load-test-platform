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
│   │   ├── 11_monitoring_observability.md # 监控与可观测性（Prometheus + Grafana）
│   │   ├── 12_week1_summary.md         # Week 1 重点与难点复盘
│   │   ├── 13_app_metrics_red.md       # 应用指标埋点 + RED 监控（Week 2 Day 8）
│   │   ├── 14_k6_results_grafana.md    # k6 结果接 Grafana + Pushgateway（Week 2 Day 9）
│   │   ├── 15_bottleneck_methodology.md # 瓶颈定位方法论（Week 2 Day 10）
│   │   ├── 16_cpu_memory_bottleneck_practice.md # CPU/内存瓶颈分析实战（Week 2 Day 11）
│   │   ├── PERF_ANALYSIS_REPORT_TEMPLATE.md # 性能分析报告模板
│   │   └── images/                     # 文档配图（火焰图 SVG、mprof 趋势图、采样数据）
│   ├── scripts/                     # k6 压测脚本
│   │   ├── 01-simple-get.js          # 第一个压测脚本（冒烟，带性能门禁）
│   │   ├── 02-load-test.js           # 完整负载测试（多接口 + 参数化 + 标签 + 门禁）
│   │   ├── baseline.js               # 基准测试（10 VU，建基线）
│   │   ├── stress-test.js            # 压力测试（50→500 VU，找极限）
│   │   ├── 03-smoke-test.js          # 冒烟测试（per-vu-iterations）
│   │   ├── 04-spike-test.js          # 尖峰测试（10→200 VU 突增回落）
│   │   ├── 05-soak-test.js           # 稳定性测试（长时查泄漏）
│   │   ├── 06-multi-scenario.js      # 多场景组合（3 种 executor + 分场景阈值）
│   │   ├── 07-cpu-stress.js          # CPU 瓶颈制造（50 VU 压 /slow/cpu，Day 11）
│   │   └── 08-memory-leak.js         # 内存泄漏制造（20 VU 压 /slow/memory，Day 11）
│   ├── monitoring/                  # 监控栈配置（Day 7 / Day 9）
│   │   ├── prometheus/prometheus.yml # 抓取 node_exporter + demo-api + pushgateway + 自身
│   │   └── grafana/
│   │       ├── provisioning/         # 数据源 + 面板自动加载
│   │       └── dashboards/
│   │           ├── k6-load-test.json        # k6 压测实时面板（Day 7）
│   │           └── k6-load-test-result.json # k6 压测结果看板（Day 9）
│   ├── results/                     # 压测结果（gitignore）
│   └── data/                        # 测试数据
├── scripts/
│   └── push_k6_metrics.py           # k6 summary-export → Pushgateway（Day 9）
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
| `k6-load-test-prometheus` | `01-simple-get.js` + remote write + summary→Pushgateway | 10 VU / 30s | 仅手动 | ❌ 否（Day 7 灰度接入，Day 9 加结果推送） |

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

### Week 2 Day 8 应用指标埋点结论

给被测服务（quality-pipeline-demo）补上**应用侧指标**，三层视图（压测侧 k6 + 主机侧 node_exporter + 应用侧 /metrics）凑齐：

| 产出 | 说明 |
|------|------|
| `app/main.py`（quality-pipeline-demo） | 手写中间件埋点：Counter(`http_requests_total`) + Histogram(`http_request_duration_seconds`) + Gauge(`http_active_requests`)，暴露 `/metrics` |
| [`prometheus.yml`](perf/monitoring/prometheus/prometheus.yml) | 打开 `demo-api` 采集 job（scrape_interval 5s） |
| [`13_app_metrics_red.md`](perf/docs/13_app_metrics_red.md) | 四种指标类型 + Histogram/Summary 选型 + RED 方法 + 实现与验证 |

覆盖 **RED 三要素**：Rate（`rate(http_requests_total[1m])`）、Errors（`status_code` 标签）、Duration（`histogram_quantile` + bucket）。
比计划示例多做三个工程细节：**`/metrics` 自排除**（防自监控流量污染）、**Gauge 用 try/finally**（防异常时泄漏）、**path 用路由模板**（`/items/{item_id}`，防标签基数爆炸）。

本地验证（5 类请求含故意 404）：计数、落桶、404 错误序列、Gauge 归零全部正确。
端到端 scrape 验证同 Day 7，放在 CI。

> 理解原理后实际项目可用 `prometheus-fastapi-instrumentator` 一键埋点——面试答原理，干活用库。

### Week 2 Day 9 k6 结果接入 Grafana 结论

Day 7 解决「压测**过程中**看得见」，Day 9 解决「压测**结束后**留得下、比得了」——两条链路互补：

```
压测中   k6 ──remote write───────────▶ Prometheus ──▶ 实时趋势面板（Day 7）
压测后   k6 ──summary-export──▶ 脚本 ──PUT──▶ Pushgateway ──scrape──▶ Prometheus ──▶ 结果看板（Day 9）
```

| 产出 | 说明 |
|------|------|
| [`scripts/push_k6_metrics.py`](scripts/push_k6_metrics.py) | 解析 `--summary-export`，把 P95/P99/TPS/失败率/checks 等 10 项推成 `k6_test_*` Gauge；`--dry-run` 可离线自检 |
| [`docker-compose.yml`](docker-compose.yml) | 新增 `pushgateway` 服务（持久化 + 管理 API 清理批次） |
| [`prometheus.yml`](perf/monitoring/prometheus/prometheus.yml) | 新增 `pushgateway` 采集 job，`honor_labels: true` 保住 `script` / `run_id` 标签 |
| [`k6-load-test-result.json`](perf/monitoring/grafana/dashboards/k6-load-test-result.json) | 压测结果看板：核心卡片（P95/P99/TPS/失败率）+ 响应时间/TPS/CPU/内存趋势 + 分布 Heatmap + 错误率 Gauge + Pushgateway 最近结果 |
| [`14_k6_results_grafana.md`](perf/docs/14_k6_results_grafana.md) | 输出方式对比 + push/pull 机制 + Pushgateway 三大坑 + 面板 PromQL + 常见坑速查 |

几个关键判断：

- **summary-export 是主选**：几百 KB、结构化、天然适合归档与推送；`--out json` 是逐请求明细，
  动辄几百 MB，只在排障时开。
- **缺失值不造假**：`p(99)` 默认不导出，脚本跳过而不是推 0，避免看板出现"P99=0ms 极快"的假象。
- **不依赖 summary 的 `thresholds` 字段**：实测出现过 `p(95)<100` 显示 `true` 而实际 p95=536ms，
  门禁仍以 k6 退出码为准。
- **Pushgateway 是覆盖语义**：默认只留每个 `script` 的最近一次；要历史才传 `--run-id`，
  并定期 `wipe`。它替代不了趋势库，趋势仍归 remote write。

> 本机无 Docker：解析（真实 + 合成 summary）、`--dry-run`、假 Pushgateway 的 PUT 均已实测；
> 端到端 scrape 与看板渲染放在 CI 的 `k6-load-test-prometheus` job（已加 `if: always()` 推送与入库校验）。

### Week 2 Day 10 瓶颈定位方法论结论

Day 10 是 Week 2 的**骨架日**——Day 7~9 把监控栈搭好、应用指标埋好、看板画好，今天用一套方法论把这些散点串成可执行的分析流程：

| 产出 | 说明 |
|------|------|
| [`15_bottleneck_methodology.md`](perf/docs/15_bottleneck_methodology.md) | 核心方法论文档：USE 方法表（5 资源 × 3 维度，贴 PromQL + Grafana 面板位置）、自顶向下 5 层走查（Day 4 SQLite 软瓶颈完整案例）、Python 生态工具清单 |
| [`PERF_ANALYSIS_REPORT_TEMPLATE.md`](perf/docs/PERF_ANALYSIS_REPORT_TEMPLATE.md) | 空白报告模板；文档内嵌了**已用 Day 4 真实数据填充的完整报告**作为范例 |

几个关键认识：

- **USE/RED 分工**：RED 看服务（"哪个服务慢"），USE 看资源（"哪个资源不够"）。定位瓶颈时用 RED 发现问题，用 USE 锁定资源类型。
- **最快的排查捷径**：**"所有物理资源都不高但慢" = 直接跳到第 4/5 层查代码和依赖**。Day 4 的 SQLite 软瓶颈就是这么定位到的——CPU 60%、内存 45%、iowait 5%，所有物理信号都排除了，直接扎进代码看锁。
- **监控栈早就在那里**：Day 7 搭 node_exporter 时跑过 `USE` 的 Utilization 指标，Day 8 埋 `/metrics` 时跑过 RED 的 Duration 指标——方法论只是给这些已有的指标加了"怎么读"的说明书。

> 与 Week 1 已有文档的分工：`05_bottlenecks.md` 讲"有什么瓶颈"，`08_performance_analysis.md` 讲"怎么读压测报告"，今天这份讲"怎么定位"。三份合起来就是一套完整的定位→分析→决策闭环。

### Week 2 Day 11 CPU / 内存瓶颈分析实战结论

给被测服务植入两个「病接口」当靶子，把 Day 10 方法论完整跑了一遍——**RED 发现慢 → USE 锁资源 → 采样工具锁代码行 → 对照实验排除假设**：

| 产出 | 说明 |
|------|------|
| `app/main.py`（quality-pipeline-demo） | 新增 `/slow/cpu`（sha256 循环）+ `/slow/memory`（全局列表泄漏）+ `/slow/memory/clear`，`@profile` 无内存分析器时优雅降级 |
| [`07-cpu-stress.js`](perf/scripts/07-cpu-stress.js) / [`08-memory-leak.js`](perf/scripts/08-memory-leak.js) | constant-vus 持续施压，故意不设 thresholds（制造瓶颈，非门禁） |
| [`16_cpu_memory_bottleneck_practice.md`](perf/docs/16_cpu_memory_bottleneck_practice.md) | CPU + 内存两份完整分析记录（现象 → 数据 → 工具 → 热点行 → 结论） |
| [`images/`](perf/docs/images/) | py-spy 火焰图 SVG + mprof 趋势图 PNG + 原始采样数据 |

**CPU 实战**：50 VU 压 `/slow/cpu`，TPS 封顶 1.555/s、avg 16.84s、错误率 0%——三特征齐（TPS 不随并发涨、响应随并发线性恶化、无错误）。
py-spy 火焰图一柱擎天：`slow_cpu (main.py:175)` 占 **98.86%** 样本，根因是 hashlib 小数据**不释放 GIL**，50 线程抢一把锁等于单核串行。
实测坑：py-spy 挂接期间请求全部 60s 超时——**采样分析器有观察者效应，基线/门禁测量时严禁挂分析器**。

**内存实战**：20 VU 压 `/slow/memory`，RSS 48.9 → 1678.9 MB 线性上涨（与 16651 请求 × 100KB 账面对平），
memory_profiler 逐行定位泄漏行 `_leaky_cache.append`（main.py:191，+1.965MiB/20 次），
`/clear` 后 RSS 回落至 53.2 MB——证明是**缓存无淘汰**而非 C 层真泄漏，Day 12 优化方向定为 LRU/容量上限。
实测坑：**mprof attach 在 Windows 超时不生效**，改用 `mprof run` 拉起进程才落盘。

## 进度

- [x] Week 1 Day 1: 性能测试基础概念
- [x] Week 1 Day 2: k6 工具安装与环境搭建
- [x] Week 1 Day 3: 第一个完整压测脚本
- [x] Week 1 Day 4: 性能指标解读与分析
- [x] Week 1 Day 5: 多场景压测脚本
- [x] Week 1 Day 6-7: 基线建立 + 监控环境
- [x] Week 2 Day 8: 应用指标埋点（Prometheus 指标 + RED 监控）
- [x] Week 2 Day 9: k6 结果接入 Grafana 可视化
- [x] Week 2 Day 10: 瓶颈定位方法论
- [x] Week 2 Day 11: CPU / 内存瓶颈分析实战
- [ ] Week 2 Day 12: 性能优化实战
- [ ] Week 2 Day 13-14: 优化对比 + 文档整理
