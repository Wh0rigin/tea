# B1: same-file batch replacements

## Hypothesis and scope

Borrow the interface idea from Pi 0.87.1: submit independent replacements in one file together and keep match text narrow. This implementation is written for TEA; no Pi code is copied. Baseline is `ffd07a1a0c6e57047486661e2936f02660011a11`. Only `src/tools.mjs` changes at runtime. S1b's rejected directory cap remains reverted. No patch receipt, new summarizer, model change, test omission, or automatic batching of model decisions is introduced.

`apply_patch` accepts either existing `path/search/replace` or `path/edits:[{search,replace}]` (1–64 entries). Batch matches refer to the original file; missing, ambiguous, duplicate and overlapping spans fail before writing. Replacements are assembled in memory and written once. This is validation-before-write, not a filesystem crash-atomic transaction. Legacy arguments and success text remain unchanged. Model-visible schema and description grow; this overhead is counted in measurements. Batch results contain a short count, not a diff. Existing path, storage, credential and post-edit validation policies remain in force.

Pi reference: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/tools/edit.ts

## Frozen experiment

Direct-parent native TEA A/B, not a new Pi comparison. Same self-authored cache-key, retry-budget and Unicode defects and fixture snapshots as previous experiments. Small: 10 repeats × 3 tasks × 2 arms = 60 runs. Medium/large: 3 repeats × 3 tasks × 2 scales × 2 arms = 36 runs. Actual 30-round long workflow: 3 repeats × 2 arms = 6 runs. Total 102 runs / 51 pairs. Each pair alternates arm order using the existing harness. Three defect families plus irrelevant-file scale expansion do not establish generalization across production projects. These fixtures may require only one replacement, so they can expose declaration overhead even when batching is unused; additionally test a deterministic multi-edit native loop for correctness, never count scripted tokens as savings.

Same GLM-5.3-flash, enabled thinking, low effort, 4096 output cap, Anthropic Messages streaming. ContextOS 32000 byte soft target, v1 inventory, summaries off, full history, capability feedback on, 24 tools/turn, 100 requests/run, 160000-byte request guard, 90-second request timeout, 180-second turn timeout. Conservative USD 8 combined / USD 1.40 per run; input/cache-read USD 0.80 and output USD 2.80 per million for accounting, not invoice rates. Freeze candidate, manifests and source identities before paid calls. Preserve every attempt, unknown usage and failure; never retry paid attempts silently.

## Decision fixed before paid calls

Use the existing small-task plan: require at least 10% aggregate small provider-token reduction; no paired quality dimension decline or new scope/false-completion failure; each protected scale and long cohort token increase at most 5%; each cohort P95 latency increase at most 10%; complete known usage and stable frozen sources. Show all attempts and per-family results. A positive point estimate below the target is exploratory, not a passed release gate. No adaptive reruns or retrospective gate changes. Reject and revert runtime if any gate fails, preserve code in Git history and evidence. Stop after reporting this candidate for user review; no next direction automatically.

Tests must cover no partial writes on failure, original-snapshot matching, mixed/invalid inputs, path restrictions, CRLF preservation, source freshness, old single-patch calls and pending validation after a batch. Full deterministic suite and frozen native protocol contract precede paid measurements.
