#!/usr/bin/env python3
# ============================================================
# scripts/generate_perf_report.py
# 性能测试报告生成器
# 功能：解析 k6 summary JSON，用 Jinja2 + ECharts 渲染 HTML 报告
#       支持基线对比、通过/失败判定
# 用法:
#   python generate_perf_report.py --summary reports/summary.json
#   python generate_perf_report.py --summary reports/summary.json --baseline baselines/v1.json
# ============================================================
import json
import os
import argparse
from datetime import datetime

from jinja2 import Environment, FileSystemLoader


class PerfReportGenerator:
    def __init__(self, template_dir='perf/templates'):
        self.env = Environment(loader=FileSystemLoader(template_dir))

    def load_k6_summary(self, filepath):
        """加载 k6 summary JSON"""
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)

    def _get_metric(self, summary, name, field, default=0):
        """
        从 k6 summary 安全获取指标字段值。
        兼容 k6 v1.x/v2.x（无 values 层）和 v0.x（有 values 层）。
        """
        metrics = summary.get('metrics', {})
        metric = metrics.get(name)
        if metric is None:
            return default
        if field in metric:
            return metric[field]
        # 兼容旧格式
        if 'values' in metric and field in metric['values']:
            return metric['values'][field]
        return default

    def extract_metrics(self, summary):
        """从 k6 summary 提取关键指标"""
        return {
            'avg': self._get_metric(summary, 'http_req_duration', 'avg'),
            'min': self._get_metric(summary, 'http_req_duration', 'min'),
            'med': self._get_metric(summary, 'http_req_duration', 'med'),
            'p90': self._get_metric(summary, 'http_req_duration', 'p(90)'),
            'p95': self._get_metric(summary, 'http_req_duration', 'p(95)'),
            'p99': self._get_metric(summary, 'http_req_duration', 'p(99)'),
            'max': self._get_metric(summary, 'http_req_duration', 'max'),
            'tps': self._get_metric(summary, 'http_reqs', 'rate'),
            'total_reqs': self._get_metric(summary, 'http_reqs', 'count'),
            # k6 v2.x 中 http_req_failed 的错误率在 value 字段
            'fail_rate': self._get_metric(summary, 'http_req_failed', 'value'),
            'fails': self._get_metric(summary, 'http_req_failed', 'fails'),
            'vus_max': self._get_metric(summary, 'vus_max', 'value'),
            'checks_rate': self._get_metric(summary, 'checks', 'value'),
            'checks_passes': self._get_metric(summary, 'checks', 'passes'),
            'iterations': self._get_metric(summary, 'iterations', 'count'),
        }

    def compare_with_baseline(self, current, baseline):
        """计算和基线的对比"""
        comparison = {}
        # 对响应时间类指标：越低越好；对 TPS：越高越好
        lower_is_better = {'avg', 'p95', 'p99', 'fail_rate'}
        higher_is_better = {'tps'}

        for key in ['avg', 'p95', 'p99', 'tps', 'fail_rate']:
            curr_val = current.get(key, 0)
            base_val = baseline.get(key, 0)
            if base_val > 0:
                diff_pct = (curr_val - base_val) / base_val * 100
            else:
                diff_pct = 0

            if key in lower_is_better:
                is_better = diff_pct < 0
            elif key in higher_is_better:
                is_better = diff_pct > 0
            else:
                is_better = diff_pct <= 0

            comparison[key] = {
                'current': curr_val,
                'baseline': base_val,
                'diff_pct': diff_pct,
                'is_better': is_better,
            }
        return comparison

    def determine_pass(self, metrics, max_p95=500, max_fail_rate=0.01):
        """判断测试是否通过"""
        return metrics['fail_rate'] < max_fail_rate and metrics['p95'] < max_p95

    def generate(self, summary_file, baseline_file=None,
                 output_file='reports/perf-report.html',
                 test_type='load', max_p95=500, max_fail_rate=0.01):
        summary = self.load_k6_summary(summary_file)
        metrics = self.extract_metrics(summary)

        comparison = None
        if baseline_file and os.path.exists(baseline_file):
            baseline = self.extract_metrics(self.load_k6_summary(baseline_file))
            comparison = self.compare_with_baseline(metrics, baseline)

        passed = self.determine_pass(metrics, max_p95, max_fail_rate)

        template = self.env.get_template('report.html')
        html = template.render(
            test_type=test_type,
            test_time=datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            metrics=metrics,
            comparison=comparison,
            passed=passed,
            env=os.environ.get('TEST_ENV', 'dev'),
        )

        out_dir = os.path.dirname(output_file)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(html)

        print('报告已生成: ' + output_file)
        return output_file


def main():
    parser = argparse.ArgumentParser(description='生成性能测试报告')
    parser.add_argument('--summary', required=True, help='k6 summary JSON 文件')
    parser.add_argument('--baseline', help='基线 summary JSON 文件')
    parser.add_argument('--output', default='reports/perf-report.html', help='输出 HTML 文件')
    parser.add_argument('--type', default='load', help='测试类型')
    parser.add_argument('--max-p95', type=float, default=500, help='P95 通过阈值 (ms)')
    parser.add_argument('--max-fail-rate', type=float, default=0.01, help='错误率通过阈值')
    args = parser.parse_args()

    gen = PerfReportGenerator()
    gen.generate(
        args.summary,
        args.baseline,
        args.output,
        args.type,
        args.max_p95,
        args.max_fail_rate,
    )


if __name__ == '__main__':
    main()
