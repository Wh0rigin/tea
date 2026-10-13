# TEA / Pi: default-24 tool-quota follow-up

[中文](README.zh-CN.md)

![Fresh repeats](tea-contextos-vs-pi-fresh.png)

TEA `b37322f1423115c6481ca53609da787bee259023`; Pi 0.87.1; 2026-10-11T15:56:48.435Z → 2026-10-11T16:37:00.987Z.

## Results

Three bug families × three sizes × three repetitions: 27 pairs / 54 runs.

- All provider tokens: TEA **708,844** / Pi **1,080,626**; TEA used **34.40% fewer tokens**.
- Full acceptance: TEA **26/27**, Pi **25/27**; complete usage **27/27**.
- Independent code, hidden completion witness and scope checks: TEA/Pi **27/27, 27/27**. Full acceptance also requires native validation and completed status.
- Both-accepted subset (25 pairs): TEA 642,058 / Pi 1,030,818; 37.71% fewer. This subset does not replace all-attempt results.
- P95 elapsed, TEA/Pi: 90.51/102.61 seconds.

## Why this follow-up

The primary profile inherited a 10-tool memory-benchmark quota. Some repairs passed independent code tests but did not complete native quota/validation obligations. A small task was also affected, so all sizes were selected before any follow-up paid calls. This uses the existing CLI default of 24 tools; Agent memory and runtime are unchanged. Primary failures and costs remain recorded.

Report profiles separately; follow-ups do not replace original failures or construct a mixed ratio. Initial Git contents match task by task. The actual 30-turn conversation was measured only at the original 10-tool quota, not at default 24.

## Controls and scope

Common GLM-5.3-flash, enabled/low thinking, 4,096 output cap, 160,000 UTF-8-byte input guard, 100 requests/run and 180-second turn timeout. TEA explicitly enables ContextOS at a 32,000-byte soft target with model summarization off; native Pi RPC enables auto-compaction with a 200,000-token advertised window. Native prompts/tools differ; agent order alternates. All cache input and reasoning output count. Default refers to tool quota; ContextOS remains opt-in.

Self-authored JavaScript primitive-cache, retry-budget and Unicode bugs in 12/120/1,200-file repositories. Unrelated modules increase size without increasing bug complexity. Three repeats do not establish unseen-production or cross-model generalization.

- small: TEA 155,754 / Pi 102,293; reduction -52.26%; accepted 8/9 · 8/9.
- medium: TEA 122,691 / Pi 288,137; reduction 57.42%; accepted 9/9 · 8/9.
- large: TEA 430,399 / Pi 690,196; reduction 37.64%; accepted 9/9 · 9/9.

## Unaccepted runs

- `medium-unicode-r2/pi`: status `completed`; turns `completed`; tool attempts 6; independent code/scope `True`; native validation `False`; tokens 38,801.
- `small-unicode-r3/tea`: status `failed`; turns `tool_limit_reached`; tool attempts 25; independent code/scope `True`; native validation `True`; tokens 59,459.
- `small-unicode-r3/pi`: status `completed`; turns `completed`; tool attempts 5; independent code/scope `True`; native validation `False`; tokens 11,007.

Unconfirmed native validation is not a code failure. The predeclared detector recognizes successful completion of `node --test tests/public.test.mjs`; equivalent command forms may cause false negatives. Only tool-result hashes are retained, not command text, so unconfirmed items cannot be reconstructed post hoc and remain conservatively unaccepted.

Conservative follow-up USD 1.4783540; primary + follow-up USD 4.8053500 / 8. Supplied-rate estimate, not invoice; token reduction is not monetary reduction.

[Primary profile, including failures and long conversations](../contextos-c-vs-pi-glm-20261011/README.md)

[Protocol](../../../docs/CONTEXTOS_PI_EXPERIMENT.md) · [Run/request evidence](comparison.json) · [Grouped metrics](groups.json) · [Independent audit](completion-witness-audit.json) · [SHA-256](evidence.sha256)
