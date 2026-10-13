# TEA / Pi：默认 24 次工具额度补测

[English](README.md)

![Fresh repeats](tea-contextos-vs-pi-fresh.png)

TEA `b37322f1423115c6481ca53609da787bee259023`; Pi 0.87.1; 2026-10-11T15:56:48.435Z → 2026-10-11T16:37:00.987Z.

## 结果

三类缺陷 × 三种规模，每配置重复三次；27 组配对、54 次运行。

- 全体 Token：TEA **708,844** / Pi **1,080,626**；TEA **减少 34.40%**。
- 完整验收：TEA **26/27** / Pi **25/27**；用量完整 **27/27**。
- 独立代码、隐藏完成见证和修改范围检查：TEA/Pi **27/27、27/27**。完整验收还要求原生测试完成和正常结束。
- 双方通过子集 25 组：TEA 642,058 / Pi 1,030,818，少 37.71%；不替代全体结果。
- P95 耗时 TEA/Pi：90.51/102.61 秒。

## 为什么补测

主实验继承了此前记忆实验的每轮 10 次工具限制，部分修复通过独立代码测试，但因额度或验证状态未完成原生流程。小型任务也受影响，因此在补测付费调用前确定重跑全部规模，未只挑失败任务。这里使用 CLI 已有的默认 24 次工具额度，Agent 记忆机制与运行时未改；主实验失败和费用继续保留。

两种配置分别报告，补测不替换原失败，不拼接混合比例。初始 Git 内容逐任务与主实验一致。真实 30 轮长会话只测过原 10 次额度配置，未测默认 24 次的长会话。

## 条件与范围

共同 GLM-5.3-flash、enabled/low 思考、输出上限 4,096、输入保护 160,000 UTF-8 字节、每运行 100 次请求、每轮超时 180 秒。TEA 主动开启 ContextOS，软目标 32,000 字节、模型摘要关闭；Pi 原生 RPC，自动压缩开启、模型窗口声明 200,000。保留各自原生提示和工具，运行顺序交替；全部缓存输入和思考输出都计入。默认指工具额度，ContextOS 仍需主动开启。

自编 JavaScript 缓存键类型冲突、重试边界、Unicode 截断缺陷。12/120/1,200 文件通过无关模块扩大规模，目标缺陷复杂度不随规模增加。三次重复不证明未见生产项目或其他模型的泛化能力。

- 小型：TEA 155,754 / Pi 102,293 Token；TEA **多 52.26%**；完整验收 8/9 对 8/9。
- 中型：TEA 122,691 / Pi 288,137 Token；TEA **少 57.42%**；完整验收 9/9 对 8/9。
- 大型：TEA 430,399 / Pi 690,196 Token；TEA **少 37.64%**；完整验收 9/9 对 9/9。

## 未通过记录

- `medium-unicode-r2/pi`: status `completed`; turns `completed`; tool attempts 6; independent code/scope `True`; native validation `False`; tokens 38,801.
- `small-unicode-r3/tea`: status `failed`; turns `tool_limit_reached`; tool attempts 25; independent code/scope `True`; native validation `True`; tokens 59,459.
- `small-unicode-r3/pi`: status `completed`; turns `completed`; tool attempts 5; independent code/scope `True`; native validation `False`; tokens 11,007.

原生测试未确认不等于代码错误。预定检测器识别指定的 `node --test tests/public.test.mjs` 成功完成，等价命令形式可能产生假阴性。只保存工具结果哈希，没有命令原文，无法事后还原未确认项；保留保守验收，不补记通过。

补测保守费用 USD 1.4783540；主实验与补测合计 USD 4.8053500 / 8。这是配置费率预算口径，不是账单；Token 降幅不是金额降幅。

[主实验：包含失败与真实长会话](../contextos-c-vs-pi-glm-20261011/README.zh-CN.md)

[Protocol](../../../docs/CONTEXTOS_PI_EXPERIMENT.md) · [Run/request evidence](comparison.json) · [Grouped metrics](groups.json) · [Independent audit](completion-witness-audit.json) · [SHA-256](evidence.sha256)
