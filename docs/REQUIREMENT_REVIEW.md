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

Enabled mode can add one immediate model request plus any diagnostics, edits and validation the model chooses; the follow-up itself may enter normal compaction and existing request/cost guards. There is no separate free review model. True token cost and accuracy effects have not been measured.

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
