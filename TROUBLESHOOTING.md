# TROUBLESHOOTING — 性能测试踩坑记录

> 按问题类别整理，每条含：**现象 → 原因 → 解决 → 预防**。
> 最后更新：2026-10-23（Week 2 Day 14）

---

## 一、k6 压测相关

### 1.1 本地无 Docker，k6 端到端链路验证缺失

- **现象**：CI 里的 k6 + Prometheus + Pushgateway + Grafana 链路，本地无法完整跑通
- **原因**：本机 Windows 无 Docker，只能本地 k6 + 本地 Python 服务
- **解决**：本地仅做离线验证（summary 解析、p(99) 分支逻辑、指标 PUT 推送），端到端必须在 CI 里手动触发
- **预防**：环境限制提前告知，Day 9 / Day 13 均以此为前提设计验证策略

### 1.2 k6-smoke-test 门禁 job 因基线漂移持续失败

- **现象**：`k6-smoke-test` job 在 CI 里一直 FAIL，但 k6-load-test-prometheus job 能 PASS
- **原因**：smoke-test 门禁阈值 `p(95)<100ms` 是 Day 9 设定的，当前环境实测 p95 ≈ 536ms，基线已漂移
- **解决**：**不因该 job 失败判定 Day 9/10/11/12 功能异常**——它是门禁告警，不是功能失败
- **预防**：基线漂移后要重新校准阈值，不能硬卡死线

### 1.3 k6 VU 模式选择不当导致无法稳定复现瓶颈

- **现象**：Day 11 最初用 `ramping-vus`，VU 爬升过程中还没到稳态就结束了
- **原因**：瓶颈制造需要**恒定 VU 持续施压**才能让系统进入饱和
- **解决**：改用 `constant-vus`（固定 VU / 固定时长），保证 CPU 持续打满
- **预防**：造瓶颈用 constant-vus，找极限用 ramping-vus，不要混用

---

## 二、py-spy / 火焰图相关（Day 11）

### 2.1 py-spy attach 有观察者效应——请求全部超时

- **现象**：`py-spy record --pid <uvicorn_pid> --duration 40` attach 上去后，所有请求立即变成 60s 超时
- **原因**：采样器 hook 住每个函数入口，Python 调用栈检查开销 × 50 并发 = 所有请求被阻塞
- **解决**：
  1. **降低采样率**：`--rate 10`（默认 100），观察者效应可控
  2. 或**直接拉起子进程采样**：`py-spy record -o profile.svg -- python -m uvicorn app.main:app --port 8001`
- **预防**：生产采样率控制在 10-20Hz

### 2.2 py-spy 在 Windows 对运行中进程采样需权限

- **现象**：`PermissionError` 或 `could not attach to pid`
- **原因**：Windows 下 py-spy 需要与目标进程同用户或管理员权限
- **解决**：以管理员身份运行 PowerShell，或用 `run` 模式直接拉起进程采样
- **预防**：Day 11 已统一用 `py-spy record -- python -m uvicorn ...` 模式，避免 attach

### 2.3 火焰图 X 轴不是时间轴

- **现象**：误以为火焰图能看到"什么时候开始慢"
- **原因**：py-spy 火焰图把**所有样本叠加**，宽度是占比而非时序
- **解决**：想看时间维度 → 用 `py-spy record --format speedscope` 上传 speedscope.app
- **预防**：读火焰图四步走（Day 11 总结）：一柱擎天？栈顶？宽度？颜色无意义

---

## 三、mprof / memory_profiler 相关（Day 11）

### 3.1 mprof attach 在 Windows 超时不生效

- **现象**：`mprof attach <pid>` 卡在等待，进程不退出也不生成 .dat 文件
- **原因**：Windows 下 mprof attach 依赖 ptrace 等价物，实现不完整
- **解决**：**必须用 `mprof run` 拉起进程**：`mprof run --interval 1 python -m uvicorn app.main:app`
- **预防**：Day 11 已改用 run 模式，不要再试 attach

### 3.2 memory_profiler 的 @profile 装饰器导致 uvicorn 启动失败

- **现象**：加了 `@profile` 装饰器的接口，`uvicorn` 启动报 NameError
- **原因**：memory_profiler 未安装时 `@profile` 是未定义的内置
- **解决**：在 main.py 里加条件导入：
  ```python
  try:
      from memory_profiler import profile
  except ImportError:
      def profile(f): return f  # 空装饰器，不影响功能
  ```
- **预防**：Day 11 已实现上述降级方案，新装环境不怕没装 memory_profiler

---

## 四、Python / FastAPI 相关（Day 11/12）

### 4.1 Python 3.9 不支持 `X | None` 类型注解

- **现象**：`TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'`
- **原因**：项目环境是 Python 3.9（anaconda），PEP 604 的联合类型语法是 3.10+
- **解决**：改成 `Optional[X]` 或去掉注解直接 `_cpu_pool = None`
- **预防**：写类型注解前先确认最低支持的 Python 版本

### 4.2 ProcessPoolExecutor 冷启动 15 秒

- **现象**：Day 12 `/slow/cpu/opt/parallel` 首次请求耗时 15.6s，后续稳定在 113ms
- **原因**：Windows spawn 4 个子进程，各自 import fastapi + uvicorn 模块
- **解决**：进程池**模块级单例 + 常驻预热**，绝不能在请求路径上临时建池
  ```python
  _cpu_pool = None
  def _get_cpu_pool():
      global _cpu_pool
      if _cpu_pool is None:
          _cpu_pool = ProcessPoolExecutor(max_workers=4)
      return _cpu_pool
  ```
- **预防**：Windows 下 spawn 开销远大于 Linux fork，进程池必须预热

### 4.3 SQLite 单写者锁导致高并发写入排队

- **现象**：高并发 POST 接口 p95 长尾数百毫秒
- **原因**：SQLite 是单写者架构，多个写请求必须排队
- **解决**：迁移 PostgreSQL（长期方案）；短期减少不必要的写操作
- **预防**：在 README 和 TROUBLESHOOTING 里记录此硬限制

---

## 五、性能分析方法论相关（Day 10/11）

### 5.1 没有火焰图时靠猜瓶颈，一轮优化要 30-60 分钟

- **现象**：Day 12 开始前，如果没有 Day 11 的火焰图，根本不知道 sha256 是热点
- **原因**：指标（CPU 100%）只能定位到"资源层"，定位不到"代码行"
- **解决**：**py-spy 是瓶颈定位的必经步骤**，跳过它所有优化都是盲改
- **预防**：Day 11 已验证完整链路：指标 → 火焰图 → 代码行 → 优化 → A/B 验证

### 5.2 "不做/少做"的优化收益碾压一切工程手段

- **现象**：Day 12 缓存 51× vs 并行 1.14×
- **原因**：缓存消除的是**工作量本身**，并行只是让单位工作更快（受硬件常数限制）
- **解决**：优化优先级 = 黄金法则：**不做 > 少做 > 做得更快 > 并行做**
- **预防**：每次优化前先问——这件事真的需要做吗？能少做几次吗？

---

## 六、CI / Docker 相关（Week 1 遗留，但影响 Week 2）

### 6.1 SQLite 表结构需手动创建

- **现象**：首次启动服务返回 OperationalError
- **原因**：FastAPI 没做自动建表，SQLite 文件存在但表不存在
- **解决**：写临时 .py 文件执行 CREATE TABLE
- **预防**：Day 11/12 已在启动步骤里加手动建表命令

### 6.2 Docker slim 镜像缺 curl

- **现象**：CI 里 healthcheck 失败
- **原因**：Dockerfile 用 python:slim，默认没装 curl
- **解决**：Dockerfile 里加 `RUN apt-get update && apt-get install -y curl`
- **预防**：Week 1 已修复，Dockerfile 当前版本包含 curl
