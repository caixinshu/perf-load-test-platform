# k6 指标解读笔记

> Day 2 学习笔记 · 7 个核心指标含义 + 输出格式 + VU 与 TPS 关系

---

## 一、k6 输出指标详解

运行 `k6 run perf/scripts/base/01-simple-get.js` 后，k6 会输出如下报告：

```
  checks.........................: 100.00% ✓ 297       ✗ 0
  data_received..................: 88 kB   2.9 kB/s
  data_sent......................: 36 kB   1.2 kB/s
  http_req_blocked...............: avg=125.41µs min=0s med=0s max=10ms
  http_req_connecting............: avg=34.83µs  min=0s med=0s max=2ms
  http_req_duration..............: avg=2.38ms   min=1ms med=2ms max=15ms
    { expected_response:true }...: avg=2.38ms   min=1ms med=2ms max=15ms
  http_req_failed................: 0.00%  ✓ 0         ✗ 297
  http_req_receiving.............: avg=184.62µs min=0s med=0s max=1ms
  http_req_sending...............: avg=75.29µs  min=0s med=0s max=500µs
  http_req_tls_handshaking.......: avg=0s       min=0s med=0s max=0s
  http_req_waiting...............: avg=2.12ms   min=1ms med=2ms max=14ms
  http_reqs......................: 297    9.894299/s
  iteration_duration.............: avg=1s       min=1s med=1s max=1.01s
  iterations.....................: 297    9.894299/s
  vus............................: 10     min=10 max=10
  vus_max........................: 10     min=10 max=10
```

---

## 二、7 个核心指标

| 指标 | 含义 | 本次测试值 | 说明 |
|------|------|-----------|------|
| `checks` | 断言通过率 | 100% (297/297) | 所有 check 都通过了 |
| `http_req_duration` | 请求响应时间 | avg=2.38ms | 平均 2.38 毫秒，很快 |
| `http_reqs` | 总请求数 / 每秒 | 297 / 9.9/s | 每秒约 10 个请求（TPS） |
| `iterations` | 总迭代数 / 每秒 | 297 / 9.9/s | 每个 VU 每秒约 1 次迭代 |
| `vus` | 当前虚拟用户数 | 10 | 10 个并发用户 |
| `vus_max` | 最大虚拟用户数 | 10 | 测试过程中最大 VU 数 |
| `http_req_failed` | 失败请求率 | 0% | 没有失败请求 |

---

## 三、响应时间细分

`http_req_duration` 是总响应时间，k6 还会拆分各个阶段：

| 阶段 | 指标 | 含义 | 本次值 |
|------|------|------|--------|
| 阻塞 | `http_req_blocked` | 等待连接分配的时间 | 125µs |
| 连接 | `http_req_connecting` | TCP 连接建立时间 | 35µs |
| TLS | `http_req_tls_handshaking` | TLS 握手时间（HTTP 无） | 0s |
| 发送 | `http_req_sending` | 请求数据发送时间 | 75µs |
| 等待 | `http_req_waiting` | 等待服务器响应时间 | 2.12ms |
| 接收 | `http_req_receiving` | 响应数据接收时间 | 185µs |

**关键**：`http_req_waiting` 通常占总时间最大比例，这是服务器处理时间。

---

## 四、VU 和 TPS 的关系

### 核心公式

```
TPS = VU / (平均响应时间 + 思考时间)
```

### 本次测试计算

| 参数 | 值 |
|------|-----|
| VU | 10 |
| 平均响应时间 | 2.38ms ≈ 0.002s |
| 思考时间（sleep） | 1s |
| 每次迭代耗时 | 0.002s + 1s ≈ 1.002s |
| 每用户每秒请求数 | 1 / 1.002 ≈ 0.998 |
| **理论 TPS** | 10 × 0.998 ≈ **9.98** |
| **实际 TPS** | **9.89** |

理论值和实际值非常接近，验证了公式的正确性。

### 去掉 sleep 会怎样？

如果去掉 `sleep(1)`：
- 每次迭代耗时 ≈ 0.002s
- 每用户每秒请求数 = 1 / 0.002 = 500
- 理论 TPS = 10 × 500 = **5000**

**但实际不会这么高**，因为：
1. 网络有延迟
2. 服务器有并发处理能力上限
3. 连接建立有开销

去掉 sleep 就是**压力测试**的做法，不是常规负载测试。

---

## 五、数据传输指标

| 指标 | 含义 | 本次值 | 说明 |
|------|------|--------|------|
| `data_received` | 接收数据量 | 88 kB (2.9 kB/s) | 从服务器接收的数据 |
| `data_sent` | 发送数据量 | 36 kB (1.2 kB/s) | 发送到服务器的数据 |

可以用来估算带宽需求：如果 TPS 1000，接收带宽 ≈ 2.9 kB/s × 100 ≈ 290 kB/s。

---

## 六、k6 结果输出格式

### 1. 终端输出（默认）

```bash
k6 run perf/scripts/base/01-simple-get.js
```
- 最常用，快速查看结果
- 实时显示进度条
- 结束后显示摘要报告

### 2. JSON 输出

```bash
k6 run --out json=perf/results/result.json perf/scripts/base/01-simple-get.js
```
- NDJSON 格式（每行一个 JSON 对象）
- 包含每个请求的详细数据
- 适合后续用 Python/jq 分析

### 3. CSV 输出

```bash
k6 run --out csv=perf/results/result.csv perf/scripts/base/01-simple-get.js
```
- 适合用 Excel 分析
- 每行一个指标数据点

### 4. InfluxDB + Grafana（后续学习）

```bash
k6 run --out influxdb=http://localhost:8086/k6 perf/scripts/base/01-simple-get.js
```
- 实时可视化
- 支持历史数据对比
- Day 6-7 会搭建

---

## 七、k6 退出码

| 退出码 | 含义 | 用途 |
|--------|------|------|
| 0 | 全部通过 | CI 中继续后续步骤 |
| 非 0 | 有失败（threshold 不通过） | CI 中中断流水线 |

**CI 用法**：在 GitHub Actions 中，k6 退出码非 0 会自动中断流水线，实现性能门禁。

---

## 八、一句话总结

> k6 输出看三行：`checks` 看通过率、`http_req_duration` 看响应时间、`http_reqs` 看 TPS。VU 和 TPS 的关系是 `TPS = VU / (RT + sleep)`，加 sleep 模拟真实用户，去掉 sleep 是压力测试。
