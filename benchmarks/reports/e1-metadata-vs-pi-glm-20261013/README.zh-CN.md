# 缩短证据元数据版 TEA 与 Pi 对比

[English](README.md)

![Provider token comparison](tea-vs-pi.png)

## 结果

计划 60 次运行，实际 60 次；提交 653 次请求，0 次用量未知。

### fresh

- small: TEA 74847 / Pi 108094 Token; 减少 30.76%; 完整验收 TEA 9/9，Pi 8/9；用量完整配对 9/9。
- medium: TEA 73938 / Pi 286969 Token; 减少 74.23%; 完整验收 TEA 9/9，Pi 9/9；用量完整配对 9/9。
- large: TEA 375718 / Pi 758901 Token; 减少 50.49%; 完整验收 TEA 9/9，Pi 9/9；用量完整配对 9/9。

本组全部任务合计：减少 54.55%; TEA 524503 / Pi 1153964 Token.

配置费率下的本组费用估算：减少 53.45%.

双方均完整验收通过的子集（26 对）：减少 54.82%. 这是诊断性子集，不替代含失败的整组结果。

- tea: 独立代码行为正确 27/27，原生最终验证 27/27；已知保守费用 USD 0.4373464，未知预留 USD 0.0000000。
  本组模型摘要/自动压缩实际执行 0 次。
- pi: 独立代码行为正确 27/27，原生最终验证 26/27；已知保守费用 USD 0.9394832，未知预留 USD 0.0000000。
  本组模型摘要/自动压缩实际执行 0 次。
- `small-cache-key`: TEA 26080 / Pi 35609; 减少 26.76%; pairs 3/3.
- `small-retry-budget`: TEA 22034 / Pi 33496; 减少 34.22%; pairs 3/3.
- `small-unicode`: TEA 26733 / Pi 38989; 减少 31.43%; pairs 3/3.
- `medium-cache-key`: TEA 22905 / Pi 93194; 减少 75.42%; pairs 3/3.
- `medium-retry-budget`: TEA 24319 / Pi 96646; 减少 74.84%; pairs 3/3.
- `medium-unicode`: TEA 26714 / Pi 97129; 减少 72.50%; pairs 3/3.
- `large-cache-key`: TEA 110265 / Pi 272046; 减少 59.47%; pairs 3/3.
- `large-retry-budget`: TEA 160483 / Pi 184722; 减少 13.12%; pairs 3/3.
- `large-unicode`: TEA 104970 / Pi 302133; 减少 65.26%; pairs 3/3.

### long

- long-session: TEA 913350 / Pi 1036146 Token; 减少 11.85%; 完整验收 TEA 3/3，Pi 2/3；用量完整配对 3/3。

本组全部任务合计：减少 11.85%; TEA 913350 / Pi 1036146 Token.

配置费率下的本组费用估算：减少 11.27%.

双方均完整验收通过的子集（2 对）：减少 41.24%. 这是诊断性子集，不替代含失败的整组结果。

- tea: 独立代码行为正确 3/3，原生最终验证 3/3；已知保守费用 USD 0.7407200，未知预留 USD 0.0000000。
  本组模型摘要/自动压缩实际执行 0 次。
  Read-only phases: 812592 tokens; repair: 100758 tokens.
- pi: 独立代码行为正确 2/3，原生最终验证 2/3；已知保守费用 USD 0.8347828，未知预留 USD 0.0000000。
  本组模型摘要/自动压缩实际执行 0 次。
- `long-30`: TEA 913350 / Pi 1036146; 减少 11.85%; pairs 3/3.

## 未通过与中断

- `small-unicode-r2/pi`: status `completed`, tokens `14294`, dimensions `nativePostEditValidation`.
  代码行为和修改范围通过；核查器无法识别其命令形式以确认最终验证，保持原保守判分，不声称代码错误。
- `long-30-r1/pi`: status `failed`, tokens `1591`, dimensions `codeCorrect, declaredReadRequirements, nativePostEditValidation, nativeCompleted`.
  在第 1 轮未确认要求的完整原生读取，修复阶段未到达；初始缺陷未被修复。完整与中断会话完成量不同，该 Token 总量不能等同于相同已完成工作的效率。

未知用量会停止剩余计划，不重试、不计为零。正式验收失败与代码行为错误分别报告，不事后修改判分。

## 条件与限制

本次直接加载已回退但保存在 Git 中的缩短元数据候选 bd41742，与固定 Pi 0.87.1 使用原生客户端对比。当前默认 TEA 未改动。GLM-5.3-flash，enabled/low，输出/思考上限 4096/4095；TEA ContextOS 32000 字节、模型摘要关闭、24 次工具/轮；Pi 原生自动压缩开启、自动重试关闭、窗口声明 200000。相同模型参数、任务提示、初始源码与核查器；提示和工具接口保留各自原生设计。

候选完整测试本轮再次通过 276/276；本地流式协议检查双方各 8 次请求通过，均为零付费、脚本用量。完整测试在首批付费运行期间执行，因此不把本轮耗时用于严格延迟收益主张。

新一轮同时运行双方，未拼接历史 Pi 样本。Token 包含所有缓存输入及思考输出。运行顺序交替，但无法重置供应商缓存。三类自编 JavaScript 缺陷在 12/120/1200 文件上重复三次；增加的是无关模块，缺陷复杂度未增加。长会话从空历史开始，30 轮原生读文件后修复。样本不是生产任务泛化证明。Pi 比较不能代替 TEA 与原版之间的优化门槛。

USD 8 suite guard; USD 1.4/run; 100 requests/run; requests/turn timeout 180/300 s. Known conservative cost USD 2.9523324; new unknown reservation USD 0.0000000. Configured input/cache-read 0.80, output 2.80 per million; cache-write conservative rate; not an invoice. Earlier unknown reservations stay separate.

[Summary](summary.json) · [All attempts](results.json) · [Accounting audit](accounting-audit.json) · [Frozen plan](frozen-plan.json) · [Protocol](frozen-protocol.md) · [Source audit](source-audit.json) · [Hashes](evidence.sha256)

这里的差距是整个缩短元数据候选 TEA 相对 Pi 的差距，包含工具、提示和记忆机制等差异，不能全部归因于元数据缩短。元数据单独收益应看之前对直接父版本的 E1 实验；两轮数据不合并。
