#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
k6 分布式压测结果聚合脚本（Week 3 Day 16）

读取多个 k6 worker 的 JSON 输出（k6 --out json 格式，每行一个 JSON），
聚合各指标的 count / total / avg / p90 / p95 / p99 / max。

用法:
    python aggregate_k6_results.py <result_dir>
    # result_dir 下应包含 worker1.json, worker2.json, ...

输出:
    - 终端打印聚合摘要
    - <result_dir>/aggregated-summary.json
"""
import json
import os
import sys
import glob


def percentile(sorted_values, pct):
    """计算百分位数（线性插值法）"""
    if not sorted_values:
        return 0.0
    n = len(sorted_values)
    k = (pct / 100.0) * (n - 1)
    f = int(k)
    c = f + 1 if f + 1 < n else f
    d = k - f
    return sorted_values[f] + d * (sorted_values[c] - sorted_values[f])


def aggregate_results(result_dir):
    """聚合 result_dir 下所有 worker*.json 文件的指标"""
    # metric_name -> list of values
    all_metrics = {}

    result_files = sorted(glob.glob(os.path.join(result_dir, 'worker*.json')))
    print('找到 %d 个 worker 结果文件' % len(result_files))

    if not result_files:
        print('警告：未找到 worker*.json 文件')
        return {}

    for f in result_files:
        worker_name = os.path.basename(f)
        line_count = 0
        point_count = 0
        with open(f, 'r', encoding='utf-8') as fp:
            for line in fp:
                line_count += 1
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # k6 json output: {"type":"Point","metric":"xxx","data":{"time":"...","value":...,"tags":{...}}}
                if data.get('type') == 'Point':
                    metric = data.get('metric', '')
                    value = data.get('data', {}).get('value')
                    if value is not None:
                        if metric not in all_metrics:
                            all_metrics[metric] = []
                        all_metrics[metric].append(float(value))
                        point_count += 1
        print('  %-15s: %d 行, %d 个数据点' % (worker_name, line_count, point_count))

    # 聚合统计
    summary = {}
    for metric, values in sorted(all_metrics.items()):
        values_sorted = sorted(values)
        summary[metric] = {
            'count': len(values),
            'total': sum(values),
            'avg': sum(values) / len(values) if values else 0,
            'min': values_sorted[0] if values_sorted else 0,
            'max': values_sorted[-1] if values_sorted else 0,
            'p(90)': percentile(values_sorted, 90),
            'p(95)': percentile(values_sorted, 95),
            'p(99)': percentile(values_sorted, 99),
        }

    return summary


def print_summary(summary, worker_count=0):
    """打印可读的聚合摘要"""
    print()
    print('=' * 70)
    print('  分布式压测聚合结果（%d 个 worker）' % worker_count)
    print('=' * 70)
    print('%-40s %10s %10s %10s %10s' %
          ('指标', 'count', 'avg', 'p(95)', 'p(99)'))
    print('-' * 70)
    for metric, stats in summary.items():
        print('%-40s %10d %10.4f %10.4f %10.4f' % (
            metric[:40],
            stats['count'],
            stats['avg'],
            stats['p(95)'],
            stats['p(99)'],
        ))
    print('=' * 70)


def main():
    if len(sys.argv) < 2:
        result_dir = '/results'
    else:
        result_dir = sys.argv[1]

    print('结果目录: %s' % result_dir)
    if not os.path.isdir(result_dir):
        print('错误：目录不存在: %s' % result_dir)
        sys.exit(1)

    summary = aggregate_results(result_dir)
    worker_count = len(glob.glob(os.path.join(result_dir, 'worker*.json')))
    print_summary(summary, worker_count)

    out_path = os.path.join(result_dir, 'aggregated-summary.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print()
    print('聚合结果已保存到: %s' % out_path)

    # 关键指标断言（用于 CI 门禁）
    if summary:
        req_duration = summary.get('http_req_duration', {})
        if req_duration:
            p95 = req_duration.get('p(95)', 0)
            print('关键指标 http_req_duration p(95) = %.4f ms' % p95)


if __name__ == '__main__':
    main()
