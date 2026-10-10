# baseline-v0 基线记录

- 日期：2026-10-11（Asia/Shanghai）
- 结果目录：`benchmarks/results/baseline-v0-20261011/`（本地保留，Git 忽略）
- Manifest SHA-256：`6bf197f901a4dbe7d0abc8df5ad9079c84bd4624f1ed99c9e3454446639b1664`
- Repo commit：初始化提交前运行，因此当时没有 HEAD SHA；初始化提交和 `baseline-v0` 标签用于保留产生该结果的源代码快照。
- Unit：`npm test` — 13/13 passed。
- Agent/live requests：0。
- Controlled replay fixtures：9。
- Heuristic input estimate：575 tokens（诊断估值，不是模型 tokenizer 或服务端计数）。
- Provider input/output/total actual tokens：`NOT_MEASURED`。
- Task success / cost / latency / hidden acceptance tests：`NOT_MEASURED` / `NOT_RUN`。
- Optimization gate：不具备资格。

本记录只验证代码和 Harness 能运行。它不是付费模型基线，也不能支持任何 V1 Token 降幅或正确率结论。
