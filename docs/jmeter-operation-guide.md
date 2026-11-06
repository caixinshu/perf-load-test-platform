# JMeter 性能测试方案 - 详细操作文档

> JMeter 安装路径：`F:\必备工具\apache-jmeter-5.6.3\apache-jmeter-5.6.3`
> 项目路径：`f:\apk\其他\todo\perf-load-test-platform\perf-jmeter`

---

## 一、环境准备

### 1.1 设置环境变量（一次性，永久生效）

**方式 A：图形界面设置**
1. 右键「此电脑」→「属性」→「高级系统设置」→「环境变量」
2. 在「系统变量」中新建：
   - 变量名：`JMETER_HOME`
   - 变量值：`F:\必备工具\apache-jmeter-5.6.3\apache-jmeter-5.6.3`
3. 找到系统变量中的 `Path`，点击「编辑」，新增一行：
   - `%JMETER_HOME%\bin`
4. 确定保存，**关闭并重新打开** PowerShell/CMD

**方式 B：PowerShell 临时设置（仅当前窗口有效）**
```powershell
$env:JMETER_HOME = "F:\必备工具\apache-jmeter-5.6.3\apache-jmeter-5.6.3"
$env:Path = "$env:JMETER_HOME\bin;$env:Path"
```

### 1.2 验证安装

```powershell
# 验证 jmeter 命令可用
jmeter -v
```

应输出包含 `5.6.3` 的版本信息。

### 1.3 验证 Java

JMeter 5.6.3 需要 Java 8+，本机已有 Java 1.8.0_202：
```powershell
java -version
```

---

## 二、打开现有测试计划（GUI 模式）

### 2.1 启动 JMeter GUI

```powershell
jmeter
```

或直接双击：`F:\必备工具\apache-jmeter-5.6.3\apache-jmeter-5.6.3\bin\jmeter.bat`

### 2.2 打开测试计划

1. JMeter 启动后，菜单「File」→「Open」
2. 选择：`f:\apk\其他\todo\perf-load-test-platform\perf-jmeter\testplans\baseline.jmx`
3. 左侧树状结构展开，可看到以下组件：

```
Baseline Test (Test Plan)
├── HTTP Request Defaults          ← 统一域名/协议
├── HTTP Header Manager           ← 统一 Content-Type
└── Baseline Thread Group         ← 线程组
    ├── POST /api/auth/login      ← 登录请求
    │   ├── JSON Extractor        ← 提取 token
    │   └── Assertion - 200 OK    ← 状态码断言
    ├── Authorization Header      ← 带 token 的请求头
    ├── GET /api/products/1       ← 业务请求
    │   ├── Assertion - 200 OK
    │   └── Assertion - Duration  ← 响应时间断言
    ├── Think Time - 1s           ← 思考时间
    └── Summary Report            ← 聚合报告
```

---

## 三、各组件详解与修改方法

### 3.1 HTTP Request Defaults（统一域名）

**作用**：所有 HTTP 请求默认使用这里配置的域名和协议，对应 k6 的 `initHttp(baseUrl)`。

**修改方法**：
1. 点击左侧「HTTP Request Defaults」
2. 右侧填写：
   - **Protocol**：`${protocol}`（从 properties 读取，或直接填 `http`）
   - **Server Name or IP**：`${baseUrl}`（或直接填 `localhost:8000`）
   - **Content encoding**：`UTF-8`

> 如果不使用 properties 文件，直接在 Server Name 填实际地址即可。

### 3.2 HTTP Header Manager（统一请求头）

**作用**：所有请求自动带上这里配置的 Header。

**当前配置**：
- `Content-Type: application/json`

**新增 Header**：
1. 点击「HTTP Header Manager」
2. 点击下方「Add」按钮
3. 填写 Name 和 Value

### 3.3 Thread Group（线程组）

**作用**：控制并发用户数、启动时间、运行时长。对应 k6 的 `scenarios`。

**修改方法**：
1. 点击「Baseline Thread Group」
2. 右侧关键参数：
   - **Number of Threads (users)**：`${threads}` → 并发用户数
   - **Ramp-up period (seconds)**：`${ramp_up}` → 启动所有线程的时间
   - **Scheduler**：勾选
   - **Duration (seconds)**：`${duration}` → 运行总时长
   - **Loop Count**：`Forever`（配合 Duration 使用）

**不使用 properties 时**：直接填数字，如 `threads=5`、`ramp_up=10`、`duration=60`。

### 3.4 POST /api/auth/login（登录请求）

**作用**：登录获取 token。对应 k6 的 `login()`。

**当前配置**：
- Path：`/api/auth/login`
- Method：POST
- Body Data：`{"username":"testuser","password":"testpass"}`

**修改方法**：
1. 点击「POST /api/auth/login」
2. 右侧切换到「Body Data」标签
3. 修改 JSON 请求体为实际的登录参数

### 3.5 JSON Extractor（提取 token）

**作用**：从登录响应中提取 token，存为变量供后续请求使用。

**当前配置**：
- Names of created variables：`token`
- JSON Path expressions：`$.data.token`

**修改方法**：
1. 点击「JSON Extractor - token」
2. 根据实际响应结构修改 JSON Path
   - 例如响应为 `{"token":"abc"}`，则 JSON Path 填 `$.token`
   - 响应为 `{"data":{"access_token":"abc"}}`，则填 `$.data.access_token`

### 3.6 Authorization Header（带 token 的请求头）

**作用**：后续请求自动带上 `Authorization: Bearer ${token}`。

**当前配置**：
- `Authorization: Bearer ${token}`

> 此组件在 Thread Group 内、登录请求之后，确保 token 已提取。

### 3.7 GET /api/products/1（业务请求）

**作用**：实际测试的接口。

**当前配置**：
- Path：`/api/products/1`
- Method：GET

**修改方法**：
1. 点击「GET /api/products/1」
2. 修改 Path 为实际接口路径
3. 如果是 POST/PUT，切换 Method 并在「Body Data」填请求体

### 3.8 Response Assertion（状态码断言）

**作用**：验证响应状态码是否为 200。

**当前配置**：
- Field to Test：Response Code
- Pattern Matching Rules：Equals
- Patterns to Test：`200`

### 3.9 Duration Assertion（响应时间断言）

**作用**：单个请求响应时间必须小于 1000ms。

**当前配置**：
- Duration in milliseconds：`1000`

**修改方法**：修改数字即可。

### 3.10 Constant Timer（思考时间）

**作用**：每个请求之间等待 1 秒，模拟真实用户操作间隔。

**当前配置**：
- Thread Delay (ms)：`1000`

### 3.11 Summary Report（聚合报告）

**作用**：运行后展示统计结果（平均、P90、P95、错误率、TPS）。

> 这是生成报告的数据源，必须保留。

---

## 四、如何新增一个接口请求

以新增「查询订单列表」接口为例：

### 步骤 1：添加 HTTP 请求
1. 右键「Baseline Thread Group」→「Add」→「Sampler」→「HTTP Request」
2. 命名：`GET /api/orders`
3. 填写：
   - Path：`/api/orders`
   - Method：`GET`

### 步骤 2：添加断言
1. 右键刚创建的「GET /api/orders」→「Add」→「Assertions」→「Response Assertion」
2. 配置：
   - Field to Test：Response Code
   - Pattern Matching Rules：Equals
   - Patterns to Test：`200`

### 步骤 3：添加响应时间断言（可选）
1. 右键「GET /api/orders」→「Add」→「Assertions」→「Duration Assertion」
2. Duration：`1000`

### 步骤 4：调整顺序
拖动「GET /api/orders」放到「Authorization Header」之后（确保带 token）。

---

## 五、如何做参数化（CSV 数据驱动）

以商品 ID 参数化为例，每次请求取不同的商品 ID。

### 步骤 1：准备 CSV 数据

`perf-jmeter/data/products.csv` 已包含示例数据：
```csv
product_id,product_name,price
1,iPhone 15,6999
2,MacBook Pro,14999
```

### 步骤 2：添加 CSV Data Set Config
1. 右键「Baseline Thread Group」→「Add」→「Config Element」→「CSV Data Set Config」
2. 配置：
   - **Filename**：`data/products.csv`（相对测试计划的路径，或绝对路径）
   - **Variable Names**：`product_id,product_name,price`
   - **Recycle on EOF**：`True`（数据用完后循环）
   - **Stop thread on EOF**：`False`

### 步骤 3：在请求中引用变量
1. 点击「GET /api/products/1」
2. 修改 Path 为：`/api/products/${product_id}`

### 步骤 4：在 Body 中引用变量（POST 请求）
```json
{"product_id": ${product_id}, "name": "${product_name}"}
```

---

## 六、如何运行测试

### 6.1 GUI 模式（调试用，不建议正式压测）

1. 打开 `baseline.jmx`
2. 点击工具栏绿色三角按钮（或 Ctrl+R）
3. 点击「Summary Report」查看实时结果
4. 点击红色方块停止

> GUI 模式会占用大量内存，正式压测务必用命令行模式。

### 6.2 命令行模式（推荐）

```powershell
cd f:\apk\其他\todo\perf-load-test-platform\perf-jmeter

jmeter -n `
  -t testplans\baseline.jmx `
  -q properties\jmeter.properties `
  -q properties\env-dev.properties `
  -l reports\baseline-dev.jtl `
  -e -o reports\baseline-dev-report
```

参数说明：

| 参数 | 说明 |
|------|------|
| `-n` | 非 GUI 模式 |
| `-t` | 测试计划文件 |
| `-q` | 加载 properties 文件（可多次指定） |
| `-l` | 结果输出文件（.jtl） |
| `-e` | 测试结束后生成 HTML 报告 |
| `-o` | HTML 报告输出目录 |

### 6.3 使用运行脚本

```powershell
# Windows
.\scripts\run-jmeter.ps1 -Scenario baseline -Env dev

# Linux
bash scripts/run-jmeter.sh baseline dev
```

---

## 七、如何查看结果

### 7.1 查看 .jtl 原始数据

用 Excel 或文本编辑器打开 `reports\baseline-dev.jtl`，每行一个请求的统计：
- `elapsed`：响应时间（ms）
- `responseCode`：状态码
- `success`：是否成功
- `label`：请求名称

### 7.2 查看 HTML 报告

用浏览器打开：`reports\baseline-dev-report\index.html`

报告包含：
- **Statistics**：平均、P90、P95、P99、错误率、TPS
- **Charts**：响应时间分布图、TPS 趋势图、错误率趋势图
- **Apdex**：应用性能指数

### 7.3 查看聚合报告

命令行运行时，`Summary Report` 监听器的数据也会写入 .jtl。

---

## 八、性能门禁检查

JMeter 原生不支持百分位断言（如 p95 < 500ms），用 `jmeter_gate.py` 解析 .jtl 实现。

### 8.1 运行门禁检查

```powershell
cd f:\apk\其他\todo\perf-load-test-platform\perf-jmeter

python scripts\jmeter_gate.py `
  --jtl reports\baseline-dev.jtl `
  --max-p95 500 `
  --max-fail-rate 0.01
```

### 8.2 输出示例

```
=== JMeter 性能门禁检查 ===
  总请求数: 1000
  失败数:   0
  错误率:   0.0000
  平均:     234.0 ms
  P90:      460.0 ms
  P95:      530.0 ms
  P99:      586.0 ms

❌ 门禁未通过:
   - P95=530.0ms >= 500.0ms
```

- 退出码 0 = 通过
- 退出码 1 = 未通过（CI 可据此阻断）

---

## 九、如何创建新的测试场景

以创建「负载测试」场景为例：

### 步骤 1：复制 baseline.jmx
```powershell
Copy-Item testplans\baseline.jmx testplans\load-test.jmx
```

### 步骤 2：在 JMeter GUI 中打开 load-test.jmx
1. 修改 Thread Group 参数：
   - Number of Threads：`50`
   - Ramp-up：`30`
   - Duration：`300`
2. 添加更多接口请求（如全链路：浏览商品 → 下单 → 查询订单）
3. 保存

### 步骤 3：添加环境配置
在 `properties\env-dev.properties` 中添加负载测试参数：
```properties
load_threads=50
load_ramp_up=30
load_duration=300
```

### 步骤 4：运行
```powershell
jmeter -n -t testplans\load-test.jmx `
  -q properties\jmeter.properties `
  -q properties\env-dev.properties `
  -l reports\load-test.jtl `
  -e -o reports\load-test-report
```

---

## 十、混沌工程实验（Toxiproxy）

Toxiproxy 是黑盒代理，与 JMeter 无关，注入故障对 JMeter 透明。

### 步骤 1：启动带 Toxiproxy 的服务栈
```powershell
cd f:\apk\其他\todo\perf-load-test-platform
docker compose -f docker-compose.chaos.yml up -d --build
```

### 步骤 2：注入 200ms 延迟
```powershell
# 创建 proxy（首次）
Invoke-RestMethod -Uri "http://localhost:8475/proxies" -Method Post `
  -ContentType "application/json" `
  -Body '{"name":"product-service","listen":"0.0.0.0:8474","upstream":"product-service:8000"}'

# 注入延迟
Invoke-RestMethod -Uri "http://localhost:8475/proxies/product-service/toxics" -Method Post `
  -ContentType "application/json" `
  -Body '{"name":"latency_toxic","type":"latency","attributes":{"latency":200,"jitter":50}}'
```

### 步骤 3：用 JMeter 压测（此时请求会经过延迟代理）
```powershell
jmeter -n -t testplans\baseline.jmx `
  -q properties\env-dev.properties `
  -l reports\with-latency.jtl
```

### 步骤 4：移除故障
```powershell
Invoke-RestMethod -Uri "http://localhost:8475/proxies/product-service/toxics/latency_toxic" -Method Delete
```

---

## 十一、常见问题排查

### Q1：JMeter GUI 打不开或闪退
**原因**：Java 版本不兼容或内存不足
**解决**：
- 确认 Java 8+ 已安装：`java -version`
- 编辑 `bin\jmeter.bat`，增加堆内存：`set HEAP=-Xms1g -Xmx2g -XX:MaxMetaspaceSize=512m`

### Q2：请求报连接超时
**原因**：服务未启动或地址错误
**解决**：
- 检查 `HTTP Request Defaults` 的 Server Name 是否正确
- 用 curl 测试接口是否可达：`curl http://localhost:8000/health`

### Q3：token 提取失败
**原因**：JSON Path 表达式错误
**解决**：
- 先用 GUI 运行一次登录请求，查看「View Results Tree」中的 Response Data
- 根据实际 JSON 结构调整 JSON Path
- 可在登录请求下添加「View Results Tree」调试（正式压测前删除）

### Q4：CSV 参数化不生效
**原因**：文件路径错误或变量名不匹配
**解决**：
- 确认 CSV Data Set Config 的 Filename 路径正确
- 确认变量名与请求中引用的 `${var}` 一致
- 检查 CSV 第一行是否为表头（变量名从 Variable Names 取，不从表头取）

### Q5：HTML 报告生成失败
**原因**：报告目录已存在或 .jtl 为空
**解决**：
- 删除旧报告目录后重试
- 确认 .jtl 文件非空且有有效数据

### Q6：中文乱码
**解决**：
- 在 `jmeter.properties` 中设置：`sampleresult.default.encoding=UTF-8`
- 或在 HTTP Request 的 Content encoding 填 `UTF-8`

### Q7：JMeter 占内存太大
**解决**：
- 正式压测用 `-n` 非 GUI 模式
- 删除不需要的监听器（View Results Tree 最耗内存）
- 增加 JVM 堆内存

---

## 十二、快速开始（一键操作）

```powershell
# 0. 进入项目目录
cd f:\apk\其他\todo\perf-load-test-platform\perf-jmeter

# 1. 设置 JMETER_HOME（如未设置环境变量）
$env:JMETER_HOME = "F:\必备工具\apache-jmeter-5.6.3\apache-jmeter-5.6.3"
$env:Path = "$env:JMETER_HOME\bin;$env:Path"

# 2. 确认服务已启动（gateway 在 localhost:8000）
#    在另一个终端运行：cd .. ; docker compose -f docker-compose.services.yml up -d

# 3. 运行基线测试 + 生成报告 + 门禁检查
.\scripts\run-jmeter.ps1 -Scenario baseline -Env dev

# 4. 查看报告
start reports\baseline-dev-report\index.html
```
