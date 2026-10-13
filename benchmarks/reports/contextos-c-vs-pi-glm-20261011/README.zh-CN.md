# TEA ContextOS C / Pi — 真实 Token 对比

[English](README.md)

Run `contextos-pi-glm-20261011`; 2026-10-11T14:22:11.890Z → 2026-10-11T15:42:47.601Z.

![TEA / Pi](tea-contextos-vs-pi.png)

## 配置与口径

GLM-5.3-flash，enabled thinking，low effort，输出上限 4,096；Pi **0.87.1**，TEA 冻结提交 `b391a6b305fb849fea2aab5051ee61f6d3dc4651`。30 组配对、60 次运行，每类任务重复 3 次。

三个自编 JavaScript 缺陷类型分别放在 12、120、1,200 文件的项目中；另有从空会话开始的真实 30 轮完整读取，再修复并测试。两组分别报告；这不代表真实生产项目或其他模型。

实际 Token = 普通输入 + 缓存读取 + 缓存写入 + 输出；思考已计入输出。全部失败也保留。两边收到完全相同的任务文本和初始 Git 内容。模型参数由公共网关统一，各自保留原生提示与工具。

## 短任务

- 全部 27 组：TEA **437,860**，Pi **1,187,808**；TEA **减少 63.14%**。
- 验收：TEA **16/27**，Pi **27/27**。
- 双方均通过子集 16 组：TEA 149,021 / Pi 407,285；减少 63.41%。该子集不替代全体结果。
- 请求数 TEA/Pi：187/153；P95 时长：65.44/55.14 秒。

TEA 验收下降，本组不能作为保持性能的优化证据。

## 真实 30 轮长会话

- 全部 3 组：TEA **905,224**，Pi **1,558,908**；TEA **减少 41.93%**。
- 验收：TEA **3/3**，Pi **3/3**。
- 双方均通过子集 3 组：TEA 905,224 / Pi 1,558,908；减少 41.93%。该子集不替代全体结果。
- 请求数 TEA/Pi：195/192；P95 时长：485.60/463.18 秒。

## 项目规模

- small: TEA 87,604 / Pi 114,295; 减少 23.35%; accepted TEA/Pi 7/9 · 9/9.
- medium: TEA 88,171 / Pi 283,742; 减少 68.93%; accepted TEA/Pi 8/9 · 9/9.
- large: TEA 262,085 / Pi 789,771; 减少 66.82%; accepted TEA/Pi 1/9 · 9/9.

![Fresh repeats](tea-contextos-vs-pi-fresh.png)

![Long conversation](tea-contextos-vs-pi-long.png)

## 审计与限制

- 30/30 组用量完整；源码与 Pi CLI 哈希未变化；模型参数、初始内容和账本加总一致。长会话完整读取验收 TEA/Pi：90/90、90/90。
- TEA 恢复工具共 0 次；Pi 自动压缩事件 0 次。Pi 自动压缩已开启，模型窗口配置 200,000；TEA ContextOS 软目标 32,000 字节，模型摘要压缩关闭。没有把未触发的压缩能力算成收益。
- 双方每次检查必须完整读取指定路径，且不得编辑、执行命令或测试；修复后必须实际运行公共测试，另有独立隐藏测试与改动范围检查。
- 本轮保守预算费用 **USD 3.3269960**，上限 8 美元；单运行上限 1.40 美元、100 次请求、单轮超时 180 秒。这是配置费率的预算口径，并非账单；Token 降幅也不是实际金额降幅。此前 A/B/C 费用不被本轮覆盖。
- 原生提示、工具模式、缓存指令不同；TEA 每轮工具上限 10，Pi 使用自己的循环策略。缓存无法通过此工具重置，使用交替顺序缓解固定顺序偏差。三次重复不能证明普遍优势。
- 相比此前 TEA 全历史的 52.12% 结论，本报告使用不同的 Pi 基线和通用任务文本，必须分别引用。没有更改已测量的 ContextOS C 运行时机制。

## 验收补充核查

主实验完成后，为隐藏验收添加了完成见证，再对全部 60 个最终工作区重跑。原验收决定完全一致，Agent 记忆代码未改变；原冻结记录不重写。[独立审计](completion-witness-audit.json)。

## 复现与数据

[冻结实验协议](../../../docs/CONTEXTOS_PI_EXPERIMENT.md) · [逐运行和逐请求数据](comparison.json) · [分组统计](groups.json) · [SHA-256](evidence.sha256)

## 默认工具额度补测与费用取舍

上述短任务使用记忆基准继承的 10 次额度，不符合 CLI 已有的 24 次默认额度。完成后事先选定全部 9 个短任务配置、三次重复，另跑 54 次；[结果单独报告](../contextos-c-vs-pi-default24-glm-20261011/README.zh-CN.md)，不替换这里的失败或拼接比例。

长会话 P95 TEA 比 Pi 慢 **4.84%**。缓存输入占比 TEA/Pi **52.46%/94.25%**。假设普通输入/缓存读/输出分别为 USD 0.80/0.23/2.80 每百万 Token，同一用量推算 TEA/Pi 为 **USD 0.465248/0.421215**，TEA 反而贵 **10.45%**。这是固定费率敏感性分析，未验证用户实际分组计费，不是账单。[全部计算输入](cache-price-sensitivity.json)。因此只支持本组 Token 优势，不能宣称速度或金额优势。

## 主实验未通过运行

- `large-cache-key-r1/tea`: `tool_limit_reached`; independent code/scope `True`; native validation `False`; tool attempts 11; 43,709 tokens.
- `large-retry-budget-r1/tea`: `tool_limit_reached`; independent code/scope `True`; native validation `True`; tool attempts 11; 30,361 tokens.
- `large-unicode-r1/tea`: `tool_limit_reached`; independent code/scope `True`; native validation `False`; tool attempts 11; 33,913 tokens.
- `small-unicode-r2/tea`: `tool_limit_reached`; independent code/scope `True`; native validation `True`; tool attempts 11; 17,084 tokens.
- `large-cache-key-r2/tea`: `tool_limit_reached`; independent code/scope `False`; native validation `False`; tool attempts 11; 19,748 tokens.
- `large-retry-budget-r2/tea`: `tool_limit_reached`; independent code/scope `True`; native validation `True`; tool attempts 11; 33,078 tokens.
- `large-unicode-r2/tea`: `tool_limit_reached`; independent code/scope `True`; native validation `True`; tool attempts 11; 13,913 tokens.
- `small-unicode-r3/tea`: `needs_validation`; independent code/scope `True`; native validation `False`; tool attempts 10; 17,432 tokens.
- `medium-unicode-r3/tea`: `tool_limit_reached`; independent code/scope `True`; native validation `False`; tool attempts 11; 19,200 tokens.
- `large-retry-budget-r3/tea`: `tool_limit_reached`; independent code/scope `False`; native validation `False`; tool attempts 11; 26,822 tokens.
- `large-unicode-r3/tea`: `tool_limit_reached`; independent code/scope `True`; native validation `False`; tool attempts 11; 33,579 tokens.
