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
│   │   └── 07_k6_stages_and_modules.md # stages 加压模式 + 模块 + 首次负载实测
│   ├── scripts/                     # k6 压测脚本
│   │   ├── 01-simple-get.js          # 第一个压测脚本（冒烟）
│   │   └── 02-load-test.js           # 完整负载测试（多接口 + 参数化 + 标签）
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
| `k6-smoke-test` | `01-simple-get.js` | 10 VU / 30s | push、PR | ✅ 是（性能门禁） |
| `k6-load-test` | `02-load-test.js` | 20 VU / 3min | 定时、手动 | ❌ 否（观察期） |

**为什么负载测试暂时不阻断流水线**：门禁值必须来自实测基线。基线尚未建立时，先用观察期积累几次真实数据，再按「基线 × 1.5」设置门禁值。这与项目一中代码扫描先用 `continue-on-error` 灰度接入是同一个思路。

基线确定后，去掉 `k6-load-test` 的 `continue-on-error: true` 即可正式启用门禁。

压测结果（含 `summary.json`）会上传为 Artifact，可在 Actions 页面下载查看。

### 首次负载测试实测结果（20 VU × 3min）

| 指标 | 实测值 | 阈值 | 判定 |
|------|--------|------|------|
| `http_req_duration` | p(95)=1.27s | <500ms | ✗ |
| `http_req_failed` | 0.53% | <1% | ✓ |
| `checks` | 99.49% | >99% | ✓ |

读接口 100% 通过，失败全部集中在写路径——详情见 [`07_k6_stages_and_modules.md`](perf/docs/07_k6_stages_and_modules.md) 第八节。

### Day 4 基线与压力测试结论

- **性能基线**（10 VU / 1min，3 次取稳定值）：TPS ≈ **10 req/s**，p50 ≈ 57ms，p95 ≈ 446ms，错误率 0%，checks 100%。
- **系统极限**（50→500 VU 阶梯）：极限 TPS ≈ **30 req/s**，拐点在 **50 VU**（此后 TPS 不再增长，p95 线性上升）。全程 0 失败，属软瓶颈（SQLite 每请求新建连接 + 文件锁串行化）。
- 完整分析框架、百分位表与现象判断思路见 [`08_performance_analysis.md`](perf/docs/08_performance_analysis.md)。

## 进度

- [x] Week 1 Day 1: 性能测试基础概念
- [x] Week 1 Day 2: k6 工具安装与环境搭建
- [x] Week 1 Day 3: 第一个完整压测脚本
- [x] Week 1 Day 4: 性能指标解读与分析
- [ ] Week 1 Day 5: 多场景压测脚本
- [ ] Week 1 Day 6-7: 基线建立 + 监控环境
