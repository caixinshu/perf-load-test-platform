#!/bin/bash
# ============================================================
# scripts/chaos-experiment.sh
# 混沌工程实验：网络延迟注入
#
# 前置条件：docker compose -f docker-compose.chaos.yml up -d --build
# 实验流程：创建 proxy -> 基线测试 -> 注入延迟 -> 故障中测试 -> 移除故障 -> 恢复测试
# ============================================================
set -e

K6=${K6:-k6}
TOXI_API=${TOXI_API:-http://localhost:8475}
REPORT_DIR=${REPORT_DIR:-reports}

mkdir -p "$REPORT_DIR"

echo "=== 混沌工程实验：网络延迟注入 ==="

# ---- Step 1: 创建 proxy ----
echo ""
echo "[Step 1] 创建 Toxiproxy proxy (toxiproxy:8474 -> product-service:8000)"
# 幂等：先删除已存在的 proxy
curl -s -X DELETE "$TOXI_API/proxies/product-service" > /dev/null 2>&1 || true

curl -s -X POST "$TOXI_API/proxies" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "product-service",
    "listen": "0.0.0.0:8474",
    "upstream": "product-service:8000"
  }'
echo ""
echo "  Proxy 创建完成"

# 等待 gateway 路由就绪
sleep 3

# ---- Step 2: 基线性能 ----
echo ""
echo "[Step 2] 基线性能测试（无故障）"
"$K6" run perf/scenarios/baseline.js -e ENV=dev --summary-export="$REPORT_DIR/baseline-before.json"

# ---- Step 3: 注入 200ms 网络延迟 ----
echo ""
echo "[Step 3] 注入 200ms 网络延迟 (jitter=50ms)"
curl -s -X POST "$TOXI_API/proxies/product-service/toxics" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "latency_toxic",
    "type": "latency",
    "attributes": {
      "latency": 200,
      "jitter": 50
    }
  }'
echo ""
echo "  延迟注入完成"

# ---- Step 4: 故障中性能测试 ----
echo ""
echo "[Step 4] 有 200ms 延迟时的性能测试"
"$K6" run perf/scenarios/baseline.js -e ENV=dev --summary-export="$REPORT_DIR/baseline-with-latency.json"

# ---- Step 5: 移除故障 ----
echo ""
echo "[Step 5] 移除延迟故障"
curl -s -X DELETE "$TOXI_API/proxies/product-service/toxics/latency_toxic"
echo ""
echo "  故障已移除"

sleep 2

# ---- Step 6: 恢复后性能测试 ----
echo ""
echo "[Step 6] 故障恢复后的性能测试"
"$K6" run perf/scenarios/baseline.js -e ENV=dev --summary-export="$REPORT_DIR/baseline-after.json"

# ---- 实验结果对比 ----
echo ""
echo "=== 实验完成：对比三份 summary ==="
echo "  基线:   $REPORT_DIR/baseline-before.json"
echo "  有延迟: $REPORT_DIR/baseline-with-latency.json"
echo "  恢复后: $REPORT_DIR/baseline-after.json"
echo ""
echo "建议: 用 scripts/generate_perf_report.py 分别生成报告并对比"
