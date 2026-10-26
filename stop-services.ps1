# 停止本地多服务
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like "*uvicorn*main:app*" } |
    ForEach-Object {
        Write-Host "停止 PID $($_.ProcessId): $($_.CommandLine.Substring(0, [Math]::Min(60, $_.CommandLine.Length)))..."
        Stop-Process -Id $_.ProcessId -Force
    }
Write-Host "已停止所有 uvicorn 服务" -ForegroundColor Yellow
