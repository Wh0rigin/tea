# V1–V5 路线及状态

当前没有任何优化版本通过统一 Live Benchmark 门禁，因此版本分支和 release tag 仅保留用于既定流程；不能提前发布或移动 `main` 来暗示收益。

2026-10-11 用户明确批准按已验证离线指标提交 V1、进入 V2。因此允许离线检查点提交，指标来源必须标注；Live 门禁与 Release 状态仍未通过。

| 版本 | 目标 | 状态 | 通过证据 |
|---|---|---|---|
| V1 | Progressive Context 渐进检索 | 用户批准提交离线检查点：路径筛选、证据引用、日志头尾和运行修复 | 12项可执行验收各12/12，工具字符−23.41%；长成功/失败日志−86.47%/−54.06%；无provider Token结果 |
| V2 | Selective Memory 与工具输出管理 | 可选旧工具结果压缩离线实验完成；完整原史、源码、失败和思考签名保留 | 集成压力输入字节−20.90%，普通任务0%；两侧验收各12/12；辅助回放−54.02%；无provider Token结果 |
| V3 | 双向推理预算路由及结构化交接 | 下一阶段：真实验证反馈路由、滞回和请求预算不变量 | 无 Live 结果 |
| V4 | Context Delta / Retrieval Refinement | 未开始 | 无 Live 结果 |
| V5 | Feedback policy / Value of Information | 未开始 | 无 Live 结果 |

## 推进约束

先完成固定仓库与验收测试、Live Harness 和实际模型基线；随后每版只选一个由上版遥测支持的浪费源。优化先在对应版本分支试验，先过 Unit/Replay，再过配对 Live Smoke 和完整 Core/Holdout。只有父版本配对数据、正确率、安全、统计区间、成本/延迟共同通过时才提交并 fast-forward `main`。未通过的代码和失败根因保留可恢复记录，不要制造 Release 标签。

## GLM Thinking 候选

底层 GLM-5.3-Flash 通常公开的 Effort 档位为 `low`、`high`、`max`，没有 `off`。Anthropic Messages 桥接层是否接受对应字段必须做小额度单次兼容性验证；在验证前，此项目配置是请求候选而非已核实的 PackyAPI 支持矩阵。
