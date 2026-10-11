# Conversation compaction validation — 2026-10-11

[中文](README.zh-CN.md)

## Follow-up

This is the preserved first experiment on engine `100c83d`. Workflow repeat 1 submitted no summary: the retention algorithm tried to reach a recent-byte minimum by adding one oversized older complete tool batch, leaving no useful prefix to summarize. A deterministic regression reproduced that boundary failure. Engine `531cad7` retains the newest complete group and adds older groups only when they fit the target. The [complete paired re-run](../compaction-glm-20261011/README.md) records its results separately.

The first run spent $0.6327104; the re-run spent $0.6214348. Combined conservative spend was **$1.2541452**, within the shared $2.20 cap, with 32/32 accepted runs and no unknown usage. Percentages are not pooled across engines. Two repetitions with stochastic tool choices do not isolate a precise incremental percentage for the boundary fix. The test count below records offline coverage at the initial verification checkpoint; it does not change the paid engine identity.

## Results

- Scripted seed stress: 320,611 → 125,670 tokens; net savings **60.80%**; eligible pairs 6/6.
- Model-generated inspection → repair workflow: 180,006 → 143,066 tokens; net savings **20.52%**; eligible pairs 2/2.
- Acceptance: **16/16** runs passed public tests, independent hidden tests, edit scope and task completion. Unknown usage: 0.
- All summary requests are included in these totals, including rejected summaries. Conservative spend: **$0.632710**; this is not an invoice.

![Provider tokens including summaries](tokens.png)

## Individual cases

- **short-small-cache** (12 files, 112 lines, seed 2 bytes): 13,425 → 11,881; net savings 11.50%; repeats 27.70%, -11.17%; summary tokens 0; eligible 2/2.
- **source-medium-retry** (120 files, 1,409 lines, seed 51,495 bytes): 169,545 → 68,889; net savings 59.37%; repeats 55.06%, 62.93%; summary tokens 25,414; eligible 2/2.
- **inventory-large-unicode** (1,200 files, 14,365 lines, seed 52,566 bytes): 137,641 → 44,900; net savings 67.38%; repeats 67.53%, 67.23%; summary tokens 7,856; eligible 2/2.
- **workflow-large-retry** (1,200 files, 14,369 lines, seed 2 bytes): 180,006 → 143,066; net savings 20.52%; repeats 1.54%, 39.52%; summary tokens 5,545; eligible 2/2.

Pairs with no summary request: **short-small-cache/1, short-small-cache/2, workflow-large-retry/1**. Their token differences are stochastic variation and cannot be attributed to compaction.

## Method and reproducibility

Transport: non-streaming Anthropic Messages requests to `https://cf.api.fan/v1/messages`. The evidence records the endpoint fingerprint and shared controls; credentials are supplied only in process environment.

glm-5.3-flash; enabled thinking; low effort; coding output 4,096; summary output 1,200 (thinking budget 1,199); 80,000 UTF-8 wire bytes; trigger 0.35; recent retention 8,000 bytes; history full; v1 context; 2 attempts/turn; 18 tools/turn; 24 requests/run; 90 s/request; 300 s/turn; $0.30/run; $2.2000000 cap for this experiment.

Each pair starts from the same pinned Git commit and task prompts. Run order alternates off/auto then auto/off. No automatic retry; unknown billing retains the full reservation and stops the experiment. Cases contain 12, 120 or 1,200 files. Scripted setup executes real read-only tools and provides identical messages to both sides; **it is not a naturally model-generated conversation**. The workflow case uses a fresh session and pays for every model request from inventory inspection through repair; its inspection phase must leave source unchanged.

Input totals include ordinary, cache-read and cache-write input. Thinking already included in provider output is not added again. Byte reduction is never substituted for measured token savings. Successful-pair rates exclude failed, missing or unknown runs; those runs and their spend remain in [evidence.json](evidence.json) and the chart.

Engine commit `100c83d6c6acfe0cf46c802309ddf8bde043e467`; measured source hash `7efa99a58f079de5c25cf872feb6ee1927f91cad808dfbb9d7f371a4ff63fd9f` remained unchanged throughout the experiment. Initial fixture commits, seed hashes, prompts, controls, per-request usage, checkpoint/rejection records and acceptance hashes are in the public evidence. No keys, raw model messages or runtime workspace paths are published.

Re-run `npm test` for deterministic coverage. Set credentials and explicit rates in environment, plus the recorded profile, then run `node scripts/compare-compaction.mjs benchmarks/results/<new-directory>`. Export with `python scripts/report-compaction.py <comparison.json> <report-directory> <verified-full-suite-count>`; Matplotlib is required only for plotting. Existing output is never overwritten by the paid runner.

## Dedicated tests and limits

**40 new tests; full suite 168/168 passed on Windows / Node 24.14.0.** Coverage includes complete tool batches, malformed history, repeated and partial summaries, latest-user retention, retained thinking/signatures, Unicode excerpts, invalid/truncated/non-reducing summaries, source cache invalidation, cancellation before and during ledger commit, ledger failure, pending validation, /new, finite automatic attempts, shared adapter budgets, unknown billing, summary cache accounting and negative/failed experiment pairs.

This is eight paired measurements on self-authored JavaScript fixtures, with two repetitions per case and one model/provider. It does not establish long-session semantic retention, unseen real-repository generalization, or a comparison with Pi. The 35% threshold is an experimental setting; these figures do not measure the default 80% trigger. Automatic compaction remains opt-in. The output caps differ by purpose as recorded above, equally for every variant that submits that purpose. Actual latency and stochastic tool choices vary; token reductions need not imply lower latency. The short control never triggers a summary: its positive or negative differences are stochastic variation, not evidence of compaction benefit. Compact-tools interaction has not been measured live in this experiment.

Published rates were rechecked on 2026-10-11: [Packy pricing API](https://www.packyapi.ai/api/pricing), model ratio 0.4, completion ratio 3.5 and applicable group ratio 1, interpreted using [New API billing formulas](https://docs.newapi.pro/en/docs/guide/console/settings/rate-settings). Conservative rates are $0.80/$2.80 per million input/output; cache read receives no discount and cache creation uses twice input for budgeting.
