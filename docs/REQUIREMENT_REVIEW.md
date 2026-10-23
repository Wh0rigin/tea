# Requirement evidence review (experimental)

## Purpose

Keep the complete `pr16-quality` model/context configuration and test one additional workflow mechanism. The historical remaining Mnamer failure passed 369/370 official checks: its local fixtures and manual preparation did not expose the custom state-directory/log interaction. Pi's two successful patches created state/log parents; a successful TEA patch did too. This evidence suggests a verification gap, not a demonstrated need to change compaction.

The existing system prompt already asks for observable outcomes and real entry-point checks. This experiment adds an actual, auditable review trigger rather than another always-present system instruction. No task names, hidden tests, expected repository patches or domain keyword lists appear in the runtime guidance.

## Behavior

Enable `requirementReview: true` in user configuration or `TEA_REQUIREMENT_REVIEW=1`. Default is **off**; the frozen 3/4 configuration stays intact. `/status` lists the enabled experiment as a profile override.

When an agent attempts to finish after an edit, or with outstanding validation, the runtime sends one bounded review message per turn:

- Map the original requested outcomes to existing executed checks and results; identify missing evidence.
- Check whether fixtures or tools performed work that belongs to the product.
- For a concrete uncovered interaction, exercise the real entry point from fresh inputs and inspect the actual persisted result.
- Derive expected locations/content from requirements independently of implementation helpers.
- Reuse sufficient evidence, repair supported defects and avoid speculative edits or repeated broad checks.

The message includes at most eight recent operation identifiers and bounded subjects, never copied tool outputs or private reasoning. These identifiers are navigation metadata, not passing assertions. Existing conversation evidence and its normal recall/freshness policies remain authoritative. Coverage claims are model assessments, not an automatically verified coverage matrix.

The trigger runs before pending-validation reminders, including when a failed command is unresolved. It replaces the first such reminder rather than adding another reminder cycle. It never clears validation obligations, changes acceptance thresholds or grants permissions. Later edits still invalidate prior passes.

No review is added to a read-only turn without pending work, disabled mode, a truncated final response, an aborted turn, unknown billing or an exhausted tool allowance. A resumed turn with pending work can request one new review. This is one review per turn, not a session-wide or persistent total limit.

## Observability and cost

`requirement_review_requested` is written to the ledger and emitted as an event. `contextDiagnostics.requirementReviewCount` records activation. Metadata collection is bounded and only occurs when enabled. The disabled variant adds no system/review prompt or model call.

Enabled mode can add one immediate model request plus any diagnostics, edits and validation the model chooses; the follow-up itself may enter normal compaction and existing request/cost guards. There is no separate free review model. The retry-aware paid screen below records actual follow-up cost, but net accuracy/token effects remain undetermined because transport failures interrupted the controls.

## Offline verification

The dedicated suite checks opt-in configuration and profile override reporting, once-only activation, pending failures, unchanged read-only/disabled flow, truncation/tool limits, bounded prompt size, post-review edit invalidation, persistent resume, cancellation and unknown billing.

A self-authored Node fixture uses real child processes. Its original unit test preconditions mask missing output-directory creation. Scripted tool choices add an independent CLI assertion: it first fails on a fresh missing output parent, then passes after a source repair and rerun. This demonstrates the mechanism and real test execution; it does **not** show that GLM autonomously detects the defect, reproduce DeepSWE scoring, or establish a correctness/token improvement.

Current verification: dedicated review suite 10/10, review plus frozen-profile suite 14/14; full regression 477 passed, one skipped, zero failed. All checks are offline.

## Initial paid attempt (interrupted)

The [authorized official-credential round](../benchmarks/reports/requirement-review-pr16-ab-deepswe-20261023-v2/README.md) stopped in its first baseline: seven complete requests totaled 43,004 provider tokens, then request eight returned `Internal Network Failure` without normal stream completion. Whole-attempt usage is unknown; seven planned attempts, including all candidates, were not started. This does not determine accuracy or token effect. The earlier HTTP401 credential failure is retained separately. The full frozen profile remains intact and review stays off.

## Next complete paid evaluation (pending; interrupted records retained)

1. Freeze one runtime archive and two explicit configurations, differing only in `requirementReview` (0/1). Assert every preserved PR16 algorithm/model setting and record full effective configuration hashes. Keep streaming and official GLM enabled/low.
2. Use the same original Helm/Mnamer snapshots and instructions; two balanced AB/BA paired repetitions per task (eight attempts). Do not reuse historical successes as newly measured controls. Historical Pi remains a behavioral reference; no Pi rerun is needed.
3. Freeze finite request/time/per-attempt/total cost controls before calls. Preserve failed attempts, unstarted tasks and unknown billing; do not retry until success or replace unknown usage with zero.
4. Record actual review activation and subsequent tool operations, official pass counts, native completion, regressions and provider token components for every attempt. Also report both-passed subsets separately.
5. Correctness is primary: target fixing the remaining omission without losing prior successes. No activation means no mechanism evidence; unchanged acceptance means no demonstrated quality gain. A 4/4 result would remain a small seen-task observation, not universal correctness. Default activation requires user review after this stage.

PR18 provides the full frozen quality profile; this change is built on that commit and does not merge the older S7 completion-review implementation.

## Retry-aware DeepSWE v3: interrupted, not an improvement claim

[Full report](../benchmarks/reports/pr19-r5-deepswe-20261023-v3/README.md) · [中文分析](../benchmarks/reports/pr19-r5-deepswe-20261023-v3/RESULTS.zh-CN.md)

Four of eight scheduled attempts ran. Both candidates activated review once, completed normally and passed official checks (Helm 7/7; Mnamer 370/370). Their complete measured total was 2,807,986 provider tokens for these two attempts. Both baseline totals remain unknown: Helm recovered one explicit Internal Network Failure and passed; Mnamer later timed out without stream completion before source editing, stopping the cohort. No fully metered paired comparison is available, and four attempts were not started.

Post-review requests consumed 599,152 tokens on Helm and 376,850 on Mnamer, including checks and test repair; these are observed follow-up costs, not causal net overhead estimates. Review generated additional checks, but no demonstrated net accuracy/token improvement follows from this interrupted screen. Keep default off and retain the complete PR16 profile. No Pi/Claude reruns and no replacement of earlier failed records.

Runtime archive: `46a475393e5afbe14edc3fdd54ab73ab208a07bf`. Protocol frozen before calls in `f12db59b9468ae6182e6344ba4a58b77bd7191ef`. Integration regression: 487 passed, one skipped, zero failed; all six Windows/Ubuntu Node 20/22/24 CI jobs passed.

## Four-attempt continuation: higher observed acceptance, higher tokens

[Continuation report](../benchmarks/reports/pr19-r5-deepswe-20261024-v4/README.md) · [中文](../benchmarks/reports/pr19-r5-deepswe-20261024-v4/RESULTS.zh-CN.md)

All four previously unstarted second-pair entries were evaluated under the same frozen runtime. Baseline accepted 0/2 tasks and candidate 1/2. Complete all-attempt provider tokens increased from 1,369,100 to 3,075,019 (**+124.60%**). No both-passed pair is available, and the baseline Helm attempt hit its input guard before editing. Candidate Helm failed official ordering checks despite local passes; Mnamer candidate passed 370/370 versus baseline 366/370. Neither candidate made product-source repairs after review, so causal quality benefit is unproven.

Review follow-up cost was 675,440 tokens on Helm and 103,305 on Mnamer. Both arms retained original PR16 settings, including 216k context, full output reservation and two compactions; no runtime edits were made during evaluation. The new cohort was frozen in 08b4849 before paid calls. Keep default off: this is not a demonstrated token optimization.

Across the two cohorts, the original eight entries have now been attempted, with candidate 3/4 versus baseline 1/4 on repeats of two seen tasks. Earlier transport failures and unknown usage remain; full baseline tokens and any combined token reduction are unknown. These counts must not be equated with the historical PR16 four-task result or advertised as causal improvement.
