# Conversation compaction validation — 2026-10-11

[中文](README.zh-CN.md)

## Experiment history and tested versions

The [first experiment](../compaction-glm-20261011-initial/README.md) is preserved, including a workflow repetition that could not advance the retained boundary. This complete re-run measures the retention fix in engine `531cad7`. The re-run cap was the remaining **$1.5672896** of a shared $2.20 budget. Combined spend was **$1.2541452**, with 32/32 accepted runs and no unknown usage. Results from different engines are reported separately.

After paid measurements finished, stronger Unicode regression coverage found broken UTF-8 tail boundaries and removal of valid literal U+FFFD characters. Commit `43be04c` fixes those boundaries and passed the full 169-test offline suite. It has **not** been remeasured with the paid model; the percentages below belong to engine `531cad7`. The original transcripts remain intact. Retained newest groups may still exceed the target, and non-reducing summaries are rejected with their costs included.

## Results

- Scripted seed stress: 390,660 → 108,096 tokens; net savings **72.33%**; eligible pairs 6/6.
- Model-generated inspection → repair workflow: 185,255 → 68,290 tokens; net savings **63.14%**; eligible pairs 2/2.
- Acceptance: **16/16** runs passed public tests, independent hidden tests, edit scope and task completion. Unknown usage: 0.
- All summary requests are included in these totals, including rejected summaries. Conservative spend: **$0.621435**; this is not an invoice.

![Provider tokens including summaries](tokens.png)

## Individual cases

- **short-small-cache** (12 files, 112 lines, seed 2 bytes): 11,623 → 11,423; net savings 1.72%; repeats -0.14%, 3.53%; summary tokens 0; eligible 2/2.
- **source-medium-retry** (120 files, 1,409 lines, seed 51,495 bytes): 153,089 → 72,372; net savings 52.73%; repeats 48.14%, 57.24%; summary tokens 26,116; eligible 2/2.
- **inventory-large-unicode** (1,200 files, 14,365 lines, seed 52,566 bytes): 225,948 → 24,301; net savings 89.24%; repeats 90.20%, 88.13%; summary tokens 9,188; eligible 2/2.
- **workflow-large-retry** (1,200 files, 14,369 lines, seed 2 bytes): 185,255 → 68,290; net savings 63.14%; repeats 60.74%, 65.34%; summary tokens 12,417; eligible 2/2.

Pairs with no summary request: **short-small-cache/1, short-small-cache/2**. Their token differences are stochastic variation and cannot be attributed to compaction.

## Method and reproducibility

Transport: non-streaming Anthropic Messages requests to `https://cf.api.fan/v1/messages`. The evidence records the endpoint fingerprint and shared controls; credentials are supplied only in process environment.

glm-5.3-flash; enabled thinking; low effort; coding output 4,096; summary output 1,200 (thinking budget 1,199); 80,000 UTF-8 wire bytes; trigger 0.35; recent retention 8,000 bytes; history full; v1 context; 2 attempts/turn; 18 tools/turn; 24 requests/run; 90 s/request; 300 s/turn; $0.30/run; $1.5672896 cap for this experiment.

Each pair starts from the same pinned Git commit and task prompts. Run order alternates off/auto then auto/off. No automatic retry; unknown billing retains the full reservation and stops the experiment. Cases contain 12, 120 or 1,200 files. Scripted setup executes real read-only tools and provides identical messages to both sides; **it is not a naturally model-generated conversation**. The workflow case uses a fresh session and pays for every model request from inventory inspection through repair; its inspection phase must leave source unchanged.

Input totals include ordinary, cache-read and cache-write input. Thinking already included in provider output is not added again. Byte reduction is never substituted for measured token savings. Successful-pair rates exclude failed, missing or unknown runs; those runs and their spend remain in [evidence.json](evidence.json) and the chart.

Engine commit `531cad7ad9bbf7779c4ea03ed3e59b5d08d3c86d`; measured source hash `b55070d4659d38bcbf81eb24d37b57936d91def8d258a985c45c9e34ed62d43e` remained unchanged throughout the experiment. Initial fixture commits, seed hashes, prompts, controls, per-request usage, checkpoint/rejection records and acceptance hashes are in the public evidence. No keys, raw model messages or runtime workspace paths are published.

Re-run `npm test` for deterministic coverage. Set credentials and explicit rates in environment, plus the recorded profile, then run `node scripts/compare-compaction.mjs benchmarks/results/<new-directory>`. Export with `python scripts/report-compaction.py <comparison.json> <report-directory> <verified-full-suite-count>`; Matplotlib is required only for plotting. Existing output is never overwritten by the paid runner.

## Dedicated tests and limits

**41 new tests; full suite 169/169 passed on Windows / Node 24.14.0.** Coverage includes complete tool batches, malformed history, repeated and partial summaries, latest-user retention, retained thinking/signatures, Unicode excerpts, invalid/truncated/non-reducing summaries, source cache invalidation, cancellation before and during ledger commit, ledger failure, pending validation, /new, finite automatic attempts, shared adapter budgets, unknown billing, summary cache accounting and negative/failed experiment pairs.

This is eight paired measurements on self-authored JavaScript fixtures, with two repetitions per case and one model/provider. It does not establish long-session semantic retention, unseen real-repository generalization, or a comparison with Pi. The 35% threshold is an experimental setting; these figures do not measure the default 80% trigger. Automatic compaction remains opt-in. The output caps differ by purpose as recorded above, equally for every variant that submits that purpose. Actual latency and stochastic tool choices vary; token reductions need not imply lower latency. The short control never triggers a summary: its positive or negative differences are stochastic variation, not evidence of compaction benefit. Compact-tools interaction has not been measured live in this experiment.

Published rates were rechecked on 2026-10-11: [Packy pricing API](https://www.packyapi.ai/api/pricing), model ratio 0.4, completion ratio 3.5 and applicable group ratio 1, interpreted using [New API billing formulas](https://docs.newapi.pro/en/docs/guide/console/settings/rate-settings). Conservative rates are $0.80/$2.80 per million input/output; cache read receives no discount and cache creation uses twice input for budgeting.
