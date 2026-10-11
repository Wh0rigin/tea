# TEA / Pi token comparison

Run: tea-pi-glm-large-80k-20261011

Period: 2026-10-11T05:05:34.028Z to 2026-10-11T05:09:53.141Z.

Model: glm-5.3-flash; thinking: enabled/low; output cap: 4096 tokens.

Pi: 0.87.1; TEA source SHA-256: fba9a98ced61424549dc4a0a5ed44eaad739fce6555c2007d3a67c444a0df9e6.

self-authored JavaScript repository-size experiment; not real-world holdout

Token totals include uncached input, cache reads, cache writes and output. Reasoning is already included in output. Unknown usage is never counted as zero.

These are native agent configurations with different prompts and tool APIs. Cache directives are retained. Provider cache state cannot be reset through this harness; alternating order reduces a consistent order advantage.

## Integrity

Recorded controls, initial snapshots and token sums agree.

## Coverage and acceptance

Measured pairs: 3/3. TEA accepted: 3/3; Pi accepted: 3/3. Both accepted: 3.

All planned pairs, including failed tasks: TEA token reduction = -8.78%.

Subset where both agents passed: TEA token reduction = -8.78% across 3 pairs. This subset is not the whole experiment.

Repetitions per task: 1. Repeating the same three bug families at different repository sizes does not establish quality or savings on unseen production tasks. One repetition is a small exploratory sample.

## Runs

### large-cache-key-r1

1200 files; 14368 lines.

- tea: completed; acceptance passed; 9678 input + 286 output = 9964 tokens; 6 requests; 35.7 s.
- pi: completed; acceptance passed; 81100 input + 301 output = 81401 tokens; 5 requests; 34.5 s.

TEA token reduction: 87.76%.

### large-retry-budget-r1

1200 files; 14369 lines.

- tea: completed; acceptance passed; 89398 input + 437 output = 89835 tokens; 11 requests; 64.6 s.
- pi: completed; acceptance passed; 9490 input + 297 output = 9787 tokens; 5 requests; 24.1 s.

TEA token reduction: -817.90%.

### large-unicode-r1

1200 files; 14365 lines.

- tea: completed; acceptance passed; 16856 input + 471 output = 17327 tokens; 9 requests; 42.6 s.
- pi: completed; acceptance passed; 16028 input + 458 output = 16486 tokens; 7 requests; 34.3 s.

TEA token reduction: -5.10%.
