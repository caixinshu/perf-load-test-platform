"""
订单服务（Order Service）

职责：创建订单、查询订单；创建订单时调用商品服务校验库存并计算总价。
链路位置：gateway -> order-service -> product-service -> (db / cache)
                                    -> db

设计要点：
- 数据库：同商品服务，PG / SQLite 双模式
- 商品服务地址：PRODUCT_SERVICE_URL（默认 http://localhost:8001）
"""
import os
import sqlite3
import time

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Order Service")

# ---------------------------------------------------------------------------
# 链路追踪（OTel + Jaeger，本地默认关闭）
# ---------------------------------------------------------------------------
from tracing import init_tracing, instrument_fastapi, instrument_httpx, instrument_psycopg2

init_tracing("order-service")
instrument_fastapi(app)
instrument_httpx()
instrument_psycopg2()

PRODUCT_SERVICE_URL = os.environ.get("PRODUCT_SERVICE_URL", "http://localhost:8001")

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./order.db")
IS_SQLITE = not DATABASE_URL.startswith("postgresql")


def _adapt_sql(sql: str) -> str:
    if IS_SQLITE:
        sql = sql.replace("%s", "?")
        sql = sql.replace("SERIAL", "INTEGER")
        sql = sql.replace("DECIMAL(10,2)", "REAL")
        sql = sql.replace("VARCHAR(255)", "TEXT")
        sql = sql.replace("VARCHAR(20)", "TEXT")
        sql = sql.replace(" RETURNING id", "")
    return sql


def get_db():
    if DATABASE_URL.startswith("postgresql"):
        import psycopg2

        rest = DATABASE_URL.replace("postgresql://", "")
        auth, _, host_db = rest.partition("@")
        user, _, password = auth.partition(":")
        hostport, _, dbname = host_db.partition("/")
        host, _, port = hostport.partition(":")
        return psycopg2.connect(
            host=host, port=int(port or 5432), dbname=dbname,
            user=user, password=password,
        )
    path = DATABASE_URL.replace("sqlite:///", "")
    return sqlite3.connect(path)


class OrderCreate(BaseModel):
    product_id: int
    quantity: int


@app.on_event("startup")
def init_db() -> None:
    conn = get_db()
    cur = conn.cursor()
    cur.execute(_adapt_sql("""
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            product_id INT NOT NULL,
            quantity INT NOT NULL,
            total_price DECIMAL(10,2) NOT NULL,
            status VARCHAR(20) DEFAULT 'created',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.commit()
    cur.close()
    conn.close()


@app.post("/orders")
def create_order(order: OrderCreate):
    """创建订单：调用商品服务 -> 算总价 -> 校验库存 -> 写 DB。"""
    # 1. 调用商品服务
    with httpx.Client(timeout=5.0) as client:
        resp = client.get(f"{PRODUCT_SERVICE_URL}/products/{order.product_id}")

    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail="Product not found")

    product = resp.json()

    # 2. 计算总价
    total_price = product["price"] * order.quantity

    # 3. 校验库存（简化版，无分布式锁）
    if product["stock"] < order.quantity:
        raise HTTPException(status_code=400, detail="Insufficient stock")

    # 4. 创建订单
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        _adapt_sql(
            "INSERT INTO orders (product_id, quantity, total_price) "
            "VALUES (%s, %s, %s) RETURNING id"
        ),
        (order.product_id, order.quantity, total_price),
    )
    order_id = cur.lastrowid if IS_SQLITE else cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()

    return {
        "order_id": order_id,
        "product_id": order.product_id,
        "quantity": order.quantity,
        "total_price": total_price,
        "status": "created",
    }


@app.get("/orders/{order_id}")
def get_order(order_id: int):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        _adapt_sql(
            "SELECT id, product_id, quantity, total_price, status, created_at FROM orders WHERE id = %s"
        ),
        (order_id,),
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    return {
        "id": row[0],
        "product_id": row[1],
        "quantity": row[2],
        "total_price": float(row[3]),
        "status": row[4],
        "created_at": str(row[5]),
    }


@app.get("/health")
def health():
    return {"status": "ok", "service": "order"}
