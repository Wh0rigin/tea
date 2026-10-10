# 项目进度

## 当前状态

- 阶段：V0 最小基线实现与离线验收完成，准备创建初始化提交。
- 仓库：`C:\Users\Administrator\Documents\token-efficient-coding-agent`。
- Git：初始化尚未执行；本地用户身份尚未写入。单元测试和 Replay 自测通过，待创建唯一初始化提交、标签 `baseline-v0` 与 `v1`–`v3` 分支。
- 运行时：Node.js 原生依赖实现；支持 Anthropic Messages/SSE、工具调用、工作区约束、测试后置条件与脱敏 Token Ledger。
- Offline harness：9 条自编 controlled-replay 轨迹，只测估算和输出格式。
- Live Baseline：`NOT_MEASURED`。未发起付费 API 请求；用户令牌分组的当前输入/输出单价和 Anthropic 桥接的具体 endpoint/effort 兼容性还未核实。
- V1–V5：全部未开始，所有性能、正确率、美元费用和真实延迟均为 `NOT_MEASURED`。

## 验证与提交记录

| 项目 | 结果 |
|---|---|
| `npm test` | 13/13 passed |
| `npm run benchmark:replay` | 9 条 controlled replay；估算 575，provider tokens 未测 |
| API Smoke | 未运行；价格与桥接兼容性未核验 |
| baseline replay run | `benchmarks/results/baseline-v0-20261011/`，已忽略提交 |
| 基线摘要报告 | `benchmarks/reports/baseline-v0.md` |
| `baseline-v0` SHA | 待初始化提交 |
| `main` / `v1`–`v3` SHA | 待初始化提交 |

## 下一步

1. 修复确定性测试、类型/运行问题后运行离线 Replay。
2. 生成实际基线摘要并执行一次本地 baseline 提交与 `v1`–`v3` 分支创建。
3. 从 PackyAPI 当前控制台核实分组单价与模型桥接参数，设置一个明确的小额硬预算后再做单请求 Smoke。
4. 在提交 V1 前补建可恢复的 pinned repos、独立验收测试和真正执行 Agent 的 Core/Smoke Harness；用 `NOT_MEASURED` 结果等待资源，不能以 Replay 估算代替。

## 恢复命令

```powershell
cd C:\Users\Administrator\Documents\token-efficient-coding-agent
git status --short --branch
npm test
npm run benchmark:replay
```

参见 [docs/EXPERIMENT_RECOVERY.md](docs/EXPERIMENT_RECOVERY.md)。
