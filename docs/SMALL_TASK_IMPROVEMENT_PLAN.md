# TEA small-task token improvement plan

[中文](SMALL_TASK_IMPROVEMENT_PLAN.zh-CN.md)

Date: October 12, 2026. Status: S0 and S1 complete; S1 remains disabled by default awaiting review. S2–S5 are not implemented. [Measured S1 report](../benchmarks/reports/small-task-s1-glm-20261012/README.md), [zero-provider S0 report](../benchmarks/reports/small-task-s0-20261012/README.md).

## Objective and baseline

Reduce unnecessary provider requests while preserving code correctness, task obligations and native completion. Initial baseline is `97e8d5bdcd7e8e339247ad5ffb659bbb9c7683d9`; the prior paid default-quota engine was `b37322f`. Later commits only add reports/plots. Record both identities.

Historical small-task totals were TEA/Pi 155,754/102,293 tokens and 79/46 requests. There were 21 denied shell calls, 20 after public validation passed. One pair contributed 90.63% of net extra tokens. These observations select a problem, not a fresh paired baseline. [Diagnosis](../benchmarks/reports/contextos-c-vs-pi-small-diagnosis-20261012/README.md).

First experimental target: at least **10% fewer all-attempt small-task provider tokens versus the direct parent**, with fewer repeated capability denials. This is a target, not a savings forecast. Rerun each candidate's actual parent; preserve prior failures, costs and acceptance.

## Sequence

S0 evaluation/recording → S1 capability/error feedback → S2 structured supplemental validation → S3 progress/completion → S4 versioned patch receipts → S5 generalization and combined confirmation.

Develop and measure each separately. Reject and roll back a failed runtime change, retain its evidence, and reassess the next direction. Accepted work can become the next parent; compare the final combination to the initial baseline as well.

## S0 — evaluation and recording

- Extend the paired harness to load named baseline/candidate Git revisions, separately frozen under a shared gateway, controls, initial snapshots and acceptance version. S0 implements this for TEA commits exposing the supported native session APIs.
- Record sanitized executable/argument information, command hashes, authorization outcomes, exit/completion status and source versions. Full sensitive content stays in encrypted local storage.
- Report independent code acceptance, scope, user obligations, native post-edit validation, native completion and complete usage separately.
- Replace overly narrow native-test recognition with positive completion evidence covering relative/space-containing paths, argument order and actual scripts. Unknown remains unconfirmed; neither command text nor exit code alone establishes valid tests.
- Retain hidden completion witnesses and full settled read checks. Freeze the new acceptance version before both arms run; do not rewrite old results.
- Freeze S5's independent task manifest before tuning prompts/code, and identify actually runnable language environments.

Areas: [paired harness](../scripts/compare-contextos-pi.mjs), [turn audit](../src/comparison-turn-audit.mjs), [report](../src/comparison-report.mjs), [independent acceptance](../src/contextos-benchmark.mjs).

Completed checks cover nonzero exit, zero tests, early exit, missing tests, stale validation, partial reads and unknown billing, plus actual-client loopback contracts. S0 delivers the frozen manifest/config/revision/acceptance package and zero-provider preflight. No token improvement claim at this stage.

S0 verification: 254/254 complete tests; 18/18 committed parent/candidate native contract tasks; both TEA/Pi client contracts; 20/20 fault preflights across five real upstream repositories. Constructed equivalent-command confirmation changes from 0/18 to 18/18 (+100 percentage points), not token savings. The future 60+42 configurations are prepared with zero paid Agent runs. [Frozen task manifest](../benchmarks/holdouts/small-task-v1.json).

## S1 — capabilities and actionable errors

Completed: candidate `efaca4129ae2ea1fe58510749ada7464439daff7` versus parent `c97b950`, 267/267 tests, 60 small + 42 protection runs, 1,062 known-usage requests. Small/medium/large provider tokens decrease 41.44%/37.11%/4.53%; long workflow increases 3.67%; full matrix saves 11.38%. Candidate full acceptance 51/51 versus 47/51, independent code 51/51 versus 50/51. Frozen scale-group gates pass. Retain opt-in `TEA_CAPABILITY_FEEDBACK=1`, disabled by default, awaiting review. Eleven small pairs increase tokens; large retry subgroup increases 5.19%. Grading effects and all negative outcomes remain explicit. [Complete evidence](../benchmarks/reports/small-task-s1-glm-20261012/README.md).

Hypothesis: explicit unavailable capabilities and usable alternatives reduce repeated rejected syntax variants.

- Declare platform, validation entry points, relative paths and approval availability at session start. Version capability changes and keep tool definitions stable during ordinary turns.
- Provide stable error categories, `retryable`, missing capabilities and permitted next steps. Distinguish capability denial, unavailable approval, invalid input, stale patch/source, test failure and transient execution faults.
- Change feedback only; preserve execution rights and stopping behavior to measure one factor.
- Use generic tool/platform categories, never fixture function names or task wording.

Areas: [tools](../src/tools.mjs), [agent](../src/agent.mjs), [persistence](../src/session-memory.mjs); extract capability/error modules if useful.

Future checks cover interactive/headless modes, user denial, resume, platform changes, invalid paths, signed protocol and spending. Unavailable execution must never become successful validation. Apply the matrix/gates below before keeping the change.

## S2 — structured supplemental validation

Hypothesis: approved boundary checks execute directly, reducing quotation failures and missing verification evidence.

- Introduce a `program/args/stdin` interface. The current underlying spawn already uses `shell:false`; improve the command-string protocol, filtering, argument parsing and capability negotiation.
- Bind authorization to executable, full arguments, workspace and script hash. Approval of a test entry point does not approve arbitrary inline execution. Headless execution without preauthorization remains unavailable.
- Use trusted executables, workspace-contained directories, sanitized environment, existing timeouts and process-tree cancellation. Handle Windows npm separately. Structured arguments are not an OS sandbox. [Node's official process documentation](https://github.com/nodejs/node/blob/v24.14.0/doc/api/child_process.md).
- Preserve the legacy interface and user test/scope constraints. Prefer portable test entry points.
- If a cohort adds preauthorized verification, use the same authorization policy in parent and candidate and label it separately. Continue disclosing native Pi permission differences.

Areas: tools, agent approval/state, [configuration](../src/config.mjs) and paired harness.

Future checks cover Windows/Ubuntu with Node 20/22/24; quotations, JS punctuation, space-containing paths, UTF-8, multiline stdin, failures, cancellation, denied/outside paths and changed approved content. Permission changes are sensitivity evidence, not silently attributed optimization.

## S3 — progress and completion

Hypothesis: separating capability failure from code failure prevents unsupported retries and unjustified source regressions.

- Group capability denials by capability, approval version and environment version. Editing source does not reset an unavailable execution capability.
- Group test/patch failures by target and source version; fresh evidence and genuine fixes allow useful retries.
- Initial fixed experiment policy: after two same-capability denials, give one actionable alternative notice; continued lack of capability/verification progress becomes restricted/incomplete. Freeze thresholds before paid calls.
- Track requirements, verification scope, source versions and provenance. Inference remains separate from observed tests; a green public test alone cannot complete the task.
- Further edits require outstanding requirements or new problem evidence. Capability denial is not failed-code evidence. Missing critical validation must be reported.
- Preserve valid repair chains, transient failures, cross-file work, new user requirements, external edits and restored permissions. Use deterministic state, not a new paid model judge.

Areas: agent loop, persistent state and [working-memory presentation](../src/context-assembler.mjs).

Future replay checks cover the Unicode recovery chain and legitimate multi-step repairs. Log continuation/restriction reasons. Lower tokens caused by skipped required work fail the quality gate.

## S4 — versioned patch and path feedback

Hypothesis: concise current-source evidence reduces stale patch errors and extra reads.

- Return path, before/after hashes, changed ranges, whether content changed and bounded current excerpts. Avoid whole-file output on large files.
- Patch mismatch explicitly requests a fresh read; receipts participate in provenance and invalidation.
- Clarify relative paths. If accepting absolute paths inside the workspace, normalize safely and reject outside/symlink escapes.
- Preserve validation for no-op patches as prevention. None occurred in the diagnosed worst run; do not claim this explains prior savings.

Areas: tools, agent validation invalidation, context dependencies and resume.

Future checks cover unique/missing/ambiguous matches, no-op edits, external changes, path casing/spaces and UTF-8. Count added receipt tokens and saved requests together; richer output is not automatically an improvement.

## S5 — generalization and combined confirmation

- Use at least 20 independent tasks frozen at S0 before tuning, drawn from at least five real open-source repositories with at most four tasks each, covering multiple-file work, JS/TS, Python and another runnable language. Three repeats and two arms produce **120 runs**.
- Pin repository commits, permission to use them and acceptance. Vary target complexity, not only unrelated file count.
- Include simple tasks with no capability denial, necessary extra validation, legitimate retries, resume/source changes and actual long sessions.
- Independent acceptance remains required. Confidential holdout claims require isolated controller/credentials; current self-authored unsandboxed fixtures are diagnostic only.
- Compare the final combination with the initial baseline and separately disable each retained change. Do not combine the best results from different stages.
- Run native Pi as an external reference afterwards, with disclosed rights and separately labeled profiles.

## Frozen matrix per candidate

First perform offline regression/protocol/resume/budget checks, including default full history, ContextOS and existing compaction compatibility, and the deterministic suite plus six CI jobs. S0's new evaluation checks have run; S1–S5 add and execute their own focused tests. Paid default-full-history confirmation is a separate profile, not mixed into the ContextOS matrix below.

1. Small pilot: 3 existing small configurations × 10 repeats × parent/candidate = **60 runs / 30 pairs**. Select all families.
2. If it passes: 6 medium/large configurations × 3 × 2 = **36 runs**; actual empty-start 30 full inspections plus repair × 3 × 2 = **6 runs**. Full candidate confirmation: **102 runs / 51 pairs**. Both long-session arms use 24 tools; do not insert older 10-tool results.
3. Then the 120-run unseen cohort and final Pi reference. Incomplete stages cannot establish a completed generalization gate.

Common GLM-5.3-flash, enabled/low, 4,096 output cap, 160,000 UTF-8-byte input guard, 24 tools/turn, 100 requests/run, 90-second request and 180-second turn timeout. Both TEA arms enable ContextOS at 32,000 bytes with model summaries off. Identical task/Git contents; alternate order; retain native caching and every failure.

Initial candidate suite cap: **USD 8**, **USD 1.40/run**. Configure verified account-group rates; estimates are not invoices. Fix a finite total cap for subsequent cohorts from settled observations before submission. Unknown usage retains full reservation and stops paid calls. Budget stops retain evidence and withhold incomplete all-pair ratios. No paid call is launched by this plan.

## Keep, investigate or reject

1. Code, scope, requirements, native validation and completion are separate quality metrics. Overall and protected-group completion cannot decline. New scope violations, skipped required verification or false success reject the candidate.
2. Investigate every parent-pass/candidate-fail pair; gains elsewhere do not explain it away. Any confirmation rerun preselects the full group, not failed-only or best-repeat selection.
3. Require at least **10% fewer all-attempt small-task provider tokens versus the direct parent**. Include cache input, reasoning, retries and failures. Below target remains experimental rather than default.
4. Medium/large/long aggregate tokens may not increase by more than **5%**; reject or isolate an explicit conditional strategy and retest.
5. **P95 latency increase above 10%** fails the performance gate under matched conditions. Report median/P95; tokens do not imply speed.
6. Report pair/family/overall/both-accepted results; use paired bootstrap 95% confirmation intervals clustered by independent task. Repeats are not separate projects. Unclear intervals mean unconfirmed gains and an optional candidate.
7. Roll back failed runtime changes while preserving records/costs, and choose the next evidence-supported direction. Lower reasoning, paid short-session summaries and higher tool quotas are not initial fallback optimizations.

## Deliverables and status

Each stage goes through a PR with its hypothesis/patch, actual verification, source/task/control identities, sanitized request evidence, positive/negative outcomes, PNG/SVG and limits. This plan is delivered with PR #3; merging/release follows repository maintenance policy.

- [x] S0 Evaluation and records (complete; stopped; provider token benefit unmeasured)
- [x] S1 Capability/error feedback (complete; disabled by default; awaiting review)
- [ ] S2 Structured validation
- [ ] S3 Progress/completion
- [ ] S4 Versioned receipts
- [ ] S5 Generalization/combined confirmation

Only frozen provider comparisons establish measured improvement percentages. Targets, offline bytes and scripted token counts must remain separately labeled.
