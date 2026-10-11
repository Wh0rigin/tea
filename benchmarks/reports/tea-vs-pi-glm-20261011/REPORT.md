# TEA / Pi token comparison

Run: tea-pi-glm-isolated-20261011

Period: 2026-10-11T04:54:54.307Z to 2026-10-11T05:05:22.092Z.

Model: glm-5.3-flash; thinking: enabled/low; output cap: 4096 tokens.

Pi: 0.87.1; TEA source SHA-256: fba9a98ced61424549dc4a0a5ed44eaad739fce6555c2007d3a67c444a0df9e6.

self-authored JavaScript repository-size experiment; not real-world holdout

Token totals include uncached input, cache reads, cache writes and output. Reasoning is already included in output. Unknown usage is never counted as zero.

These are native agent configurations with different prompts and tool APIs. Cache directives are retained. Provider cache state cannot be reset through this harness; alternating order reduces a consistent order advantage.

## Integrity

Recorded controls, initial snapshots and token sums agree.

## Coverage and acceptance

Measured pairs: 9/9. TEA accepted: 9/9; Pi accepted: 7/9. Both accepted: 7.

All planned pairs, including failed tasks: TEA token reduction = -4.49%.

Subset where both agents passed: TEA token reduction = 25.44% across 7 pairs. This subset is not the whole experiment.

Repetitions per task: 1. Repeating the same three bug families at different repository sizes does not establish quality or savings on unseen production tasks. One repetition is a small exploratory sample.

## Runs

### small-cache-key-r1

12 files; 112 lines.

- tea: completed; acceptance passed; 5471 input + 207 output = 5678 tokens; 4 requests; 22.4 s.
- pi: completed; acceptance passed; 10490 input + 206 output = 10696 tokens; 5 requests; 23.6 s.

TEA token reduction: 46.91%.

### small-retry-budget-r1

12 files; 113 lines.

- tea: completed; acceptance passed; 6179 input + 269 output = 6448 tokens; 4 requests; 20.9 s.
- pi: completed; acceptance passed; 10909 input + 232 output = 11141 tokens; 5 requests; 29.1 s.

TEA token reduction: 42.12%.

### small-unicode-r1

12 files; 109 lines.

- tea: completed; acceptance passed; 27618 input + 1196 output = 28814 tokens; 14 requests; 84.3 s.
- pi: completed; acceptance passed; 17250 input + 356 output = 17606 tokens; 7 requests; 40.4 s.

TEA token reduction: -63.66%.

### medium-cache-key-r1

120 files; 1408 lines.

- tea: completed; acceptance passed; 5652 input + 289 output = 5941 tokens; 4 requests; 23.8 s.
- pi: completed; acceptance passed; 21472 input + 275 output = 21747 tokens; 8 requests; 43.0 s.

TEA token reduction: 72.68%.

### medium-retry-budget-r1

120 files; 1409 lines.

- tea: completed; acceptance passed; 5561 input + 236 output = 5797 tokens; 4 requests; 17.5 s.
- pi: completed; acceptance passed; 30881 input + 306 output = 31187 tokens; 5 requests; 26.6 s.

TEA token reduction: 81.41%.

### medium-unicode-r1

120 files; 1405 lines.

- tea: completed; acceptance passed; 11979 input + 679 output = 12658 tokens; 7 requests; 45.5 s.
- pi: completed; acceptance passed; 30707 input + 280 output = 30987 tokens; 5 requests; 29.7 s.

TEA token reduction: 59.15%.

### large-cache-key-r1

1200 files; 14368 lines.

- tea: completed; acceptance passed; 31871 input + 255 output = 32126 tokens; 7 requests; 41.4 s.
- pi: failed; acceptance failed; 1570 input + 91 output = 1661 tokens; 1 requests; 7.5 s.
  Guard: Input byte guard reached.

TEA token reduction: -1834.14%.

### large-retry-budget-r1

1200 files; 14369 lines.

- tea: completed; acceptance passed; 32902 input + 341 output = 33243 tokens; 8 requests; 42.3 s.
- pi: failed; acceptance failed; 21270 input + 92 output = 21362 tokens; 2 requests; 9.8 s.
  Guard: Input byte guard reached.

TEA token reduction: -55.62%.

### large-unicode-r1

1200 files; 14365 lines.

- tea: completed; acceptance passed; 37132 input + 445 output = 37577 tokens; 8 requests; 46.9 s.
- pi: completed; acceptance passed; 14309 input + 350 output = 14659 tokens; 7 requests; 38.3 s.

TEA token reduction: -156.34%.
