# 三方最新实测：普通任务 v5 / 长会话 v6

[English](README.md)

![Three native coding agents](three-agents.png)

两组独立冻结：普通任务 81 次采用 v5，Long 9 次采用 v6。相同归档 TEA bd41742 / Pi 0.87.1 / Claude Code 2.1.281、GLM-5.3-flash enabled/low、输出/思考上限 4096/4095、相同初始任务与源码。不是统一的 90 次源码冻结；旧 v5 Long 数据保留在独立报告中。

## fresh

- teaVsPi: 减少 50.60% （全尝试总量）；双方通过的诊断子集 减少 50.60% (27 pairs).
- teaVsClaude: 减少 48.26% （全尝试总量）；双方通过的诊断子集 减少 47.07% (18 pairs).
- tea: tokens 487388; acceptance 27/27; behavior 27/27; workflow completion 27/27; declared read compliance 27/27.
- pi: tokens 986602; acceptance 27/27; behavior 27/27; workflow completion 27/27; declared read compliance 27/27.
- claude: tokens 942024; acceptance 18/27; behavior 27/27; workflow completion 27/27; declared read compliance 27/27.

## long

- teaVsPi: 减少 41.36% （全尝试总量）；双方通过的诊断子集 减少 41.36% (3 pairs).
- teaVsClaude: 减少 62.40% （全尝试总量）；双方通过的诊断子集 减少 62.40% (3 pairs).
- tea: tokens 905432; acceptance 3/3; behavior 3/3; workflow completion 3/3; declared read compliance 3/3.
- pi: tokens 1544126; acceptance 3/3; behavior 3/3; workflow completion 3/3; declared read compliance 3/3.
- claude: tokens 2407974; acceptance 3/3; behavior 3/3; workflow completion 3/3; declared read compliance 3/3.

## 标记、判定与限制

Claude Code 普通任务的三角从 26/27 降至 9/27，完整验收从 1/27 变为 18/27。这修复了主要识别问题，但未完全消除复杂命令的不确定性；不追改旧记录。圆点完整通过，三角仅最终验证未确认且其他维度通过；三角仍可进入柱形，叉号失败不进入柱形。所有点、失败与未知用量保留。柱形子集与全尝试总量分开，失败排除后不对柱形标全尝试百分比。

v6 对正常完成且工具事件完整的阶段继续执行，读取遗漏、只读违规和工作区变化仍计入验收；运行/协议失败、异常、超时与用量/预算保护仍停止。没有违规即通过的改判。

三方比较的是 Agent 软件，Claude Code 使用同一个 GLM，不是 Anthropic Claude 模型；保留原生提示/工具，关闭宿主个性化与跨会话记忆。三类自编 JavaScript 缺陷与无关模块扩展，不证明生产泛化。差距不隔离元数据优化；默认运行时仍未启用归档候选。

Displayed cohort known conservative cost USD 5.9191288; v5 plus successful retry attempted-work cost USD 9.4054536; configured rates, not invoice. Reservations USD 0.0000000; earlier reservations separate.

[Fresh v5 evidence](../tea-pi-claude-v5-glm-20261013/README.md) · [Long v6 evidence](../tea-pi-claude-v6-retry1-glm-20261014/README.md) · [Full displayed records](results.json) · [Chart audit](chart-audit.json) · [Summary](summary.json) · [Hashes](evidence.sha256)


本次为用户明确授权的独立新组重测：9/9 完整通过，587 笔请求用量已知，无未知请求。上次中断组仍单独保留，已知费用 USD 0.3135940、未知预留 USD 0.2674688 不并入本次完整 Token 降幅；不以新用量填补旧请求。

[Prior interrupted cohort](../tea-pi-claude-v6-glm-20261014/README.md)
