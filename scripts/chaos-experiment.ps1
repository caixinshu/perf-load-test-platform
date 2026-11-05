# ============================================================
# scripts/chaos-experiment.ps1
# 混沌工程实验：网络延迟注入
#
# 前置条件：docker compose -f docker-compose.chaos.yml up -d --build
# 实验流程：创建 proxy -> 基线测试 -> 注入延迟 -> 故障中测试 -> 移除故障 -> 恢复测试
# ============================================================

$ErrorActionPreference = "Continue"

$K6 = "F:\tools\k6\k6-v2.3.0-windows-amd64\k6.exe"
$TOXI_API = "http://localhost:8475"
$REPORT_DIR = "reports"

if (-not (Test-Path $REPORT_DIR)) { New-Item -ItemType Directory -Path $REPORT_DIR -Force | Out-Null }

Write-Host "=== 混沌工程实验：网络延迟注入 ===" -ForegroundColor Cyan

# ---- Step 1: 创建 proxy ----
Write-Host "`n[Step 1] 创建 Toxiproxy proxy (toxiproxy:8474 -> product-service:8000)" -ForegroundColor Yellow
# 先删除已存在的 proxy（幂等）
try { Invoke-RestMethod -Uri "$TOXI_API/proxies/product-service" -Method Delete -UseBasicParsing | Out-Null } catch {}

$proxyBody = @{
    name = "product-service"
    listen = "0.0.0.0:8474"
    upstream = "product-service:8000"
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "$TOXI_API/proxies" -Method Post -Body $proxyBody -ContentType "application/json" -UseBasicParsing | Out-Null
    Write-Host "  Proxy 创建成功" -ForegroundColor Green
} catch {
    Write-Host "  Proxy 创建失败: $_" -ForegroundColor Red
    exit 1
}

# 等待 gateway 路由就绪
Start-Sleep -Seconds 3

# ---- Step 2: 基线性能 ----
Write-Host "`n[Step 2] 基线性能测试（无故障）" -ForegroundColor Yellow
& $K6 run perf/scenarios/baseline.js -e ENV=dev --summary-export="$REPORT_DIR/baseline-before.json" 2>&1 | Select-Object -Last 5

# ---- Step 3: 注入 200ms 网络延迟 ----
Write-Host "`n[Step 3] 注入 200ms 网络延迟 (jitter=50ms)" -ForegroundColor Yellow
$toxicBody = @{
    name = "latency_toxic"
    type = "latency"
    attributes = @{
        latency = 200
        jitter = 50
    }
} | ConvertTo-Json -Depth 3

try {
    Invoke-RestMethod -Uri "$TOXI_API/proxies/product-service/toxics" -Method Post -Body $toxicBody -ContentType "application/json" -UseBasicParsing | Out-Null
    Write-Host "  延迟注入成功" -ForegroundColor Green
} catch {
    Write-Host "  延迟注入失败: $_" -ForegroundColor Red
}

# ---- Step 4: 故障中性能测试 ----
Write-Host "`n[Step 4] 有 200ms 延迟时的性能测试" -ForegroundColor Yellow
& $K6 run perf/scenarios/baseline.js -e ENV=dev --summary-export="$REPORT_DIR/baseline-with-latency.json" 2>&1 | Select-Object -Last 5

# ---- Step 5: 移除故障 ----
Write-Host "`n[Step 5] 移除延迟故障" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$TOXI_API/proxies/product-service/toxics/latency_toxic" -Method Delete -UseBasicParsing | Out-Null
    Write-Host "  故障已移除" -ForegroundColor Green
} catch {
    Write-Host "  移除失败: $_" -ForegroundColor Red
}

Start-Sleep -Seconds 2

# ---- Step 6: 恢复后性能测试 ----
Write-Host "`n[Step 6] 故障恢复后的性能测试" -ForegroundColor Yellow
& $K6 run perf/scenarios/baseline.js -e ENV=dev --summary-export="$REPORT_DIR/baseline-after.json" 2>&1 | Select-Object -Last 5

# ---- 实验结果对比 ----
Write-Host "`n=== 实验完成：对比三份 summary ===" -ForegroundColor Cyan
Write-Host "  基线:   $REPORT_DIR/baseline-before.json"
Write-Host "  有延迟: $REPORT_DIR/baseline-with-latency.json"
Write-Host "  恢复后: $REPORT_DIR/baseline-after.json"
Write-Host "`n建议: 用 scripts/generate_perf_report.py 分别生成报告并对比" -ForegroundColor Gray
