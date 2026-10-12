# S1a: shorter resident capability notice

Status: implementation candidate; not yet measured. This is proposal 1 from the long-session diagnosis, not S2. Stop after this experiment for maintainer review.

## Hypothesis and scope

The original S1 notice is pinned in the first user message and appears in every assembled request. Reducing its wording can lower repeated input while retaining S1's denial guidance. Frozen parent: `eb39591bd7e6fcee354a5ee660abb356c936c701`. The candidate differs in notice wording and a presentation version, with related tests and this protocol. Command filters, tool definitions, failure feedback, memory selection, execution order, validation and stopping rules remain identical.

Windows/headless notice text is **699 → 398 UTF-8 bytes (43.06% fewer bytes)**. This is not provider token savings. Keep relative paths, common validation forms, installed-runner qualification, quoted shell-operator restrictions, Windows limitations, approval availability, refusal semantics, unverified checks and denial-versus-source distinction. Add `noticeVersion: 2` to the capability identity so a resumed old session announces the new format once. Its original full notice remains historical user text; expiry is proposal 2 and is outside this experiment.

## Frozen comparison

Use the unchanged native revision comparison harness and `native-positive-validation-v3` acceptance. Freeze a clean candidate Git commit and source hashes before any paid request. Save all task identities, prompts, source/harness hashes and this protocol in the private preflight specification.

- Both arms: requested GLM-5.3-flash, Anthropic Messages API, enabled thinking, low effort, output cap 4096, ContextOS target 32,000 bytes, v1 inventory, semantic summaries off and capability feedback on.
- Native tool cap 24/turn, 100 requests/run, 90-second request and 180-second turn timeout, input-byte guard 160,000. No interactive approval.
- Fixed cohorts: **six long-workflow pairs (12 runs)**; **ten repeats of each of three small task families (60 runs)**; **three repeats of each medium/large family (36 runs)**. Total **108 runs / 54 pairs**.
- Execute long, small, then medium/large cohorts. Within each cohort, the existing harness alternates arm order by repetition. All fixtures must match the prior S1 task hashes and prompts. Repeats measure variability, not independent projects.
- Finite shared conservative guard **USD 8**, per-run guard **USD 1.4**, input/output budget rates USD 0.80/2.80 per million; cache reads count at the full input rate for reservations. These rates are not a verified invoice.
- Preserve all attempts, failures, outliers, cache usage and reservations. Halt on unknown billing or an exhausted shared guard; do not silently retry or replace runs. Do not stop a valid fixed cohort based on interim favorable results.

## Decision rules fixed before live calls

Primary metric: all-attempt provider tokens in the long cohort, including all input/cache/output. Report the first 30 read-only turns and final repair separately.

Retain the candidate only when the complete known-usage, stable-source comparison meets all of:

1. Long total tokens decrease, and read-only-phase total tokens decrease.
2. The diagnostic paired-repeat bootstrap 95% lower bound for long token reduction is above zero (10,000 samples, seed 20261012). This establishes confidence only within this one workflow.
3. Small, medium and large scale totals do not increase relative to the current S1 parent. No arbitrary 10% incremental improvement is required for this small wording change.
4. No paired quality dimension declines; candidate scope passes in every run; candidate acceptance is no lower per task family. Keep frozen conservative validation grades unchanged.
5. Per-cohort P95 latency regression does not exceed 10%.

Report denials, failed patches, tool/request counts, output verbosity, and paired negative results as explanatory diagnostics. All gates use the frozen rules even when model variance might explain a failure. If the candidate fails, restore parent runtime/tests through a new revert commit and retain the complete failed evidence. Do not automatically move to proposals 5, 3 or 4.

## Verification and limitations

Run targeted notice/legacy-resume tests, the full deterministic suite, exact default-off parent request parity and the actual dual-revision local contract before paid calls. Local scripted token counts do not measure provider gains.

This remains three self-authored JavaScript bug families, unrelated-file size pressure and one repeated-reading workflow. No new Pi comparison or unseen-project Agent result is claimed. Broader memory quality and capability-transition experiments remain necessary for later proposals.
