# ContextOS and automatic compaction combination test

This tests existing runtime behavior without changing `src/`, defaults, permissions, retrieval policy or model settings. Automatic compaction remains off by default. Pi is not an experiment arm. B1's interrupted experiment and its unresolved reservation remain separate and are not retried.

## Four arms

- `full_off`: full history, automatic summary off.
- `full_auto`: full history, automatic summary on.
- `contextos_off`: ContextOS, automatic summary off.
- `contextos_auto`: ContextOS, automatic summary on.

GLM-5.3-flash, enabled/low thinking; task output 4096, native summary output 1200 (thinking budgets derived by the existing adapter). Same initial Git contents, exact seed transcript and repair prompt within each four-arm block. All summary requests, thinking output and cache input count toward provider totals. No estimates or scripted token values count as savings.

## Fixed cases and limits

Three self-authored JavaScript cases: empty-history small cache-key repair; medium retry repair after repeated real README reads (protected history); large Unicode repair after real inventory reads (evictable history). Pressure histories are scripted setup using actual read-only tools, not model-generated long conversations. Setup is unbilled and identical across arms. Larger repositories add unrelated files without increasing defect complexity. No claim of production-project generalization.

Four repeats per case, four arms each: **48 runs**, twelve matched blocks. Rotate arm order by repeat, balancing all four positions. Prepare initial fixtures/history fingerprints and all initial projected request byte sizes before paid calls. Stress seeds grow deterministically to just above the 80% summary threshold; no padding is added by editing messages after tool execution. The empty control must remain below the threshold. The protected-history combined arm must exceed the threshold; the evictable-history combined arm is expected to avoid it through ContextOS. Record actual activation, not merely enabled flags.

Common wire guard 80,000 bytes, summary trigger 0.8, recent retention 24,000 bytes (default ratios with an explicit guard); ContextOS soft target 32,000 bytes, latest two tool rounds protected. v1 inventory, full history, capability feedback on, 24 tools/turn, maximum 24 provider attempts/run including summaries, maximum two compaction attempts/turn. Request timeout **180 seconds**, turn timeout 300 seconds, fixed before calls for all arms. Conservative shared USD 8 guard, USD 0.60/run. Input/cache-read USD 0.80 and output USD 2.80 per million; not invoice rates. Stop all new paid calls at unknown usage or exhausted guard, preserve the reservation and every attempt; no retries or replacement samples. Do not overwrite run directories.

## Checks and interpretation

Before paid calls, use a scripted native four-arm loop to verify actual source repair/tests, pending validation despite an inaccurate summary, unchanged canonical history, stale source exclusion and durable checkpoint resume. Record model-visible history retrieval tools after compaction. An indexed old result accessible internally but absent from model-visible tool declarations is a conditional integration gap; do not count ordinary repair success as proof of historical retrieval completeness. A known failed compatibility expectation remains failed and does not stop observational token measurement of the unchanged configurations.

Live acceptance: unchanged instructions/tests/unrelated files, independently checked public and hidden code behavior, complete current source read, actual positive validation after the final edit, normal completion and complete provider usage. Every attempted run is reported. Unknown totals stay null. Only complete fixed blocks can support full-experiment ratios; report complete subsets separately if interrupted, never replace the planned comparison with them.

Compare `contextos_auto` against `contextos_off` per case and overall, alongside the other two arms and summary-only token costs. Flag any paired acceptance decline, missing retrieval entry, or additional token consumption. In arms where no summary executes, token variation is observational, not attributed to automatic compaction. A smaller next-request byte count does not prove that summary costs are recovered. Existing compatibility gap plus synthetic workload means no default-enablement decision follows from a positive token result alone. Stop after reporting for user review; do not implement a fix or launch another experiment automatically.
