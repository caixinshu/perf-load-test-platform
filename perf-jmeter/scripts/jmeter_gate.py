#!/usr/bin/env python3
# ============================================================
# perf-jmeter/scripts/jmeter_gate.py
# JMeter 性能门禁：解析 .jtl 结果文件，检查 p95 和错误率
# 用法: python jmeter_gate.py --jtl result.jtl --max-p95 500 --max-fail-rate 0.01
# ============================================================
import csv
import argparse
import sys
import numpy as np


def parse_jtl(jtl_path):
    """解析 JMeter .jtl (CSV 格式)，返回统计指标"""
    durations = []
    fails = 0
    total = 0
    label_durations = {}  # 按接口分组

    with open(jtl_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            elapsed = int(row['elapsed'])
            success = row.get('success', 'true').lower() == 'true'
            label = row.get('label', 'unknown')

            durations.append(elapsed)
            if not success:
                fails += 1
            total += 1

            label_durations.setdefault(label, []).append(elapsed)

    if total == 0:
        return None

    result = {
        'total': total,
        'fails': fails,
        'fail_rate': fails / total,
        'avg': float(np.mean(durations)),
        'p90': float(np.percentile(durations, 90)),
        'p95': float(np.percentile(durations, 95)),
        'p99': float(np.percentile(durations, 99)),
        'min': float(np.min(durations)),
        'max': float(np.max(durations)),
    }
    return result


def check_gate(metrics, max_p95=500, max_fail_rate=0.01):
    """检查是否通过门禁"""
    passed = True
    reasons = []

    if metrics['p95'] >= max_p95:
        passed = False
        reasons.append(f"P95={metrics['p95']:.1f}ms >= {max_p95}ms")

    if metrics['fail_rate'] >= max_fail_rate:
        passed = False
        reasons.append(f"错误率={metrics['fail_rate']:.4f} >= {max_fail_rate}")

    return passed, reasons


def main():
    parser = argparse.ArgumentParser(description='JMeter 性能门禁检查')
    parser.add_argument('--jtl', required=True, help='JMeter .jtl 结果文件')
    parser.add_argument('--max-p95', type=float, default=500, help='P95 通过阈值 (ms)')
    parser.add_argument('--max-fail-rate', type=float, default=0.01, help='错误率通过阈值')
    args = parser.parse_args()

    metrics = parse_jtl(args.jtl)
    if metrics is None:
        print("❌ .jtl 文件为空或无有效数据")
        sys.exit(1)

    print("=== JMeter 性能门禁检查 ===")
    print(f"  总请求数: {metrics['total']}")
    print(f"  失败数:   {metrics['fails']}")
    print(f"  错误率:   {metrics['fail_rate']:.4f}")
    print(f"  平均:     {metrics['avg']:.1f} ms")
    print(f"  P90:      {metrics['p90']:.1f} ms")
    print(f"  P95:      {metrics['p95']:.1f} ms")
    print(f"  P99:      {metrics['p99']:.1f} ms")
    print(f"  Min/Max:  {metrics['min']:.0f} / {metrics['max']:.0f} ms")

    passed, reasons = check_gate(metrics, args.max_p95, args.max_fail_rate)

    if passed:
        print(f"\n✅ 门禁通过 (P95 < {args.max_p95}ms, 错误率 < {args.max_fail_rate})")
        sys.exit(0)
    else:
        print(f"\n❌ 门禁未通过:")
        for r in reasons:
            print(f"   - {r}")
        sys.exit(1)


if __name__ == '__main__':
    main()
