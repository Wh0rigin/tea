# 贡献 TEA

[English](CONTRIBUTING.md)

我们的目标是在保持任务正确率、代码质量和执行性能的前提下节省 Token。欢迎改进文件发现、工具反馈、恢复能力、计量、终端体验、文档和评估。

## 开始前

先查看已有 issue 和 PR，避免重复工作。较大的行为调整先提交问题与方案；小型修复和文档改进可以直接开 PR。报告问题时提供复现步骤、预期/实际结果、Node/系统版本和脱敏日志，不要公开凭据或私有源码。

## 本地开发

需要 Node.js 20+ 和 Git。项目没有 npm 运行时依赖；确定性测试不需要模型凭据。

```sh
git clone https://github.com/Wh0rigin/tea.git
cd tea
git switch -c fix/describe-the-change
npm test
npm run tea -- --demo
```

外部贡献者先 fork，在自己的分支修改并向 `Wh0rigin/tea:main` 提交 PR；维护者在仓库内使用主题分支。

## 所有改动都走 PR

代码、文档和实验报告都使用主题分支，提交 PR 到 `main`。不要直接推送 `main`；合并与发布由维护者决定。

保持改动聚焦，保留无关行为，根据修改补充回归覆盖。PR 说明应写清改了什么、原因、实际执行的检查，以及仍存在的限制。未完成的工作使用 Draft；准备好审阅后再转为 Ready。提交消息使用明确描述，例如 `fix: preserve validation after cancellation`。

## 验证

```sh
npm test
git diff --check
npm run benchmark:replay
npm run benchmark:runtime
```

按改动执行相关检查。CI 在 Windows/Ubuntu 与 Node 20/22/24 上运行确定性测试，不需要密钥，也不进行付费调用。Pi 客户端本地联调需另外安装并固定 Pi 版本，然后执行 `npm run benchmark:pi:check`；脚本化 Token 不可作为性能结果。详见 [对比说明](docs/PI_COMPARISON.zh-CN.md)。

## 优化证据

- 说明优化假设、基线/候选源码、任务清单和固定的初始仓库。
- 两侧使用相同模型、API、思考模式、等级、输出上限和验收规则。
- 区分真实服务商 Token、离线字节、字符与估算；完整计入缓存，未知用量不能当作零。
- 包含所有尝试、失败、预算中止、验收结果与重复次数，双方通过的子集要单列。
- 付费实验必须设置总预算、请求上限和超时，并记录价格来源与缓存假设。

正确率下降时，Token 更少不能证明优化有效。自编样本只提供诊断证据，需要不同问题与真实项目验证泛化。Pi 对比也不等于 TEA 与直接父版本的发布门禁。可以提交诚实标注的实验基础设施和离线/部分报告，不得声称未通过的门禁已经通过。

## 公开结果

原始工作区、账本和运行结果保存在 Git 忽略的 `.tea/`、`benchmarks/results/`。审阅后才将脱敏汇总、报告和图片放进 `benchmarks/reports/`。不要发布密钥、账户余额、原始对话或私有绝对路径；保留运行 ID、版本哈希、量纲和验收信息。

贡献按项目 [MIT 协议](LICENSE) 分发，请确保有权提交并保留第三方版权说明。
