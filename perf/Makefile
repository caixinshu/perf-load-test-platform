# ============================================================
# perf/Makefile
# 性能测试框架 - 统一执行入口
# 用法: make baseline ENV=dev
# ============================================================

K6 ?= k6
ENV ?= dev
REPORTS_DIR = reports

# 导出 summary-json，便于 CI 门禁
SUMMARY = --summary-export=$(REPORTS_DIR)/$(SCENARIO)-summary.json

.PHONY: baseline load stress soak full product order report clean

baseline:
	$(K6) run scenarios/baseline.js -e ENV=$(ENV) $(SUMMARY)

load:
	$(K6) run scenarios/load-test.js -e ENV=$(ENV) $(SUMMARY)

stress:
	$(K6) run scenarios/stress-test.js -e ENV=$(ENV) $(SUMMARY)

soak:
	$(K6) run scenarios/soak-test.js -e ENV=$(ENV) $(SUMMARY)

full:
	$(K6) run scenarios/full-link/e-commerce.js -e ENV=$(ENV) $(SUMMARY)

product:
	$(K6) run scenarios/api/product.js -e ENV=$(ENV) $(SUMMARY)

order:
	$(K6) run scenarios/api/order.js -e ENV=$(ENV) $(SUMMARY)

# 生成数据
gen-products:
	node data/generators/product-gen.js 1000 data/products.json

# 清理报告
clean:
	rm -f $(REPORTS_DIR)/*.json
