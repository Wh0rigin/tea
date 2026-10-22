# ContextOS evidence residency: stopped diagnostic pilot

## Outcome

**Mechanism regression tests pass; provider-token and coding-quality effects are inconclusive.**

The protocol planned two seen DeepSWE tasks × baseline/candidate × one attempt. The first baseline attempt stopped after an incomplete SSE response. Three planned attempts were never started, including both candidate attempts. There are no complete paired results and no token-saving percentage.

- Baseline source: `f03052a5b41453c206f9375bd5c004842cab0dc4` (shared command parsing, corrected benchmark approval/export).
- Candidate source: `778a54ff1773e51d4f1ca1211fda4249a1eb848c`.
- Only production variable: `src/context-assembler.mjs` retains read caches using exact current-version source ranges still visible in the final assembled request.
- Model: GLM-5.3-flash, enabled/low, streaming, output cap 4,096; local window 216,000; ContextOS target 32,000 bytes.
- Per attempt: 96 tools, 128 transport calls, 30 minutes, 5 USD control budget. Planned suite cap: 20 USD. Control rates are not an invoice.
- Both arms use the same task bases, corrected command policy, task instructions and artifact export. No hidden tests or reference solutions were supplied to the coding agent.

[Frozen protocol](protocol.json) · [Results](results.json) · [Offline lifecycle fixture](preflight.json) · [中文机制与验证说明](../../../docs/EVIDENCE_RESIDENCY_REVIEW.zh-CN.md)

## Actual paid attempt

Only baseline Helm ran:

- 20 submitted requests and 20 relay requests; **19 complete usage records, 1 partial record**.
- Runtime reported `Provider stream ended before the message_stop event` in the model stage. Relay reported a broken pipe. These observations do not establish which endpoint or network component caused the interruption.
- Whole-run provider tokens are **unknown**, with a reported lower bound of **398,005**. Unknown usage is not zero. Any ledger cost estimate includes uncertainty reservations and is not an actual charge.
- 36 tools, no successful source edits, no validation. Official separate verifier: fail-to-pass **0/5**, pass-to-pass **2/2**, complete-task reward **0**.
- Stop policy retained the **5 USD task reservation**, stopped the suite and made no automatic retry.
- Candidate Helm, candidate mnamer and baseline mnamer are **not started**, rather than failed or zero-token observations.

Neither all-attempt nor both-complete token ratios can be computed. This interrupted baseline does not establish a regression caused by the candidate, which was never executed against the real provider.

The baseline had 21 complete source outputs, including 10 duplicate complete same-range/same-version reads, plus truncated outputs. All occurred before any edit. Properly evicted source still needs to be retrieved; this patch does not implement task-progress control or a larger working set.

## Deterministic evidence

- Same 13 targeted cases against a clean exported baseline: **6 pass, 7 fail**; candidate: **13/13 pass**.
- Final Windows full suite: **393 pass, 1 Go-unavailable skip / 394**. Initial full-suite local gateway 502 preserved; isolated test and subsequent full reruns passed without changing gateway behavior or assertions.
- Original Linux task image, Node 24, network disabled: **394/394 pass**, no skips.
- Existing scripted runtime independent acceptance: **12/12**. Controlled replay completed. Neither is a model solving score.
- Actual Pier adapter fixture: **10 synthetic fragmented SSE responses and 9 real tool calls per arm**, zero provider calls. CLI execution, edit/read reuse, validation, commit/export and independent patch tests pass. Both produce the same patch SHA-256.
- Fixture read-output bytes: **19,464 → 13,309**. Cumulative serialized request bytes: **156,099 → 143,386** (**8.14% lower**). These are scripted byte measurements, not provider-token savings or predicted production gains.

The fixture's read-after-edit sequence reproduces the stale-old-version/new-resident-version bug. Separate tests ensure omitted source, unchanged receipts alone and truncated text cannot preserve complete-read caches, and that preview, compaction/GC and manual edits remain safe.

## Artifact metadata and limitations

During full Pier collection, its artifact inventory replaces `artifacts/manifest.json`. The analysis initially failed on that different schema. Export metadata was recovered from the finalizer stdout already captured in `agent/commit.json`; its patch hash was checked against the existing `model.patch`. No solution changes, model retry or new grading were performed. A future adapter should avoid the framework-reserved manifest filename; this frozen adapter was not changed during the attempt.

Both tasks are previously seen regressions. Even a completed two-pair pilot would not establish unseen-task generalization or a stable causal savings estimate. The mechanism patch remains a correctness candidate for review; no later optimization stage or unseen-task expansion was started.
