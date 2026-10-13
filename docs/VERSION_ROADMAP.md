# V1–V5 路线及状态

## 当前专项计划（2026-10-12）

小任务诊断后的近期优先级为：S0 评测记录 → S1 能力反馈 → S2 结构化补充验证 → S3 进度与结束判断 → S4 版本化补丁回执 → S5 泛化与整体确认。S0、S1 已完成；S1 在 102 次真实对照中全体 Token 减少 11.38%，小任务减少 41.44%，长会话增加 3.67%，默认关闭并等待审核。S2–S5 尚未实施；每候选单独与直接父版测量，失败则回退并保留证据。[S1 结果与负向样本](../benchmarks/reports/small-task-s1-glm-20261012/README.zh-CN.md)、[S0 零付费报告](../benchmarks/reports/small-task-s0-20261012/README.zh-CN.md)、[完整计划](SMALL_TASK_IMPROVEMENT_PLAN.zh-CN.md)。以下 V1–V5 保留原版本记录，专项实验不代表正式泛化门槛已通过。

当前没有任何优化版本通过统一 Live Benchmark 门禁，因此版本分支和 release tag 仅保留用于既定流程；不能提前发布或移动 `main` 来暗示收益。

2026-10-11 用户明确批准按已验证离线指标提交 V1、进入 V2。因此允许离线检查点提交，指标来源必须标注；Live 门禁与 Release 状态仍未通过。

| 版本 | 目标 | 状态 | 通过证据 |
|---|---|---|---|
| V1 | Progressive Context 渐进检索 | 用户批准提交离线检查点：路径筛选、证据引用、日志头尾和运行修复 | 12项可执行验收各12/12，工具字符−23.41%；长成功/失败日志−86.47%/−54.06%；无provider Token结果 |
| V2 | Selective Memory 与工具输出管理 | 可选旧工具结果压缩离线实验完成；完整原史、源码、失败和思考签名保留 | 集成压力输入字节−20.90%，普通任务0%；两侧验收各12/12；辅助回放−54.02%；无provider Token结果 |
| V3 | 双向推理预算路由及结构化交接 | 本地候选：验证证据路由/过期水位/滞回/预算预留；请求预算边界已修；交接未完成 | 13轨迹×4策略保护违例0；9个本地协议case非法提交6→0；全套116/116；无Token收益结论 |
| V4 | Context Delta / Retrieval Refinement | 未开始 | 无 Live 结果 |
| V5 | Feedback policy / Value of Information | 未开始 | 无 Live 结果 |

## 推进约束

先完成固定仓库与验收测试、Live Harness 和实际模型基线；随后每版只选一个由上版遥测支持的浪费源。优化先在对应版本分支试验，先过 Unit/Replay，再过配对 Live Smoke 和完整 Core/Holdout。只有父版本配对数据、正确率、安全、统计区间、成本/延迟共同通过时才提交并 fast-forward `main`。未通过的代码和失败根因保留可恢复记录，不要制造 Release 标签。

## GLM Thinking 候选

底层 GLM-5.3-Flash 通常公开的 Effort 档位为 `low`、`high`、`max`，没有 `off`。Anthropic Messages 桥接层是否接受对应字段必须做小额度单次兼容性验证；在验证前，此项目配置是请求候选而非已核实的 PackyAPI 支持矩阵。
