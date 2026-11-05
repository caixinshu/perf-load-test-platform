# 混沌工程与故障注入

## 一、什么是混沌工程

混沌工程 = **有目的、有控制地在系统中注入故障，验证系统的韧性**。

不是搞破坏，是提前发现弱点，避免线上出问题。

> 核心思想：复杂系统一定会出故障，与其等它出事，不如主动搞事。

Netflix 是混沌工程的鼻祖（Chaos Monkey —— 随机杀死生产环境的服务实例）。

## 二、故障类型与验证目标

| 故障类型 | 注入方式 | 验证什么 |
|---------|---------|---------|
| 网络延迟 | 增加请求延迟 | 超时设置是否合理 |
| 网络丢包 | 丢弃一定比例的包 | 重试机制是否有效 |
| 服务不可用 | 断开服务连接 | 降级/熔断是否生效 |
| 高 CPU | 消耗 CPU 资源 | 系统在高负载下的表现 |
| 高内存 | 占用大量内存 | 内存不足时的 OOM 处理 |
| 磁盘慢 | 增加 IO 延迟 | IO 密集型操作的容错 |

## 三、Toxiproxy 入门

[Toxiproxy](https://github.com/Shopify/toxiproxy) 是 Shopify 开源的 TCP 代理故障注入工具。

**原理**：在客户端和服务端之间加一层代理，代理可以注入各种故障。

**支持的故障类型（toxics）**：
- `latency` — 网络延迟
- `down` — 服务不可用（断开连接）
- `bandwidth` — 限制带宽
- `slow_close` — 延迟关闭连接
- `timeout` — 超时
- `slicer` — 数据包切片（模拟丢包）

**管理 API**（端口 8475）：

```bash
# 创建 proxy
curl -X POST http://localhost:8475/proxies \
  -H 'Content-Type: application/json' \
  -d '{"name":"product-service","listen":"0.0.0.0:8474","upstream":"product-service:8000"}'

# 添加 toxic（注入 200ms 延迟）
curl -X POST http://localhost:8475/proxies/product-service/toxics \
  -H 'Content-Type: application/json' \
  -d '{"name":"latency_toxic","type":"latency","attributes":{"latency":200,"jitter":50}}'

# 移除 toxic
curl -X DELETE http://localhost:8475/proxies/product-service/toxics/latency_toxic
```

## 四、部署架构

```
client (k6)
   |
   v
api-gateway:8000
   |                    \
   | (PRODUCT_URL=        \ (ORDER_URL=order-service:8002)
   |  http://toxiproxy:8474)
   v                       v
toxiproxy:8474  --->  product-service:8000
   (故障注入层)
```

Toxiproxy 插在 gateway 和 product-service 之间，所有对商品服务的调用都会经过代理，可以动态注入/移除故障。

## 五、故障注入实验报告

### 实验目的
验证系统在 200ms 网络延迟下的表现。

### 实验假设
延迟 200ms 时，TPS 下降不超过 30%。

### 实验过程（5 步法）

| 步骤 | 操作 | 产出 |
|------|------|------|
| 1 | 创建 Toxiproxy proxy | proxy 就绪 |
| 2 | 基线性能测试（无故障） | `baseline-before.json` |
| 3 | 注入 200ms 延迟 toxic | 故障生效 |
| 4 | 有延迟时的性能测试 | `baseline-with-latency.json` |
| 5 | 移除故障 + 恢复测试 | `baseline-after.json` |

### 实验结果（示例数据）

| 指标 | 基线 | 200ms 延迟 | 恢复后 |
|------|------|-----------|--------|
| TPS (req/s) | 150 | 90 | 148 |
| P95 (ms) | 50 | 280 | 52 |
| 错误率 | 0% | 0% | 0% |

### 实验结论
- **假设不成立**：200ms 延迟导致 TPS 下降 40%，超过预期的 30%
- 故障移除后 TPS 恢复到 148（与基线 150 基本一致），说明系统**可恢复**
- 当前系统对网络延迟较敏感，缺少超时控制和重试机制

### 改进建议
1. **增加超时时间**：gateway 调用 product-service 时设置合理的请求超时
2. **增加重试机制**：对幂等接口（如 GET /products/{id}）增加 1-2 次重试
3. **考虑熔断降级**：当 product-service 延迟过高时，返回降级数据而非阻塞

## 六、安全原则

混沌工程不是瞎搞，必须遵守以下原则：

1. **有明确的假设和预期** —— 先写清楚"注入 X 故障，预期系统表现 Y"，再动手
2. **从小故障开始，逐步加大** —— 先 50ms 延迟，再 200ms，最后 1s
3. **随时可以停止和恢复** —— 所有 toxic 都能通过 API 即时移除
4. **环境隔离** —— 先测试环境，再预发，最后才考虑生产
5. **有紧急停止按钮** —— 出现异常立即停止实验并移除所有故障

## 七、运行实验

### Windows
```powershell
docker compose -f docker-compose.chaos.yml up -d --build
.\scripts\chaos-experiment.ps1
```

### Linux / CI
```bash
docker compose -f docker-compose.chaos.yml up -d --build
bash scripts/chaos-experiment.sh
```

### 生成对比报告
```bash
python scripts/generate_perf_report.py --summary reports/baseline-before.json --output reports/report-before.html
python scripts/generate_perf_report.py --summary reports/baseline-with-latency.json --output reports/report-with-latency.html
python scripts/generate_perf_report.py --summary reports/baseline-after.json --output reports/report-after.html
```
