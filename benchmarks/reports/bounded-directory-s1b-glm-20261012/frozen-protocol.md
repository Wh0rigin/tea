# S1b: bound the historical reference directory

This is proposal 5 in the previously agreed sequence, after rejected S1a (proposal 1). Stop after this experiment for the user's review. Do not begin assistant reply compaction, tool batching or S2 automatically.

## Hypothesis and patch

Baseline is `d40056a66212c6e901f09254f5949bd78dc31694`, including restored full S1 capability guidance. Change only `src/context-assembler.mjs`: directories larger than eight entries show the latest eight complete entries plus an explicit `search_history` discovery route. Smaller directories retain exact original wording and entries. Canonical history, reference IDs, search indexing, recall pagination, source freshness, signed assistant blocks, protected/recent/active evidence, failure logs, obligations and permissions remain unchanged. Existing goal/changed-file protection keeps active source resident; there is no new domain vocabulary or keyword classification.

Record directory total/shown/omitted counts. No new model request or summarizer is added by the implementation. Subsequent recovery requests, including searches due to omitted entries, count in provider totals. Entry count is bounded; arbitrary path lengths are not claimed to have a byte bound. Full history still occupies local RAM/disk.

## Frozen paired experiment

Freeze the implementation commit after offline checks, then record the exact manifest before paid calls. Same GLM-5.3-flash, enabled thinking, low effort, output cap 4096, Anthropic Messages streaming, S1 capability feedback enabled, ContextOS target 32,000 bytes, v1 inventory, summaries off and headless approval on both sides. No new Pi comparison.

Core matrix is unchanged from S1a: six long-session pairs (12 runs), ten repeats of three small families (60), three repeats of six medium/large tasks (36): 108 runs / 54 pairs. All core tasks start empty; same initial snapshots and prompts as S1a. Alternate native arm order using the existing runner. Add a separate six-pair historical-receipt diagnostic (12 runs): identical shared scripted real tool outputs, then paid native retrieval and repair. Scripted seed construction is unbilled and is never represented as an empty-start workflow or production holdout. Its results remain separately reported.

Total 120 runs / 60 pairs. Total conservative cost guard USD 8 across all cohorts, per-run USD 1.4, 100 requests per run, 24 tools per turn, request timeout 90 seconds, turn timeout 180 seconds, 160,000-byte request guard. Conservative rates USD 0.80 input / 2.80 output per million; cache input counts at full price for guards. These are user-supplied conservative assumptions, not an invoice. Halt on unknown billing or limits; retain all attempts and outstanding liabilities; no silent paid retry or replacement attempt.

## Gates declared before measurement

- All fixed cohorts complete, provider usage known, native/gateway controls and hashes matched, engine/harness sources stable.
- Long-session total and read-only provider tokens decrease. Paired repeat bootstrap (10,000 samples, seed 20261012) 95% lower savings bound exceeds zero. Six repeats of one self-authored workflow are not six independent projects.
- No aggregate provider token increase in each small, medium or large scale, or the separate recovery diagnostic. Report all individual regressions and failures even when aggregates pass.
- No paired decline in any frozen quality dimension; all candidate scopes pass. Recovery must preserve the actual old observation, use retrieval and avoid rerunning or reading the old test file.
- Per-cohort P95 elapsed time increase at most 10%, including recovery.
- Offline Unicode/search/recall/freshness/resume/protocol checks and full deterministic suite pass. Compare request equality on unaffected projections and exercise over-eight directories and omitted-record recovery.

Keep the candidate only if every gate passes. Otherwise revert its runtime changes, retain sanitized evidence and explain whether failure is token cost, quality, latency, correctness or incomplete measurement. Never rewrite acceptance rules after observing a result.
