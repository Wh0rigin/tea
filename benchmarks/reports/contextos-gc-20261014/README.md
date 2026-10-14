# ContextOS GC: functional and cold-history checks

[中文](README.zh-CN.md)

Auto compaction and durable checkpoint GC now default on. Covered bodies leave RAM only after the checkpoint commits. Cold ContextOS evidence remains in authenticated storage; the default output LRU is 256 KiB. Preserve verbatim user requirements, observed valid rules, pending edits and unknown billing. The resident-history trigger is 4 MiB of serialized history; per-session log/artifact capacity is 512 MiB. Neither is a hard process-heap limit.

Disk GC marks all committed/nested historical artifacts, then collects only unreferenced regular hash files older than 24 hours; at most 1,000 directory entries per pass under the writer lock. Never automatically destroy committed history.

## Verification

- Deterministic suite 296/296; GC-specific 15/15, including a separate Node process, interrupted commits/checkpoints, source/rule invalidation, budgets, reset, cache/quota bounds and corrupt nested artifacts.
- Combination contract 18/18. The summary-era history-search entry gap is repaired in these local checks; every arm performs real independent validation.
- 18 scripted pressure runs: 12/36/72 tool rounds, three repeats, GC off/auto; one fixed scripted summary per run. Serialized resident-history reductions: 99.85% / 99.95% / 99.97%.

These are serialized active-history bytes, not measured heap/RSS or provider-token improvements. Zero new paid provider calls. Retrieval schemas add overhead that needs a separate matched-model live evaluation. Original paid records unchanged. Initial local failures and repairs remain private.

Event metadata, protected requirements and task state can still grow; old sessions need explicit cleanup. Per-session quota is not a machine-wide quota. Long logs increase startup/search/GC latency, and full-history rollback reloads RAM. No production-scale reliability, new token release-gate or cross-model claim.

[Pressure records](stress.json) · [Combination contract](combination.json) · [Validation](validation.json) · [Source bytes](source-audit.json) · [Hashes](evidence.sha256) · [Design and limits](../../../docs/MEMORY_GC.md)
