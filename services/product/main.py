"""
商品服务（Product Service）

职责：维护商品信息，对外提供商品查询接口。
链路位置：gateway -> product-service -> (db / cache)

设计要点：
- 数据库：DATABASE_URL 以 postgresql:// 开头用 psycopg2，否则用 sqlite3（本地无 Docker 时降级）
- 缓存：有 REDIS_URL 用 redis，否则用内存 dict + TTL（本地降级）
- 启动时自动建表 + 插入 100 条测试数据
"""
import json
import os
import sqlite3
import time
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Product Service")


class ProductCreate(BaseModel):
    name: str
    price: float
    stock: int = 0

# ---------------------------------------------------------------------------
# 链路追踪（OTel + Jaeger，本地默认关闭）
# ---------------------------------------------------------------------------
from tracing import init_tracing, instrument_fastapi, instrument_psycopg2

init_tracing("product-service")
instrument_fastapi(app)
instrument_psycopg2()

# ---------------------------------------------------------------------------
# 数据库连接（PG / SQLite 双模式）
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./product.db")
IS_SQLITE = not DATABASE_URL.startswith("postgresql")


def _adapt_sql(sql: str) -> str:
    """适配 PG 与 SQLite 的方言差异：占位符 %s -> ?，类型 SERIAL/DECIMAL/VARCHAR。"""
    if IS_SQLITE:
        sql = sql.replace("%s", "?")
        sql = sql.replace("SERIAL", "INTEGER")
        sql = sql.replace("DECIMAL(10,2)", "REAL")
        sql = sql.replace("VARCHAR(255)", "TEXT")
        sql = sql.replace("VARCHAR(20)", "TEXT")
    return sql


def get_db():
    if DATABASE_URL.startswith("postgresql"):
        import psycopg2

        # postgresql://user:pass@host:port/db
        rest = DATABASE_URL.replace("postgresql://", "")
        auth, _, host_db = rest.partition("@")
        user, _, password = auth.partition(":")
        hostport, _, dbname = host_db.partition("/")
        host, _, port = hostport.partition(":")
        return psycopg2.connect(
            host=host, port=int(port or 5432), dbname=dbname,
            user=user, password=password,
        )
    # sqlite
    path = DATABASE_URL.replace("sqlite:///", "")
    return sqlite3.connect(path)


# ---------------------------------------------------------------------------
# 缓存（Redis / 内存 dict 双模式）
# ---------------------------------------------------------------------------
class _MemoryCache:
    """极简内存缓存，带 TTL，无 Redis 时的降级实现。"""

    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Optional[Any]:
        item = self._store.get(key)
        if item is None:
            return None
        value, expire_at = item
        if time.time() > expire_at:
            self._store.pop(key, None)
            return None
        return value

    def setex(self, key: str, ttl: int, value: Any) -> None:
        self._store[key] = (value, time.time() + ttl)


class _RedisCache:
    """Redis 包装，接口与 _MemoryCache 一致。"""

    def __init__(self, url: str) -> None:
        import redis as _redis

        self._r = _redis.Redis.from_url(url)

    def get(self, key: str) -> Optional[bytes]:
        return self._r.get(key)

    def setex(self, key: str, ttl: int, value: bytes) -> None:
        self._r.setex(key, ttl, value)


REDIS_URL = os.environ.get("REDIS_URL", "")
if REDIS_URL:
    cache = _RedisCache(REDIS_URL)
else:
    cache = _MemoryCache()


# ---------------------------------------------------------------------------
# 启动：建表 + 测试数据
# ---------------------------------------------------------------------------
@app.on_event("startup")
def init_db() -> None:
    conn = get_db()
    cur = conn.cursor()
    cur.execute(_adapt_sql("""
        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            stock INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.commit()

    cur.execute(_adapt_sql("SELECT COUNT(*) FROM products"))
    if cur.fetchone()[0] == 0:
        for i in range(100):
            cur.execute(
                _adapt_sql("INSERT INTO products (name, price, stock) VALUES (%s, %s, %s)"),
                (f"product_{i}", round(9.9 + i, 2), 1000 - i),
            )
        conn.commit()
    cur.close()
    conn.close()


# ---------------------------------------------------------------------------
# 业务接口
# ---------------------------------------------------------------------------
@app.get("/products/{product_id}")
def get_product(product_id: int):
    """查商品详情：先缓存，未命中查 DB，写缓存 TTL 60s。"""
    cache_key = f"product:{product_id}"
    cached = cache.get(cache_key)
    if cached:
        # redis 返回 bytes，内存缓存返回 str，统一反序列化为 dict
        if isinstance(cached, (bytes, str)):
            return json.loads(cached)
        return cached

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        _adapt_sql("SELECT id, name, price, stock FROM products WHERE id = %s"),
        (product_id,),
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Product not found")

    product = {
        "id": row[0],
        "name": row[1],
        "price": float(row[2]),
        "stock": row[3],
    }
    cache.setex(cache_key, 60, json.dumps(product))
    return product


@app.get("/products")
def list_products(page: int = 1, page_size: int = 20, search: Optional[str] = None):
    """分页商品列表；带 search 参数时走模糊搜索（无索引，用于慢查询演示）。"""
    conn = get_db()
    cur = conn.cursor()
    if search:
        cur.execute(
            _adapt_sql("SELECT id, name, price, stock FROM products WHERE name LIKE %s ORDER BY id LIMIT %s OFFSET %s"),
            (f"%{search}%", page_size, (page - 1) * page_size),
        )
    else:
        offset = (page - 1) * page_size
        cur.execute(
            _adapt_sql("SELECT id, name, price, stock FROM products ORDER BY id LIMIT %s OFFSET %s"),
            (page_size, offset),
        )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [{"id": r[0], "name": r[1], "price": float(r[2]), "stock": r[3]} for r in rows]


@app.post("/products")
def create_product(product: ProductCreate):
    """创建商品（写入场景）。"""
    conn = get_db()
    cur = conn.cursor()
    if IS_SQLITE:
        cur.execute(
            _adapt_sql("INSERT INTO products (name, price, stock) VALUES (%s, %s, %s)"),
            (product.name, product.price, product.stock),
        )
        product_id = cur.lastrowid
    else:
        cur.execute(
            "INSERT INTO products (name, price, stock) VALUES (%s, %s, %s) RETURNING id",
            (product.name, product.price, product.stock),
        )
        product_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": product_id, "name": product.name, "price": product.price, "stock": product.stock}


@app.get("/health")
def health():
    return {"status": "ok", "service": "product"}
