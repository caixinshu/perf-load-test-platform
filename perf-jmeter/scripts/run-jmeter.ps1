# ============================================================
# perf-jmeter/scripts/run-jmeter.ps1
# JMeter 运行脚本（Windows）
# 用法: .\run-jmeter.ps1 -Scenario baseline -Env dev
# ============================================================
param(
    [string]$Scenario = "baseline",
    [string]$Env = "dev",
    [string]$JmeterHome = $env:JMETER_HOME
)

$ErrorActionPreference = "Stop"

# 默认 JMeter 安装路径
$DefaultJmeterHome = "F:\必备工具\apache-jmeter-5.6.3\apache-jmeter-5.6.3"

if (-not $JmeterHome) {
    if (Test-Path $DefaultJmeterHome) {
        $JmeterHome = $DefaultJmeterHome
        Write-Host "使用默认 JMETER_HOME: $JmeterHome" -ForegroundColor Yellow
    } else {
        Write-Host "请设置 JMETER_HOME 环境变量或安装 JMeter" -ForegroundColor Red
        exit 1
    }
}

$jmeter = Join-Path $JmeterHome "bin\jmeter.bat"
$testPlan = "testplans\$Scenario.jmx"
$props = "properties\env-$Env.properties"
$commonProps = "properties\jmeter.properties"

# 带时间戳的结果文件名，每次运行不覆盖旧结果
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$jtl = "reports\$Scenario-$Env-$timestamp.jtl"
$htmlReport = "reports\$Scenario-$Env-$timestamp-report"

if (-not (Test-Path $testPlan)) {
    Write-Host "测试计划不存在: $testPlan" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "reports")) { New-Item -ItemType Directory reports | Out-Null }

Write-Host "=== JMeter 性能测试 ===" -ForegroundColor Cyan
Write-Host "  场景: $Scenario"
Write-Host "  环境: $Env"
Write-Host "  测试计划: $testPlan"
Write-Host ""

& $jmeter -n -t $testPlan `
    -q $commonProps `
    -q $props `
    -l $jtl `
    -e -o $htmlReport

Write-Host "`n=== 结果 ===" -ForegroundColor Cyan
Write-Host "  .jtl 文件: $jtl"
Write-Host "  HTML 报告: $htmlReport\index.html"

# 运行门禁检查
Write-Host "`n=== 性能门禁检查 ===" -ForegroundColor Cyan
python scripts\jmeter_gate.py --jtl $jtl --max-p95 500 --max-fail-rate 0.01
