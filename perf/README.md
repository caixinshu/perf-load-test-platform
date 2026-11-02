# 性能测试框架 (perf/)

结构化的 k6 性能测试框架，支持场景管理、配置管理、数据管理，让性能测试可复用、可维护。

## 目录结构

```
perf/
├── config/          # 配置管理
│   ├── base.js      # 基础配置（环境/阈值/场景）
│   ├── dev.js       # 开发环境覆写
│   ├── staging.js   # 预发环境覆写
│   └── prod.js      # 生产环境覆写
├── lib/             # 公共库
│   ├── http.js      # HTTP 请求封装
│   ├── auth.js      # 认证与 token 管理
│   ├── utils.js     # 工具函数（随机/断言/调试）
│   └── thresholds.js# 阈值管理
├── scenarios/       # 测试场景
│   ├── baseline.js      # 基准测试
│   ├── load-test.js     # 负载测试
│   ├── stress-test.js   # 压力测试
│   ├── soak-test.js     # 稳定性测试
│   ├── full-link/       # 全链路场景
│   │   └── e-commerce.js
│   └── api/             # 单接口场景
│       ├── product.js
│       └── order.js
├── data/            # 测试数据
│   ├── products.json
│   ├── users.json
│   └── generators/
│       └── product-gen.js
├── reports/         # 测试报告输出目录
├── scripts/         # 旧版脚本（保留，CI 仍在使用）
├── Makefile         # make 入口
└── package.json     # npm scripts 入口
```

## 快速开始

### 1. 安装 k6

确保 `k6` 命令可用，或指定 K6 变量：

```bash
export K6=/path/to/k6
```

### 2. 运行场景

```bash
# 使用 npm scripts
npm run baseline
npm run load
npm run stress
npm run soak
npm run full

# 或使用 make
make baseline ENV=dev
make load ENV=staging
```

### 3. 指定环境

通过 `-e ENV=xxx` 切换环境：

```bash
k6 run scenarios/baseline.js -e ENV=dev
k6 run scenarios/baseline.js -e ENV=staging
k6 run scenarios/baseline.js -e ENV=prod
```

## 核心模块

### config/base.js

统一管理：
- **环境配置** (`environments`): dev/staging/prod 的 baseUrl、数据库、Redis
- **阈值** (`thresholds`): smoke / load / stress 三级
- **场景** (`scenarios`): baseline / load / stress / soak

导出函数：`getEnv()`, `getThresholds()`, `getScenario()`, `currentEnv()`

### lib/http.js

HTTP 封装，自动拼接 baseUrl：

```js
import { initHttp, apiGet, apiPost, apiPut, apiDel } from './lib/http.js';

initHttp(currentEnv());
apiGet('/products/1');
apiPost('/orders', { product_id: 1, quantity: 2 });
```

### lib/auth.js

认证管理：

```js
import { login, withAuth } from './lib/auth.js';

login('/auth/login', { username: 'admin', password: '123' });
apiGet('/protected', withAuth());
```

### lib/utils.js

工具函数：`randomInt`, `randomItem`, `randomString`, `assertStatus`, `assertSuccess`, `assertBodyHas`, `debug`, `sleep`

### lib/thresholds.js

阈值管理：

```js
import { thresholdsFor, strictThresholds } from './lib/thresholds.js';

thresholdsFor('load');        // load 级阈值
strictThresholds();           // 严格门禁阈值
```

## 编写新场景

```js
import { getScenario, getThresholds, currentEnv } from '../config/base.js';
import { initHttp, apiGet } from '../lib/http.js';
import { sleep } from 'k6';

export const options = {
  ...getScenario('load'),
  thresholds: getThresholds('load'),
};

initHttp(currentEnv());

export default function () {
  apiGet('/your/api');
  sleep(1);
}
```

## 与旧版 scripts/ 的关系

`perf/scripts/` 下保留了 Week 1-3 的原始压测脚本，CI 工作流仍引用它们。
本框架 (`scenarios/`, `lib/`, `config/`) 是重构后的结构化版本，新场景请在 `scenarios/` 下编写。

## 报告

每次运行通过 `--summary-export` 将 k6 summary 输出到 `reports/` 目录，供 CI 门禁解析。
