# 性能基线数据 (perf/baselines/)

性能基线用于**基线对比门禁**——将本次测试结果与历史基线对比，检测性能退化。

## 文件命名规则

```
baseline-v{版本号}.json
```

示例：`baseline-v1.json`、`baseline-v2.json`

## 生成基线

每次全量性能测试后，若确认性能稳定且可接受，将 summary 保存为新的基线版本：

```bash
# 运行全量测试并导出 summary
k6 run scenarios/load-test.js -e ENV=staging --summary-export=baselines/baseline-v2.json
```

## 更新策略

- **不要覆盖旧基线**：每次更新生成新版本号（v1 → v2 → v3），保留历史可追溯
- **手动更新**：基线代表"当前可接受的性能水平"，需人工确认后才更新，避免退化的结果成为新基线
- **更新条件**：性能提升 ≥ 10%，或业务变更导致性能基准发生合理变化

## 门禁用法

```bash
# 仅固定阈值检查（PR 级）
python scripts/performance_gate.py --current reports/summary.json --mode threshold

# 固定阈值 + 基线对比（每日回归）
python scripts/performance_gate.py \
  --current reports/summary.json \
  --baseline perf/baselines/baseline-v1.json \
  --mode both
```
