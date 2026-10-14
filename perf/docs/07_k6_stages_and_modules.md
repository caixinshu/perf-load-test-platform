# k6 stages 加压模式与常用模块

> Day 3 学习笔记 · stages 三段式 + thresholds 性能门禁 + tags 分组 + 8 个内置模块

---

## 一、为什么需要 stages

Day 2 的脚本用的是固定并发：

```js
export const options = { vus: 10, duration: '30s' };
```

这相当于「10 个用户同时在线，持续 30 秒」，不符合真实场景。真实流量的形态是：

```
用户逐渐到来  →  维持一段时间  →  逐渐离开
```

如果直接把并发从 0 拉到 100，那是**尖峰测试**（考察系统抗突发能力），不是常规负载测试。

---

## 二、stages 三段式配置

```js
export const options = {
  stages: [
    { duration: '30s', target: 20 }, // 爬升期：0 -> 20 VU
    { duration: '2m',  target: 20 }, // 稳定期：保持 20 VU
    { duration: '30s', target: 0  }, // 恢复期：20 -> 0 VU
  ],
};
```

### 三段式对应图

```
VU
20 |          ┌──────────────┐
   |         /                \
   |        /                  \
 0 |_______/____________________\______  时间
   0s    30s        2m30s      3m

   爬升期    稳定期       恢复期
```

### 每个阶段的意义

| 阶段 | 目的 | 关注点 |
|------|------|--------|
| 爬升期 | 模拟用户逐渐到来 | 系统能否平稳承接增量负载 |
| 稳定期 | 模拟正常负载 | **核心指标就在这里采集**（TPS、P95 是否达标） |
| 恢复期 | 模拟用户离开 | 系统能否正常释放资源、恢复原状 |

### 关键认知

**只有稳定期的数据才是有效的性能结论。** 爬升期和恢复期数据波动大，混在一起看平均值会严重失真。

---

## 三、thresholds 性能门禁

```js
thresholds: {
  http_req_duration: ['p(95)<500'], // 95% 的请求响应时间 < 500ms
  http_req_failed:   ['rate<0.01'], // 请求失败率 < 1%
  checks:            ['rate>0.99'], // 断言通过率 > 99%
}
```

### 最重要的特性：退出码

| 阈值结果 | k6 退出码 | CI 表现 |
|----------|-----------|---------|
| 全部通过 | 0 | 流水线继续 |
| 任一不通过 | 非 0 | **流水线中断** |

这就是把性能测试变成**性能门禁**的关键——不需要额外写判断逻辑，k6 自己会用退出码表达结果。

### 阈值表达式速查

| 表达式 | 含义 |
|--------|------|
| `p(95)<500` | 95 分位响应时间小于 500ms |
| `p(99)<1000` | 99 分位响应时间小于 1000ms |
| `avg<200` | 平均响应时间小于 200ms |
| `rate<0.01` | 比率类指标小于 1%（用于 `http_req_failed`、`checks`） |
| `rate>0.99` | 比率类指标大于 99% |
| `count>100` | 计数类指标大于 100 |

> 阈值可以写多条，用数组：`http_req_duration: ['p(95)<500', 'p(99)<1000']`，全部满足才算通过。

---

## 四、tags 请求标签：按接口看性能

### 问题：所有接口混在一起的平均值是废数据

如果不打标签，输出里只有一个 `http_req_duration` 平均值：

```
http_req_duration.........: avg=56.41ms
```

读接口快、写接口慢，混在一起这个 56ms 既不代表读也不代表写，**无法定位瓶颈**。

### 解决：给每个请求打 name 标签

```js
const res = http.get(`${BASE_URL}/items`, {
  tags: { name: 'listItems' },
});
```

输出就会按标签拆开：

```
http_req_duration..............: avg=56.41ms
  { name:listItems }...........: avg=2.1ms    ← 读接口，很快
  { name:createItem }..........: avg=58.3ms   ← 写接口，慢 27 倍
  { name:getItemById }.........: avg=3.4ms
```

**一眼就能看出瓶颈在写接口。**

> **最佳实践**：所有重要接口都必须打 `name` 标签。这是性能分析的基础，不打标签就等于放弃了瓶颈定位能力。

### group 与 tags 的区别

| 机制 | 作用 | 输出形态 |
|------|------|----------|
| `group()` | 把多个请求组织成一个业务场景 | 分组树状报告 + `group_duration` 指标 |
| `tags` | 给单个请求打标签 | 按标签拆分的指标明细 |

两者互补：`group` 表达"用户在做什么"，`tags` 表达"具体调用了哪个接口"。

---

## 五、参数化数据

压测数据如果固定不变，会带来两个问题：

1. **缓存命中失真**——同一个 key 反复查询，缓存效果被无限放大，测出来偏乐观
2. **数据约束冲突**——唯一键冲突导致大量 4xx/5xx，测出来偏悲观

所以要用随机数据：

```js
const payload = JSON.stringify({
  name: `perf_item_${randomString(8)}`,
  price: randomIntBetween(1, 1000) / 10,
});
```

---

## 六、8 个 k6 内置模块

k6 的内置模块通过 `import` 引入，无需 npm 安装：

| # | 模块 | 导入方式 | 用途 |
|---|------|----------|------|
| 1 | `k6` | `import { check, sleep, group, fail } from 'k6'` | 核心 API：断言、思考时间、分组、主动失败 |
| 2 | `k6/http` | `import http from 'k6/http'` | HTTP 请求（GET/POST/PUT/DELETE、批量请求、文件上传） |
| 3 | `k6/metrics` | `import { Counter, Gauge, Rate, Trend } from 'k6/metrics'` | 自定义指标 |
| 4 | `k6/ws` | `import ws from 'k6/ws'` | WebSocket 连接测试 |
| 5 | `k6/net/grpc` | `import grpc from 'k6/net/grpc'` | gRPC 接口测试 |
| 6 | `k6/crypto` | `import crypto from 'k6/crypto'` | 加密：MD5/SHA/HMAC/随机数 |
| 7 | `k6/encoding` | `import encoding from 'k6/encoding'` | Base64、URL 编码解码 |
| 8 | `k6/html` | `import { parseHTML } from 'k6/html'` | HTML 解析（配合页面抓取取元素值） |

### 本脚本用到的 3 个

| 函数 | 作用 |
|------|------|
| `http.get` / `http.post` | 发请求 |
| `check(res, {...})` | 断言，结果计入 `checks` 指标 |
| `sleep(n)` | 思考时间，模拟用户操作间隔 |
| `group(name, fn)` | 业务场景分组 |

### 自定义指标示例（后续会用到）

```js
import { Trend, Rate } from 'k6/metrics';

const createItemDuration = new Trend('create_item_duration');
const businessSuccess    = new Rate('business_success');

export default function () {
  const res = http.post(`${BASE_URL}/items`, payload, params);
  createItemDuration.add(res.timings.duration);
  businessSuccess.add(res.status === 200);
}
```

---

## 七、踩坑记录：不要依赖外部 CDN 加载工具库

k6 有官方工具库 `k6-utils`，提供 `randomString`、`randomIntBetween`、`uuidv4` 等函数，但它是**在线加载**的：

```js
// ❌ 有网络风险：CDN 不可达时脚本直接加载失败
import { randomString, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
```

实测报错：

```
could not load JS test: The moduleSpecifier "https://jslib.k6.io/k6-utils/1.4.0/index.js"
couldn't be retrieved from the resolved url.
Error: "Get https://jslib.k6.io/k6-utils/1.4.0/index.js": net/http: TLS handshake timeout
```

**脚本在加载阶段就失败了**，压测根本没开始跑。

### 解决方案：脚本内置工具函数

```js
// ✅ 完全自包含，离线也能跑
function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
```

**原则**：压测脚本依赖越少越好。任何在线依赖（CDN、外部接口）都是压测链路里的不稳定因素——它坏掉时，你分不清是"被测系统有问题"还是"压测脚本环境有问题"。

---

## 八、实测记录：20 VU 负载测试跑出了真实瓶颈

### 测试条件

| 项 | 值 |
|----|-----|
| 被测服务 | FastAPI + SQLite（demo API） |
| 脚本 | `perf/scripts/02-load-test.js` |
| 负载曲线 | 30s 爬升至 20 VU → 2m 稳定 → 30s 恢复 |
| 实际执行 | 3m04s，561 次迭代 |

### 结果

| 指标 | 实测值 | 阈值 | 判定 |
|------|--------|------|------|
| `http_req_duration` | avg=359.58ms med=152ms p(90)=528.89ms **p(95)=1.27s** max=7.74s | p(95)<500ms | ✗ **未通过** |
| `http_req_failed` | 0.53%（12/2244） | <1% | ✓ |
| `checks` | 99.49%（3907/3927） | >99% | ✓ |
| `http_reqs` | 2244（12.19/s） | — | — |
| `iterations` | 561（3.05/s） | — | — |
| `data_received` | 55 MB（298 kB/s） | — | — |

### 按场景拆分：瓶颈一眼可见

```
✓ 列表查询返回 200        100%
✓ 列表返回是数组          100%
✗ 创建商品返回 200         99%   (557 / 4)
✗ 创建返回包含 id          99%   (557 / 4)
✗ 创建查询用商品成功       99%   (557 / 4)
✗ 查询单个商品返回 200     99%   (557 / 4)
✗ 商品名称正确             99%   (557 / 4)
```

**两个纯读接口 100% 通过，所有失败都集中在写路径。**

> 这正是 `tags` 的价值：如果不打标签，只有一个 `avg=359.58ms`，你完全看不出问题出在写接口。

### 初步定位

被测服务每个请求都新建并关闭一次 SQLite 连接：

```python
conn = sqlite3.connect(DB_PATH)   # 每个请求都新建
conn.execute("INSERT INTO items (name, price) VALUES (?, ?)", ...)
conn.commit()                     # 每次提交都要 fsync
conn.close()                      # 每个请求都关闭
```

叠加 SQLite 的**单写者锁模型**，20 VU 并发写入时出现两类症状：

| 症状 | 表现 | 根因 |
|------|------|------|
| 请求排队 | p(95) 从 411ms 恶化到 1.27s | 等待写锁释放 |
| 请求失败 | 4 次 `POST /items` 返回 500 | 等锁超时（`database is locked`） |

### 对照组：同一套阈值，结果完全不同

| 负载 | p(95) | 失败率 | 阈值判定 |
|------|-------|--------|----------|
| 1 VU × 5 次迭代 | 114.92ms | 0% | 全部通过 |
| 20 VU × 50s | 433.64ms | 0% | 全部通过 |
| 20 VU × 3m | **1.27s** | 0.53% | **未通过** |

**结论：短跑会得出过于乐观的结论。** 负载测试必须跑完稳定期——只有稳定期的数据才是有效的性能结论。

> 深度分析（百分位解读、瓶颈分类、优化方案）留到 Day 4 展开。

---

## 九、门禁策略：先观察，后设门禁

本次阈值未通过，但 CI 不应该因此直接变红。原因是**基线还没建立**。

门禁值必须来自实测基线，而不是拍脑袋定的。`p(95)<500` 目前只是一个**目标值**，不是基线值。

正确做法分三步：

| 阶段 | 做法 | 目的 |
|------|------|------|
| 1. 观察期 | 压测照常跑，但**不阻断流水线**（`continue-on-error`） | 先在无压力的情况下积累几次真实数据 |
| 2. 定基线 | 取多次稳定运行的 p95 中位值作为基线 | 得到系统的真实水平 |
| 3. 上门禁 | 基线 × 1.5 左右作为门禁值，随优化逐步收紧 | 门禁既能拦住退化，又不会天天误报 |

> 这也是项目一里代码扫描先用 `continue-on-error: true` 灰度接入的原因——**任何新的质量手段，都要先观察，再设卡**。

---

## 十、一句话总结

> `stages` 让负载曲线贴合真实用户行为，`thresholds` 用退出码把性能标准变成 CI 门禁，`tags` 让每个接口的性能单独可见——**这三样凑齐，压测脚本才算"完整"**。
>
> 本次实测还额外证明了一件事：**不打标签就只能看到平均值，打上标签才能看到瓶颈**。
