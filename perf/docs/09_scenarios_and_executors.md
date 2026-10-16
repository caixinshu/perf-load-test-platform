# 09 - k6 多场景压测脚本（Day 5）

> 目标：掌握 k6 的 **scenarios + executor** 机制，能在一个脚本里组合出「浏览 / 下单 / 探针」等多类真实流量，并给不同场景分别设阈值；同时补齐冒烟、尖峰、稳定性三类测试脚本。

---

## 一、为什么需要「多场景」

Day 2~4 的脚本都用 `vus` / `duration` / `stages` 这几种**简写**，它们本质是"单一场景"：一种节奏压一种流量。

但真实系统里，流量是**混合**的：

| 流量类型 | 特征 | 例子 |
|----------|------|------|
| 高频读 | 请求量大、要求快 | 商品列表、首页 |
| 低频写 | 请求量小、容易锁冲突 | 下单、评论 |
| 探针 | 固定并发、几乎不许失败 | 健康检查、监控 |

如果只测单一场景，测出来的 TPS / 延迟不能代表真实混合负载。k6 的 **scenarios** 就是用来表达"同时存在多种流量"的。

---

## 二、scenarios + executor：从「简写」升级到「显式编排」

`vus` / `duration` / `stages` 只是 k6 的语法糖，底层都会被翻译成 `scenarios`：

```js
// 简写
export const options = { vus: 10, duration: '30s' };

// 等价于显式写法
export const options = {
  scenarios: {
    default: { executor: 'constant-vus', vus: 10, duration: '30s' },
  },
};
```

多场景时，直接写 `scenarios`，每个 key 就是一个独立场景：

```js
export const options = {
  scenarios: {
    browse: { /* 高频读，每秒固定 20 请求 */ },
    write:  { /* 低频写，VU 曲线爬升    */ },
    health: { /* 探针，固定 2 并发      */ },
  },
};
```

### 7 种 executor（执行器）

executor 决定「负载以什么方式施加」，是多场景的核心：

| executor | 负载怎么走 | 典型用途 | 关键参数 |
|----------|-----------|----------|----------|
| `constant-vus` | 固定并发数，VU 循环跑 | 恒定负载、探针、长连接 | `vus`、`duration` |
| `ramping-vus` | VU 按 stages 曲线增减 | 模拟用户逐渐到来/离开 | `stages` |
| `per-vu-iterations` | 每个 VU 跑固定次数 | 冒烟（确定跑完 N 次） | `vus`、`iterations` |
| `shared-iterations` | 多 VU 共享总迭代数 | 一次性跑完固定请求数 | `vus`、`iterations` |
| `constant-arrival-rate` | 每秒发起固定**请求数** | 稳定压 TPS（与 VU 解耦） | `rate`、`timeUnit`、`preAllocatedVUs`、`maxVUs` |
| `ramping-arrival-rate` | 每秒请求数按曲线增减 | 精确控制到达率曲线 | `stages`、`rate` |
| `externally-controlled` | 外部实时调 VU/时长 | 交互式压测、动态扩缩 | `maxVUs`、`duration` |

> **关键区别**：`vus` 是"并发数"，`arrival-rate` 是"每秒请求数"。
> 用 `constant-arrival-rate` 时，即使响应变慢，k6 也会加 VU 去保证请求数达标——这样测的是"系统在固定到达率下是否扛得住"，更能复现真实流量。

### 按场景设阈值：`tags: { scenario }`

给场景打 `tags`，就能对**不同场景分别设阈值**：

```js
scenarios: {
  browse: { ..., tags: { scenario: 'browse' } },
  write:  { ..., tags: { scenario: 'write' } },
},
thresholds: {
  'http_req_duration{scenario:browse}': ['p(95)<500'], // 浏览要快
  'http_req_failed{scenario:write}':    ['rate<0.1'],  // 写路径放宽
},
```

这正是多场景压测的价值：**不同业务的质量目标本来就不同**，不该用同一个阈值一刀切。

### arrival-rate 特有指标：`dropped_iterations`

用 `*.arrival-rate` executor 时，若 `maxVUs` 不够、VU 跟不上到达率，k6 会**丢弃（drop）**本该发起的迭代，并计入 `dropped_iterations`。这个指标 > 0 说明"压测机自己没压满"，需要调大 `maxVUs`。

---

## 三、6 种测试类型 ↔ 脚本映射

结合 `docs/03_test_types.md` 的 6 大类，Day 5 后脚本已覆盖如下：

| 测试类型 | 脚本 | 关键配置 |
|----------|------|----------|
| 基准测试 Benchmark | [`baseline.js`](../scripts/baseline.js) | 10 VU / 1m，跑 3 次取稳定值 |
| 负载测试 Load | [`02-load-test.js`](../scripts/02-load-test.js) | stages 三段式 20 VU |
| 压力测试 Stress | [`stress-test.js`](../scripts/stress-test.js) | 50→500 VU 阶梯，无阈值 |
| **冒烟测试 Smoke** | [`03-smoke-test.js`](../scripts/03-smoke-test.js) | `per-vu-iterations`，1 VU×5 |
| **尖峰测试 Spike** | [`04-spike-test.js`](../scripts/04-spike-test.js) | 10→200 VU 突增再回落 |
| **稳定性测试 Soak** | [`05-soak-test.js`](../scripts/05-soak-test.js) | 20 VU 长时间，查泄漏 |
| **多场景组合** | [`06-multi-scenario.js`](../scripts/06-multi-scenario.js) | 3 场景 3 executor + 分场景阈值 |

> 容量测试（Volume）需要先灌大量数据再测，留待后续；本机当前没有适合的大数据量查询接口。

---

## 四、Day 5 实测结果

被测服务：FastAPI + SQLite（demo API）。全部通过 `-e BASE_URL` 指向 `http://127.0.0.1:8000`。

### 1）冒烟测试（03-smoke-test.js）

| 指标 | 值 | 判定 |
|------|-----|------|
| checks | **100%**（25/25） | ✓ |
| http_req_failed | 0% | ✓ |
| http_req_duration | avg=45ms, p95=142ms | — |

**结论**：脚本与服务的读写链路全部走通，可以放心跑后面的重负载。

### 2）尖峰测试（04-spike-test.js）

| 指标 | 值 |
|------|-----|
| 总请求 | 8,668 |
| checks | **100%** |
| 失败率 | **0%** |
| avg | 1.82 s |
| med | 311 ms |
| **p95** | **4.39 s** |
| max | 27.67 s |
| VU 峰值 | 200 |

分阶段观察（从控制台进度推断的瞬时吞吐）：

| 阶段 | 负载 | 瞬时吞吐 |
|------|------|---------|
| 正常期 | ~10 VU | ≈ 50 req/s |
| 尖峰期 | 200 VU | **≈ 23~25 req/s（不升反降）** |
| 恢复期 | 回落到 10 VU | ≈ 58 req/s，迅速恢复 |

**结论**：
- **尖峰把延迟放大了约 30 倍**（p95 从 ~140ms → 4.39s），但**错误率为 0**——系统选择"排队等待"而不是"直接拒绝"。
- **尖峰期间吞吐不升反降**：200 VU 涌入后 TPS 反而低于低负载期。这是典型的**并发过载（congestion collapse）**——过量并发不但没换来吞吐，反而因锁竞争与线程调度开销导致吞吐回落。
- **尖峰退去后能快速恢复**：VU 一回落，吞吐立刻回升，说明系统有弹性，但**尖峰期间的用户体验已经崩溃**。生产环境需要**限流 / 排队 / 熔断**来保护尖峰期的可用性。

### 3）多场景组合（06-multi-scenario.js）

| 场景 | executor | 阈值 | 实测 | 判定 |
|------|----------|------|------|------|
| browse | constant-arrival-rate 20/s | p(95)<500ms | p(95)=396ms | ✓ |
| health | constant-vus ×2 | 失败率<1% | 0% | ✓ |
| write | ramping-vus 5→10→0 | 失败率<10% | 0% | ✓ |

- 总计 1,540 请求，checks 100%，失败率 0%。
- `dropped_iterations = 8`：browse 场景偶发未压满 20/s，说明 `maxVUs` 略紧（可调大）。
- **按场景阈值全部生效**：三个场景各自独立判定，互不干扰。

### 4）稳定性测试（05-soak-test.js，本次 3 分钟）

| 指标 | 值 | 判定 |
|------|-----|------|
| 时长 | 3m（默认 10m，可 `-e SOAK_DURATION=30m`） | — |
| 总请求 | 1,394 | — |
| checks | 100% | ✓ |
| 失败率 | 0% | ✓ |
| p95 | 262 ms | ✓（<800ms） |

**结论**：短时稳定性正常，无失败。但**3 分钟不足以暴露内存泄漏**——泄漏是"每请求漏一点"，必须跑**数小时**才能看出 p95 是否随时间单调上升、内存是否持续增长。

---

## 五、四类脚本的核心差异（一句话记住）

| 脚本 | 问的问题 | 负载形态 | 要不要阈值 |
|------|---------|---------|-----------|
| 冒烟 | "脚本对吗？服务活着吗？" | 极小、固定次数 | 要（必须全绿） |
| 负载 | "预期负载下达标吗？" | 三段式到目标 VU | 要（性能门禁） |
| 尖峰 | "突发流量扛得住吗？能恢复吗？" | 陡增 → 持续 → 骤降 | 探索性，可先不设 |
| 稳定性 | "跑久了会不会崩/变慢？" | 中等负载 × 长时间 | 要（放宽的稳定性阈值） |

---

## 六、踩坑与注意

1. **`arrival-rate` 的 `maxVUs` 别设太小**：不够会丢迭代（`dropped_iterations>0`），测出来偏乐观。
2. **多场景的阈值必须带 `{scenario:xxx}` 过滤**：否则会拿所有场景混在一起的平均值判定，结论失真。
3. **尖峰测试的 `gracefulRampDown`**：VU 骤降时 k6 不会硬切，而是等当前迭代结束，观测恢复期要把这段算进去。
4. **稳定性测试不要用短跑替代**：短跑只能验证脚本，验证不了泄漏。
5. 依旧坚持 Day 3 的原则：**脚本不依赖在线 CDN**，随机数据用内置 `Math.random()`，`BASE_URL` 用 `__ENV` 覆盖。

---

## 七、一句话总结

> `scenarios` 让一个脚本同时跑多类流量，`executor` 决定每类流量的施加方式，`tags:{scenario}` 让每类流量能独立设阈值——**三者合一，压测才从"压一个接口"升级为"还原一天的真实业务"。**
>
> 本次实测最有价值的一条：**尖峰之下，系统 0 报错却严重卡顿，且吞吐不升反降**——只看错误率会以为"没事"，必须同时看延迟与吞吐才能发现过载。
