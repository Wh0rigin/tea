# 恢复与继续执行

1. `cd` 到项目目录，执行 `git status --short --branch` 和 `git log --oneline --decorate -5`；先阅读 `AGENTS.md`、`CONTRIBUTING.zh-CN.md` 和 `PROGRESS.md`。更新远端引用，复用适合的 PR 分支或从远端 `main` 建立主题分支；不要丢弃未提交试验。
2. 运行 `npm test`、`npm run benchmark:replay`、`npm run benchmark:runtime`。Replay 只估算；Runtime 用脚本化工具选择执行真实代码/验收，两者都不是模型成功率或 provider usage。运行目录必须唯一；中断时先检查 checkpoint 与逐请求 Ledger，未知花费不能自动按零重跑。
3. 从 PackyAPI 当前令牌分组控制台获取该模型的输入、输出价格倍率，并设置环境变量。公开 Anthropic Messages 示例使用 `https://cf.api.fan`，先到模型广场确认 GLM-5.3-Flash 的协议兼容性。再执行一次有限输出的单请求 Smoke，核实工具调用、SSE 终止事件、low/high/max effort 映射、服务端 usage 和实际扣费。底层档位以 [Z.AI 官方模型文档](https://docs.z.ai/guides/vlm/glm-5.3-flash) 为准。
4. 补全可固定版本和验收的多语言任务仓库及隐藏测试，做 Live baseline，并归档脱敏日志、价格、配置哈希和 commit SHA。未能取得这些资源时记录 `NOT_MEASURED` 并停止宣称性能收益。
5. V1/V2 已按用户授权记录离线检查点，按 `docs/VERSION_ROADMAP.md` 和 `docs/GIT_WORKFLOW.md` 从 V3 继续。所有代码、文档和实验改动均推送主题分支并通过 PR 交付；未经授权不合并或发布。正式优化发布仍需直接父版本配对 Live 证据；离线字节和估算不能改称实测 Token。基础设施与诚实标注的实验报告可先审阅。

2026-10-11 已完成 GLM-5.3-flash 真实工具冒烟和两种 TEA/Pi 自编样本配置，[报告](../benchmarks/reports/tea-vs-pi-glm-20261011/README.zh-CN.md)包含相同模型/思考参数、负收益、输入限制失败、排除试跑和保守费用。它不替代直接父版本和多语言真实留出集门禁。

不要把 API 密钥保存进文件、命令参数、Git 或模型日志。用户给出的明文凭据若曾暴露，应先在供应商处撤销并创建新密钥。
