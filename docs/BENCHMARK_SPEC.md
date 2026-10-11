# Benchmark 规范

## 指标与来源

主指标只接受模型服务端报告的所有请求总输入 + 输出，纳入失败、重试、路由、交接和缓存输入。Anthropic 总输入为 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`；输出不再额外累加 reasoning。Ledger 保留原始 usage 与归一化总量。任意请求 usage 未知/中断/无效或账本写入失败，完整实测总量为 `null`，已报告下界另存。工具输出字符不是实际模型 Token。

跨模型比较还需记录统一 tokenizer 的文本估算、模型原生 token、单价来源、费用、P50/P95 端到端耗时、调用数、工具次数、无效工具调用率、测试次数、错误循环、预算停止、按任务类型的成功率。当前 Replay 只记录启发式估算与工具字符诊断，provider 实际 usage 和验收结果为空，不能用于版本准入。

## 当前数据状态

`benchmarks/tasks/core-replay.json` 是 23 条自编 controlled-replay 轨迹，用于估算与召回筛查，不执行代码。

`benchmarks/tasks/runtime-smoke.json` 是 12 个自编 JavaScript 小仓库，每项有固定文件快照、可重复的初始 Git commit、公开测试、独立验收及脚本化修正。公开测试修前成功，独立断言修前失败。脚本化 runtime 模式执行真实代码和测试，但其 acceptance 仅代表 Harness 验证，模型成功率与 provider Token 为空。Live 入口要求价格和整个套件总预算；首次 Live 仍未执行。验收测试在 agent 停止期间于工作区外临时运行，需要完成见证以防 `process.exit(0)` 跳过断言；异常会保留费用 checkpoint 和失败摘要。源码前后哈希不同的运行不可作为配对依据。

当前 fixture 运行没有 OS 隔离，manifest 包含验收与答案，不能算保密测试；也没有正式 core/holdout、多语言仓库或任意 Git revision A/B。这些 smoke 结果均设置 `gateEligible=false`。

正式任务清单需固定：来源与许可、仓库 commit、干净恢复方式、用户提示、难度/语言/任务类型、预算、模型/API/Thinking 参数、可用工具、seed、超时、公开和隐藏验收命令。需覆盖至少 12 项 Smoke、40–60 项 Core 和独立 100+ Holdout；成本不足时保留 `NOT_MEASURED`，不得用受控回放冒充 Live。

## 配对与统计

每个任务在同一 repo SHA、指令、工具、测试、模型、Thinking、参数、seed 和预算下成对运行；A/B 顺序交错。报告父版本与 `baseline-v0` 的绝对 usage、均值/中位数、分层成功率及成对 Bootstrap 95% 区间。正式 Gate 要求综合总 Token 平均至少下降 5%、任务中位数不升、区间支持改进、固定确定性任务无新增失败、整体和关键分层成功率不退步、无显著时延/安全/崩溃回归。

当前 `benchmark compare` 仅接受清单哈希和完整唯一任务集合相同的 controlled replay，明确设置 `gateEligible=false`；拒绝拿 runtime/live 结果套用估算公式。它不执行 Git 版本恢复，也不生成 Live Gate 结论。

## 目录与复现

- 任务清单：`benchmarks/tasks/`
- Harness 实现：`src/benchmark.mjs`
- 原始运行：`benchmarks/results/<run-id>/`（忽略提交）
- 脱敏任务账本：`<workspace>/.tea/runs/<run-id>/`
- 入库摘要：`benchmarks/reports/`

每次运行需要记录模型/API 版本、努力挡位、参数、任务/测试/工具配置哈希、父/候选 SHA、随机种子、原始日志校验和与价格口径。只将可分享的脱敏摘要提交到 Git。
