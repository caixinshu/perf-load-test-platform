#!/usr/bin/env python3
# ============================================================
# scripts/performance_gate.py
# 性能门禁检查脚本
# 功能：固定阈值检查 + 基线对比检查，通过返回 exit 0，失败返回 exit 1
# 用法:
#   python performance_gate.py --current reports/summary.json --max-p95 500 --mode threshold
#   python performance_gate.py --current reports/summary.json --baseline baselines/v1.json --mode baseline
#   python performance_gate.py --current reports/summary.json --baseline baselines/v1.json --mode both
# ============================================================
import json
import sys
import argparse


def load_summary(filepath):
    """加载 k6 summary JSON"""
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)


def get_metric(summary, metric_name, field):
    """
    从 k6 summary 中安全地获取指标字段值。
    兼容 k6 v1.x/v2.x（无 values 包装层）和 v0.x（有 values 包装层）。
    """
    metrics = summary.get('metrics', {})
    metric = metrics.get(metric_name)
    if metric is None:
        return None
    # k6 v1.x/v2.x: 字段直接在 metric 下
    if field in metric:
        return metric[field]
    # k6 v0.x: 字段在 metric['values'] 下
    if 'values' in metric and field in metric['values']:
        return metric['values'][field]
    return None


def check_threshold(current, thresholds):
    """固定阈值检查"""
    results = {}
    all_passed = True

    # P95 响应时间 (ms)
    p95 = get_metric(current, 'http_req_duration', 'p(95)')
    max_p95 = thresholds.get('max_p95_ms', 500)
    if p95 is not None:
        p95_pass = p95 < max_p95
        results['p95_threshold'] = {
            'value': p95,
            'threshold': max_p95,
            'passed': p95_pass,
            'unit': 'ms',
        }
        if not p95_pass:
            all_passed = False
    else:
        results['p95_threshold'] = {
            'value': 'N/A',
            'threshold': max_p95,
            'passed': True,
            'unit': 'ms',
            'note': 'metric not found, skipped',
        }

    # 错误率
    fail_rate = get_metric(current, 'http_req_failed', 'value')
    max_fail = thresholds.get('max_fail_rate', 0.01)
    if fail_rate is not None:
        fail_pass = fail_rate < max_fail
        results['fail_rate'] = {
            'value': fail_rate,
            'threshold': max_fail,
            'passed': fail_pass,
            'unit': 'rate',
        }
        if not fail_pass:
            all_passed = False
    else:
        results['fail_rate'] = {
            'value': 'N/A',
            'threshold': max_fail,
            'passed': True,
            'unit': 'rate',
            'note': 'metric not found, skipped',
        }

    return all_passed, results


def compare_baseline(current, baseline, max_degradation=0.1):
    """和基线对比，检查退化幅度"""
    results = {}
    all_passed = True

    # P95 退化对比
    curr_p95 = get_metric(current, 'http_req_duration', 'p(95)')
    base_p95 = get_metric(baseline, 'http_req_duration', 'p(95)')

    if curr_p95 is not None and base_p95 is not None and base_p95 > 0:
        degradation = (curr_p95 - base_p95) / base_p95
        pass_deg = degradation <= max_degradation
        results['p95_degradation'] = {
            'current': curr_p95,
            'baseline': base_p95,
            'degradation': degradation,
            'max_allowed': max_degradation,
            'passed': pass_deg,
        }
        if not pass_deg:
            all_passed = False
    else:
        results['p95_degradation'] = {
            'current': curr_p95,
            'baseline': base_p95,
            'degradation': 'N/A',
            'max_allowed': max_degradation,
            'passed': True,
            'note': 'insufficient data, skipped',
        }

    # 错误率退化对比（当前错误率不能显著高于基线）
    curr_fail = get_metric(current, 'http_req_failed', 'value')
    base_fail = get_metric(baseline, 'http_req_failed', 'value')

    if curr_fail is not None and base_fail is not None:
        # 错误率只升不降，当前必须 <= 基线 * (1 + max_degradation)
        allowed = base_fail * (1 + max_degradation) if base_fail > 0 else max_degradation
        pass_fail = curr_fail <= allowed
        results['fail_rate_degradation'] = {
            'current': curr_fail,
            'baseline': base_fail,
            'allowed': allowed,
            'passed': pass_fail,
        }
        if not pass_fail:
            all_passed = False
    else:
        results['fail_rate_degradation'] = {
            'current': curr_fail,
            'baseline': base_fail,
            'passed': True,
            'note': 'insufficient data, skipped',
        }

    return all_passed, results


def print_threshold_results(results):
    for name, r in results.items():
        status = 'PASS' if r['passed'] else 'FAIL'
        if r['value'] == 'N/A':
            print('  %s: N/A [%s] (%s)' % (name, status, r.get('note', '')))
        elif r.get('unit') == 'rate':
            print('  %s: %.4f (阈值: %.4f) [%s]' % (name, r['value'], r['threshold'], status))
        else:
            print('  %s: %.2fms (阈值: %.2fms) [%s]' % (name, r['value'], r['threshold'], status))


def print_baseline_results(results, max_degradation):
    for name, r in results.items():
        status = 'PASS' if r['passed'] else 'FAIL'
        if r.get('degradation') == 'N/A' or 'degradation' not in r:
            print('  %s: N/A [%s] (%s)' % (name, status, r.get('note', '')))
        elif 'current' in r and 'baseline' in r and 'degradation' in r:
            deg_pct = r['degradation'] * 100
            print('  %s: 当前=%.2fms, 基线=%.2fms, 退化=%.1f%% [上限:%.0f%%] [%s]' % (
                name, r['current'], r['baseline'], deg_pct, max_degradation * 100, status))
        elif 'current' in r and 'baseline' in r and 'allowed' in r:
            print('  %s: 当前=%.4f, 基线=%.4f, 允许上限=%.4f [%s]' % (
                name, r['current'], r['baseline'], r['allowed'], status))


def main():
    parser = argparse.ArgumentParser(description='性能门禁检查')
    parser.add_argument('--current', required=True, help='本次测试 summary JSON 路径')
    parser.add_argument('--baseline', help='基线测试 summary JSON 路径')
    parser.add_argument('--max-p95', type=float, default=500, help='P95 最大阈值 (ms)')
    parser.add_argument('--max-fail-rate', type=float, default=0.01, help='最大错误率')
    parser.add_argument('--max-degradation', type=float, default=0.1, help='最大退化幅度 (0.1 = 10%%)')
    parser.add_argument('--mode', choices=['threshold', 'baseline', 'both'], default='both',
                        help='检查模式: threshold(固定阈值) / baseline(基线对比) / both(两者)')
    args = parser.parse_args()

    current = load_summary(args.current)

    thresholds = {
        'max_p95_ms': args.max_p95,
        'max_fail_rate': args.max_fail_rate,
    }

    overall_pass = True

    # 固定阈值检查
    if args.mode in ('threshold', 'both'):
        print('=== 固定阈值检查 ===')
        passed, results = check_threshold(current, thresholds)
        print_threshold_results(results)
        if not passed:
            overall_pass = False
        print()

    # 基线对比检查
    if args.mode in ('baseline', 'both'):
        if args.baseline:
            print('=== 基线对比检查 ===')
            baseline = load_summary(args.baseline)
            passed, results = compare_baseline(current, baseline, args.max_degradation)
            print_baseline_results(results, args.max_degradation)
            if not passed:
                overall_pass = False
        else:
            print('=== 基线对比检查 ===')
            print('  未提供 --baseline，跳过基线对比')
        print()

    if overall_pass:
        print('✅ 性能门禁通过')
        sys.exit(0)
    else:
        print('❌ 性能门禁未通过，请检查性能退化')
        sys.exit(1)


if __name__ == '__main__':
    main()
