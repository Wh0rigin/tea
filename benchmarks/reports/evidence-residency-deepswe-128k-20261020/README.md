# Evidence residency: 128K-output streaming reassessment

Status: completed. Eight fixed attempts independently graded; 276 submitted requests. All usage is complete and reconciled.

[Frozen protocol](protocol.json) · [Previous complete 4K round](../evidence-residency-deepswe-r2-20261019/README.md) · [Earlier interrupted round](../evidence-residency-deepswe-20261019/README.md)

## Scope and fixed schedule

The user requested testing after raising the configured maximum output from 4,096 to **131,072 tokens**. This is the GLM-5.3-flash model's documented maximum output ([official model page](https://docs.z.ai/guides/vlm/glm-5.3-flash)); compatibility of the user's actual relay is checked separately before repository attempts. A short accepted response can demonstrate parameter acceptance, not actual 128K-length generation.

Baseline `f03052a5b41453c206f9375bd5c004842cab0dc4` and candidate `778a54ff1773e51d4f1ca1211fda4249a1eb848c` use the original verified archives. Their only production difference is version/range-aware retention of resident source evidence. Two previously seen DeepSWE v1.1 tasks, two independent repeats per arm: **eight fixed attempts / four pairs**. Arm order matches the previous round. No hidden-test feedback is supplied to the agent.

Both arms use GLM-5.3-flash, enabled thinking / low effort, streaming, 216,000 local context tokens, 32,000-byte ContextOS target, automatic compaction/GC, 96 tools, 128 transport requests and a 30-minute agent wall limit. Permissions and artifact export match the previous completed comparison. Ordinary tool/test failures already enter the agent feedback loop; terminal output/JSON recovery behavior is unchanged.

## Shared changes from the 4K round

- Maximum output **4,096 → 131,072**. Existing adapter logic derives thinking budget **4,095 → 8,000**; both arms receive the same controls.
- Request deadline **300 → 900 seconds**, relay deadline 915 seconds, to accommodate longer responses.
- Per-task control allocation **5 → 10 USD**, suite allocation **80 USD**. The larger allocation accommodates conservative maximum-output reservation; the production reservation formula and 2 MiB wire guard are unchanged.
- A separately bounded, single streaming `READY` compatibility completion, **1 USD allocation**. The combined new-round allocation is at most **81 USD**, including unknown reservations. These are accounting controls, not invoice claims.

This is a **new common execution profile**, not an isolated causal test of changing only `max_tokens`. In particular, reserving more output also changes input scheduling headroom under the same context window. The old 4K results remain historical sensitivity data and are never pooled with this round.

## Gates and reporting

1. Full local regression and both real-tool adapter lifecycle fixtures must pass without provider calls. Check archive/adapter hashes before launch.
2. Freeze the probe source hash. Run exactly one real streaming parameter probe. A rejected, incomplete or unknown probe stops before the main schedule; do not silently fall back or retry.
3. If accepted, execute only the eight predeclared trials. Each retains its entire 10 USD allocation after unknown billing. Infrastructure exceptions stop the suite; no ad hoc paid retry or extra sample.
4. Official independent whole-task acceptance is primary. Report existing-behavior checks separately; self-authored test passes and internal completion are not official acceptance.
5. Reconcile provider usage with native request counts/hashes and upstream SSE metadata. Include cache input once; do not add reasoning twice. Unknown totals stay null and never become zero.
6. Report all-attempt consumption with every failure. A same-work efficiency percentage requires paired, fully accepted work with complete metering on both sides. Show that subset and its size separately.
7. Two seen task types/four pairs, uncontrolled provider randomness and residual command-policy gaps do not establish a broad DeepSWE score or generalization.

Results, all failures, unknown reservations and the retention assessment will be recorded after the fixed schedule ends or an infrastructure stop occurs. No runtime change or PR merge is part of this reassessment.

## Completed preflight

- Local full regression: **393 passed, one Go-unavailable skip, zero failures / 394**.
- Real adapter lifecycle fixture: both arms passed, ten synthetic SSE responses and nine actual tools each, identical exported patch hashes and independent patch tests. Zero provider calls. These are self-authored infrastructure checks, not task acceptance.
- Synthetic transport checks: **17 passed**, covering fragmented Unicode/LF/CRLF and incomplete/malformed SSE metadata; zero provider calls.
- [Provider parameter probe](provider-probe.json): one real streaming call accepted **131,072 output / 8,000 thinking budget**, returned `READY` with normal termination and complete usage: **26 input + 9 output = 35 provider tokens**. No unknown reservation or retry. This confirms parameter acceptance, not full-length generation.
- [Dual-arm offline lifecycle result](preflight.json). All eight autonomous attempts have ended under the separately frozen 80 USD allocation.

## Final measured results

[All attempts and native/relay audits](results.json) · [Historical profile sensitivity](profile-comparison.json)

- Baseline: **1/4** whole tasks accepted; **2,080,101** provider tokens; 116 requests.
- Candidate: **0/4** whole tasks accepted; **2,839,108** provider tokens; 160 requests.
- Candidate minus baseline whole-task acceptance: **-25 percentage points**.
- Raw all-attempt consumption change: **+36.49%**. Includes all failures and unequal work; **not a same-work efficiency result**.
- Both-accepted, fully metered pairs: **0/4**; same-work token change **unavailable**. No eligible pair means null, not zero savings.

### Every fixed attempt

- **R1 B Helm:** `failed`; whole-task FAIL; F2P **0/5**, P2P **2/2**; 729,568 tokens / 35 requests. Successful edits 0; first edit tool none; terminal code `MODEL_CONTEXT_LIMIT`.
- **R1 C Helm:** `failed`; whole-task FAIL; F2P **0/5**, P2P **2/2**; 698,149 tokens / 42 requests. Successful edits 0; first edit tool none; terminal code `MODEL_CONTEXT_LIMIT`.
- **R1 C mnamer:** `completed`; whole-task FAIL; F2P **48/51**, P2P **319/319**; 793,633 tokens / 46 requests. Successful edits 17; first edit tool 17; terminal code `none`.
- **R1 B mnamer:** `completed`; whole-task PASS; F2P **51/51**, P2P **319/319**; 512,083 tokens / 27 requests. Successful edits 7; first edit tool 7; terminal code `none`.
- **R2 C Helm:** `failed`; whole-task FAIL; F2P **0/5**, P2P **2/2**; 536,127 tokens / 28 requests. Successful edits 0; first edit tool none; terminal code `MODEL_CONTEXT_LIMIT`.
- **R2 B Helm:** `failed`; whole-task FAIL; F2P **0/5**, P2P **2/2**; 345,891 tokens / 22 requests. Successful edits 0; first edit tool none; terminal code `MODEL_CONTEXT_LIMIT`.
- **R2 B mnamer:** `completed`; whole-task FAIL; F2P **48/51**, P2P **319/319**; 492,559 tokens / 32 requests. Successful edits 8; first edit tool 13; terminal code `none`.
- **R2 C mnamer:** `completed`; whole-task FAIL; F2P **50/51**, P2P **312/319**; 811,199 tokens / 44 requests. Successful edits 14; first edit tool 6; terminal code `none`.

F2P/P2P values are official verifier report items, not independent tasks. Internally completed attempts with 48/51 or other incomplete F2P coverage remain whole-task failures. Self-authored/public tests are useful feedback, not a replacement for the independent verifier.

## What changed relative to the old 4K profile

These comparisons use the same source identities, task instructions and starting commits, but output allowance, derived thinking budget, request deadline and control allocation changed together. Repeats are independent and unseeded. Percentages below describe consumption under different profiles, not an isolated output-cap effect or general coding improvement.

- **B:** whole-task acceptance **0/4 → 1/4**; provider tokens **4,440,517 → 2,080,101** (-53.16% raw consumption). Acceptance change +25 percentage points.
- **C:** whole-task acceptance **1/4 → 0/4**; provider tokens **2,720,007 → 2,839,108** (+4.38% raw consumption). Acceptance change -25 percentage points.

## Runtime findings

### 1. Larger output was actually used

The parameter probe succeeded, and **4 task responses exceeded the old 4,096-token cap**. The largest measured response produced **7,505 output tokens**. The longest submitted request took **344.678 seconds**. Every request's actual upstream model/thinking/effort/stream/output controls is audited against the native ledger. This does not assert that a full 131,072-token generation was tested.

Task output-limit events: **0**; malformed tool-JSON terminal failures: **0**. Compare with two explicit task output-limit events and one tool-JSON failure in the old 4K round. The new observation does not isolate output cap from the other shared controls or stochastic trajectories.

### 2. Fixed output reservation exposed a local input bottleneck

All **4/4 Helm attempts** stopped at the local `MODEL_CONTEXT_LIMIT`, before successful edits. This is TEA's scheduling guard, not a provider response saying the model's context was exhausted.

`src/context-budget.mjs` reserves the entire configured output allowance on each request:

```text
old input allowance = 216,000 -   4,096 - 4,096 = 207,808
new input allowance = 216,000 - 131,072 - 4,096 =  80,832
```

The input allowance falls **61.10%**. The automatic estimated-input trigger falls from **166,246 to 64,665**. A 32,000-byte ContextOS projection target is a separate soft target; protected content can prevent achieving it. Local estimates are not provider-token measurements. Increasing only the maximum output does not make the local total window larger.

### 3. Summary output remained separately capped

Across the schedule, the agent submitted **5 compaction requests**, adopted **1** checkpoint, and recorded **4** summary `max_tokens` events. Ordinary task maximum 131,072 did not raise the summary's explicit **1,200-token** override. Rejected incomplete summaries leave history intact. Subsequent context guards can end the agent instead of producing a repairable tool error.

The individual rejection details, adopted counts and numeric terminal budgets are in `results.json`. A failed summary is not an accepted checkpoint; a successful earlier checkpoint does not imply later requests fit.

### 4. Ordinary test repair works; full requirement coverage remains incomplete

The first candidate mnamer trace exercised real feedback: its self-authored pytest suite initially failed, the agent continued editing and reran it to 16 passes, and local tests passed. Official acceptance was still 48/51 + 319/319. Normal test failure did not end that attempt. Other cases' exact grades are retained above; internal completion and self-tests do not prove whole-task correctness.

### 5. A narrow passing test erased an unresolved broad failure

The last candidate attempt has a stronger, directly observed validation defect. Its model-visible broad command `python -m pytest tests/local -q` reported **7 failed, 320 passed** at tool calls **42 and 53**. It subsequently ran only `tests/local/test_daemon.py` at call **55**, obtaining **17 passed**. TEA then returned `completed` with `validationPassed: true`, despite the unresolved broad failures. The official verifier reported **50/51 F2P and 312/319 P2P**, including seven existing-behavior regressions.

[Sanitized command/grade evidence](validation-scope-diagnostic.json) contains actual tool numbers and numeric summaries, with no hidden test source or expected solution. The shared controller assigns its global validation flag from the latest validating command ([source](../../../src/agent.mjs#L389)); it does not require outstanding broader failures to be resolved before completion. This controller is identical in the frozen B/C versions, so the gap was not introduced by the resident-evidence patch. The concrete candidate artifact still failed the acceptance gate.

This is not merely a hidden requirement the agent never saw: known public test failures were delivered to the agent and later masked by a narrower success. It is a priority repair item before claiming dependable completion.

Residual command restrictions, including blocked `grep` regular-expression invocations, were retained in both arms. No mid-run permission or recovery change was made.

## Accounting and interpretation

All 276 native/relay request counts, hashes, usage, terminal events and shared model controls reconcile.

- **B:** input including cache 2,038,943, output 41,158; cache reads 254,144, writes 0. Control-rate estimate 1.7463968 USD, not an invoice.
- **C:** input including cache 2,782,022, output 57,086; cache reads 551,040, writes 0. Control-rate estimate 2.3854584 USD, not an invoice.

Cache input is included once; separately unreported reasoning is not added again to output. The compatibility probe's 35 tokens are separate from all main totals. Old-round consumption and its unresolved 5 USD reservation are not pooled into this new comparison. All failures remain recorded; no ad hoc paid retries or extra samples were added.

Short `read_file` receipts across all attempts: B **0**, C **0**. Narrow controlled reuse savings from the separate earlier six-completion experiment are not pooled into these autonomous outcomes. Identical initial request hashes and normalized first tool actions are recorded for audit; opaque full response hashes include variable envelope fields and must not be treated as semantic equality/difference evidence.

## Assessment and disposition

**The 128K parameter works, but fixed full-output reservation with a 216K local window is not a successful general solution to early termination.** The same configuration repeatedly moved the failure boundary to local context protection; summary truncation and incomplete requirement coverage remain.

This cohort does not pass a claim of stable autonomous token/coding improvement for the resident-evidence change. Report its exact acceptance and consumption, including adverse pairs. The previously proven evidence-correctness repair and controlled reuse experiment remain separate evidence; this round adds no production optimization to adopt or revert. The explicitly requested personal output ceiling is not silently rolled back.

Recommended next review items are: retain unresolved validation failures so a narrow success cannot clear a broader failure; distinguish the maximum allowed output from per-request reserved output; make compaction budgeting/recovery reliable; and verify public task requirements before self-reporting completion. Those changes were not implemented or paid-tested in this protocol. No PR was merged; stop for user review.
