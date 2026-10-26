# 18 · 多服务全链路压测场景搭建（Week 3 Day 15）

> 前两周一直在**单服务**上做压测与优化。
> 但真实线上系统是**微服务**——一次用户请求会穿越网关、多个业务服务、数据库、缓存，
> 任何一个节点都可能成为瓶颈。
> Day 15 的目标是搭出一条可压测的**完整链路**：
> `client → gateway → order-service → product-service → (db / cache)`，
> 为后续全链路压测、链路追踪、混沌工程打基础。

---

## 一、架构设计（5 节点链路）

```
                        ┌──────────────┐
                        │  api-gateway │ :8000  统一入口，按路径转发
                        └──────┬───────┘
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
        ┌────────────────┐         ┌────────────────┐
        │ product-service│ :8001   │  order-service │ :8002  创建订单时调用商品服务
        └───────┬────────┘         └───────┬────────┘
                │                          │
        ┌───────┴────────┐          ┌───────┴────────┐
        ▼                ▼          ▼                ▼
   ┌─────────┐      ┌─────────┐ ┌─────────┐    ┌─────────┐
   │   db    │      │  cache  │ │   db    │    │product- │  (order 调 product 的 HTTP)
   │(PG/SQLite)│    │(Redis/  │ │(PG/SQLite)│   │service  │
   └─────────┘      │ 内存)   │ └─────────┘    └─────────┘
                    └─────────┘
```

| 节点 | 端口 | 职责 | 依赖 |
|------|------|------|------|
| api-gateway | 8000 | 统一入口，按路径转发到商品/订单服务 | product-service, order-service |
| product-service | 8001 | 商品查询，缓存优先（TTL 60s） | db, cache |
| order-service | 8002 | 创建/查询订单，下单时调商品服务校验库存 | product-service, db |
| db | 5432 | 商品表 + 订单表持久化 | - |
| cache | 6379 | 商品详情缓存，降低 DB 压力 | - |

**下单链路（5 节点串联）**：
`client → gateway → order-service → product-service → db/cache → order-service → db → client`

---

## 二、服务实现

代码位置：[services/](../../services/)

| 服务 | 文件 | 关键接口 |
|------|------|----------|
| 商品服务 | [services/product/main.py](../../services/product/main.py) | `GET /products/{id}`（缓存优先）、`GET /products`（分页） |
| 订单服务 | [services/order/main.py](../../services/order/main.py) | `POST /orders`（调商品→算价→校验库存→写库）、`GET /orders/{id}` |
| API 网关 | [services/gateway/main.py](../../services/gateway/main.py) | 转发 `/products*`、`/orders*` 到下游 |

### 2.1 关键设计：双模式降级（本地无 Docker 也能跑）

计划要求 PostgreSQL + Redis，但本机无 Docker。为了**本地可验证 + 生产/Docker 真实链路**双满足，
两个有状态服务（product、order）都做了方言适配：

| 组件 | Docker/CI 模式（有 `DATABASE_URL=postgresql://...`） | 本地降级模式（默认） |
|------|------------------------------------------------------|----------------------|
| 数据库 | psycopg2 + PostgreSQL | sqlite3（标准库） |
| 缓存 | redis-py + Redis | 内存 dict + TTL |

适配核心（[product/main.py:29](../../services/product/main.py#L29)）：
```python
IS_SQLITE = not DATABASE_URL.startswith("postgresql")

def _adapt_sql(sql):
    if IS_SQLITE:
        sql = sql.replace("%s", "?")               # 占位符
        sql = sql.replace("SERIAL", "INTEGER")     # 自增主键
        sql = sql.replace("DECIMAL(10,2)", "REAL") # 小数类型
        sql = sql.replace(" RETURNING id", "")     # sqlite 用 lastrowid
    return sql
```

这样业务 SQL 写一份（PG 语法），sqlite 自动转译，**不牺牲 CI 里的真实 PG 链路**。

### 2.2 商品缓存（TTL 60s）

```python
cached = cache.get(f"product:{product_id}")
if cached:
    return json.loads(cached)        # 命中：直接返回
# 未命中：查 DB，写缓存 TTL 60s
cache.setex(f"product:{product_id}", 60, json.dumps(product))
```

---

## 三、编排：docker-compose.services.yml

[docker-compose.services.yml](../../docker-compose.services.yml)

```
db (postgres:15) ─┐
cache (redis:7) ──┤
                  ├─ product-service ─┐
                  │                    ├─ order-service ─ api-gateway :8000
                  └────────────────────┘
```

启动：
```bash
docker-compose -f docker-compose.services.yml up -d --build
```

---

## 四、本地启动与全链路验证

> 本机无 Docker，用 SQLite + 内存缓存降级启动 3 个服务。

### 4.1 启动

```bash
# 方式一：脚本（PowerShell，注意需 -ExecutionPolicy Bypass）
powershell -ExecutionPolicy Bypass -File .\run-services.ps1

# 方式二：分别后台启动
cd services/product && python -m uvicorn main:app --port 8001
cd services/order   && python -m uvicorn main:app --port 8002
cd services/gateway && python -m uvicorn main:app --port 8000
```

### 4.2 验证结果（实测）

| # | 验证项 | 请求 | 结果 |
|---|--------|------|------|
| 1 | 商品详情（DB 命中） | `GET http://127.0.0.1:8001/products/1` | `{"id":1,"name":"product_0","price":9.9,"stock":1000}` |
| 2 | 商品详情（缓存命中） | 再次请求同上 | 同结果，TTL 60s |
| 3 | **全链路下单（5 节点）** | `POST http://127.0.0.1:8000/orders` `{"product_id":1,"quantity":3}` | `{"order_id":1,"total_price":29.7,"status":"created"}` |
| 4 | 查订单 | `GET http://127.0.0.1:8000/orders/1` | `{"id":1,"quantity":3,"total_price":29.7,"created_at":"..."}` |
| 5 | 库存不足校验 | `POST /orders` `{"product_id":99,"quantity":99999}` | `400 {"detail":"Insufficient stock"}` |

下单请求实际穿越的节点：
```
gateway(8000) → order-service(8002) → product-service(8001) → cache/db
                                            ↓
                              order-service 写订单 db → 返回
```

---

## 五、踩坑记录

| 问题 | 原因 | 解决 |
|------|------|------|
| `sqlite3.OperationalError: near "%": syntax error` | PG 用 `%s`，sqlite 用 `?` | `_adapt_sql` 统一替换 |
| `RETURNING id` 在 sqlite 报错 | sqlite 不支持 RETURNING | sqlite 下去掉，用 `cur.lastrowid` |
| `string indices must be integers`（下单 500） | 内存缓存存了 `json.dumps` 字符串，未反序列化 | 缓存命中时统一 `json.loads` |
| `Start-Process -WorkingDirectory` 中文路径报错 | PowerShell 5 对中文路径处理 | 改用 `Push-Location` + `Start-Process`，或用 `$PSScriptRoot` |
| 沙箱命令结束后子进程被清理 | job object 回收 | 用 `run_in_background` 启动服务作为独立后台任务 |

---

## 六、今日产出

- [x] 多服务架构设计：网关 + 商品服务 + 订单服务 + DB + Redis（5 节点）
- [x] 3 个服务代码：[gateway](../../services/gateway/main.py) / [product](../../services/product/main.py) / [order](../../services/order/main.py)
- [x] docker-compose 多服务编排：[docker-compose.services.yml](../../docker-compose.services.yml)
- [x] 全链路验证通过：下单请求经过 5 个节点，缓存/库存校验正常

**下一站（Day 16）**：对这条全链路跑 k6 压测，观察哪个节点先成为瓶颈。
