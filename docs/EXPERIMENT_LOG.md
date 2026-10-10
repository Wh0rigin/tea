# 实验日志

## E0 — 最小可运行基线与 Harness 自测

- 假设：先完成工具边界、SSE 结束事件、预算预检及确定性 Harness 能给后续版本建立可审计起点。
- 改动：V0 独立 CLI/runtime、Anthropic Messages 适配、Token Ledger、限定工作区工具、Replay runner 与统计框架。
- 结果：`npm test` 13/13 passed；controlled replay 9 项，启发式输入估值 575，配置清单 SHA-256 `6bf197f901a4dbe7d0abc8df5ad9079c84bd4624f1ed99c9e3454446639b1664`。这不是优化实验。
- Live API：`NOT_MEASURED`。服务商计费单价未从该用户 Token 分组得到核验，未发起模型请求。
- Token 节省与正确率：不可比较；没有父版本，也没有真实 Live 任务。
- Git：离线自测完成；即将创建唯一基线提交并标记 `baseline-v0`，随后建立 `v1`–`v3`。
