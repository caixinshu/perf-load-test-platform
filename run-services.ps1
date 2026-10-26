# ============================================================
# 本地启动多服务（无 Docker 环境用，SQLite + 内存缓存降级）
# 用法：.\run-services.ps1
# 停止：Ctrl+C 或 .\stop-services.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot

# 清理上一轮的 SQLite 文件
Remove-Item "$repo\services\product\product.db" -ErrorAction SilentlyContinue
Remove-Item "$repo\services\order\order.db" -ErrorAction SilentlyContinue

function Start-Svc($dir, $port, $name) {
    Write-Host "==> 启动 $name ($port)..." -ForegroundColor Cyan
    Push-Location "$repo\services\$dir"
    Start-Process -FilePath "python" -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "$port" -WindowStyle Hidden
    Pop-Location
}

Start-Svc "product" 8001 "product-service"
Start-Svc "order" 8002 "order-service"
Start-Svc "gateway" 8000 "api-gateway"

Write-Host "`n等待服务启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 6

Write-Host "`n==> 健康检查..." -ForegroundColor Cyan
try { (Invoke-WebRequest "http://127.0.0.1:8001/health" -UseBasicParsing -TimeoutSec 5).Content | Write-Host } catch { "product FAIL: $_" }
try { (Invoke-WebRequest "http://127.0.0.1:8002/health" -UseBasicParsing -TimeoutSec 5).Content | Write-Host } catch { "order FAIL: $_" }
try { (Invoke-WebRequest "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 5).Content | Write-Host } catch { "gateway FAIL: $_" }

Write-Host "`n==> 全链路验证（下单 5 节点）..." -ForegroundColor Cyan
$body = '{"product_id":1,"quantity":2}'
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/orders" -Method POST -Body $body `
        -ContentType "application/json" -UseBasicParsing -TimeoutSec 10
    Write-Host "下单成功: $($r.Content)" -ForegroundColor Green
} catch {
    Write-Host "下单失败: $_" -ForegroundColor Red
}

Write-Host "`n服务已在后台运行。停止请运行: .\stop-services.ps1" -ForegroundColor Yellow
