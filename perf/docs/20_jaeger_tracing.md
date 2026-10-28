# 20. Jaeger 链路追踪接入（Week 3 Day 17）

> 目标：给 3 个服务接入 OpenTelemetry 链路追踪，用 Jaeger 查看完整的调用链路。

## 一、核心概念

| 概念 | 说明 |
|------|------|
| **Trace** | 一次请求的完整调用链路，跨越多个服务 |
| **Span** | 链路中的一个操作（一次 HTTP 调用、一次 DB 查询） |
| **Trace ID** | 整条链路的唯一标识，所有 span 共享 |
| **Span ID** | 每个 span 的唯一标识 |
| **Parent Span ID** | 父 span 的 ID，形成调用树 |

**为什么重要**：微服务架构下，一次请求可能穿过十几个服务。出问题时不知道哪个服务慢、哪个服务报错。有了链路追踪，一眼就能看到整个调用链和每个服务的耗时。

## 二、OpenTelemetry（OTel）

CNCF 项目，统一可观测性数据标准，三大支柱：
- **Tracing**：链路追踪
- **Metrics**：指标
- **Logging**：日志

自动埋点（auto-instrumentation）：一行 `instrument_app()` 就能自动采集 HTTP 请求的入站和出站 span，对业务代码零侵入。

## 三、接入方案

### 3.1 公共模块 `services/tracing.py`

```python
from tracing import init_tracing, instrument_fastapi, instrument_httpx, instrument_psycopg2

init_tracing("product-service")
instrument_fastapi(app)
instrument_psycopg2()
```

**降级策略**：
- 通过 `OTEL_ENABLED` 环境变量控制是否启用（默认 `false`，本地无 Jaeger 时关闭）
- `OTEL_JAEGER_HOST` / `OTEL_JAEGER_PORT` 配置 Jaeger agent 地址
- 如果 OTel 依赖未安装或初始化失败，静默跳过，不影响业务

### 3.2 各服务接入

| 服务 | FastAPI | httpx | psycopg2 | service.name |
|------|---------|-------|----------|-------------|
| api-gateway | ✅ | ✅ | — | api-gateway |
| product-service | ✅ | — | ✅ | product-service |
| order-service | ✅ | ✅ | ✅ | order-service |

### 3.3 依赖

```
opentelemetry-api
opentelemetry-sdk
opentelemetry-instrumentation-fastapi
opentelemetry-instrumentation-httpx
opentelemetry-instrumentation-psycopg2
opentelemetry-exporter-jaeger
```

## 四、Jaeger 部署

`docker-compose.services.yml` 中增加：

```yaml
jaeger:
  image: jaegertracing/all-in-one:1.52
  ports:
    - "16686:16686"   # Jaeger UI
    - "6831:6831/udp" # agent 接收 thrift
```

3 个服务配置环境变量：
```yaml
environment:
  - OTEL_ENABLED=true
  - OTEL_JAEGER_HOST=jaeger
```

## 五、验证链路追踪

### 5.1 启动

```bash
docker compose -f docker-compose.services.yml up -d --build
```

### 5.2 触发链路

```bash
curl -X POST http://localhost:8000/orders \
  -H "Content-Type: application/json" \
  -d '{"product_id": 1, "quantity": 2}'
```

### 5.3 Jaeger UI

浏览器访问 `http://localhost:16686`：
1. 左侧 Service 选 `api-gateway`
2. 点 **Find Traces**
3. 点击一条 trace 查看详情

预期看到的链路（5 节点调用树）：

```
api-gateway (入口，POST /orders)
  └── order-service (HTTP 调用)
        ├── product-service (HTTP 调用 GET /products/1)
        │     └── product-service DB (SQL 查询)
        └── order-service DB (SQL 插入)
```

每个 span 都有：耗时、状态、标签（HTTP method、URL、status code、SQL 语句等）。

## 六、本地降级验证

本地无 Docker/PG/Redis/Jaeger 时：
- `OTEL_ENABLED` 默认 `false`，tracing 自动跳过
- 服务正常启动，业务功能不受影响
- 全链路下单测试通过（已验证）

如果设置 `OTEL_ENABLED=true` 但无 Jaeger：
- JaegerExporter 用 BatchSpanProcessor 异步发送，连接失败不影响请求处理
- 服务正常运行，只是 span 数据发不出去

## 七、踩坑记录

| 问题 | 原因 | 解决 |
|------|------|------|
| `No module named 'deprecated'` | psycopg2 instrumentation 依赖 `deprecated` 包，本地 pip 未自动安装 | Docker 中 `pip install -r requirements.txt` 会自动安装；本地可手动 `pip install deprecated` |
| tracing.py 无法被 COPY | Docker build context 是各服务目录，公共 tracing.py 在父目录 | 把 tracing.py 复制到每个服务目录，Dockerfile 用 `COPY main.py tracing.py .` |
| Jaeger 连接失败导致服务崩溃 | JaegerExporter 同步发送会阻塞 | 使用 BatchSpanProcessor 异步发送，连接失败不影响业务 |

## 八、今日产出

- ✅ 链路追踪原理：Trace / Span / Trace ID / Span ID 概念理解
- ✅ OpenTelemetry 接入：3 个服务都接入了 OTel SDK
- ✅ 自动埋点：FastAPI + httpx + PostgreSQL 自动采集
- ✅ Jaeger 部署：all-in-one 模式，UI 可访问
- ✅ 本地降级验证：OTEL_ENABLED=false 时服务正常，全链路下单通过
