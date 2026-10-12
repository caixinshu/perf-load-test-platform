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

## 目录结构

```
perf-load-test-platform/
├── perf/
│   ├── docs/           # 性能测试学习笔记
│   │   ├── 01_core_metrics.md      # 6大核心指标
│   │   ├── 02_percentiles.md        # 百分位响应时间
│   │   ├── 03_test_types.md         # 6种测试类型
│   │   ├── 04_test_workflow.md      # 8步测试流程
│   │   └── 05_bottlenecks.md        # 6类性能瓶颈
│   ├── scripts/        # k6 压测脚本（待添加）
│   └── data/           # 测试数据文件（待添加）
├── config/             # Prometheus 等配置（待添加）
└── README.md
```

## 进度

- [x] Week 1 Day 1: 性能测试基础概念
- [ ] Week 1 Day 2: k6 工具安装与环境搭建
- [ ] Week 1 Day 3: 第一个压测脚本
- [ ] Week 1 Day 4: 性能指标解读与分析
- [ ] Week 1 Day 5: 多场景压测脚本
- [ ] Week 1 Day 6-7: 基线建立 + 监控环境
