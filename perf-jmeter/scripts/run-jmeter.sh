#!/bin/bash
# ============================================================
# perf-jmeter/scripts/run-jmeter.sh
# JMeter 运行脚本（Linux）
# 用法: bash run-jmeter.sh baseline dev
# ============================================================
set -e

SCENARIO=${1:-baseline}
ENV=${2:-dev}
JMETER_BIN=${JMETER_HOME:+$JMETER_HOME/bin/jmeter}

if [ -z "$JMETER_BIN" ] || [ ! -f "$JMETER_BIN" ]; then
    JMETER_BIN=$(which jmeter 2>/dev/null || echo "")
fi

if [ -z "$JMETER_BIN" ]; then
    echo "请安装 JMeter 并设置 JMETER_HOME"
    exit 1
fi

TESTPLAN="testplans/${SCENARIO}.jmx"
PROPS="properties/env-${ENV}.properties"
COMMON_PROPS="properties/jmeter.properties"
JTL="reports/${SCENARIO}-${ENV}.jtl"
HTML_REPORT="reports/${SCENARIO}-${ENV}-report"

if [ ! -f "$TESTPLAN" ]; then
    echo "测试计划不存在: $TESTPLAN"
    exit 1
fi

mkdir -p reports

echo "=== JMeter 性能测试 ==="
echo "  场景: $SCENARIO"
echo "  环境: $ENV"
echo ""

"$JMETER_BIN" -n -t "$TESTPLAN" \
    -q "$COMMON_PROPS" \
    -q "$PROPS" \
    -l "$JTL" \
    -e -o "$HTML_REPORT"

echo ""
echo "=== 结果 ==="
echo "  .jtl 文件: $JTL"
echo "  HTML 报告: $HTML_REPORT/index.html"

echo ""
echo "=== 性能门禁检查 ==="
python3 scripts/jmeter_gate.py --jtl "$JTL" --max-p95 500 --max-fail-rate 0.01
