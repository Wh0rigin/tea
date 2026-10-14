# TEA automatic compaction and GC: provider token test

[中文](README.zh-CN.md)

## Result

The normal-workload optimization gate did **not** pass. The candidate used **6.54% more tokens** than its direct parent, despite both achieving 30/30 acceptance. Do not advertise this change as general token savings.

- Small (9 pairs): 82,320 → 74,194; **9.87% fewer**.
- Medium (9 pairs): 79,107 → 69,880; **11.66% fewer**.
- Large (9 pairs): 292,140 → 405,703; **38.87% more**.
- Long, 30 reads plus repair (3 pairs): 928,257 → 922,476; **0.62% fewer**.
- Overall (30 pairs): 1,381,824 → 1,472,253; **6.54% more**.

There were no compactions in these empty-start normal workloads. The decreases cannot be attributed to compaction or GC. Large cache-key tasks regressed in all three repetitions; Unicode had a high-cost candidate attempt (17 requests / 20 tools versus 6 / 6 for its paired baseline), also without compaction. Execution-path variation and changes outside the actual collection step remain confounded; this experiment does not establish the causal source of the regression.

## Threshold ablation

A separate, same-candidate experiment uses two scripted histories made by real read-only tools, with paid native repair and summary calls. Three repeats per history, off versus auto+GC; all 12 attempts accepted.

- Protected history above the trigger: 218,724 → 118,517 tokens; **45.81% fewer**, including 13,595 summary tokens across three summary calls. Each enabled run committed one compaction and performed GC.
- Evictable history projected below the trigger: 70,791 → 74,399; **5.10% more**, with zero summary calls on both arms. Do not attribute this difference to GC.

Example real GC: resident serialized history 61,737 → 21,205 bytes. This is not heap usage, disk reclamation or a token count. No committed artifacts were deleted. The pressure result measures the combined compaction+GC feature, not an independent token contribution of garbage collection.

## Controls and limits

GLM-5.3-flash; enabled thinking, low effort, 4,096 task output cap; same endpoint, initial fixtures and acceptance per pair. Provider totals include uncached input, cache read/write input and output including reasoning; summary calls count. No Pi or Claude calls. All 72 attempts accepted, all measured usage known. No retries or excluded failures. Old unknown reservations remain separate.

Natural baseline bdc06bc versus candidate 381a937, ContextOS on both; baseline compaction/GC off, candidate auto/auto. ContextOS target 32,000 bytes; request guard 160,000 bytes; suite cap USD 12, per-run USD 1.4, 100 requests per run, 300-second turn timeout. [Natural evidence](natural.json) includes full resolved revisions and source fingerprints.

Pressure: same 381a937 runtime; request guard 80,000 bytes, trigger 0.8, recent suffix 24,000 bytes, ContextOS target 32,000 bytes; suite cap USD 8, per-run USD 0.6, 24 requests per run, 300-second timeout. [Pressure evidence](pressure.json) includes exact hashes, seed manifests, ledger usage and collection events. Conservative accounted cost: USD 2.3431796 normal + USD 0.3989828 pressure; these are configured estimates, not invoices.

These are repeated self-authored JavaScript fixtures, not production holdouts. Fixed controls do not remove model randomness or provider-cache effects. Do not combine the two cohorts into one improvement percentage or append this candidate to an older three-agent chart.

## Reproduction

Normal: `node scripts/compare-contextos-pi.mjs --mode live --baseline-ref bdc06bc --candidate-ref 381a937 --candidate-auto-gc true --repeat 3 --timeout-ms 300000 --max-cost-usd 12 --run-id UNIQUE_ID`, with the stated model controls and private credentials in environment.

The archived [pressure harness](pressure-harness.mjs) was executed as `.tea/gc-pressure.mjs`; to reproduce, copy it to that path and run `node .tea/gc-pressure.mjs prepare NEW_OUTPUT`, inspect the frozen plan, then `live NEW_OUTPUT`. Its source fingerprint includes that harness path. Set `TEA_MAX_REQUEST_INPUT_TOKENS=80000`, model/thinking/effort/output/tool/timeout/rate/stream settings to match pressure.json. Never reuse an existing paid output or silently retry unknown usage.

The native revision loopback contract passed 18/18 runs and 72 requests without provider calls before the paid experiment. Runtime deterministic coverage remains 298/298 from the feature verification. Await review; the overall token gate failed.

[Post-hoc large-task diagnosis and proposed fixes (Chinese)](LARGE_ANALYSIS.zh-CN.md)
