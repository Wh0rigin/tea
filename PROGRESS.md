# 项目进度

## 当前状态

- 阶段：交互终端已提交；TEA/Pi 两种配置的真实 GLM 测试、图表和贡献流程已完成。结果不支持稳定的整体 Token 优势；各版直接父版本 Live 门禁仍未通过。
- 仓库：`C:\Users\Administrator\Documents\token-efficient-coding-agent`。
- Git：远端 `main` 起点为 `49ce44b`；本轮交付分支为 `feat/pi-benchmark-and-contributing`，终端提交为 `3c7dfe1`。所有后续改动通过 PR 到 `main`，不直接推送或自动合并。历史 `baseline-v0` 为 `1777950`，V1/V2 为 `c2a218d`/`c7d73cb`；无 release 标签。
- 运行时：Node.js 原生依赖；Anthropic Messages/SSE、工具调用、工作区安全、测试后置条件、脱敏 Token Ledger、硬预算预检。
- Offline harness：23 条自编 Replay（13 条大型合成定位）及 12 个固定 commit 的可执行 JavaScript fixture；后者脚本化选择工具、实际修改和运行公开/独立验收。没有模型成功率数据。
- Live：GLM-5.3-flash、enabled/low、输出 4,096。64,000 字节上限 9 组，TEA/Pi 验收 9/9 与 7/9，Token 168,282/161,046，TEA 多 4.49%；80,000 字节大型补测双方 3/3，117,126/107,674，TEA 多 8.78%。两种配置单列，各一轮。真实父版本优化 Baseline 与多语言留出集仍未完成。

- 最新本地验证：`npm test` **128/128**；实际 TEA/Pi 客户端本地协议检查通过；CLI help 与差异检查通过。CI 配置覆盖 Ubuntu/Windows × Node 20/22/24，运行状态以 PR 为准。
- 全部付费测试保守费用 **$0.69280956 / $3**，包含冒烟和排除试跑，不是服务商账单。完整结果：[中文报告](benchmarks/reports/tea-vs-pi-glm-20261011/README.zh-CN.md)。

## 历史离线验证

| 项目 | 结果 |
|---|---|
| `npm test` | V2 checkpoint 94/94；当前V3工作区116/116 passed；明确限定 tests 目录，不扫描旧 benchmark 仓库 |
| `git diff --check` | passed |
| `npm run benchmark:replay` | baseline 23 条；估算 13,431；服务商 Token 未测 |
| baseline → 默认 V1（cap=8） | 估算 13,431 → 2,106（−84.32%）；标注相关路径召回 1/26 → 26/26；paired bootstrap 95% 差值区间 `[-679.57, -304.78]` |
| 纯词面 → 自动扩词（cap=8） | 估算 2,129 → 2,106；召回 21/26 → 26/26；区间 `[-3.83, 0.61]`；13 个定位样本里 4 个触发扩词 |
| cap 扫描（根目录含 `AGENTS.md`、README、package） | cap=2、3 命中 0/26；4 命中 13/26；6、8 命中 26/26；默认 8 留出更多候选位置 |
| 重复读去重单项 | 估算下降 0.22%，区间 `[-3.91, 0.00]`；收益不明确 |
| Live usage / 成功率 / 实际成本 / 延迟 | `NOT_MEASURED` |

成对回放运行 ID 和完整诊断在 `benchmarks/results/`（Git 忽略）；摘要见 [V1 实验报告](benchmarks/reports/v1.md)。所有仓库、相关路径和轨迹都是合成数据，不是生产任务样本，因此这些结果不能证明代码任务正确率或实际计费节省，也不具备优化门禁资格。

## 本轮真实执行检查

- 长日志 A/B：历史 `baseline-v0` 工具因约 165k 输出提前杀进程，两例均 SIGTERM；候选正常取得 exit=0/1，成功返回字符 −86.47%，失败 −54.06%，保留尾部断言和结果。没有速度改进结论，旧版提前中止。
- 最终脚本化 runtime 成对复测：`runtime-verified-baseline-20261011` / `runtime-verified-v1-20261011`，独立验收各 12/12；工具字符 15,551 → 11,911（约 −23.4%）。两侧 manifest、源码快照、初始仓库 commit 一致，运行期间源码未变。
- 上述 baseline 是同一候选引擎中的上下文消融，不是历史 Git 版本完整运行。脚本修正是给定答案，不能解释为模型成功率；provider actual Token 为空。
- 修复：任务哈希启动错误、Git/help/零通过测试误验收、编辑后验证状态、截断范围误引用、UTF-8 分块、缓存用量漏计、未知 usage 当零、有限价格/预算校验、账本写失败与运行目录混入。
- 新 Harness：固定仓库、独立验收完成见证、失败/费用 checkpoint、源码前后哈希、套件总预算和 Live smoke 入口。当前没有 OS 隔离，manifest 含验收/答案，不能作为保密测试或正式安全门禁。
- 详情：[真实工具与 runtime 实验](benchmarks/reports/v1-runtime.md)。未发起付费请求；按本次用户授权提交离线检查点，不推进 main 或打 release tag。

## 下一步

1. V3 确定性双向 effort 路由：由实际验证失败/成功、待验证状态和预算预留决策，加入滞回与最低保持期；先做本地请求预算边界实验。完整思考签名与源码证据继续保留。
2. 在一次 Live Smoke 前核对 PackyAPI 当前 Token 分组输入/输出价格、Anthropic Messages 桥接能力和 GLM effort 行为，并给定总花费上限。
3. 扩展真实多语言仓库、40–60 Core / 100+ Holdout、保密隔离验收及任意 Git revision A/B；同一模型/effort 下做父版配对测试。用户授权的离线检查点必须标明量纲；只有完整 Live 门禁通过才推进 `main`。

## V2 离线结果（2026-10-11）

- 普通 runtime full/compact 各12/12验收，候选原始/准备输入279,315→279,315字节，0%变化；60次adapter输入，没有压缩。
- 重复长日志压力 full/compact 各12/12验收，156次adapter输入/108次验证。候选同轨迹原始输入1,694,687→1,340,431字节（−20.90%，含恢复说明）；中位单任务−20.97%。源码、清单、仓库commit与验收一致且运行期间源码未变。
- 7条工具记忆辅助轨迹/79成对输入减少54.02%，该辅助system比真正agent短，不能与集成数值混用；保留4轮则37.09%。短任务和普通短成功日志0%变化，失败/两代源码/重复引用保留检查全通过。
- 完整报告：[V2](benchmarks/reports/v2.md)。实际provider Token、模型成功率、计费和延迟改进仍未测；当前结果只支持可选策略的离线检查点。

## 恢复命令

```powershell
cd C:\Users\Administrator\Documents\token-efficient-coding-agent
git status --short --branch
npm test
npm run benchmark:replay
npm run benchmark:runtime
node src/cli.mjs benchmark run --suite core --mode replay --strategy v1 --initial-file-limit 8
node scripts/request-budget-experiment.mjs v3-request-budget-NEW
node scripts/policy-experiment.mjs --run-id v3-policy-NEW
```

参见 [实验恢复说明](docs/EXPERIMENT_RECOVERY.md)。

## V3 历史实验（真实对比之前）

- 动态输出预算边界已实现候选：显式0/无效上限不被默认值吞掉，请求不能超过配置上限，普通enabled thinking预算与当前请求max_tokens保持有效关系。9项真实adapter→本地HTTP合约实验，非法提交6→0，全部候选预期检查通过；没有provider请求或Token收益结论。
- 双向effort独立策略候选已实现，19/19专项测试；13条固定轨迹×4策略共240观察步，双向策略4升/5降，保护违例0；源码身份往返/同轮新验证的过期水位已补齐。verified/root两次重放决策和源码快照完全一致。仍是模拟状态，不是代码验收或模型Token结果。
- 当前全套116/116测试和diff检查通过；V3候选未提交、尚未接入Live，结构化交接未完成。报告：[V3](benchmarks/reports/v3.md)。


## 2026-10-11：交互终端（早期记录）

- 新增 `--interactive` / 无任务 TTY 入口与 `--demo` 离线预览；原单次任务和 benchmark 命令保留。
- 连续追问复用消息、词表和适配器；费用/累计输入预算不跨轮重置。`/new` 清空上下文，保留预算和待验证修改。
- 接入按行流式回答、工具记录与展开、补丁/Git 差异预览、Token/预算状态、Esc/Ctrl+C 中断和统一命令批准输入。
- 每轮单独账本；取消后的未执行工具返回明确跳过结果，避免后续消息出现未配对工具调用。
- 已进行静态语法检查与本地演示操作（持续输入、工具展开、状态和 Esc 取消）；没有执行测试套件，没有真实模型请求或新增 Token 收益结论。
- 退出后的会话恢复尚未实现；改动尚未提交/推送。

## 2026-10-11：TEA / Pi 对比准备

- 新增配对运行入口 `scripts/compare-pi.mjs`，三类 JavaScript 修复任务 × 12/120/1,200 文件三种仓库规模，共 9 组。每组两侧使用相同任务、固定 Git 提交和文件指纹；agent 会话与 Pi 配置全新创建。
- 共用 Anthropic Messages 网关，统一模型、thinking 模式、effort 和输出上限；逐请求保存实际共同参数、服务商 usage、请求/响应哈希与费用预留。每任务等额预算与请求上限，整个套件有总预算；未知用量停止继续付费，保留预留与已报告下界。
- 安装的 Pi 为 0.87.1；关闭扩展、技能、模板、自动重试、压缩与缓存预热。保留原生提示/工具接口与缓存指令，输入总量包含所有缓存读写。交替运行次序，但无法清空服务商缓存。
- `scripts/check-pi-protocol.mjs` 已让两侧实际客户端通过本地读取→修改→测试流程，各 4 次脚本响应；共同参数一致。修复 Pi SDK 的 `?beta=true` 路由兼容和缓存预热设置格式。脚本 usage 仅供协议验证，不用于性能报告。
- 本轮专项/相关测试 **49/49** 通过；JavaScript/Python 语法和 `git diff --check` 通过。图表入口确认拒绝准备阶段数据。初始 9 个样本均公开测试通过、独立验收失败且完成见证有效。
- 已接入真实结果的 Markdown/JSON 汇总和自动 PNG/SVG 图，标注输入/输出、验收、失败和未知用量。全体比例与双方通过的子集分开；起点、请求参数或用量不一致则不提供比例。
- 样本为自编 JavaScript 仓库规模实验，主要增加无关模块；不是复杂真实项目或多语言留出集。**真实服务商 Token、费用和 TEA/Pi 成功率仍为 NOT_MEASURED；没有付费调用，也没有真实对比图。**
- 等待本轮模型/API、有效环境凭据、当前费率和套件总预算。补齐后运行 `--mode live`，完成会自动导出图片。用法：[英文](docs/PI_COMPARISON.md) / [中文](docs/PI_COMPARISON.zh-CN.md)。本轮改动未提交/推送。

## 2026-10-11：真实 GLM 对比与 PR 流程

本节更新上方准备阶段的未测状态。

- 按用户授权复用原 API 凭据，仅通过进程环境注入；GLM 真实工具调用冒烟通过，SSE/usage 完整。
- 排除早期 111 次请求的试跑：Pi 原生读取祖先目录指令，新建项目贡献规则使该轮上下文不稳定。整轮不用于性能结论，保留费用与本地记录。
- 有效工作区迁至独立临时目录，每次启动检查祖先指令；新增两项隔离回归。两轮均确认模型/思考/输出参数一致、初始快照一致、源码前后未变、全部已提交 usage 完整。
- 64,000 字节配置：9 组、105 次请求，TEA 9/9、Pi 7/9。两次 Pi 输入上限失败计入全体，TEA 多 4.49%；双方通过子集 7 组少 25.44%，不能替代全体。
- 80,000 字节补测：预先选择全部 3 类大型任务、43 次请求，双方 3/3，TEA 多 8.78%；与前一轮分开报告。中型任务的正收益与大型重试的负收益均保留，不宣称普遍优势。
- 公开英文/中文解释、逐请求脱敏 JSON、验收、源哈希和 PNG/SVG：[报告](benchmarks/reports/tea-vs-pi-glm-20261011/README.zh-CN.md)。样本均自编 JavaScript，各配置只跑一轮；不是多语言真实仓库或正式父版本优化门禁。
- 完善双语 `CONTRIBUTING`、PR/issue 模板、无付费 API 的跨平台 CI，以及 `AGENTS.md` / `.cursor/rules/pull-requests.mdc`。用户要求之后全部通过主题分支 PR 交付。
- 后续优化调查：大仓库发现与额外工具循环；应通过直接父版本配对和重复试验验证因果，当前没有据此修改排序或路由规则。
- 首轮跨平台 CI 暴露 Node 22 的静默成功日志长度差异：旧测试将“不发生压缩”当作固定结果。修正为不增加体积、保留全部 10 次验证和最近两轮；固定短日志与失败/源码保护测试继续保留，相关 18/18 通过。该修改只影响测试断言，不改变已测 agent 行为或用量。
