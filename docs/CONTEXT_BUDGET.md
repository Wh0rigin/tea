# Token context budget / Token 上下文预算

## Current CLI policy: Pi-style budgeting

The daily CLI defaults to `contextBudgetPolicy: "pi"`, following the reserve-based scheduling policy in Pi 0.87.1. TEA retains its own estimator, ContextOS, validation obligations and encrypted history.

```json
{
  "contextBudgetPolicy": "pi",
  "contextWindowTokens": 216000,
  "contextReserveTokens": 16384,
  "maxOutputTokens": 131072,
  "compactionTriggerRatio": 1,
  "compactionKeepRecentTokens": 20000,
  "compactionReserveTokens": 16384,
  "maxRequestInputBytes": 2097152
}
```

This window and output ceiling are examples; use your provider's documented capacities. The unknown-model fallback remains 32,768 context / 4,096 output tokens. Existing explicit user settings override new defaults; a saved reserve of 4,096 or trigger ratio of 0.8 is not silently rewritten. Restart TEA to reload configuration.

- Scheduling input limit: `contextWindowTokens - contextReserveTokens`.
- Automatic trigger: `floor(inputLimit * compactionTriggerRatio)`. With the example this is **199,616 estimated input tokens**, rather than reserving the entire 131,072 output ceiling before applying an additional 80% trigger.
- Each request's output allowance is `min(configured output ceiling, context window - estimated input)`. Short requests retain their ceiling; long inputs get a smaller allowance. Estimated input and allowance fit the configured window; this is not a guarantee of exact provider tokenization. A post-response calibration factor can only increase the estimate. No count-token API call is added.
- Summary ceiling: `min(configured output ceiling, floor(0.8 * compactionReserveTokens))`; default reserve 16,384 gives 13,107, or 4,096 under the default CLI output ceiling. Thinking follows the existing output-based rule.
- Recent history: approximately 20,000 estimated tokens, keeping complete tool batches and the newest group. Small windows clamp retention to half the input scheduling limit so there is space to summarize and continue. An explicit `compactionKeepRecentBytes` preserves byte-based retention unless a token setting is also supplied.
- The CLI has no default task-wide tool-call cap or task-wide count of successful automatic compactions. Explicit `TEA_MAX_TOOL_CALLS` and `TEA_COMPACTION_MAX_PER_TURN` remain enforced. Repeated identical context fingerprints cannot retrigger compaction; an unchanged summary pauses attempts until context/resident size grows by the existing cooldown. Unknown billing prevents silent retries.
- Pi-style summary input keeps historical tool text and patch parameters instead of applying the old 2,000/1,000-byte excerpts. Complete historical groups must still fit summary input and wire guards. Ordinary user requirements are never cut to fit.

Environment variables: `TEA_CONTEXT_BUDGET_POLICY`, `TEA_CONTEXT_WINDOW_TOKENS`, `TEA_CONTEXT_RESERVE_TOKENS`, `TEA_MAX_OUTPUT_TOKENS`, `TEA_COMPACTION_TRIGGER_RATIO`, `TEA_COMPACTION_KEEP_RECENT_TOKENS`, `TEA_COMPACTION_RESERVE_TOKENS`. The old `TEA_MAX_REQUEST_INPUT_TOKENS` is a **byte-limit alias**; `TEA_MAX_REQUEST_INPUT_BYTES` takes precedence.

## Compatibility and differences from Pi

`loadConfig` keeps `reserved-output` by default for existing SDK and frozen-experiment callers; `loadCliConfig` chooses `pi`. Select `TEA_CONTEXT_BUDGET_POLICY=reserved-output` to restore the old scheduling formula and defaults. Old experiment engines and published results are not rewritten.

This is budget-policy alignment, not an identical agent or tokenizer. TEA still uses its calibrated ASCII/Unicode estimator, its six-heading summary validation and smaller-projection adoption guard. No new provider-error compact-and-retry path is introduced. Pi's tool implementation, 50 KiB/2,000-line output limits and large-file reading behavior are not copied by this change. ContextOS's 32,000-byte target, recall page bounds, tool capture limits and protected validation state remain separate policies. The independent CLI wire guard is 2 MiB; resident memory pressure can also trigger compaction at 4 MiB. Explicit monetary caps retain conservative reservations.

## 中文说明

本轮对齐的是上下文预算：默认预留 16,384 Token，在接近窗口容量时压缩，保留约 20k Token 近期原文；不再默认限制每任务只能调用 24 次工具或压缩两次。摘要输入不再固定截成 2 KB 首尾，仍保留截断摘要拒收、原始需求和未解决验证状态保护。

这不是声称估算器、工具、错误恢复和 Pi 完全一致。未知模型仍用 32k 窗口；小窗口会缩小近期保留量。已有显式配置优先，不自动修改用户文件。此次没有付费对照，不能沿用上一版本的 17.16% 数字作为新策略收益。


## Verification for this policy change

Deterministic regression: 457 passed, 1 skipped, 0 failed. Targeted budget/model/compaction/file-creation checks: 83 passed. New scripted integration fixtures execute 26 tools in one task and at least three successful compactions in one task. Adapter loopback checks verify the fitted wire output allowance, invalid overrides and local capacity rejection before fetch. Summary input retains a middle-of-result marker that legacy excerpts omit. These are self-authored offline checks, not provider Token savings or real coding acceptance. No paid requests were made for this policy change.
