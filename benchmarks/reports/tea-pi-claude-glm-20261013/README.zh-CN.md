# TEA / Pi / Claude Code 三方实测

[English](README.md)

![Three native coding agents](three-agents.png)

计划 90 次运行，实际 90 次；968 次已提交请求，0 次用量未知。全部计划完成：True。

## fresh

- small: TEA vs Pi 减少 34.02%; TEA vs Claude Code 减少 73.70%.
  tea: tokens 72897, accepted 9/9, code behavior 9/9.
  pi: tokens 110482, accepted 9/9, code behavior 9/9.
  claude: tokens 277132, accepted 0/9, code behavior 9/9.
- medium: TEA vs Pi 减少 75.68%; TEA vs Claude Code 减少 76.58%.
  tea: tokens 73911, accepted 9/9, code behavior 9/9.
  pi: tokens 303904, accepted 9/9, code behavior 9/9.
  claude: tokens 315539, accepted 1/9, code behavior 9/9.
- large: TEA vs Pi 减少 50.12%; TEA vs Claude Code 减少 18.32%.
  tea: tokens 335519, accepted 9/9, code behavior 9/9.
  pi: tokens 672665, accepted 9/9, code behavior 9/9.
  claude: tokens 410752, accepted 0/9, code behavior 9/9.

- teaVsPi: 全部计划任务 Token 减少 55.63%; known pairs 27/27.
  双方均验收通过的诊断子集：减少 55.63% (27 pairs); 不替代整组结果。
- teaVsClaude: 全部计划任务 Token 减少 51.93%; known pairs 27/27.
  双方均验收通过的诊断子集：减少 80.70% (1 pairs); 不替代整组结果。
- tea: attempted 27/27, accepted 27/27, code behavior 27/27, native final validation 27/27, compactions 0, known conservative cost USD 0.4049796, reservation USD 0.0000000.
- pi: attempted 27/27, accepted 27/27, code behavior 27/27, native final validation 27/27, compactions 0, known conservative cost USD 0.8843968, reservation USD 0.0000000.
- claude: attempted 27/27, accepted 1/27, code behavior 27/27, native final validation 1/27, compactions 0, known conservative cost USD 0.8397244, reservation USD 0.0000000.

## long

- long-session: TEA vs Pi 增加 76.35%; TEA vs Claude Code 减少 61.78%.
  tea: tokens 920730, accepted 3/3, code behavior 3/3.
  pi: tokens 522099, accepted 1/3, code behavior 1/3.
  claude: tokens 2409039, accepted 2/3, code behavior 3/3.

- teaVsPi: 全部计划任务 Token 增加 76.35%; known pairs 3/3.
  双方均验收通过的诊断子集：减少 41.77% (1 pairs); 不替代整组结果。
- teaVsClaude: 全部计划任务 Token 减少 61.78%; known pairs 3/3.
  双方均验收通过的诊断子集：减少 61.71% (2 pairs); 不替代整组结果。
- tea: attempted 3/3, accepted 3/3, code behavior 3/3, native final validation 3/3, compactions 0, known conservative cost USD 0.7465560, reservation USD 0.0000000.
- pi: attempted 3/3, accepted 1/3, code behavior 1/3, native final validation 1/3, compactions 0, known conservative cost USD 0.4208212, reservation USD 0.0000000.
- claude: attempted 3/3, accepted 2/3, code behavior 3/3, native final validation 2/3, compactions 0, known conservative cost USD 1.9432352, reservation USD 0.0000000.

## 未通过记录

- `small-cache-key-r1/claude`: completed, tokens 28388; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `small-retry-budget-r1/claude`: completed, tokens 28704; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `small-unicode-r1/claude`: completed, tokens 30281; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `medium-cache-key-r1/claude`: completed, tokens 31744; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `medium-retry-budget-r1/claude`: completed, tokens 32972; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `medium-unicode-r1/claude`: completed, tokens 42265; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `large-cache-key-r1/claude`: completed, tokens 26509; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `large-retry-budget-r1/claude`: completed, tokens 66534; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `large-unicode-r1/claude`: completed, tokens 33852; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `small-cache-key-r2/claude`: completed, tokens 31209; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `small-retry-budget-r2/claude`: completed, tokens 28715; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `small-unicode-r2/claude`: completed, tokens 36967; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `medium-cache-key-r2/claude`: completed, tokens 32242; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `medium-retry-budget-r2/claude`: completed, tokens 32795; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `medium-unicode-r2/claude`: completed, tokens 39363; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `large-cache-key-r2/claude`: completed, tokens 31040; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `large-retry-budget-r2/claude`: completed, tokens 67971; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `large-unicode-r2/claude`: completed, tokens 81421; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `small-cache-key-r3/claude`: completed, tokens 36282; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `small-retry-budget-r3/claude`: completed, tokens 28680; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `small-unicode-r3/claude`: completed, tokens 27906; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `medium-retry-budget-r3/claude`: completed, tokens 41278; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `medium-unicode-r3/claude`: completed, tokens 32756; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `large-cache-key-r3/claude`: completed, tokens 33943; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `large-retry-budget-r3/claude`: completed, tokens 29138; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `large-unicode-r3/claude`: completed, tokens 40344; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。
- `long-30-r1/pi`: failed, tokens 1586; codeCorrect, declaredReadRequirements, nativePostEditValidation, nativeCompleted.
  长会话未完成全部阶段，完成量不同；不能将 Token 差距等同于相同已完成工作的效率。
  第一阶段未满足完整原生源码读取要求，流程在修复阶段之前停止；用量记录完整时不将其当作 API 用量缺失。
- `long-30-r2/pi`: failed, tokens 1577; codeCorrect, declaredReadRequirements, nativePostEditValidation, nativeCompleted.
  长会话未完成全部阶段，完成量不同；不能将 Token 差距等同于相同已完成工作的效率。
  第一阶段未满足完整原生源码读取要求，流程在修复阶段之前停止；用量记录完整时不将其当作 API 用量缺失。
- `long-30-r2/claude`: completed, tokens 824646; nativePostEditValidation.
  代码行为通过，最终原生验证未确认，保留保守判分，不称为代码错误。

## 条件与限制

共同 GLM-5.3-flash、enabled/low、输出/思考上限 4096/4095，相同任务与初始源码。TEA 受测版本为归档的缩短元数据候选 bd41742，ContextOS 32000 字节、能力反馈开启、模型摘要关闭、24 次工具/轮；默认运行时未重新启用候选。Pi 0.87.1 使用原生 RPC；Claude Code 2.1.281 使用原生 safe-mode CLI（非 bare），保留核心提示与 Bash/Edit/Glob/Grep/Read/Write。关闭宿主个性化配置和跨会话自动记忆；保留原生会话历史与自动压缩。这里比较编程 Agent 软件，使用的是同一个 GLM 模型，不是 GLM 与 Anthropic Claude 模型的比较。

三方全部重新运行，没有混用旧样本。输入含全部缓存读写，输出含思考；轮换顺序但无法重置供应商缓存。三类自编缺陷，每规模三次重复，规模靠无关模块扩展，不能证明生产泛化。原生提示/工具/缓存策略不同，整体差距不能归因于元数据单项。源码、框架及二进制指纹冻结；Claude 行号只做可核查呈现转换，不补齐缺失源码。

Known conservative cost USD 5.2397132; unknown reservation USD 0.0000000; not invoice. USD12 shared guard, USD1.4/run, 100 requests/run, 160000-byte input guard, request/turn timeout 180/300 seconds. Previous unknown reservations remain separate. No paid retry after unknown usage.

Deterministic tests: 274/274. Native three-agent loopback: 27/27, 108 scripted requests; Claude multi-turn: 8 scripted requests. Zero paid calls in functional checks. Initial Windows short-path and mock SSE-header failures retained and corrected before paid calls. Scripted usage is not performance evidence.

[All attempts](results.json) · [Summary](summary.json) · [Accounting audit](accounting-audit.json) · [Frozen plan](frozen-plan.json) · [Protocol](frozen-protocol.md) · [Functional checks](functional-checks.json) · [Hashes](evidence.sha256)
