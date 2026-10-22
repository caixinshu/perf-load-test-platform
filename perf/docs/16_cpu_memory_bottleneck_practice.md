# 16 · CPU / 内存瓶颈分析实战（Week 2 Day 11）

> Day 10 学了方法论（USE / RED / 自顶向下），Day 11 把方法落地：
> 给被测服务故意植入一个 **CPU 瓶颈接口** 和一个 **内存泄漏接口**，
> 用 k6 压出典型特征，再用 **py-spy 火焰图** 和 **memory_profiler** 把热点精确定位到代码行。
> 这两个慢接口是 Day 12 性能优化实战的「靶子」。

---

## 一、实战准备：三个慢接口

在被测服务（quality-pipeline-demo）`app/main.py` 末尾新增，**不动任何既有接口与 Day 8 中间件**：

| 接口 | 设计 | 模拟的真实事故 |
|------|------|----------------|
| `GET /slow/cpu?rounds=N` | 循环 `N*1000` 次 `hashlib.sha256`，串行依赖、纯计算无 IO | 加解密 / 序列化 / 正则等 CPU 密集逻辑拖垮服务 |
| `GET /slow/memory?size_kb=K` | 每次请求向**模块级全局列表** `_leaky_cache` 追加 K KB，永不清理 | 缓存只写不清、无淘汰策略导致 OOM |
| `POST /slow/memory/clear` | `list.clear()` + `gc.collect()` | 验证内存「可回收还是真泄漏」 |

关键实现细节：`@profile` 装饰器（memory_profiler 注入）在正常启动时**退化为无操作装饰器**，
服务不装 memory_profiler 也能跑——埋点和生产兼容性两不误。

k6 脚本：[`07-cpu-stress.js`](../scripts/07-cpu-stress.js)（50 VU / 1min）、
[`08-memory-leak.js`](../scripts/08-memory-leak.js)（20 VU / 2min），
均用 `constant-vus` 让压力持续稳定，且**故意不设 thresholds**（它们制造瓶颈，不是门禁）。

---

## 二、CPU 瓶颈分析实战

### 2.1 压测数据（未挂分析器的干净轮）

```powershell
k6 run -e BASE_URL=http://127.0.0.1:8000 perf/scripts/07-cpu-stress.js
```

| 指标 | 实测值 | 解读 |
|------|--------|------|
| 完成请求 | 140 / 60s | 50 个 VU 一分钟只挤出来 140 个请求 |
| **TPS** | **1.555 /s** | 并发加到 50，吞吐纹丝不动——**TPS 封顶** |
| avg 响应 | **16.84 s** | 对比单发约 0.3~0.6s，恶化了 30~50 倍 |
| p95 | 27.58 s（max 33.38s） | 响应时间随并发**线性恶化** |
| 错误率 | **0%** | 全部 200——不是依赖故障，请求只是「排队等 CPU」 |

**CPU 瓶颈三特征全部命中**（对照 Day 10 方法论第五节）：
TPS 不随并发增长 ✓、响应时间随并发线性上升 ✓、错误率保持 0 ✓。

> **为什么 50 个并发还不如 1 个？** uvicorn 把同步接口丢进线程池（压测时进程 31 个线程），
> 但 `hashlib.sha256` 处理的是 32 字节小数据，**不释放 GIL**（hashlib 只对 >2KB 数据释放）。
> 于是 50 个请求在 50 个线程里抢同一把 GIL，实际是**单核串行执行**——
> 每个请求都要等前面的算完，平均等 16.8s。这是 Python CPU 密集服务的经典死法：
> **加机器没用，加线程更没用，瓶颈是那把锁**。

### 2.2 py-spy 火焰图定位热点

```powershell
# 压测运行中，对 uvicorn 进程采样 40 秒
py-spy record -o flame_cpu.svg --pid <PID> --duration 40 --rate 100
```

采样 37244 个栈、0 错误，生成 [`images/flame_cpu_day11.svg`](images/flame_cpu_day11.svg)（浏览器打开可交互，点帧放大）。

**热点帧分布（按样本数排序）**：

| 帧 | 样本占比 | 说明 |
|----|---------|------|
| `slow_cpu (main.py:175)` | **98.86%** | 就是 `data = hashlib.sha256(data).digest()` 这一行 |
| `run (anyio...asyncio.py:986)` | 99.25% | 调用链：worker 线程 → 业务函数 |
| uvicorn 事件循环（`proactor_events` 等） | 0.45% | 框架本身几乎不占 CPU |

**火焰图读法**（Day 10 工具清单的落地）：
- 横向 = 样本占比，**找最宽的「平台」**——`slow_cpu` 一柱擎天占满全图宽度；
- 纵向 = 调用栈，从底往上 `线程启动 → anyio → slow_cpu:175`，热点没有更深层——
  时间全花在 sha256 计算本身，**优化方向只能是「少算」或「换算法/并行」，没有中间层可砍**。

### 2.3 坑：py-spy 的观察者效应（实测）

挂 py-spy 的第二轮压测，50 个请求**全部顶到 k6 默认 60s 超时**（avg=60.0s vs 第一轮 16.8s）：
py-spy 在 Windows 上靠**挂起线程**读栈，100 次/秒 × 31 个线程的挂起/恢复开销，
让目标进程在采样窗口内几乎停摆（实测 40s 墙钟内进程 CPU 增量仅 2s）。

**工程结论**：采样分析器不是免费的。
生产环境用 py-spy 时 **降低采样率（`--rate 10`）、缩短时长、避开高峰**；
做基线/门禁测量时**严禁挂分析器**——否则你测的是分析器，不是系统。

---

## 三、内存瓶颈分析实战

### 3.1 压测数据与 RSS 四点采样

```powershell
# 先清理，再压：POST /slow/memory/clear → k6 run perf/scripts/08-memory-leak.js
```

| 时点 | 进程 RSS（WorkingSet） | 说明 |
|------|----------------------|------|
| 清理后基线 | **48.9 MB** | 空缓存 |
| 压测 1 分钟 | 503.9 MB | +455 MB |
| 压测 2 分钟结束 | **1678.9 MB** | +1630 MB |
| 调用 `/slow/memory/clear` 后 | **53.2 MB** | **完全回落** |

交叉验证：16651 个请求 × 100 KB/请求 = **1.63 GB**，与 RSS 增量 1630 MB **精确吻合**——
泄漏的不是「看不见的开销」，就是接口返回的 `cache_mb` 本身，账能对平。

k6 侧数据：16651 请求、138 req/s、错误率 0%；
但 avg 从空载 ~2ms 恶化到 **143.56ms**（p95 410ms）——
列表膨胀导致每次 append 的内存分配越来越贵，**泄漏不仅占内存，还拖慢响应**。

### 3.2 mprof 内存趋势图

```powershell
# attach 不可靠（见坑），改用 mprof run 直接拉起服务，压测后杀进程落盘
mprof run --interval 1 -o mprofile_day11.dat python -m uvicorn app.main:app --port 8000
```

153 个采样点，原始数据 [`images/mprofile_day11.dat`](images/mprofile_day11.dat)，
趋势图 [`images/mprof_trend_day11.png`](images/mprof_trend_day11.png)：

```
0 ~ 50s    : 平台期 ≈ 50 MB（服务空载）
50 ~ 160s  : 线性爬升 50 MB → 1926 MB，斜率 ≈ 14.2 MB/s
```

**线性爬升 = 内存泄漏的图形特征**（正常缓存是「升到水位线后走平」）。
斜率对账：20370 请求 × 0.1 MB ÷ 120s ≈ 17 MB/s 理论值，实测 14.2 MB/s，
差异来自采样起止与 graceful stop 尾段——**量级吻合，判定泄漏成立**。

### 3.3 memory_profiler 逐行定位泄漏行

```powershell
python -m memory_profiler driver_memory_profiler.py   # 直接调用 slow_memory() × 20
```

输出（`Filename: app/main.py`）：

```
Line #    Mem usage    Increment  Occurrences   Line Contents
   191   62.191 MiB    1.965 MiB          20    _leaky_cache.append(b"x" * (size_kb * 1024))
   192   62.191 MiB    0.000 MiB          20    cache_mb = len(_leaky_cache) * size_kb / 1024
   193   62.191 MiB    0.004 MiB          20    return {...}
```

**Increment 列就是答案**：20 次调用，191 行累计 +1.965 MiB（≈ 20 × 0.1MB），
其余行 ≈ 0——泄漏点精确到行，就是那句 `append`。

> 首行 `Mem usage 62.094 MiB` 是函数首次进入时的进程总内存（含解释器/FastAPI 启动开销），
> 看内存问题**只看 Increment，不看绝对值**。

### 3.4 清理验证：可回收 ≠ 真泄漏

`/slow/memory/clear` 后 RSS 从 1678.9 MB → 53.2 MB，**1.6 GB 全部还给操作系统**。
这排除了「C 扩展层真泄漏」（那种 clear 也收不回），确认病灶是**应用层缓存无淘汰策略**——
Day 12 的优化方向：LRU 淘汰 / 容量上限 / 弱引用，而不是重启续命。

### 3.5 坑：mprof attach 在 Windows 不可靠（实测）

`mprof attach <PID> --timeout 150` 两次复现均**超时不生效、不落盘、无报错**（进程僵住）。
Windows 下正确姿势：**`mprof run` 拉起目标进程**，结束时杀进程即写盘；
或在被测代码里用 `memory_profiler.profile` 上下文逐段打点。

---

## 四、分析记录汇总（对照 Day 10 方法论的闭环）

| 维度 | CPU 瓶颈 | 内存泄漏 |
|------|----------|----------|
| **RED 信号** | Duration 飙升（avg 16.8s）、Rate 封顶 1.55/s | Duration 缓升（avg 143ms）、Rate 正常 138/s |
| **USE 信号** | Utilization：单核 100%（GIL 串行）；Saturation：线程池 31 线程排队 | Utilization：RSS 48.9→1678.9 MB 线性上涨 |
| **定位工具** | py-spy 火焰图 | mprof 趋势 + memory_profiler 逐行 |
| **热点代码行** | `main.py:175` sha256 循环（98.86% 样本） | `main.py:191` `_leaky_cache.append`（+1.965MiB/20次） |
| **佐证实验** | 错误率 0%、单发正常 → 排除依赖故障 | clear 后 RSS 完全回落 → 排除 C 层真泄漏 |
| **优化方向（Day 12）** | 少算（缓存结果）、放 GIL（大对象/多进程）、换算法 | LRU/容量上限/定期清理 |

**方法论复用心得**：两个案例都遵循同一条路径——
**RED 发现「慢了」→ USE 确认「哪种资源」→ 采样/逐行工具锁定「哪行代码」→ 对照实验排除备选假设**。
火焰图和逐行内存表只是最后 10%，前面 90% 是指标形态判断（TPS 封顶 vs 内存斜率）。

---

## 五、今日产出

1. **慢接口 ×3**（quality-pipeline-demo `app/main.py`）：`/slow/cpu`、`/slow/memory`、`/slow/memory/clear`，`@profile` 优雅降级
2. **k6 脚本 ×2**：`07-cpu-stress.js`、`08-memory-leak.js`
3. **CPU 分析记录**：第二节——TPS 封顶三特征数据 + GIL 分析 + 火焰图（98.86% 热点行）
4. **内存分析记录**：第三节——RSS 四点账 + 线性趋势图 + 逐行泄漏表 + 可回收性验证
5. **火焰图会生成会解读**：`py-spy record` 全流程 + 观察者效应实测坑
6. **memory_profiler 会用**：逐行 `Increment` 读法 + `mprof run/plot` 趋势图 + attach 坑

## 六、Day 12 预告

针对今天的两个靶子做优化实战并 A/B 对比：
**CPU 方向 4 招**（结果缓存 / 算法减轮 / 多进程绕 GIL / 异步卸载）、
**内存方向 3 招**（LRU 淘汰 / 容量上限 / 弱引用缓存），
每招前后各压一轮，把对比数据回填到 `PERF_ANALYSIS_REPORT_TEMPLATE.md` 第五节「优化建议与验证」。
