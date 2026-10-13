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
k6 run perf/scripts/01-simple-get.js

# 3. 输出 JSON/CSV 结果
k6 run --out json=perf/results/result.json perf/scripts/01-simple-get.js
k6 run --out csv=perf/results/result.csv perf/scripts/01-simple-get.js
```

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
│   │   └── 06_k6_metrics_guide.md    # k6 指标解读笔记
│   ├── scripts/                     # k6 压测脚本
│   │   └── 01-simple-get.js          # 第一个压测脚本
│   ├── results/                     # 压测结果（gitignore）
│   └── data/                        # 测试数据
├── docker-compose.yml               # 环境编排
├── .gitignore
└── README.md
```

## CI/CD

| 触发条件 | 行为 |
|----------|------|
| push 到 main/develop | 运行 k6 压测 |
| PR 到 main | 运行 k6 压测 |
| 每日定时 (UTC 20:00) | 日常性能回归 |
| 手动触发 | 随时验证 |

压测结果会上传为 Artifact，可在 Actions 页面下载查看。

## 进度

- [x] Week 1 Day 1: 性能测试基础概念
- [x] Week 1 Day 2: k6 工具安装与环境搭建
- [ ] Week 1 Day 3: 第一个完整压测脚本
- [ ] Week 1 Day 4: 性能指标解读与分析
- [ ] Week 1 Day 5: 多场景压测脚本
- [ ] Week 1 Day 6-7: 基线建立 + 监控环境
