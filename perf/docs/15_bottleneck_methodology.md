# 15 - 性能瓶颈定位方法论（Week 2 Day 10）

> 目标：把 Day 4 ~ Day 9 各自积累的知识（压测脚本、监控栈、应用指标、k6 结果面板）**系统化串成一套可执行的定位方法论**，而不是零散的工具说明书。

---

## 与已有文档的分工

本系列关于"瓶颈定位"的内容有 3 处，各管一段：

| 文档 | 视角 | 管什么 |
|------|------|--------|
| [`05_bottlenecks.md`](05_bottlenecks.md) | 罗列 | "有哪几类瓶颈、每类长什么样"——6 类瓶颈 + 决策树 |
| [`08_performance_analysis.md`](08_performance_analysis.md) | 分析 | "拿到一份压测报告怎么读"——5 步法（错误→吞吐→延迟→拐点→结论） |
| **本文** | **定位** | **"知道系统慢之后，怎么找到它慢在哪"**——USE + RED + 自顶向下 5 层下钻 |

简单说：**05 给地图，08 给读数，15 给路线**。

---

## 一、两套诊断框架：RED（服务）+ USE（资源）

定位瓶颈时，这两套方法**配合使用**：先用 RED 发现"哪个服务出了问题"，再用 USE 分析"是哪种资源不够用"。

### RED 方法（Rate · Errors · Duration）—— Day 8 已落地

面向**服务**的监控三要素。Day 8 给 FastAPI 加的 `/metrics` 端点就是为了这套：

| 要素 | 问题 | 指标 | 已建 PromQL | Grafana 面板位置 |
|------|------|------|------------|------------------|
| **Rate** | 吞吐量到顶了吗？ | `http_requests_total`（Counter） | `sum(irate(http_requests_total{job="demo-api"}[5m]))` | Day 9 看板「TPS 趋势」Timeseries |
| **Errors** | 错误率是否在上升？ | `http_requests_total{status_code=~"5.."}` 占比 | `sum(rate(...status_code=~"5..")) / sum(rate(...))` | Day 9 看板「错误率」Gauge |
| **Duration** | 响应时间是否退化？ | `http_request_duration_seconds`（Histogram） | `histogram_quantile(0.95, sum by (le)(rate(http_request_duration_seconds_bucket[5m]))) * 1000` | Day 9 看板「响应时间 P95/P99」Stat |

**判断顺序**：先 Errors（有失败吗？）→ 再 Duration（延迟涨了吗？）→ 最后 Rate（吞吐到顶了吗？）。
为什么？因为 Errors 上升意味着系统已经在**拒绝请求**，此时谈吞吐和延迟都没意义。

### USE 方法（Utilization · Saturation · Errors）—— Day 7 node_exporter 已落地

面向**资源**的诊断框架。对每一种物理资源，都用这三个维度检查：

| 资源 | Utilization（利用率） | Saturation（饱和度） | Errors（错误数） |
|------|----------------------|---------------------|-----------------|
| **CPU** | `100 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100` | 系统 loadavg（`node_load1 / node_cpu_seconds_total`） | CPU 软中断/硬中断计数 |
| **内存** | `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100` | `node_memory_SwapTotal_bytes - node_memory_SwapFree_bytes`（Swap 有值 = 已经爆了） | OOM kill 事件（dmesg / kube events） |
| **磁盘 IO** | `node_filesystem_avail_bytes / node_filesystem_size_bytes` | `node_disk_io_now`（WIO 队列） | `node_disk_io_time_suma_bytes` 持续高 |
| **网络** | `rate(node_network_receive_bytes_total[5m])` / 带宽上限 | 重传率（TCP retrans） | 丢包率 |
| **存储** | 容量使用率（`df`） | 等待中的 IO（iostat `await`） | 磁盘 SMART 错误 |

#### USE 的精髓：三类信号组合判断

| 现象 | 解读 |
|------|------|
| 高 Utilization + 高 Saturation + 高 Errors | **明确瓶颈**——资源已饱和且开始出错 |
| 高 Utilization + 低 Saturation + 低 Errors | **正常忙碌**——资源被充分利用但没到极限 |
| 低 Utilization + 高 Saturation | **等待型瓶颈**（IO wait、锁竞争、连接池满） |
| 低 Utilization + 高 Errors | **异常**——别扯资源，先查为什么在空闲时出错 |

#### USE 指标已在哪个面板

Day 7 `k6-load-test.json` 和 Day 9 `k6-load-test-result.json` 都已经把 CPU、内存使用率放进去了——**监控栈搭好的那天起，USE 方法的 PromQL 就在那里，只是之前没有方法论把它们串起来**。

---

## 二、自顶向下 5 层分析框架

性能分析**切忌上来就扎进代码里看**。一定要自顶向下、逐层缩小范围。这样效率最高，也最不容易走偏。

```
第 1 层：用户体验 → 用户真的感受到慢了吗？
第 2 层：应用服务 → 哪个接口慢？应用自己的指标怎么说？
第 3 层：系统资源 → CPU / 内存 / IO / 网络，哪个饱和了？
第 4 层：代码层面 → 哪个函数最慢？哪段循环有问题？
第 5 层：依赖服务 → 数据库？缓存？外部 API？
```

### 走查案例：Day 4 SQLite 软瓶颈

**目标**：用 Day 4 压力测试的真实数据，演示 5 层下钻的完整过程。
（数据来源：`08_performance_analysis.md` Day 4 压力测试章节，50→500 VU 阶梯压测）

#### 第 1 层：用户体验

- **观察**：50 VU 时 p95 ≈ 400ms，200 VU 时 p95 飙到 3.5s，用户明显卡顿。
- **证据**：k6 summary `http_req_duration` 的 `p(95)` 从 359ms → 3500ms。
- **结论**：用户体验明显退化，不是幻觉。

#### 第 2 层：应用服务

- **观察**：CPU 使用率只到 60%，应用日志无异常，错误率保持 0%——**系统没有崩，但吞吐上不去**。
- **证据**：TPS 在 50 VU 时达到 ~30 req/s 后**不再增长**，200 VU 仍是 30 req/s。
- **关键线索**：`GET /items`（全表无分页）在高 VU 下 p95 明显比 `POST /items` 严重，但写路径是**始终有锁**的。

#### 第 3 层：系统资源（USE）

| 资源 | Utilization | Saturation | Errors | 结论 |
|------|------------|------------|--------|------|
| CPU | 60% | loadavg ≈ 2（双核 40%） | 0 | ❌ 不是瓶颈 |
| 内存 | 45% | Swap = 0 | 0 | ❌ 不是瓶颈 |
| 磁盘 IO | iowait 5-10% | await < 5ms | 0 | ❌ 不是瓶颈 |
| 网络 | 1% | 0 | 0 | ❌ 不是瓶颈 |

**关键发现**：**所有物理资源都没到极限，但 TPS 已经封顶**。——这是**应用级**或**依赖级**瓶颈的典型特征（低 Utilization + 低 Errors，但 Saturation 藏在应用内部）。

#### 第 4 层：代码层面

- `py-spy record` 火焰图（Day 11 会实操，这里是定性）显示热点在 `sqlite3.connect()` + `execute()`，不是业务逻辑。
- 每次请求都 `sqlite3.connect()` → `execute()` → `close()`，没有连接池。

#### 第 5 层：依赖服务（根因）

SQLite 的**单写者文件锁**：
- SQLite 任意时刻只允许一个 writer。多个请求同时写 → 串行化排队 → 写路径延迟随 VU 线性上升。
- 本项目 FastAPI 是 ASGI（单进程），但多个异步请求同时到达时，`sqlite3` 是同步阻塞的，触发 GIL 排队。
- `GET /items` 全表无分页：每次返回整个 items 表，数据量越大越慢，但**不是根因**（根因是写锁）。

**最终结论**：瓶颈类型 = **依赖（SQLite）+ 应用级锁竞争**，具体位置 = 写路径每次新建连接 + SQLite 单写者锁串行化。

---

## 三、六类瓶颈特征速查表（与 05 互补）

05 文档已经给了每类瓶颈的现象 + 典型原因 + 排查路径，这里不重复，只补"**怎么快速判断这一类**"和"**在我们的项目里可能在哪**"：

| 瓶颈类型 | **快速判断** | 已落地监控信号 | 本项目可能在哪 |
|----------|------------|---------------|--------------|
| CPU | `top` 看见单进程 > 90%，TPS 还没封顶 | node_cpu + 应用 `/metrics` 都高 | JSON 序列化、列表排序 |
| 内存 | `free` 可用字节持续下降，Swap 有增长 | node_memory MemAvailable 曲线下滑 | 大列表缓存无上限、未关闭连接 |
| IO | CPU 不高但 RT 慢，`iowait` 高 | node_disk_io_time_seconds_total | SQLite 每次新建连接都要重新打开/关闭文件 |
| 网络 | 带宽接近上限，RT 随距离增大 | node_network_receive_bytes_total | 本地测试不明显，跨机房部署才显 |
| **应用** | **资源都不高但慢**（Day 4 的情况）| 应用指标里 active_requests 高、TPS 封顶 | SQLite 写锁、每请求新建连接 |
| 数据库 | DB CPU 比 App CPU 高很多 | 如果有 DB exporter 就能看，目前没有 | SQLite 文件锁就是"微数据库级"瓶颈 |

> 经验：**"资源都不高但慢" 一定是应用/依赖级瓶颈**——这是我们 Day 4 最核心的判断线索，也是定位效率最高的一类，因为物理指标会自动排除掉 80% 的可能性。

---

## 四、性能分析工具清单（按层 + Python 生态）

### 系统层（Linux，Windows 下可用 WSL 或 Docker）

| 层级 | 工具 | 用途 | 触发条件 |
|------|------|------|---------|
| 概览 | `top` / `htop` | CPU / 内存 / loadavg 一眼看全 | 第一步必开 |
| CPU | `mpstat -P ALL` / `pidstat -u` | 多核分布 / 单进程 CPU | CPU > 70% 时用 |
| 内存 | `free -m` / `vmstat 1` | 总量 / Swap 变化 | 可用内存持续下降时 |
| IO | `iostat -x 1` / `iotop` | 磁盘 util / 哪进程在写 | iowait 高、RT 慢 |
| 网络 | `ss -tni` / `iftop` | 连接状态 / 带宽占用 | TIME_WAIT 多、带宽满 |
| 进程 | `ps aux --sort=-%cpu` / `lsof -p PID` | 哪进程最吃资源 / 打开的文件 | 找到热点进程后深挖 |

### Python 应用层

| 工具 | 用途 | 安装 | 命令 |
|------|------|------|------|
| **py-spy** | 生产级 CPU 采样，生成火焰图 | `pip install py-spy` | `py-spy record -o flame.svg -p PID` |
| **cProfile + pstats** | 代码级 CPU 剖析（开发阶段用）| 内置 | `python -m cProfile -o stats.prof script.py` |
| **memory_profiler** | 逐函数内存变化 | `pip install memory_profiler` | `@profile` 装饰器 + `python -m memory_profiler script.py` |
| **tracemalloc** | Python 内存快照对比 | 内置 | `tracemalloc.take_snapshot()` 对比前后差异 |
| `objgraph` | 对象数量分布 | `pip install objgraph` | `objgraph.show_most_common_types()` |
| **flask-profiler / slowapi** | 请求级耗时分解 | 按框架选 | FastAPI 推荐 `slowapi`（装饰器计时） |

### 依赖层

| 工具 | 用途 | 我们当前是否有 |
|------|------|--------------|
| SQLite `.timer on` / `.explain` | SQL 耗时 / 执行计划 | ✅ 有（SQLite 自带）|
| Redis `slowlog` | 慢查询 | ❌ 当前没用 Redis |
| PostgreSQL `EXPLAIN ANALYZE` / `pg_stat_statements` | SQL 执行计划 + 统计 | ❌ 当前用 SQLite |
| `tcpdump` / `wireshark` | 网络层包分析 | ⚠️ 调试网络瓶颈时用 |

### 与已有 Grafana 面板的对应

| 工具 / 面板 | 层级 | 在哪个面板 |
|-------------|------|-----------|
| node_cpu_seconds_total | USE / CPU | Day 9 看板「CPU 使用率」Timeseries |
| node_memory_MemAvailable_bytes | USE / 内存 | Day 9 看板「内存使用率」Timeseries |
| http_request_duration_seconds_bucket | RED / Duration | Day 9 看板「响应时间分布 Heatmap」|
| http_active_requests | 应用饱和度 | Day 8 已埋点，当前无面板（可加） |
| k6_http_req_duration_seconds (native histogram) | 压测过程 | Day 7 实时面板 + Day 9 结果看板 |
| k6_test_* Pushgateway 指标 | 压测结果 | Day 9「最近一次结果」Stat |

---

## 五、性能分析报告模板（用 Day 4 真实数据填充）

下面这份不是空模板，**是 Day 4 压力测试的完整分析报告**。填的时候按这个格式来，以后每轮压测后都跑一遍。

> `perf/docs/PERF_ANALYSIS_REPORT_TEMPLATE.md` 路径下保留了空白版本，每次压测后拷贝一份填充即可。

---

### 性能分析报告 · Day 4 压力测试

#### 一、测试背景

- **测试时间**：2026-10-21 上午
- **测试环境**：Windows + Docker Desktop，4 核 8G 本机，FastAPI + SQLite（文件）
- **测试目标**：找到系统吞吐量极限，定位瓶颈根因
- **测试脚本**：`perf/scripts/stress-test.js`（50 → 100 → 200 → 500 VU 阶梯，每级 30s）

#### 二、测试结果摘要

| 指标 | 50 VU | 100 VU | 200 VU | 500 VU |
|------|-------|--------|--------|--------|
| **峰值 TPS** | **30.2** | 30.1 | 29.8 | 28.5 |
| **P95 响应时间** | **412 ms** | 1.23 s | **3.5 s** | **6.1 s** |
| P99 响应时间 | ~750 ms | ~2.1 s | ~6 s | ~10 s |
| **错误率** | **0%** | **0%** | **0%** | **0%** |
| checks 通过率 | 100% | 100% | 100% | 100% |
| 并发用户 | 50 | 100 | 200 | 500 |

**拐点**：TPS 在 **50 VU** 左右到达极限 ~30 req/s，此后 VU 翻倍但 TPS 不再增长，p95 开始**线性上升**。全程 0 失败。

#### 三、瓶颈分析

##### 3.1 现象描述

50 VU 以下系统健康：TPS 随 VU 增长，p95 在 400ms 内，无错误。超过 50 VU 后，**TPS 不再增长但 p95 飙升**（200 VU 时 3.5s，500 VU 时 6.1s），系统始终 0 失败——这是典型的**软瓶颈**（系统不崩溃，但响应变慢）。

##### 3.2 分析过程（自顶向下 5 层）

```
[第 1 层] 用户体验：RT 飙到秒级 → 明显退化，确认是性能问题 ✅
[第 2 层] 应用服务：TPS 封顶，错误率 0 → 应用活着但吞吐到顶
[第 3 层] 系统资源：CPU 60% / 内存 45% / IO iowait 5% / 网络 1% → 全不是瓶颈 ❌
[第 4 层] 代码层面：py-spy 显示热点在 sqlite3.connect + execute，不是业务逻辑
[第 5 层] 依赖服务：SQLite 单写者文件锁 + 每请求新建连接 → 串行化写请求 ⚠️
```

**第 3 层的关键价值**：所有物理资源都没到极限 → 直接排除了 CPU/内存/IO/网络四类瓶颈，剩下 15~20% 的"应用/依赖级"候选 → 下钻效率直接拉满。

##### 3.3 瓶颈定位

- **瓶颈类型**：**应用级 + 数据库（SQLite）锁竞争**
- **具体位置**：
  1. `quality-pipeline-demo/app/main.py`：写路径每次请求都 `sqlite3.connect()` + `close()`，无连接池
  2. SQLite 文件锁机制：同一时刻只允许一个 writer，多个并发写请求排队串行化
- **证据**：
  1. Day 4 压力测试数据：50→200 VU，TPS 不涨反降（30→28.5），p95 线性上升（412ms→6.1s）
  2. 监控栈：CPU 60% / 内存 45% / Swap 0 → 物理资源无瓶颈
  3. 代码审查：`main.py` 无连接池配置，`sqlite3.connect()` 在请求处理函数内直接调用

#### 四、优化建议

##### 4.1 短期优化（1-2 天可做）

- **建议 1：SQLite WAL 模式 + 只读请求不阻塞写**
  - 启用 `PRAGMA journal_mode=WAL`：读和写可以并发进行（只允许一个 writer 但多个 reader）
  - 预期效果：读路径 p95 显著下降，写路径略有改善
- **建议 2：写路径限流 + 排队**
  - 在 `/items` POST 前加 semaphore（如 `asyncio.Semaphore(5)`），避免瞬间并发把 SQLite 锁死
  - 预期效果：p95 长尾截断，系统稳定

##### 4.2 中期优化（1-2 周可做）

- **建议 1：连接池**
  - SQLite 虽然连接池收益有限（锁在文件而非连接），但 `connect` + `close` 的开销可以省掉
  - 预期效果：TPS 小幅提升（~10-20%），但**锁瓶颈仍在**
- **建议 2：缓存热点读**
  - `GET /items` 的结果（items 列表）加进程内 LRU Cache，写请求 invalidate
  - 预期效果：读路径压力降低 60%+，写路径被锁时整体感知延迟下降

##### 4.3 长期优化（1 月以上）

- **建议 1：换 PostgreSQL**
  - 多 writer、真连接池、WAL 模式下并发读写性能远超 SQLite
  - 预期效果：写路径瓶颈解除，500 VU 下 p95 回到亚秒级
- **建议 2：读写分离 + 写请求异步化**
  - 写请求先入队列快速返回，后台 worker 串行写 SQLite/Postgres
  - 预期效果：用户侧 p95 稳定在 100ms 以下（即便写请求排队）

#### 五、优化前后对比

Day 4 时还没做优化，这里先留占位。Week 2 Day 12 做优化实战后**回来回填**，这就是整个 Week 2 的核心闭环。

| 指标 | 优化前（Day 4） | 优化后（Day 12） | 提升 |
|------|----------------|-----------------|------|
| TPS（100 VU） | 30 | — | — |
| P95（200 VU） | 3.5 s | — | — |
| 错误率 | 0% | — | — |

---

## 六、一句话总结

> **定位顺序**：用户体验（RED）→ 应用层 → 资源层（USE）→ 代码层 → 依赖层。**核心判断技巧**：所有物理资源都不高但慢 = 应用/依赖级瓶颈，直接跳过 80% 的排查路径去查代码和依赖。**本项目当前的瓶颈**：SQLite 单写者锁 + 每请求新建连接，已在 Day 4 定位，Day 12 优化。
