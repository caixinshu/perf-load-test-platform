"""
API 网关（API Gateway）

职责：统一入口，按路径转发到商品/订单服务。
链路位置：外部请求 -> gateway -> product-service / order-service

设计要点：
- 纯转发，不做业务逻辑
- 下游地址通过环境变量注入（PRODUCT_URL / ORDER_URL）
"""
import os

import httpx
from fastapi import FastAPI, Request

app = FastAPI(title="API Gateway")

# ---------------------------------------------------------------------------
# 链路追踪（OTel + Jaeger，本地默认关闭）
# ---------------------------------------------------------------------------
from tracing import init_tracing, instrument_fastapi, instrument_httpx

init_tracing("api-gateway")
instrument_fastapi(app)
instrument_httpx()

PRODUCT_URL = os.environ.get("PRODUCT_URL", "http://localhost:8001")
ORDER_URL = os.environ.get("ORDER_URL", "http://localhost:8002")


@app.get("/products")
async def list_products(page: int = 1, page_size: int = 20):
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{PRODUCT_URL}/products",
            params={"page": page, "page_size": page_size},
        )
        return resp.json()


@app.get("/products/{product_id}")
async def get_product(product_id: int):
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{PRODUCT_URL}/products/{product_id}")
        return resp.json()


@app.post("/orders")
async def create_order(request: Request):
    body = await request.json()
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{ORDER_URL}/orders", json=body)
        return resp.json()


@app.get("/orders/{order_id}")
async def get_order(order_id: int):
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{ORDER_URL}/orders/{order_id}")
        return resp.json()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "gateway"}
