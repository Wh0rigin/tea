# S0: evaluation and recording results

[中文](README.zh-CN.md) · [Sanitized data](summary.json) · [Protocol](../../../docs/REVISION_COMPARISON.md) · [Stage plan](../../../docs/SMALL_TASK_IMPROVEMENT_PLAN.md)

October 12, 2026. **S0 is complete. Stop here; S1–S5 are not implemented.**

## Result

Evaluation improved in the constructed checks. **Provider token reduction and
provider latency change are unmeasured; paid provider requests: 0.** S0 changes
the external harness rather than Agent prompts, rights, memory or stopping rules.
The 23 existing noncomparison source modules are byte-identical between direct
parent `ccc0d449371d9edd488b5e1c39cad7eb3fedf917` and implementation
`bc3d769cb5903e8a4f2230e1439ea024c109cae5`.

Constructed positive-output replay of the two equivalent commands used in the
native contract improves confirmation from **0/18 to 18/18 (+100 percentage
points)**. This is recognition of two command variants across three fixture
families and three repeats, not token savings or an estimate of general accuracy.
Final native contract acceptance and each quality dimension are **9/9 per arm**.
No quality regression was observed in this cohort. The identical 5,040 tokens per
arm are scripted values, not a measured 0% provider result.

![Evaluation checks, not provider performance](s0-checks.png)

The observer adds bounded local source reads/hashes: 228.32 ms across 18 turns,
maximum cumulative 15.69 ms in a turn. It adds no model message or request. These
event-observer timings are not a provider latency benchmark or speed improvement.

## Changes

- Native parent/candidate engines extracted from committed regular Git files,
  with per-file/aggregate hashes and separate harness identity; no Pi dependency
  for revision comparisons, no checkout/reset or setup scripts.
- Positive Node/npm validation recognition with quoted/relative paths and
  supported options. Actual passing counts, settled events and stable declared
  source are required; filtered, compound, zero-test, failed, incomplete or stale
  evidence remains unconfirmed. Duplicate/unmatched/pending events fail.
- Separate code correctness/completion witness, scope, declared reads, native
  post-edit validation, native completion and complete-usage dimensions.
- Sanitized program/argument shapes and hashes, observed approval/exit/timestamps
  and source versions. Missing exit/approval data stays unknown. No command body,
  test stdout or credential is published.
- Twenty fixed seeded faults on five pinned upstream repositories, with source,
  license, precise mutation and acceptance hashes, including a multiple-file
  implementation/type declaration repair. Future small/protected cohort settings
  are prepared independently; their paid executions have not started.

## Verification and retained attempts

- **254/254 deterministic tests, no skips**; 17 added to the prior 237.
- **18 frozen-engine native runs / 72 scripted SSE requests**; all accepted,
  common controls matched, sources stable, actual provider ratios withheld.
  [Per-run contract evidence](native-contract.json).
- Actual TEA/Pi print-mode contract: 8 scripted requests; three-turn RPC contract:
  16. Full settled reads, conversation reuse, real patches and post-edit tests pass.
  These are not a new paid Pi comparison.
- **20/20 task preflights**: 21 original checks pass and all 21 fault checks fail,
  42 process executions. Node 24.14.0, Python 3.13.9, Go 1.24.0 and TypeScript 5.9.3
  actually executed. [Preflight](holdout-preflight.json), [manifest](../../holdouts/small-task-v1.json).
- Ten initial fixtures pass public/scope checks and complete hidden witnesses
  that detect their faults. The 60-run small and 42-run protected configurations
  are prepared with **zero actual Agent runs**. [Preparation](cohort-prepares.json).

Two earlier development contracts also passed 18/18; all three attempts are
retained in `summary.json`, not pooled as independent provider samples. A new
remote-contract guard test initially omitted its required finite budget, producing
253/254. Correcting the test setup yields the final 254/254; budget protection
was not relaxed.

## Controls and limits

Acceptance: `native-positive-validation-v3`. GLM-5.3-flash requested controls:
enabled/low, 4,096 output, 24 tools, 100 requests per run, 160,000 UTF-8 input-byte
guard, 90-second request and 180-second turn timeout. S0 uses a scripted loopback
server. Future paid cohorts still require declared finite costs, retained failures
and unknown reservations.

Historical paid records and acceptance are unchanged. This command replay cannot
promote old unconfirmed Pi runs because their raw commands were not retained.
The native recognizer currently covers Node/npm; Python/Go native adapters and
equal authorization must be implemented before paid S5. Public self-authored
faults on real source are diagnostic holdouts without OS isolation, not naturally
occurring upstream bugs or confidential evaluation. Preflight success is not an
Agent success rate. Source observation happens at event receipt, not atomically
inside the native process. Hashes do not establish script semantics; declared
read checks do not prove all natural-language obligations.

**Keep S0's evaluation changes and stop.** S1 will measure a separate capability/
error-feedback candidate against its actual parent. Keep runtime changes only
after passing the plan's quality, actual token and latency gates.
