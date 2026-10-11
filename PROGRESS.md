# 项目进度

## 当前状态

- 阶段：V1 离线检查点已提交；V2 选择性历史实验完成并保存结果，进入 V3 本地策略/请求预算实验。各版 Live 门禁仍未通过。
- 仓库：`C:\Users\Administrator\Documents\token-efficient-coding-agent`。
- Git：V1 为 `c2a218d4daada6901038d30d149ee515d44910e7`，V2 为 `c7d73cbf253e7864ab8463920482ad4f44b0015d`，`v3` 从 V2 fast-forward 并有未提交实验。`baseline-v0`/`main` 为 `17779508744eee1cf986eb123a612be3d957fbee`。v1/v2 已冻结各自离线状态，无 release 标签。
- 运行时：Node.js 原生依赖；Anthropic Messages/SSE、工具调用、工作区安全、测试后置条件、脱敏 Token Ledger、硬预算预检。
- Offline harness：23 条自编 Replay（13 条大型合成定位）及 12 个固定 commit 的可执行 JavaScript fixture；后者脚本化选择工具、实际修改和运行公开/独立验收。没有模型成功率数据。
- Live Baseline：`NOT_MEASURED`。未调用付费 API；当前 Token 分组价格、桥接兼容性和 Live 验收尚未完成。

## 最近验证

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

## V3 当前实验

- 动态输出预算边界已实现候选：显式0/无效上限不被默认值吞掉，请求不能超过配置上限，普通enabled thinking预算与当前请求max_tokens保持有效关系。9项真实adapter→本地HTTP合约实验，非法提交6→0，全部候选预期检查通过；没有provider请求或Token收益结论。
- 双向effort独立策略候选已实现，19/19专项测试；13条固定轨迹×4策略共240观察步，双向策略4升/5降，保护违例0；源码身份往返/同轮新验证的过期水位已补齐。verified/root两次重放决策和源码快照完全一致。仍是模拟状态，不是代码验收或模型Token结果。
- 当前全套116/116测试和diff检查通过；V3候选未提交、尚未接入Live，结构化交接未完成。报告：[V3](benchmarks/reports/v3.md)。
