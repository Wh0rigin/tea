# TEA / Pi Token 对比

[English](PI_COMPARISON.md)

## 当前 ContextOS C 对比

2026-10-11 至 12 日完成当前主动开启的 **ContextOS C** 与原生 **Pi 0.87.1** 对比：共同 **GLM-5.3-flash、enabled/low 思考、4,096 输出上限**，相同初始 Git 内容。每配置重复三次；全部服务商输入、缓存和思考输出计入。

- **短任务，CLI 已有的默认每轮 24 次工具额度**：12/120/1,200 文件，27 组配对。TEA **708,844** / Pi **1,080,626** Token，TEA **少 34.40%**；完整验收 **26/27 对 25/27**。[默认额度报告](../benchmarks/reports/contextos-c-vs-pi-default24-glm-20261011/README.zh-CN.md)。
- **从空会话实际读取 30 轮，再修复和测试**：3 组配对。TEA **905,224** / Pi **1,558,908**，TEA **少 41.93%**，双方 **3/3**。这组使用原每轮 10 次工具配置；P95 TEA/Pi **485.60/463.18 秒**，没有速度提升证据。[长会话及主实验失败记录](../benchmarks/reports/contextos-c-vs-pi-glm-20261011/README.zh-CN.md)。
- **原 10 次额度短任务**：TEA 验收 **16/27 对 27/27**，额度与验证完成问题全部保留，低 Token 不能算保持性能的收益。补测开始前已选定重跑全部短任务，没有只挑失败项。

默认额度分规模差异明显：小型任务 TEA **多用 52.26%**（双方完整验收 8/9）；中型、大型分别**少 57.42%、37.64%**。补测双方独立代码与范围检查均为 27/27；完整验收还要求原生测试和正常结束，保守的命令识别可能有假阴性，不能将完整验收率解释成 TEA 代码更正确。

这些是自编 JavaScript 缺陷，规模增加主要添加无关模块；三次重复不能证明未见项目泛化。保留双方原生提示、工具与缓存策略。ContextOS 仍需主动开启，Token 降幅不等于账单降幅，压缩也可能降低缓存复用。旧完整历史 TEA/Pi 的 64k 多 4.49%、80k 大型多 8.78% 结果[单独保留](../benchmarks/reports/tea-vs-pi-glm-20261011/README.zh-CN.md)。[对比说明](PI_COMPARISON.zh-CN.md)。

![默认 24 次额度短任务](../benchmarks/reports/contextos-c-vs-pi-default24-glm-20261011/tea-contextos-vs-pi-fresh.png)

![真实长会话累计 Token](../benchmarks/reports/contextos-c-vs-pi-glm-20261011/tea-contextos-vs-pi-long.png)

当前多轮脚本与参数见[冻结协议](CONTEXTOS_PI_EXPERIMENT.md)，运行 `npm run benchmark:contextos-pi:check` 可进行零 API 的实际客户端检查。下文保留的是旧 E10 单轮配置，关闭自动压缩的设置不适用于当前实验。

## 历史 E10 配置与复现

## 当前状态

已准备 9 个固定初始版本的任务和对比脚本，当前安装的 Pi 版本为 **0.87.1**。本地检查已让 TEA 和 Pi 的实际客户端完成读取、修改、测试和结束流程，并确认共同参数一致。这个检查使用脚本响应，**没有付费服务商请求**。

**真实服务商 Token 对比：已于 2026-10-11 完成。** 两侧均使用 GLM-5.3-flash、enabled 思考、low 等级和 4,096 Token 输出上限。64,000 字节配置的 9 组结果：TEA 168,282 Token、验收 9/9；Pi 161,046 Token、验收 7/9，包含两次输入上限失败，TEA 总量多 4.49%。全部 3 组大型任务另以 80,000 字节配置重跑，双方均 3/3，TEA/Pi 为 117,126/107,674 Token，TEA 多 8.78%。两种配置分开统计、各一轮，不能证明稳定节省。[报告、原始计数与图表](../benchmarks/reports/tea-vs-pi-glm-20261011/README.zh-CN.md)。

早期付费试跑因 Pi 读入变化的祖先目录指令而排除，保留本地记录和费用；有效结果均在独立外部目录重跑。冒烟、排除试跑及两种有效配置合计保守费用约 $0.692810，未超过 $3 上限；这不是服务商账单。

## 怎样保证起点一致

- 同一组使用完全相同的任务文本、Git 提交和文件内容；启动前核对整个仓库的 SHA-256。
- 真实工作区放在 TEA 仓库之外，每次启动都检查祖先目录是否存在额外的 `AGENTS`/`CLAUDE` 指令；有则阻止运行。Pi 仍按原生方式读取样本自己的指令，避免只给 Pi 混入本项目的规则。
- 共同网关固定模型、Anthropic Messages API、思考模式、思考等级和输出上限，记录实际发给服务商的参数，完成后再次核对。
- 两侧使用相同的输入字节保护上限、请求次数上限和每任务费用额度；整个套件也有总费用上限。
- 每次都新建会话。Pi 使用新的配置目录，关闭扩展、技能、提示模板、自动重试、自动压缩和缓存预热；TEA 使用新的原生会话。
- 交替安排谁先运行。服务商缓存无法由本脚本清空，保留各自的缓存指令，但所有缓存读写 Token 都计入输入总量。
- 各自的系统提示、文件发现方式和工具接口保持原生。对比结果对应文档所述的两套配置。Windows 下 Pi 使用 `read/edit/write/powershell`，其他平台使用 `bash`。

源码前后哈希和 Pi CLI 版本/哈希也会保存。模型参数、初始仓库或用量汇总不一致时，不生成节省比例。

## 任务覆盖

三类问题分别放在三种规模仓库中，共 9 组：

- 小型：12 个文件，约 110 行。
- 中型：120 个文件，约 1,400 行。
- 大型：1,200 个文件，约 14,400 行。

问题包括缓存键的类型冲突、重试次数边界和 Unicode 截断。大仓库增加的是无关模块，目标问题的复杂度没有同步增加。这些是自编 JavaScript 样本，测的是仓库规模变化下的行为，不能代表真实项目或泛化能力结论。

初始公开测试通过，独立验收失败。完成后同时检查公开测试、独立断言、验收完成见证、修改范围和 agent 结束状态。独立验收在 agent 结束后到其工作区外执行；没有操作系统隔离，不能视为保密的正式留出集。

## 运行方式

不调用模型的准备和本地检查：

```powershell
node scripts/compare-pi.mjs --mode prepare --run-id tea-pi-prepare-NEW
node scripts/check-pi-protocol.mjs
node --test tests/comparison.test.mjs
```

真实运行前，在环境变量中设置凭据、模型、API、当前费率和总预算。完整参数与英文示例见 [英文说明](PI_COMPARISON.md)。本次使用 enabled 思考和 4,096 输出上限，其他模型仍需确认兼容。`TEA_MAX_REQUEST_INPUT_TOKENS` 名称沿用旧配置，实际保护的是序列化 UTF-8 字节，不是精确 tokenizer 上限。

```powershell
node scripts/compare-pi.mjs --mode live --repeat 3 --run-id tea-pi-live-NEW
```

每个运行 ID 必须唯一。总预算平均分给所有计划中的 agent/任务。请求提交前预留输入上限和输出上限对应的费用；费率按配置计算，缓存写入默认使用输入费率的两倍预留，缓存读取保守按普通输入费率计费。因此报告的 USD 是预算口径，并非服务商账单。

预算不足以为所有运行各预留一次请求时直接报错。可以先用 `--scales small --repeat 1` 缩小实验。任务可能需要多次请求；未知用量保留完整预留，并停止继续付费提交。失败和预算中止也会进入结果。

## 最后生成什么图

真实数据通过一致性检查后，自动生成 **PNG 和 SVG**：

- 每组显示 TEA 和 Pi 的输入、输出及总 Token。
- 标注任务验收 PASS/FAIL；失败任务仍保留。
- 用量缺失标记为 unknown，不当作 0。
- 汇总全体任务，并单独列出双方都通过的子集；缺少任何计划组的完整用量时不提供全体节省比例。

图表需要 Python/matplotlib；可通过 `TEA_PYTHON` 指定 Python 路径。也可重新生成：

```powershell
node scripts/chart-pi.mjs benchmarks/results/tea-pi-live-NEW/comparison.json
```

结果目录还包含 `comparison.json`、逐请求账本、`summary.json` 和 `REPORT.md`。节省比例为 `(1 - TEA总量 / Pi总量) × 100%`；负数代表 TEA 消耗更多。若正确率下降，即使 Token 更低，也不符合我们的目标。少量自编样本不能证明普遍优势。

运行目录由 Git 忽略；发布时再把经过审阅的真实报告和图复制到 `benchmarks/reports/`，不会自动推送。
