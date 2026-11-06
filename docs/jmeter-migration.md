# JMeter 性能测试方案（k6 迁移设计）

## 一、为什么迁移到 JMeter

| 维度 | k6 | JMeter |
|------|----|--------|
| 学习曲线 | 低（JS 语法） | 中（GUI/XML） |
| 协议支持 | HTTP/gRPC/WebSocket | HTTP/DB/MQ/JMS/全协议 |
| 插件生态 | 较少 | 极其丰富（JMeter Plugins） |
| 分布式 | 需自己写 | 原生支持（Master-Slave） |
| 报告 | 需自己生成 | 原生 HTML Dashboard |
| 企业接受度 | 新兴 | 主流标配 |
| 适合场景 | 快速迭代、DevOps | 复杂协议、企业级压测 |

**结论**：k6 适合快速上手和 DevOps 集成；JMeter 适合复杂场景和企业标准。本方案保留 k6 的工程化思想，迁移到 JMeter 实现。

## 二、k6 → JMeter 概念映射

| k6 模块 | JMeter 对应实现 | 说明 |
|---------|----------------|------|
| `config/base.js`（环境/阈值/场景） | `jmeter.properties` + User Defined Variables | 环境地址、线程数、时长外部化 |
| `config/{env}.js` | `env-{dev,staging,prod}.properties` | 各环境覆盖配置 |
| `lib/http.js`（apiGet/apiPost） | HTTP Request Defaults + HTTP Header Manager | 统一 baseUrl、Content-Type |
| `lib/auth.js`（login/token） | HTTP Request(登录) + JSON Extractor + Header Manager | 登录后提取 token，后续请求自动带 |
| `lib/utils.js`（断言/随机） | Response Assertion + Duration Assertion + __Random | 状态码断言、响应时间断言、随机数据 |
| `scenarios/baseline.js` | Thread Group + HTTP Request | 线程组 + 请求组合 |
| `data/products.json` | CSV Data Set Config | 参数化测试数据 |
| `thresholds`（p95<500） | Duration Assertion + 结果文件解析 | JMeter 原生不支持百分位断言，用脚本解析 .jtl |
| `--summary-export` | `-l result.jtl` | 输出结果文件 |
| `performance_gate.py` | `jmeter_gate.py`（解析 .jtl） | 检查 p95/错误率 |
| `generate_perf_report.py` | `jmeter -e -o report/` | JMeter 原生 HTML 报告 |
| Toxiproxy 混沌 | 不变 | 黑盒代理层注入，与工具无关 |

## 三、目录结构设计

```
perf-jmeter/
├── properties/
│   ├── jmeter.properties        # 通用配置（结果格式、超时等）
│   ├── env-dev.properties       # dev 环境
│   ├── env-staging.properties
│   └── env-prod.properties
├── testplans/
│   ├── baseline.jmx             # 基准测试
│   ├── load-test.jmx            # 负载测试
│   ├── stress-test.jmx          # 压力测试
│   ├── soak-test.jmx            # 稳定性测试
│   ├── full-link-ecommerce.jmx  # 全链路电商
│   └── api/
│       ├── product.jmx
│       └── order.jmx
├── data/
│   ├── products.csv             # 商品数据
│   └── users.csv                # 用户数据
├── scripts/
│   ├── run-jmeter.ps1           # Windows 运行脚本
│   ├── run-jmeter.sh            # Linux 运行脚本
│   └── jmeter_gate.py           # 性能门禁（解析 .jtl）
└── reports/                     # .jtl 结果 + HTML 报告
```

## 四、核心模块 JMeter 实现

### 4.1 环境配置（properties 文件）

`properties/env-dev.properties`：
```properties
# 环境地址
baseUrl=http://localhost:8000
protocol=http

# 场景参数
threads=5
ramp_up=10
duration=60

# 阈值
max_p95=500
max_fail_rate=0.01
```

运行时通过 `-q env-dev.properties` 加载。

### 4.2 HTTP 公共配置（HTTP Request Defaults）

在 Test Plan 下添加：
- **User Defined Variables**：引用 properties 中的 baseUrl
- **HTTP Request Defaults**：Server Name = `${baseUrl}`，Protocol = `${protocol}`
- **HTTP Header Manager**：Content-Type: application/json

### 4.3 鉴权（登录 + token 传递）

```
Thread Group
├── HTTP Request: POST /login
│   └── JSON Extractor: 提取 $.data.token → token 变量
├── HTTP Header Manager: Authorization: Bearer ${token}
└── HTTP Request: GET /products/1  (自动带 token)
```

### 4.4 参数化（CSV Data Set Config）

```
CSV Data Set Config
├── Filename: data/products.csv
├── Variable Names: product_id,product_name,price
└── HTTP Request: GET /products/${product_id}
```

### 4.5 断言

- **Response Assertion**：响应码 = 200
- **Duration Assertion**：单个请求 < 1000ms（JMeter 原生支持）
- **百分位断言**：JMeter 原生不支持，用 `jmeter_gate.py` 解析 .jtl 实现

### 4.6 运行命令

```powershell
# Windows
jmeter -n -t testplans/baseline.jmx `
  -q properties/jmeter.properties `
  -q properties/env-dev.properties `
  -l reports/baseline.jtl `
  -e -o reports/baseline-report/

# Linux
jmeter -n -t testplans/baseline.jmx \
  -q properties/jmeter.properties \
  -q properties/env-dev.properties \
  -l reports/baseline.jtl \
  -e -o reports/baseline-report/
```

参数说明：
- `-n` 非 GUI 模式
- `-t` 测试计划文件
- `-q` 加载属性文件
- `-l` 结果输出文件（.jtl）
- `-e` 生成 HTML 报告
- `-o` 报告输出目录

## 五、性能门禁（jmeter_gate.py）

JMeter 的 `.jtl` 文件是 CSV/XML 格式，包含每个请求的时间戳、耗时、状态码。解析后可计算 p95、错误率。

```python
import csv
import numpy as np

def parse_jtl(jtl_path):
    durations = []
    fails = 0
    total = 0
    with open(jtl_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            durations.append(int(row['elapsed']))
            if row['success'] == 'false':
                fails += 1
            total += 1
    p95 = np.percentile(durations, 95)
    fail_rate = fails / total if total > 0 else 1
    return p95, fail_rate, total
```

## 六、CI 集成（jmeter-gate.yml）

```yaml
- name: Run JMeter test
  run: |
    jmeter -n -t testplans/baseline.jmx \
      -q properties/env-dev.properties \
      -l reports/result.jtl -e -o reports/html-report

- name: Performance gate
  run: python scripts/jmeter_gate.py --jtl reports/result.jtl --max-p95 500

- name: Upload report
  uses: actions/upload-artifact@v4
  with:
    name: jmeter-report
    path: reports/html-report/
```

## 七、混沌工程（不变）

Toxiproxy 是黑盒代理，与压测工具无关。k6 和 JMeter 都调 `http://gateway:8000`，故障注入对两者透明。

## 八、k6 vs JMeter 选择建议

| 场景 | 推荐 |
|------|------|
| 团队会 JS，追求快速迭代 | k6 |
| 企业标准要求 JMeter | JMeter |
| 需要测数据库/JMS/MQ | JMeter |
| DevOps 友好，想嵌入 CI | k6（更轻量） |
| 需要丰富的图形化插件 | JMeter |
| 团队已有 JMeter 资产 | JMeter |

**最佳实践**：两者并行。k6 做日常 CI 轻量门禁，JMeter 做复杂场景和正式压测。
