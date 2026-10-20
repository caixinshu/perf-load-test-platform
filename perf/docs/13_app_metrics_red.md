# 13 - 应用指标埋点与 RED 监控（Week 2 Day 8）

> 目标：给被测 FastAPI 服务加上 Prometheus 指标埋点，暴露 `/metrics` 端点，实现 RED 三要素监控。
> 这是 Week 1「监控栈」缺的那块拼图——之前只有压测侧（k6）和主机侧（node_exporter）指标，
> 今天补上**应用侧**指标，三层视图凑齐。

---

## 一、Prometheus 四种指标类型

| 类型 | 特点 | 典型用途 | 示例 | 本项目用在哪 |
|------|------|---------|------|-------------|
| **Counter** | 只增不减的计数器（重启归零） | 请求总数、错误总数 | `http_requests_total` | 每个请求 +1 |
| **Gauge** | 可增可减的瞬时值 | CPU 使用率、内存、在线用户数 | `http_active_requests` | 活跃请求数（进 +1 / 出 -1） |
| **Histogram** | 直方图，观测值落入预定义的桶 | 响应时间分布、请求大小分布 | `http_request_duration_seconds` | 每个请求耗时入桶 |
| **Summary** | 摘要，客户端直接算百分位 | 百分位响应时间 | `request_latency_seconds` | 未用（见下文选型） |

### Histogram vs Summary 选型

两者都能算百分位，但机制完全不同：

| 维度 | Histogram | Summary |
|------|-----------|---------|
| 百分位在哪算 | **Prometheus 服务端**（`histogram_quantile()`） | **客户端**（应用进程内） |
| 能否聚合 | ✅ 多个实例的桶可以相加后再算分位 | ❌ 已算好的分位数不能再平均/聚合 |
| 灵活性 | 查询时任意选 p90/p95/p99 | 埋点时就定死哪几个分位 |
| 客户端开销 | 低（只计数入桶） | 高（要维护流式分位算法） |

**结论：用 Histogram。** 只要可能需要跨实例聚合、或事后想换分位数，Histogram 都更灵活。
这也是 Week 1 k6 remote write 选 native histogram 的同一个道理。

### Counter 的正确用法：配合 rate()

Counter 的绝对值意义不大（只增不减），**永远配合 `rate()` / `irate()` 用**：

```promql
# 每秒请求数（Rate 要素）
rate(http_requests_total[1m])

# 错误率（Errors 要素）：5xx 占比
sum(rate(http_requests_total{status_code=~"5.."}[1m]))
/
sum(rate(http_requests_total[1m]))
```

### Histogram 的正确用法：histogram_quantile()

```promql
# p95 响应时间（Duration 要素）
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))

# 按接口拆开的 p95
histogram_quantile(0.95, sum by (le, path) (rate(http_request_duration_seconds_bucket[5m])))
```

注意必须 `sum by (le)`——Histogram 在 Prometheus 里每个桶是一条独立序列，
要先按 `le` 聚合，才能算分位。

---

## 二、RED 监控方法

**RED = Rate + Errors + Duration**，是面向**服务**的监控三要素：

| 要素 | 含义 | 本项目的指标 | PromQL |
|------|------|-------------|--------|
| **R**ate | 每秒请求数，衡量吞吐量 | `http_requests_total` | `sum(rate(http_requests_total[1m]))` |
| **E**rrors | 错误率，衡量正确性 | `http_requests_total` 的 `status_code` 标签 | `sum(rate(http_requests_total{status_code=~"5.."}[1m])) / sum(rate(http_requests_total[1m]))` |
| **D**uration | 响应时间，衡量速度 | `http_request_duration_seconds` | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))` |

### RED vs USE：一个看服务，一个看资源

| 方法 | 面向 | 三要素 | 回答的问题 |
|------|------|--------|-----------|
| **RED** | 服务（Service） | Rate / Errors / Duration | 这个服务好不好？ |
| **USE** | 资源（Resource） | Utilization / Saturation / Errors | 这个资源饱没饱和？ |

**定位瓶颈时的组合拳**：先用 RED 发现"哪个服务慢"（应用指标），
再用 USE 分析"哪个资源有问题"（node_exporter 的主机指标）。
这就是 Week 1 搭监控栈时说的"三层视图"的方法论基础——Day 10 瓶颈定位会完整展开。

---

## 三、实现：手写中间件埋点

周计划给了两种方式：手写中间件（理解原理）和 `prometheus-fastapi-instrumentator`（一键埋点）。
**按学习建议先手写一遍**，改动在 quality-pipeline-demo 的 `app/main.py`。

### 指标定义

```python
REQUEST_COUNT = Counter(
    "http_requests_total", "Total HTTP requests",
    ["method", "path", "status_code"],      # status_code 标签 => Errors 要素
)
REQUEST_DURATION = Histogram(
    "http_request_duration_seconds", "HTTP request duration in seconds",
    ["method", "path"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
)
ACTIVE_REQUESTS = Gauge("http_active_requests", "Number of active HTTP requests")
```

桶的选择依据：当前受控基线 p50≈9ms / p95≈26ms（冒烟）、p95≈1s（负载），
桶从 5ms 铺到 10s，两头都留余量——**桶要按自己系统的响应时间分布来定，不能照抄默认值**。

### 中间件

```python
@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    if request.url.path == "/metrics":            # 细节 1：自排除
        return await call_next(request)

    ACTIVE_REQUESTS.inc()
    start_time = time.time()
    try:
        response = await call_next(request)
    finally:
        ACTIVE_REQUESTS.dec()                     # 细节 2：finally 保证 Gauge 不泄漏

    duration = time.time() - start_time
    route = request.scope.get("route")            # 细节 3：路由模板
    path = getattr(route, "path", request.url.path)

    REQUEST_COUNT.labels(method=request.method, path=path,
                         status_code=str(response.status_code)).inc()
    REQUEST_DURATION.labels(method=request.method, path=path).observe(duration)
    return response

@app.get("/metrics", include_in_schema=False)
def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
```

### 三个工程细节（比计划示例多做的）

| 细节 | 问题 | 做法 |
|------|------|------|
| **`/metrics` 自排除** | Prometheus 每 5s scrape 一次，若计入统计，自监控流量会污染 Rate（周计划坑 1） | 中间件开头直接放行，不计数 |
| **Gauge 用 try/finally** | 若 `call_next` 抛异常，`dec()` 不执行，活跃数只增不减，Gauge 就废了 | `finally` 里 `dec()` |
| **path 用路由模板** | `/items/123`、`/items/456` 各生成一条序列，标签基数爆炸，Prometheus 会被拖垮 | 从 `request.scope["route"].path` 取模板 `/items/{item_id}`；`call_next` 返回时路由已匹配，模板可得 |

### 简化版：prometheus-fastapi-instrumentator

理解原理后，实际项目可以用现成库一行搞定：

```python
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app)
```

自动暴露 `/metrics`，自带 `http_requests_total` / `http_request_duration_seconds` /
`http_request_size_bytes` / `http_response_size_bytes` / `http_requests_active`。
**面试问原理能答上来（就是上面那套中间件），干活用库效率更高。**

---

## 四、Prometheus 采集配置

`perf/monitoring/prometheus/prometheus.yml` 中 Week 1 预留的注释 job 正式打开：

```yaml
- job_name: demo-api
  metrics_path: /metrics
  scrape_interval: 5s   # 应用指标比主机指标采得密一些，压测时曲线更细腻
  static_configs:
    - targets: ['api:8000']
```

scrape 间隔的权衡：太短（如 1s）会让 `/metrics` 流量占比过高、序列存储膨胀；
太长（如 30s）压测曲线会糊。**5s 是压测观察与开销的平衡点**（周计划示例用 2s，坑 1 建议 5-15s，取 5s）。

---

## 五、本地验证（Windows + uvicorn，无 Docker）

本机没有 Docker，验证分两步：本机验证 `/metrics` 端点本身，端到端 scrape 留给 CI。

### 验证过程

启动服务后，制造 5 类流量（含一次故意的 404）：

```bash
curl http://localhost:8000/health
curl http://localhost:8000/items
curl http://localhost:8000/items/1        # 存在
curl http://localhost:8000/items/99999    # 不存在 -> 404
curl -X POST http://localhost:8000/items -d '{"name":"metrics_test","price":9.9}'
curl http://localhost:8000/metrics
```

### 验证结果（实际输出节选）

**Counter（Rate + Errors）**——5 个请求全部计入，404 单独一条序列：

```
http_requests_total{method="GET",path="/health",status_code="200"} 1.0
http_requests_total{method="GET",path="/items",status_code="200"} 1.0
http_requests_total{method="GET",path="/items/{item_id}",status_code="200"} 1.0
http_requests_total{method="GET",path="/items/{item_id}",status_code="404"} 1.0   ← Errors 要素
http_requests_total{method="POST",path="/items",status_code="200"} 1.0
```

**Histogram（Duration）**——0.21s 的 `/items` 请求正确落入 `le="0.25"` 桶：

```
http_request_duration_seconds_bucket{le="0.005",method="GET",path="/items"} 0.0
http_request_duration_seconds_bucket{le="0.01",method="GET",path="/items"} 0.0
...
http_request_duration_seconds_bucket{le="0.25",method="GET",path="/items"} 1.0    ← 落桶正确
http_request_duration_seconds_count{method="GET",path="/items"} 1.0
http_request_duration_seconds_sum{method="GET",path="/items"} 0.2139
```

**Gauge（饱和度）**——请求结束后归零：

```
http_active_requests 0.0
```

**两个细节验证**：
- `path="/metrics"` 的序列**不存在** → 自排除生效 ✓
- `/items/1` 和 `/items/99999` 归并到同一条 `path="/items/{item_id}"` → 路由模板生效 ✓

### RED 三要素核对

| 要素 | 数据来源 | 状态 |
|------|---------|------|
| Rate | `rate(http_requests_total[1m])` | ✓ 可查 |
| Errors | `status_code="404"` 序列已出现 | ✓ 可查 |
| Duration | bucket/count/sum 完整 | ✓ 可查 |

> 端到端验证（Prometheus 真的 scrape 到这些指标）需要 Docker 起监控栈，本机做不了，
> 由 CI 的 `k6-load-test-prometheus` job 或后续本地装 Docker 后验证。验证 PromQL：
> `rate(http_requests_total[1m])`、`http_request_duration_seconds_bucket`。

---

## 六、对既有流水线的影响

| 影响面 | 评估 |
|--------|------|
| quality-pipeline-demo 的单测/API 测试 | 中间件是附加逻辑，不改任何接口返回结构，不影响 |
| Docker 构建 | `requirements.txt` 新增 `prometheus-client`，镜像构建时自动安装 |
| 性能基线 | 中间件每请求增加 `time.time()` × 2 + 三次标签计数，开销在微秒级，相对当前 p95 基线（26ms / 1.02s）可忽略；若 Day 9 复测基线有漂移，按 Week 1 规则重测 |
| CI 监控 job | `demo-api` job 打开后，Prometheus 会 scrape `api:8000/metrics`，CI 里 api 容器已带新代码（clone develop 分支构建），链路自洽 |

---

## 七、Day 8 小结

| 知识点 | 掌握程度 |
|--------|---------|
| 四种指标类型及适用场景 | ✓ |
| Histogram vs Summary 选型（可聚合性是关键差异） | ✓ |
| Counter 配 rate()、Histogram 配 histogram_quantile() 的查询套路 | ✓ |
| RED 三要素监控 + RED/USE 分工 | ✓ |
| 手写中间件埋点（原理） | ✓ |
| `/metrics` 自排除、Gauge try/finally、路由模板防基数爆炸 | ✓ |
| Prometheus 采集配置（scrape_interval 权衡） | ✓ |
| 本地验证指标输出（RED 三要素均可查） | ✓ |

**三层视图现状**：压测侧 k6（Day 7 ✓）+ 主机侧 node_exporter（Day 7 ✓）+ 应用侧 /metrics（Day 8 ✓）。
Day 9 把 k6 结果接进 Grafana 看板，三层数据就能在同一屏上联动分析了。
