# 14 - k6 结果接入 Grafana 可视化（Week 2 Day 9）

> 目标：把 k6 的压测结果**持久化**成 Prometheus 指标，并在 Grafana 上做成一块压测结果看板。
> Day 7 解决的是「压测**过程中**看得见」，今天解决的是「压测**结束后**留得下、比得了」。

---

## 一、为什么还要单独做一条链路

Day 7 已经用 remote write 把 k6 指标推进了 Prometheus，为什么 Day 9 还要再来一遍？

因为 k6 是**短生命周期进程**——只活 30 秒到 3 分钟：

| 问题 | Day 7 remote write | Day 9 summary + Pushgateway |
|------|-------------------|------------------------------|
| 压测过程中的曲线 | ✅ 实时写入，有完整时间序列 | ❌ 只有结束后的一个快照 |
| 压测结束后的最终结果 | ⚠️ 序列还在，但混在时序里，不好"取最后一次" | ✅ 一个明确的 Gauge，随手可查 |
| 压测**失败**（阈值不过） | ⚠️ 进程退出，可能来不及 flush | ✅ 脚本 `if: always()` 照样推送留档 |
| 跨批次对比 | ❌ 时间序列越长越难比 | ✅ 按 `script` / `run_id` 标签直接过滤 |
| 查询成本 | 高（要扫一段时间的直方图） | 低（instant 查询一条 Gauge） |

**结论：两条链路互补，不是替代。**

```
                          ┌──────────────────────────────┐
压测进行中 ──remote write──▶│ Prometheus（native histogram）│──▶ 实时趋势面板（Day 7）
                          └──────────────────────────────┘
                          ┌──────────────────────────────┐
压测结束后 ──summary-export──▶ push_k6_metrics.py ──PUT──▶│ Pushgateway │──scrape──▶ Prometheus ──▶ 结果看板（Day 9）
                          └──────────────────────────────┘
```

---

## 二、k6 的输出方式对比

k6 支持多种结果输出，选错方式会带来完全不同的成本：

| 方式 | 命令 | 数据形态 | 适合场景 | 本项目结论 |
|------|------|---------|---------|-----------|
| **summary-export** | `--summary-export=out.json` | 结束时的结构化汇总（p90/p95/avg/max、TPS、失败率） | 归档、门禁复核、推送 Pushgateway | ✅ **主选** |
| JSON 明细 | `--out json=out.json` | 每个请求/指标一行，几百 MB | 离线逐请求分析、排障 | ⚠️ 体积大，只作 Artifact |
| CSV 明细 | `--out csv=out.csv` | 同上，CSV 格式 | 丢进 Excel 看 | ⚠️ 同上 |
| InfluxDB | `--out influxdb=http://...` | 时序库 | 长期保留明细、跨批次对比 | ❌ 多一个组件，本机无 Docker |
| **Prometheus remote write** | `-o experimental-prometheus-rw` | 过程指标实时写入 | 压测过程可视化 | ✅ Day 7 已用 |
| **Prometheus + Pushgateway** | summary → 脚本 → Pushgateway | 结束时一条 Gauge 快照 | 结果归档、面板展示"最近一次" | ✅ 今天新增 |

### 推送（push）vs 拉取（pull）

这是 Prometheus 生态里最容易混淆的一点：

- **拉取（scrape）**：Prometheus 定时去目标的 `/metrics` 抓。要求目标**长期在线**（应用、node_exporter 都是这种）。
- **推送（push）**：目标主动把指标发给一个接收端。k6 这种**短命进程**只能用这个。
- **remote write**：k6 直接调 Prometheus 的写接口（`/api/v1/write`），等价于"推给 Prometheus 本体"，但需要 Prometheus 开 `--web.enable-remote-write-receiver`。
- **Pushgateway**：介于两者之间——k6 推给 Pushgateway（一个常驻的中转站），Prometheus 再**用常规 scrape 去拉** Pushgateway。

> 记忆：**Prometheus 永远只会拉，不会推。** 所谓"推送"都是推到某个中转站，让它替你把数据"挂"在那里等着被抓。

---

## 三、Pushgateway 的原理与三个坑

Pushgateway 的模型极简：一个内存里的 map，`(job, 分组标签)` → 一组指标。

推送就是 `PUT /metrics/job/<job>/<label>/<value>/...`，之后 Prometheus 用普通 scrape 配置去抓 `pushgateway:9091`，指标就进入时序库了。

### 坑 1：覆盖语义

`push_to_gateway` 是**整组替换**，不是追加：

- grouping key = `{script, environment}` → 同一脚本再推一次，**上一轮结果被整组覆盖**；
- grouping key 里加 `run_id` → 每轮一个独立分组，历史保留。

默认（不带 `run_id`）正是我们想要的：看板永远显示**最近一次**结果。
如果要跨批次横向对比，才传 `--run-id`——并注意分组会无限增长，需要定期
`curl -X DELETE http://localhost:9091/api/v1/admin/wipe` 清理（所以 compose 里开了 `--web.enable-admin-api`）。

### 坑 2：`honor_labels: true` 不能漏

Pushgateway 的指标自带 `job` / `instance` 标签。如果不加 `honor_labels: true`，
Prometheus 抓取时会用自己配置的 `job=pushgateway`、`instance=pushgateway:9091` **覆盖**掉线上标签，
你在 Grafana 里就再也按 `script` / `run_id` 过滤不了了。

```yaml
  - job_name: pushgateway
    honor_labels: true          # 保留 push 时打的标签
    static_configs:
      - targets: ['pushgateway:9091']
```

### 坑 3：Pushgateway 不是"历史数据库"

它只保留**每个分组的最后一次**推送。它不是 InfluxDB，不要拿它当趋势库用。
趋势看 remote write，结果看 Pushgateway——**分工别搞混**。

---

## 四、指标推送脚本 `scripts/push_k6_metrics.py`

### 用法

```bash
# 自检：只解析不推送（本机没有 Docker / Pushgateway 时用）
python scripts/push_k6_metrics.py perf/results/load-summary.json --dry-run

# 真实推送
python scripts/push_k6_metrics.py perf/results/load-summary.json \
  --pushgateway-url http://localhost:9091 \
  --script 02-load-test \
  --environment local
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `summary`（位置参数） | — | k6 `--summary-export` 导出的 JSON |
| `--pushgateway-url` | `http://localhost:9091` | Pushgateway 地址 |
| `--job` | `k6_loadtest` | Pushgateway 的 job 名（看板按它过滤） |
| `--script` | 从文件名推断 | `xxx-summary.json` → `xxx` |
| `--run-id` | 空 | 传了才保留历史，不传则覆盖 |
| `--environment` | `local` | 环境标签，CI 里传 `ci` |
| `--dry-run` | 关 | 只打印解析结果 |

### 指标映射

| k6 summary 字段 | 推送的指标名 | 单位处理 |
|----------------|-------------|---------|
| `http_req_duration["p(95)"]` | `k6_test_http_req_duration_p95_seconds` | ms → **s**（符合 Prometheus 命名惯例） |
| `http_req_duration["p(99)"]` | `k6_test_http_req_duration_p99_seconds` | 同上；**缺失则跳过** |
| `http_req_duration.avg / max` | `k6_test_http_req_duration_avg/max_seconds` | 同上 |
| `http_reqs.rate` | `k6_test_http_reqs_rate` | 即 TPS |
| `http_reqs.count` | `k6_test_http_reqs_count` | 请求总数 |
| `http_req_failed` | `k6_test_http_req_failed_rate` | 0~1 比例 |
| `checks` | `k6_test_checks_rate` | 0~1 比例 |
| `vus_max` | `k6_test_vus_max` | 最大并发 |
| `iterations.count` | `k6_test_iterations_count` | 迭代总数 |

两个刻意的设计：

1. **缺失值不建 Gauge**。k6 默认只导出 `p(90)` / `p(95)`，`p(99)` 取不到。
   与其推一条恒为 0 的假数据（看板上 P99 = 0ms，看起来"极快"，实为没有数据），不如跳过。
   要 P99 就在 k6 命令上加 `--summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)"`。
2. **不依赖 summary 里的 `thresholds` 布尔字段**。实测它并不可靠（见"常见坑"第 4 条），门禁交给 k6 退出码。

### 实测输出

真实 summary（10 VU / 30s，10 个指标中 `p(99)` 缺失被跳过，实际推 9 个）：

```
summary : perf/results/day9-summary.json
script  : day9
指标数  : 9
--------------------------------------------------------------
k6_test_http_req_duration_p95_seconds                          0.5363
k6_test_http_req_duration_avg_seconds                          0.1017
k6_test_http_req_duration_max_seconds                          1.2055
k6_test_http_reqs_rate                                         8.5428
k6_test_http_reqs_count                                      263.0000
k6_test_http_req_failed_rate                                   0.0000
k6_test_checks_rate                                            1.0000
k6_test_vus_max                                               10.0000
k6_test_iterations_count                                     263.0000
--------------------------------------------------------------
dry-run：未推送
```

本机没有 Docker，用临时起的一个假 Pushgateway 验证了真实 PUT：

```
PUT /metrics/job/k6_loadtest/environment/local/script/01-simple-get
→ 200 OK，payload 中 9 条指标名与数值均正确
```

---

## 五、Prometheus 与 Grafana 配置

### docker-compose（`monitoring` profile 新增 pushgateway）

```yaml
  pushgateway:
    image: prom/pushgateway:v1.9.0
    profiles: ["monitoring"]
    ports: ["9091:9091"]
    command:
      - --persistence.file=/data/pushgateway.data   # 重启不丢上一轮结果
      - --persistence.interval=5m
      - --web.enable-admin-api                       # 允许 wipe 清理历史批次
    volumes: ["pushgateway_data:/data"]
```

### 启动

```bash
docker compose --profile monitoring up -d           # prometheus + grafana + node-exporter + pushgateway
python scripts/push_k6_metrics.py perf/results/load-summary.json --script 02-load-test --environment local
# 等一个 scrape 周期（15s）后查
curl -s 'http://localhost:9090/api/v1/query?query=k6_test_http_req_duration_p95_seconds' | head -c 500
```

Grafana → `http://localhost:3000` → Dashboards → **k6 压测结果看板**。

---

## 六、看板设计：7 类面板

文件：[`perf/monitoring/grafana/dashboards/k6-load-test-result.json`](../monitoring/grafana/dashboards/k6-load-test-result.json)
（uid `k6-loadtest-result`），分 4 个 Row、共 11 个 panel，覆盖计划要求的 7 类。

| # | 面板 | 类型 | 数据来源 | 关键 PromQL | 怎么读 |
|---|------|------|---------|------------|--------|
| 1 | **核心指标卡片**（P95 / P99 / TPS / 失败率） | stat ×4 | k6 native histogram，缺失时回退应用侧 | `histogram_quantile(0.95, sum by (le) (rate(k6_http_req_duration_seconds[$__rate_interval]))) * 1000` | 四个数一眼判断"这轮能不能过门禁" |
| 2 | **响应时间趋势** | timeseries | k6 | `histogram_quantile(0.95/0.99, ...)` | 看爬升拐点：什么时候开始劣化 |
| 3 | **TPS 趋势** | timeseries | 应用侧 + k6 两条线 | `sum(irate(http_requests_total{job="demo-api"}[...]))` / `sum(irate(k6_http_reqs_total{...}[...]))` | 两条线是否贴合 = 客户端视角与服务端视角是否一致 |
| 4 | **CPU 使用率** | timeseries | node_exporter | `100 - avg by (instance)(rate(node_cpu_seconds_total{mode="idle"}[...])) * 100` | 配合 TPS 看是否已成 CPU 瓶颈 |
| 5 | **内存使用率** | timeseries | node_exporter | `max by (instance)((1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100)` | 稳态压测时缓慢上升 = 疑似泄漏 |
| 6 | **响应时间分布 Heatmap** | heatmap | 应用侧 Histogram | `sum(rate(http_request_duration_seconds_bucket{job="demo-api"}[...])) by (le)` | 不只看 p95：是整体右移，还是只有一小撮请求慢 |
| 7 | **错误率 Gauge** | gauge | k6 + 应用侧 5xx | `sum(rate(http_requests_total{status_code=~"5.."}[...])) / sum(rate(http_requests_total[...]))` | 红区即门禁失败 |
| 附 | **最近一次压测结果** | stat ×5 | Pushgateway | `max by (script)(k6_test_http_req_duration_p95_seconds{job="k6_loadtest"}) * 1000` | 压测已结束也能看，且按脚本区分 |

设计上的三个取舍：

1. **`or` 回退**：k6 侧 native histogram 只在 remote write 链路存在。普通 k6 跑（不带 `-o`）时，
   `k6_http_req_duration_seconds` 根本不存在，面板会全空。所以核心卡片用
   `k6 查询 or 应用侧查询`，保证"至少有一侧数据"。
2. **单位统一**：k6 native histogram 是**秒**，应用侧 Histogram 也是**秒**，
   stat 面板乘 1000 显示毫秒——面板上看到的是 ms，指标存储仍是 s，符合 Prometheus 惯例。
3. **`testid` 变量**来自 `label_values(k6_http_reqs_total, testid)`（k6 每次运行自动打），
   支持多选 + All，用于对比多轮压测；没有 remote write 数据时变量为空，查询自动退到应用侧。

---

## 七、验证流程

1. **解析自检**（无需 Docker）：
   ```bash
   python scripts/push_k6_metrics.py perf/results/load-summary.json --dry-run
   ```
2. **起监控栈**：`docker compose --profile monitoring up -d`
3. **跑一轮压测**：
   ```bash
   k6 run -o experimental-prometheus-rw \
     --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
     --summary-export=perf/results/load-summary.json \
     perf/scripts/01-simple-get.js
   ```
4. **推送结果**：`python scripts/push_k6_metrics.py perf/results/load-summary.json --script 01-simple-get`
5. **确认入库**：Prometheus 查询 `k6_test_http_req_duration_p95_seconds` 有值
6. **看板观察**：压测过程中 1~7 号面板实时变化；压测结束后"最近一次结果"一行出现数据。

> 本机无 Docker，1/3（k6 本地跑）已实测，第 4 步用假 Pushgateway 实测，2/5/6 在 CI 的
> `k6-load-test-prometheus` job 里端到端验证。

---

## 八、常见坑速查

| # | 现象 | 原因 | 解法 |
|---|------|------|------|
| 1 | 看板 P99 一直空/为 0 | summary 默认只导出 p90/p95 | k6 加 `--summary-trend-stats="...,p(99)"` |
| 2 | 看板全是 0 | 指标推上去了但值是 0 | 检查是否把"缺失"当成了 0（本脚本跳过缺失值） |
| 3 | 按 `script` 过滤不到 | Prometheus 覆盖了标签 | scrape 配置加 `honor_labels: true` |
| 4 | summary 里 `thresholds: {p(95)<100: true}` 但 p95=536ms | k6 summary 的 thresholds 字段不可靠 | **不要用它做门禁**，用 k6 退出码 |
| 5 | 数值差了 1000 倍 | 单位混用（ms vs s） | summary 是 ms，Pushgateway 指标统一存 s，展示时 ×1000 |
| 6 | 上一轮结果没了 | Pushgateway 分组覆盖 | 需要历史就传 `--run-id`，并定期 wipe |
| 7 | 面板空，但 remote write 明明在跑 | `testid` 变量为空 / 时间范围不对 | 选 All 或把时间范围拉到压测时段；无 A 数据时靠 `or` 回退 |
| 8 | `--out json=` 把磁盘写满 | 逐请求明细，几百 MB | 只用 `--summary-export`，`--out json` 仅在排障时开 |
| 9 | Pushgateway 重启后结果丢了 | 没开持久化 | `--persistence.file` + 挂卷 |

---

## 九、与 Day 7 面板的关系

| 文件 | uid | 定位 |
|------|-----|------|
| [`k6-load-test.json`](../monitoring/grafana/dashboards/k6-load-test.json) | `k6-loadtest` | **压测过程中**的实时面板（VUs / p95 / TPS / 失败率 + 4 张分接口趋势） |
| [`k6-load-test-result.json`](../monitoring/grafana/dashboards/k6-load-test-result.json) | `k6-loadtest-result` | **压测结果**看板（核心卡片 + 资源 + 分布 + Pushgateway 最近结果） |

两者共用同一个 Prometheus 数据源（uid `prometheus`），Grafana provisioning 会自动扫描
`/var/lib/grafana/dashboards` 加载，无需手动 import。

---

## 十、今日产出

- [`scripts/push_k6_metrics.py`](../../scripts/push_k6_metrics.py)：summary → Pushgateway 推送脚本（含 `--dry-run`）
- [`docker-compose.yml`](../../docker-compose.yml)：新增 `pushgateway` 服务 + 持久化卷
- [`prometheus.yml`](../monitoring/prometheus/prometheus.yml)：新增 `pushgateway` 采集 job（`honor_labels: true`）
- [`k6-load-test-result.json`](../monitoring/grafana/dashboards/k6-load-test-result.json)：压测结果看板（4 Row / 11 panel，覆盖 7 类）
- `.github/workflows/perf-test.yml`：`k6-load-test-prometheus` 增加 summary 导出、p99 统计、推送与入库校验
