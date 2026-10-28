"""
OpenTelemetry 链路追踪公共模块

用法：
    from tracing import init_tracing, instrument_fastapi
    init_tracing("product-service")
    instrument_fastapi(app)

降级策略：
- 通过 OTEL_ENABLED 环境变量控制是否启用（默认 false，本地无 Jaeger 时不启用）
- OTEL_JAEGER_HOST / OTEL_JAEGER_PORT 配置 Jaeger agent 地址
- 如果 OTel 依赖未安装，静默跳过，不影响业务
"""
import os
import logging

logger = logging.getLogger(__name__)

OTEL_ENABLED = os.environ.get("OTEL_ENABLED", "false").lower() == "true"
JAEGER_HOST = os.environ.get("OTEL_JAEGER_HOST", "jaeger")
JAEGER_PORT = int(os.environ.get("OTEL_JAEGER_PORT", "6831"))


def init_tracing(service_name: str) -> None:
    """初始化链路追踪，发送到 Jaeger agent。"""
    if not OTEL_ENABLED:
        logger.info("OTel tracing disabled (set OTEL_ENABLED=true to enable)")
        return

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.resources import Resource

        resource = Resource.create({
            "service.name": service_name,
            "service.version": "1.0.0",
        })
        provider = TracerProvider(resource=resource)

        # Jaeger exporter（thrift UDP）
        from opentelemetry.exporter.jaeger.thrift import JaegerExporter
        jaeger_exporter = JaegerExporter(
            agent_host_name=JAEGER_HOST,
            agent_port=JAEGER_PORT,
        )
        provider.add_span_processor(BatchSpanProcessor(jaeger_exporter))

        trace.set_tracer_provider(provider)
        logger.info("OTel tracing enabled for service=%s, jaeger=%s:%s",
                    service_name, JAEGER_HOST, JAEGER_PORT)
    except ImportError as e:
        logger.warning("OTel dependencies not installed, tracing skipped: %s", e)
    except Exception as e:
        logger.warning("OTel init failed, tracing skipped: %s", e)


def instrument_fastapi(app) -> None:
    """对 FastAPI app 进行自动埋点。"""
    if not OTEL_ENABLED:
        return
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        FastAPIInstrumentor.instrument_app(app)
        logger.info("FastAPI instrumented")
    except ImportError:
        logger.warning("opentelemetry-instrumentation-fastapi not installed")
    except Exception as e:
        logger.warning("FastAPI instrumentation failed: %s", e)


def instrument_httpx() -> None:
    """对 httpx 出站请求自动埋点。"""
    if not OTEL_ENABLED:
        return
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        HTTPXClientInstrumentor().instrument()
        logger.info("httpx instrumented")
    except ImportError:
        logger.warning("opentelemetry-instrumentation-httpx not installed")
    except Exception as e:
        logger.warning("httpx instrumentation failed: %s", e)


def instrument_psycopg2() -> None:
    """对 psycopg2 数据库查询自动埋点。"""
    if not OTEL_ENABLED:
        return
    try:
        from opentelemetry.instrumentation.psycopg2 import Psycopg2Instrumentor
        Psycopg2Instrumentor().instrument()
        logger.info("psycopg2 instrumented")
    except ImportError:
        logger.warning("opentelemetry-instrumentation-psycopg2 not installed")
    except Exception as e:
        logger.warning("psycopg2 instrumentation failed: %s", e)
