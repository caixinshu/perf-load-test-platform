#!/usr/bin/env python3
"""把 k6 的 summary-export 结果推送到 Pushgateway。

为什么需要这个脚本：
    k6 是短生命周期进程，只在压测那 30 秒 ~ 3 分钟内存在。Prometheus 默认抓不到它，
    而 remote write 只记录"压测过程中的曲线"，压测结束后的最终结果没有独立存档。
    summary-export 是 k6 结束后写出的结构化汇总，用 Pushgateway 把它变成可长期保存、
    可跨批次对比的 Prometheus 指标。

用法：
    python scripts/push_k6_metrics.py perf/results/load-summary.json
    python scripts/push_k6_metrics.py perf/results/load-summary.json --dry-run
    python scripts/push_k6_metrics.py perf/results/load-summary.json \
        --pushgateway-url http://localhost:9091 --script 02-load-test --environment ci

注意：
    - summary-export 默认只导出 p(90)/p(95)，要 p(99) 需在 k6 命令上加
      --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)"
    - 默认不带 --run-id，同 script 的多次结果会互相覆盖（看板永远显示最近一次）；
      需要保留历史时传 --run-id，脚本会把它作为分组标签，各批次独立保留。
"""

import argparse
import json
import re
import sys
from pathlib import Path

from prometheus_client import CollectorRegistry, Gauge, push_to_gateway


def load_metrics(summary_path):
    """读取 k6 --summary-export 导出的 JSON，返回 metrics 字典。"""
    with open(summary_path, encoding="utf-8") as f:
        data = json.load(f)

    metrics = data.get("metrics")
    if not isinstance(metrics, dict):
        raise ValueError(
            f"{summary_path} 不是 k6 summary-export 格式（缺少 metrics 字段）。"
            "请确认 k6 命令带上了 --summary-export。"
        )
    return metrics


def _number(metric, key):
    """取指标字段并转 float；不存在返回 None（用于跳过不可用指标）。"""
    value = metric.get(key)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _ratio(metric, total_key=None):
    """Rate 型指标：优先用 value 字段，否则用 passes/(passes+fails) 计算。"""
    value = _number(metric, "value")
    if value is not None:
        return value

    passes = _number(metric, "passes") or 0.0
    fails = _number(metric, "fails") or 0.0
    total = passes + fails
    return passes / total if total else None


def collect_values(metrics):
    """把 summary 里的指标映射成 (Prometheus 指标名, 说明, 值) 列表。

    只返回有值的项：缺 p(99) 时不创建对应的 Gauge，
    避免 Prometheus 里出现一条恒为 0 的假数据。
    """
    duration = metrics.get("http_req_duration") or {}
    failed = metrics.get("http_req_failed") or {}
    checks = metrics.get("checks") or {}
    reqs = metrics.get("http_reqs") or {}
    vus_max = metrics.get("vus_max") or {}
    iterations = metrics.get("iterations") or {}

    return [
        # 响应时间：summary 里单位是毫秒，指标名统一转成秒，符合 Prometheus 命名惯例
        (
            "k6_test_http_req_duration_p95_seconds",
            "k6 压测 P95 响应时间（秒）",
            _ms_to_s(_number(duration, "p(95)")),
        ),
        (
            "k6_test_http_req_duration_p99_seconds",
            "k6 压测 P99 响应时间（秒）",
            _ms_to_s(_number(duration, "p(99)")),
        ),
        (
            "k6_test_http_req_duration_avg_seconds",
            "k6 压测平均响应时间（秒）",
            _ms_to_s(_number(duration, "avg")),
        ),
        (
            "k6_test_http_req_duration_max_seconds",
            "k6 压测最大响应时间（秒）",
            _ms_to_s(_number(duration, "max")),
        ),
        # 吞吐
        ("k6_test_http_reqs_rate", "k6 压测 TPS（req/s）", _number(reqs, "rate")),
        ("k6_test_http_reqs_count", "k6 压测请求总数", _number(reqs, "count")),
        # 质量
        ("k6_test_http_req_failed_rate", "k6 压测请求失败率（0-1）", _ratio(failed)),
        ("k6_test_checks_rate", "k6 断言通过率（0-1）", _ratio(checks)),
        # 负载与迭代
        ("k6_test_vus_max", "k6 最大并发 VU", _number(vus_max, "value") or _number(vus_max, "max")),
        ("k6_test_iterations_count", "k6 迭代总数", _number(iterations, "count")),
    ]


def _ms_to_s(value):
    return None if value is None else value / 1000.0


def infer_script_name(summary_path):
    """从文件名推断脚本名：xxx-summary.json -> xxx。"""
    name = Path(summary_path).name
    name = re.sub(r"-summary\.json$", "", name)
    return name or "k6-loadtest"


def main():
    parser = argparse.ArgumentParser(
        description="解析 k6 summary-export JSON 并推送到 Pushgateway"
    )
    parser.add_argument("summary", help="k6 --summary-export 导出的 JSON 文件路径")
    parser.add_argument(
        "--pushgateway-url",
        default="http://localhost:9091",
        help="Pushgateway 地址（默认 http://localhost:9091）",
    )
    parser.add_argument("--job", default="k6_loadtest", help="Pushgateway job 名")
    parser.add_argument("--script", default=None, help="压测脚本名（默认从文件名推断）")
    parser.add_argument(
        "--run-id",
        default=None,
        help="批次标识；不传则同脚本结果覆盖，传入则按批次保留历史",
    )
    parser.add_argument("--environment", default="local", help="环境标签，如 local / ci")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只解析并打印指标，不真正推送（无 Docker / 无 Pushgateway 时自检用）",
    )
    args = parser.parse_args()

    metrics = load_metrics(args.summary)
    rows = [(name, help_text, value) for name, help_text, value in collect_values(metrics) if value is not None]

    if not rows:
        print("未从 summary 中解析到任何可用指标，请检查文件内容。", file=sys.stderr)
        return 1

    script_name = args.script or infer_script_name(args.summary)

    print(f"summary : {args.summary}")
    print(f"script  : {script_name}")
    print(f"指标数  : {len(rows)}")
    print("-" * 62)
    for name, _, value in rows:
        print(f"{name:52s} {value:>12.4f}")
    print("-" * 62)

    if args.dry_run:
        print("dry-run：未推送（去掉 --dry-run 即可真正推送到 Pushgateway）")
        return 0

    registry = CollectorRegistry()
    for name, help_text, value in rows:
        Gauge(name, help_text, registry=registry).set(value)

    # 分组标签：同一 script 的指标归到同一个 group。
    # 不带 run-id 时 push_to_gateway 会整体替换该 group，即覆盖上一轮结果。
    grouping_key = {"script": script_name, "environment": args.environment}
    if args.run_id:
        grouping_key["run_id"] = args.run_id

    push_to_gateway(
        args.pushgateway_url,
        job=args.job,
        registry=registry,
        grouping_key=grouping_key,
    )
    print(f"已推送到 {args.pushgateway_url}（job={args.job}, {grouping_key}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
