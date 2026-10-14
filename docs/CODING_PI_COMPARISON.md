# Coding ability: recorded TEA vs native Pi

This comparison reuses the completed eight-task TEA cohort and runs the same eight tasks once through native Pi 0.87.1. It is a sequential diagnostic comparison, not an interleaved repeated trial or a production-repository benchmark.

The frozen fixture manifest, prompts, initial files and independent acceptance assertions are identical. A shared helper contains the exact acceptance/workspace operations from the original TEA harness; regression checks prevent drift. Source/reference solutions are not seeded into model conversations. Native system prompts, tools and context policies remain different by design.

## Common controls

- GLM-5.3-flash, Messages API, enabled thinking, low effort, 4,096 maximum output tokens. The relay applies a 4,095 thinking budget, matching the TEA adapter at this output limit.
- Same configured 32,768-token scheduling capacity and 256,000-byte request guard; this does not assert the provider's actual capacity. Pi automatic compaction uses native reserve/retention defaults; TEA uses its ContextOS and compaction policy.
- Ninety-second request deadline, ten-minute task deadline, 1 USD per task / 6 USD added Pi cohort accounting guards. Costs use recorded conservative rates, not account invoices.
- TEA retains its native 24-tool limit. The Pi RPC observer interrupts on the 25th tool-start event; this boundary may interrupt an in-flight operation. A separate 32-request guard protects the added Pi run. Record boundary events rather than describing stopped tasks as success.
- Each task starts fresh. Pi receives only a local relay credential; provider credentials never enter the Pi child. Extensions, skills and automatic paid retries are disabled. Pi uses its native PowerShell tool on Windows; TEA keeps its approval policy for unlisted commands.

Pi runs in a temporary workspace without ancestor instructions. The earlier TEA engine discovers its task workspace; native instruction loading and absolute paths differ. Model/effort/output values are frozen in the recorded TEA plan and checked on Pi requests. The older TEA plan did not record an endpoint fingerprint, so endpoint continuity relies on the previous personal configuration rather than a recorded endpoint hash; the new Pi endpoint fingerprint is retained. Timing is not reported as a speedup.

## Acceptance and reporting

Both require preserved original tests and protected files, passing independent source-level assertions, passing added tests, completion and actual post-edit validation. Pi validation is derived from native events, declared test commands, positive Node test output and source fingerprints. Unrecognized validation is reported separately from functional correctness.

All attempted samples, failures, guards and unknown usage remain visible. Unknown usage is never zero and halts the added cohort without retry. Chart bars contain functional passes only; failed costs appear as separate markers, and native validation uncertainty is marked U. A total ratio requires complete coverage and usage for all eight tasks; any both-passed subset is separately named. Tokens include cache reads/writes and output, without adding reasoning output twice.

```sh
node scripts/compare-coding-pi.mjs --mode=prepare --run-id=coding-pi-preflight-example
node scripts/compare-coding-pi.mjs --mode=live --run-id=coding-pi-live-example
```

The current local Pi package location is resolved under the user's global npm installation. Install the pinned package before running; no Pi installation or paid calls happen in CI. The aggregate report is reviewed before publishing; raw candidate workspaces, command traces and temporary paths remain private.

## 中文范围说明

使用刚才已完成的 TEA 八题结果，新增 Pi 原生八题运行。相同题意、初始文件、模型参数和独立验收；保留两者原生工具及压缩策略。每题仅一次且先后运行，因此只能说明这轮任务的差异，不能证明稳定优势，也不比较时间加速比。失败、验证未确认和未知用量均单独保留。
