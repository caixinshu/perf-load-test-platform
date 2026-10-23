# perf 一键压测脚本
# 用法：.\run.ps1 <场景名> [VU] [时长] [TARGET_PATH]
# 示例：
#   .\run.ps1 smoke                      # 冒烟：01-simple-get.js，10 VU / 30s
#   .\run.ps1 load                       # 负载：02-load-test.js，20 VU / 3min
#   .\run.ps1 cpu-opt cache              # CPU 优化 A/B：07-cpu-stress.js + /opt/cache
#   .\run.ps1 cpu-opt parallel 50 60s    # CPU 并行优化：50 VU / 60s

param(
  [Parameter(Position=0, Mandatory=$true)]
  [ValidateSet('smoke','smoke2','load','spike','soak','multi','baseline','stress','cpu','cpu-opt','mem','mem-opt')]
  [string]$Scenario,

  [Parameter(Position=1)]
  [string]$Arg1 = '',

  [Parameter(Position=2)]
  [string]$Arg2 = '',

  [Parameter(Position=3)]
  [string]$Arg3 = ''
)

$k6 = "F:\tools\k6\k6-v2.3.0-windows-amd64\k6.exe"
$baseUrl = if ($env:BASE_URL) { $env:BASE_URL } else { "http://127.0.0.1:8000" }
$perfDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $perfDir)
$resultsDir = Join-Path $repoRoot "perf\results"
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

$summaryFile = Join-Path $resultsDir "$Scenario-$((Get-Date).ToString('yyyyMMdd-HHmmss')).json"

function Invoke-K6 {
  param([string]$Script, [hashtable]$Env, [string]$Summary)
  $args_list = @('run', $Script, '--summary-export=' + $Summary)
  foreach ($k in $Env.Keys) { $args_list += '-e' }
  foreach ($k in $Env.Keys) { $args_list += "$k=$($Env[$k])" }
  Write-Host "k6 $($args_list -join ' ')"
  & $k6 @args_list
}

switch ($Scenario) {
  'smoke'   { Invoke-K6 "$perfDir\01-simple-get.js" @{ BASE_URL=$baseUrl } $summaryFile }
  'smoke2'  { Invoke-K6 "$perfDir\03-smoke-test.js"  @{ BASE_URL=$baseUrl } $summaryFile }
  'load'    { Invoke-K6 "$perfDir\02-load-test.js"   @{ BASE_URL=$baseUrl } $summaryFile }
  'spike'   { Invoke-K6 "$perfDir\04-spike-test.js"  @{ BASE_URL=$baseUrl } $summaryFile }
  'soak'    { Invoke-K6 "$perfDir\05-soak-test.js"   @{ BASE_URL=$baseUrl } $summaryFile }
  'multi'   { Invoke-K6 "$perfDir\06-multi-scenario.js" @{ BASE_URL=$baseUrl } $summaryFile }
  'baseline'{ Invoke-K6 "$perfDir\baseline.js"       @{ BASE_URL=$baseUrl } $summaryFile }
  'stress'  { Invoke-K6 "$perfDir\stress-test.js"    @{ BASE_URL=$baseUrl } $summaryFile }

  # CPU 瓶颈 + A/B（Week 2 Day 11/12）
  'cpu'     {
    $vus = if ($Arg1) { $Arg1 } else { '50' }
    $dur = if ($Arg2) { $Arg2 } else { '60s' }
    Invoke-K6 "$perfDir\07-cpu-stress.js" @{ BASE_URL=$baseUrl; VUS=$vus; DURATION=$dur; TARGET_PATH='/slow/cpu?rounds=100' } $summaryFile
  }
  'cpu-opt' {
    # Arg1: cache | blake2 | parallel | reduce
    $variant = if ($Arg1) { $Arg1 } else { 'cache' }
    $vus = if ($Arg2) { $Arg2 } else { '50' }
    $dur = if ($Arg3) { $Arg3 } else { '60s' }
    $paths = @{
      'cache'    = '/slow/cpu/opt/cache?rounds=100'
      'blake2'   = '/slow/cpu/opt/blake2?rounds=100'
      'parallel' = '/slow/cpu/opt/parallel?rounds=100'
      'reduce'   = '/slow/cpu?rounds=10'
    }
    $path = $paths[$variant]
    Write-Host "==> CPU 优化 A/B：$variant  (path=$path)"
    Invoke-K6 "$perfDir\07-cpu-stress.js" @{ BASE_URL=$baseUrl; VUS=$vus; DURATION=$dur; TARGET_PATH=$path } $summaryFile
  }

  # 内存瓶颈 + A/B（Week 2 Day 11/12）
  'mem'     {
    $vus = if ($Arg1) { $Arg1 } else { '20' }
    $dur = if ($Arg2) { $Arg2 } else { '120s' }
    Invoke-K6 "$perfDir\08-memory-leak.js" @{ BASE_URL=$baseUrl; VUS=$vus; DURATION=$dur; TARGET_PATH='/slow/memory?size_kb=100' } $summaryFile
  }
  'mem-opt' {
    # Arg1: bounded | release
    $variant = if ($Arg1) { $Arg1 } else { 'bounded' }
    $vus = if ($Arg2) { $Arg2 } else { '20' }
    $dur = if ($Arg3) { $Arg3 } else { '120s' }
    $paths = @{
      'bounded' = '/slow/memory/opt/bounded?size_kb=100'
      'release' = '/slow/memory/opt/release?size_kb=100'
    }
    $path = $paths[$variant]
    Write-Host "==> 内存优化 A/B：$variant  (path=$path)"
    Invoke-K6 "$perfDir\08-memory-leak.js" @{ BASE_URL=$baseUrl; VUS=$vus; DURATION=$dur; TARGET_PATH=$path } $summaryFile
  }
}

Write-Host "`nsummary-export: $summaryFile"
