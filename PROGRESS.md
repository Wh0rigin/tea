# 项目进度

## 当前状态

- 阶段：用户于2026-10-11明确批准提交 V1 离线实验检查点并进入 V2；V1 的 Live 门禁仍未通过。
- 仓库：`C:\Users\Administrator\Documents\token-efficient-coding-agent`。
- Git：本次在 `v1` 提交已验证候选，随后 `v2` 从该提交继续；父提交/`baseline-v0` 为 `17779508744eee1cf986eb123a612be3d957fbee`。确切检查点 SHA 可用 `git rev-parse v1` 查看，`main` 保持 V0。
- 运行时：Node.js 原生依赖；Anthropic Messages/SSE、工具调用、工作区安全、测试后置条件、脱敏 Token Ledger、硬预算预检。
- Offline harness：23 条自编 Replay（13 条大型合成定位）及 12 个固定 commit 的可执行 JavaScript fixture；后者脚本化选择工具、实际修改和运行公开/独立验收。没有模型成功率数据。
- Live Baseline：`NOT_MEASURED`。未调用付费 API；当前 Token 分组价格、桥接兼容性和 Live 验收尚未完成。

## 最近验证

| 项目 | 结果 |
|---|---|
| `npm test` | 71/71 passed；明确限定 tests 目录，不扫描旧 benchmark 仓库 |
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

1. 扩展真实多语言仓库、40–60 Core / 100+ Holdout、保密隔离验收及任意 Git revision A/B；继续检查大型仓库发现与工具上下文开销。
2. 在一次 Live Smoke 前核对 PackyAPI 当前 Token 分组输入/输出价格、Anthropic Messages 桥接能力和 GLM effort 行为，并给定总花费上限。
3. 在同一模型/effort 下对父版和 V1 候选运行成对任务；只有 Token、任务成功率、安全、统计区间、成本及延迟门槛全部达标才提交并推进 `main`。

## 恢复命令

```powershell
cd C:\Users\Administrator\Documents\token-efficient-coding-agent
git status --short --branch
npm test
npm run benchmark:replay
npm run benchmark:runtime
node src/cli.mjs benchmark run --suite core --mode replay --strategy v1 --initial-file-limit 8
```

参见 [实验恢复说明](docs/EXPERIMENT_RECOVERY.md)。
