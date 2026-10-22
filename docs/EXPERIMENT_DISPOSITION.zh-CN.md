# 实验与最终代码保留情况

核对日期：2026-10-18。按 PR 的最终文件差异与当前运行源码判断，不能把提交历史中出现过的实验代码等同于最终启用功能。

## 当前开放 PR

- [#8：S3 工具描述实验](https://github.com/Wh0rigin/tea/pull/8)：最终只含实验脚本、计划与报告，没有 src 或运行依赖改动。未启用失败候选。
- [#9：S4 验证失败处理实验](https://github.com/Wh0rigin/tea/pull/9)：最终只含实验脚本与报告，没有运行源码改动。未启用失败候选。
- [#10：S5 验证修复反馈实验](https://github.com/Wh0rigin/tea/pull/10)：最终只含实验脚本与报告，没有运行源码改动。未启用失败候选。
- [#11：编码成本归因](https://github.com/Wh0rigin/tea/pull/11)：分析脚本与报告，不改变 Agent 默认行为。
- [#12：S6 版本化替换实验](https://github.com/Wh0rigin/tea/pull/12)：最终只含实验脚本与报告，没有运行源码改动。未将未完成的候选投入正常使用。
- [#13：工具核心、权限与上下文规则](https://github.com/Wh0rigin/tea/pull/13)：包含实际运行改动，也包含已撤回实验的复现脚本和负面结果。具体状态如下。

合并 #8～#12 的最终差异是在保留研究记录，不会将相应的失败候选接入默认运行路径。实验脚本仍应仅在显式调用且遵守付费协议时运行。

## #13 保留的运行功能

- ToolContext / ToolSpec / ToolService 统一工具管理；不宣称架构重构本身节省 Token。
- 配置式编辑权限及执行前策略检查；编辑权限需要用户配置，并非操作系统沙箱。
- AGENTS.md 按需发现；局部规则遵守有诊断改善，尚无稳定 Token 收益证明。
- 已有文件、补丁缺失和补丁歧义的分类反馈：2026-10-18 用户确认保留。正常 CLI 无需新增开关，仍保留不可覆盖新建和精确补丁保护。

## #13 已撤回的运行候选

- 可选 retrieve_code 编排模式：旧轮次 Token 上涨，运行入口已撤回。
- 强制 Code Agent 自定义 JavaScript 模式：旧轮次 Token 上涨，运行入口已撤回。
- QuickJS 模式：质量下降，运行时与依赖已撤回。
- Python / RestrictedPython 模式：全尝试 Token 增加 29.75%，完整验收下降，运行时、依赖与 CI 安装步骤已撤回。

实际源码与 package.json 中没有上述 retrieve_code、codeFirst、retrievalCode、QuickJS 或 RestrictedPython 运行入口/依赖。Python 回退提交 f3177be 的 src、tests、CI 与 package.json 与其正常工具基线 b6f9395 完全一致；之后只叠加已记录的权限、规则发现与错误恢复功能。

历史提交与实验 runner 保留冻结候选，便于复现，不会由正常 tea 命令自动执行。负面报告保留原结果，不改写成成功优化。

## 最新反馈修改的证据

12 次真实运行全部结算，双方完整验收均 6/6，provider Tokens 128,179 → 121,349（减少 5.33%）。分页任务增加 3.69%，重复间波动和机制归因局限继续保留。不能将该值作为普遍性能承诺。

相关回归 16/16、全量 362/362 通过。源代码候选为 55c0975；[复盘](EDIT_ERROR_RECOVERY_REVIEW.zh-CN.md)及[报告](../benchmarks/reports/edit-recovery-screen-glm-20261017-v1-reviewed/README.md)保持可追溯。

当前本机全局 tea 安装以目录链接指向此项目，因此项目源码修改直接供下一次启动使用。GitHub main 只有在用户授权合并后才更新；本文不代表已合并或已发布新版本。
