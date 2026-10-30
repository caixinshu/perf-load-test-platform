# 11 - 监控与可观测性（Day 7）

> 目标：把 k6 的压测指标从"测试结束才看到的一份汇总"变成"压测过程中实时可见的曲线"，
> 并让主机资源指标（CPU / 内存 / 网络）与服务指标出现在同一张时间轴上，
> 这样才谈得上"发现问题 → 定位瓶颈在哪一层"。

---

## 一、为什么需要监控栈

前 6 天跑压测，我们靠的是 k6 结束后的 `TOTAL RESULTS` 汇总。这有两个盲区：

| 盲区 | 后果 |
|------|------|
| 只有结果、没有过程 | 看不到"第 40 秒开始抖动"这种关键时间点，无法和部署/GC/流量事件对齐 |
| 只有请求侧指标 | 不知道服务端 CPU/内存到底用了多少，无法判断瓶颈是"服务代码慢"还是"机器不够" |

监控栈要解决的就是这两点：

```
k6（请求侧指标）  ──remote write──▶  Prometheus  ──▶  Grafana（时间轴 + 面板）
node_exporter（主机侧） ──scrape──▶        │
                                           └── 同一个时间轴，可以叠图对比
```

**核心价值**：把"请求抖动"和"资源曲线"画在一起，一眼看出因果。比如 p95 突然飙高时，
如果 CPU 同时打满 → CPU 瓶颈；如果 CPU 很闲但磁盘 IO 等待高 → 是 SQLite 文件锁在排队。

---

## 二、Prometheus 的两种数据入口

这是理解整套监控最容易被绕晕的地方，必须分清楚：

| 入口 | 方向 | 谁主动 | 适用于 | 我们的用法 |
|------|------|--------|--------|-----------|
| **scrape（抓取）** | Prometheus → 目标 | Prometheus 定时拉 `/metrics` | 长期驻留的服务（主机、API 服务） | 拉 node_exporter 和 Prometheus 自身 |
| **remote write（远程写）** | 目标 → Prometheus | 客户端主动推 | 短生命周期的任务（压测、批处理） | k6 把压测指标推进来 |

为什么 k6 要走 remote write 而不是被 scrape：k6 压测只跑 30 秒～3 分钟然后进程就退出了，
Prometheus 的 15s 抓取很可能压根抓不到几次，而且 k6 也没有一个常驻的 `/metrics` 端点给人拉。

remote write 在 Prometheus 侧需要显式打开接收器开关，否则会返回 404：

```yaml
# docker-compose.yml 里 prometheus 服务的 command
- --web.enable-remote-write-receiver
```

---

## 三、目录结构

```
perf/monitoring/
├── prometheus/
│   └── prometheus.yml                        # 抓取配置（node_exporter + 自身）
└── grafana/
    ├── provisioning/
    │   ├── datasources/prometheus.yml        # 数据源自动配置（uid=prometheus）
    │   └── dashboards/dashboards.yml         # 面板目录自动扫描
    └── dashboards/
        └── k6-load-test.json                 # k6 压测实时监控面板（8 个 panel）
```

三个配置文件各自的作用：

| 文件 | 作用 | 关键点 |
|------|------|--------|
| `prometheus/prometheus.yml` | 定义 scrape 目标 | node_exporter 的地址是容器名 `node-exporter:9100`（容器内 DNS） |
| `grafana/provisioning/datasources/*.yml` | 自动挂数据源 | `uid` 固定为 `prometheus`，面板 JSON 里按 uid 引用，导入不会出现 datasource not found |
| `grafana/provisioning/dashboards/*.yml` | 自动挂面板 | 声明扫描路径 `/var/lib/grafana/dashboards`，容器启动即加载 |
| `grafana/dashboards/k6-load-test.json` | 面板本体 | 8 个 panel：4 个总览 stat + 4 个趋势 timeseries |

---

## 四、启动监控栈

监控栈用独立的 `monitoring` profile，不会影响既有的压测流程：

```bash
# 只起监控栈（Prometheus + Grafana + node_exporter）
docker compose --profile monitoring up -d

# 查看状态
docker compose --profile monitoring ps
```

三个入口：

| 服务 | 地址 | 默认账号 |
|------|------|---------|
| Prometheus | http://localhost:9090 | 无 |
| Grafana | http://localhost:3000 | admin / admin（同时开了匿名只读） |
| node_exporter | http://localhost:9100/metrics | 无 |

验证 Prometheus 抓取是否正常：打开 `http://localhost:9090/targets`，
`prometheus` 和 `node-exporter` 两个 job 的 State 应显示 `UP`。

---

## 五、跑一次"带监控"的压测

监控栈起来后，k6 需要显式指定 remote write 地址（默认是 `http://localhost:9090/api/v1/write`）：

```bash
# Linux / macOS / Git Bash / CI
K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write \
K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true \
K6_PROMETHEUS_RW_STALE_MARKERS=true \
K6_PROMETHEUS_RW_LABELS="environment=local,platform=windows" \
k6 run -o experimental-prometheus-rw perf/scripts/base/02-load-test.js
```

```powershell
# Windows PowerShell
$env:K6_PROMETHEUS_RW_SERVER_URL="http://localhost:9090/api/v1/write"
$env:K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM="true"
$env:K6_PROMETHEUS_RW_STALE_MARKERS="true"
$env:K6_PROMETHEUS_RW_LABELS="environment=local,platform=windows"
k6 run -o experimental-prometheus-rw perf/scripts/base/02-load-test.js
```

三个环境变量的作用：

| 变量 | 作用 | 不加会怎样 |
|------|------|-----------|
| `K6_PROMETHEUS_RW_SERVER_URL` | 指明 remote write 端点 | 默认指向 `localhost:9090`，非本地场景会推错地址 |
| `K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true` | Trend 指标（`http_req_duration`）以 native histogram 写入 | 退化成 `k6_http_req_duration_p99` 这类单值 gauge，**没法算 p90/p95 任意百分位** |
| `K6_PROMETHEUS_RW_STALE_MARKERS=true` | 测试结束时把序列标记为 stale | 曲线会一直延伸到最后一次采样值，看起来"还在压测" |
| `K6_PROMETHEUS_RW_LABELS` | 附加静态标签，区分环境/机器 | 多环境数据混在一起无法过滤 |

> 压测跑起来后打开 Grafana → `k6 性能测试` 文件夹 → **k6 压测实时监控**，
> 时间范围选 `Last 15 minutes`，刷新间隔 10s，即可看到 VUs / p95 / TPS / 失败率实时变化。

---

## 六、Grafana 面板设计说明

面板分两组，共 8 个 panel，布局按"先看结论，再看趋势"排列：

### 总览（4 个 stat）

| Panel | 查询 | 判定阈值 |
|-------|------|---------|
| 并发虚拟用户 (VUs) | `avg(k6_vus)` | — |
| 响应时间 p95 | `histogram_quantile(0.95, sum by (le) (rate(k6_http_req_duration_seconds[$__rate_interval]))) * 1000` | 绿<100ms / 黄<500ms / 红≥500ms |
| 吞吐量 (TPS) | `sum(irate(k6_http_reqs_total[$__rate_interval]))` | — |
| 请求失败率 | `avg(k6_http_req_failed_rate) * 100` | 绿=0 / 黄≥0.5% / 红≥1% |

p95 的红线取 **500ms**（对外 SLA 参考线），失败率红线取 **1%**（与门禁一致）。
注意：这里的 500ms 是"业务能接受的线"，和 `02-load-test.js` 里 1.6s 的**防劣化门禁**不是一回事——
防劣化门禁用于拦住"越改越差"，SLA 是业务目标，当前尚未达标（见 [`10_baseline_and_gating.md`](10_baseline_and_gating.md) 第七节）。

### 趋势（4 个 timeseries）

| Panel | 看点 |
|-------|------|
| 响应时间百分位（p95 / p99） | 两条线越分开说明长尾越严重；p99 突刺通常对应 GC / 锁等待 |
| 各接口吞吐量（按 `name` 标签分组） | 脚本里每个请求都打了 `tags: { name: 'xxx' }`，这里能看清单个接口的吞吐 |
| 失败率（按 `name` 标签分组） | 直接定位是哪个接口在报错（历史经验：失败集中在写路径 `createItem`） |
| 负载曲线（VUs + 迭代速率） | 和 stages 配置对照，确认加压节奏符合预期 |

**`name` 标签是关键**：Day 3 写脚本时给每个请求打的 `tags: { name: 'listItems' / 'createItem' }`
在 remote write 后会变成时间序列的标签，Grafana 里用 `sum by (name)` 就能按接口拆开。
这就是"标签没白打"的兑现时刻。

### testid 变量

k6 每次运行会生成一个 `testid` 标签。面板顶部有 `testid` 变量（支持多选 + All），
用来**只显示某一次压测**的数据——否则多次压测的曲线会糊在一起，看不出单次趋势。

---

## 七、k6 指标 → Prometheus 指标名映射

k6 的指标名不会原样进 Prometheus，会加 `k6_` 前缀并按类型加后缀：

| k6 指标 | k6 类型 | Prometheus 指标名 | 后缀规则 |
|---------|---------|------------------|---------|
| `http_reqs` | Counter | `k6_http_reqs_total` | Counter → `_total` |
| `http_req_duration` | Trend | `k6_http_req_duration_seconds` | Trend + native histogram → 单位后缀 `_seconds` |
| `http_req_failed` | Rate | `k6_http_req_failed_rate` | Rate → `_rate` |
| `vus` | Gauge | `k6_vus` | Gauge → 单位后缀（无单位则不加） |
| `vus_max` | Gauge | `k6_vus_max` | 同上 |
| `iterations` | Counter | `k6_iterations_total` | Counter → `_total` |
| `data_received` | Counter | `k6_data_received_total` | Counter → `_total` |
| `data_sent` | Counter | `k6_data_sent_total` | Counter → `_total` |

**Trend 的两种映射方式**（这是最容易踩坑的点）：

| 模式 | 开关 | 产出 | 能否算任意百分位 |
|------|------|------|----------------|
| 默认（counter + gauge） | 无 | `k6_http_req_duration_p99`（受 `K6_PROMETHEUS_RW_TREND_STATS` 控制，默认只有 p99） | ❌ 只能看预先指定的那几个分位 |
| native histogram | `K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true` | `k6_http_req_duration_seconds`（直方图） | ✅ `histogram_quantile(0.95, ...)` 想要几分位都行 |

我们选 native histogram，因为它能在 Grafana 里自由调整百分位（面板里 `$quantile` 的思路），
而且存储上比"一个分位一条序列"更省。代价是 Prometheus 侧要开特性开关：

```yaml
- --enable-feature=native-histograms
```

---

## 八、本机没有 Docker 时怎么办

本机（Windows）**没有安装 Docker**，因此监控栈的配置文件与面板已就绪，但无法端到端跑通。
这属于"环境缺失"而不是"设计缺失"，处理方式是：

| 阶段 | 能做的事 | 做法 |
|------|---------|------|
| 本地（无 Docker） | 验证脚本语法、压测本身 | 用"方式三：本地 k6 + 本地 Python 服务"（见 README），只跑 k6 看汇总 |
| 本地（无 Docker） | 验证配置文件语法 | `prometheus.yml` / provisioning yml 为纯静态配置，Grafana 导入的 dashboard JSON 用 `python -m json.tool` 校验 |
| CI（ubuntu-latest，有 Docker） | 端到端跑通监控链路 | `perf-test.yml` 里的 `k6-load-test-prometheus` job，起 monitoring profile + k6 remote write |

补充说明两点限制：

1. **node_exporter 在 Windows + Docker Desktop 下只能看到容器视角的主机指标**。完整的宿主
   `/proc` 采集需要在 Linux 宿主机上追加只读挂载（见 `docker-compose.yml` 中的注释块）。
2. **被测服务 `api` 目前没有暴露 `/metrics`**。要采集"服务侧"指标（如 SQLite 查询耗时、
   请求数），需要给 FastAPI 装 `prometheus-fastapi-instrumentator`，然后在
   `prometheus/prometheus.yml` 里打开注释掉的 `demo-api` job。这一步留到后续 Week 做。

---

## 九、常见坑速查

| 现象 | 原因 | 解决 |
|------|------|------|
| Prometheus 报 404 接收 remote write | 没开接收器 | 加 `--web.enable-remote-write-receiver` |
| 面板里 `k6_http_req_duration_seconds` 取不到数 | k6 没开 native histogram | 加 `K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true` |
| 只用 `sum by (le)` 却报 "le not found" | 用的是 native histogram 模式 | native histogram 下 `histogram_quantile` 不需要 `by (le)` 也能算；本面板沿用官方写法，两者兼容 |
| 导入面板提示 datasource not found | 面板里写死了 datasource uid | 数据源 provisioning 里固定 `uid: prometheus`，面板按同一 uid 引用 |
| 压测结束曲线还在跑 | remote write 没发 stale marker | 加 `K6_PROMETHEUS_RW_STALE_MARKERS=true` |
| Grafana 面板没有 `name` 标签可用 | 脚本里没给请求打 `tags.name` | 请求必须带 `tags: { name: 'xxx' }`（我们的脚本已打） |
| 主机 CPU 曲线看不到宿主机真实值 | node_exporter 未挂宿主 `/proc` | Linux 宿主追加挂载；Windows 下接受该限制 |

---

## 十、Day 7 小结

| 知识点 | 掌握程度 |
|--------|---------|
| 分清 scrape 与 remote write 两种数据入口 | ✓ |
| k6 → Prometheus → Grafana 全链路串通（配置层） | ✓ |
| Grafana provisioning：数据源与面板自动加载 | ✓ |
| 用 `histogram_quantile` 从直方图算任意百分位 | ✓ |
| k6 指标到 Prometheus 指标名的映射规则（含后缀规则） | ✓ |
| 用脚本 tags 作为时间序列标签做接口维度下钻 | ✓ |
| 面板阈值与 CI 门禁使用同一套标准 | ✓ |

下一步（Week 2 衔接点）：给被测服务接入 `prometheus-fastapi-instrumentator`，
在同一个 Grafana 里叠上"服务侧指标 + 主机指标 + 压测指标"三层视图，再做瓶颈定界。
