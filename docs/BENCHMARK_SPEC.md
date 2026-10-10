# Benchmark 规范

## 指标与来源

主指标只接受模型服务端报告的所有请求 `input_tokens + output_tokens`，纳入失败、重试、路由、交接和缓存输入。当前 Ledger 存 provider 原始 usage 字段、累计 input/output/cached/reasoning（服务端提供时）、请求耗时和保守美元核算。工具输出字符和实际发送上下文字符分开记；二者都不是实际模型 Token。

跨模型比较还需记录统一 tokenizer 的文本估算、模型原生 token、单价来源、费用、P50/P95 端到端耗时、调用数、工具次数、无效工具调用率、测试次数、错误循环、预算停止、按任务类型的成功率。当前 Replay 只记录启发式估算与工具字符诊断，provider 实际 usage 和验收结果为空，不能用于版本准入。

## 当前数据状态

`benchmarks/tasks/core-replay.json` 是 9 条自编 controlled-replay 轨迹，用于核验结果格式、配对统计与脱敏边界。没有可执行任务仓库、固定 commit、隐藏验收测试或模型回答。它不满足 smoke/core/holdout 任务集，也不模拟真实完成率。

正式任务清单需固定：来源与许可、仓库 commit、干净恢复方式、用户提示、难度/语言/任务类型、预算、模型/API/Thinking 参数、可用工具、seed、超时、公开和隐藏验收命令。需覆盖至少 12 项 Smoke、40–60 项 Core 和独立 100+ Holdout；成本不足时保留 `NOT_MEASURED`，不得用受控回放冒充 Live。

## 配对与统计

每个任务在同一 repo SHA、指令、工具、测试、模型、Thinking、参数、seed 和预算下成对运行；A/B 顺序交错。报告父版本与 `baseline-v0` 的绝对 usage、均值/中位数、分层成功率及成对 Bootstrap 95% 区间。正式 Gate 要求综合总 Token 平均至少下降 5%、任务中位数不升、区间支持改进、固定确定性任务无新增失败、整体和关键分层成功率不退步、无显著时延/安全/崩溃回归。

当前 `benchmark compare` 能比较配对回放的启发式估算，明确设置 `gateEligible=false`。它暂不执行 Git 版本恢复，也不能生成 Live Gate 结论。

## 目录与复现

- 任务清单：`benchmarks/tasks/`
- Harness 实现：`src/benchmark.mjs`
- 原始运行：`benchmarks/results/<run-id>/`（忽略提交）
- 脱敏任务账本：`<workspace>/.tea/runs/<run-id>/`
- 入库摘要：`benchmarks/reports/`

每次运行需要记录模型/API 版本、努力挡位、参数、任务/测试/工具配置哈希、父/候选 SHA、随机种子、原始日志校验和与价格口径。只将可分享的脱敏摘要提交到 Git。
