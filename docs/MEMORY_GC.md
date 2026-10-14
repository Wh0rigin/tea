# ContextOS garbage collection and automatic compaction

[中文](MEMORY_GC.zh-CN.md)

Automatic compaction and checkpoint GC now default to `auto`. ContextOS itself remains opt-in. Before a model request, an 80% wire-byte threshold or 4 MiB of serialized resident history triggers a bounded summary attempt. Each submitted task permits at most two automatic attempts. Summary calls use the same model and accounted budget.

## Commit before releasing memory

Accept a complete structured summary only when the candidate request is smaller, including verbatim requirements and prospective recovery-tool overhead. Archive covered tool results and inferred notes into authenticated local storage. Commit a GC checkpoint containing retained message artifacts, original user requirements, observed rule references, summary and authoritative in-turn validation state. Only then splice the covered prefix out of the live message array and prune caches.

Commit failure leaves the originals reachable. A crash immediately after the checkpoint restores the latest validation obligation even if the next runtime-state event was never written. Retained tool batches and signed thinking remain intact. Cold retrieval checks source dependencies, returns UTF-8 pages and never reruns an old command. Historical success cannot certify current source. Search tools remain available after compaction.

## Configuration

- `--compaction auto|off` / `TEA_COMPACTION`: default `auto`.
- `--memory-gc auto|off` / `TEA_MEMORY_GC`: default `auto`.
- `TEA_MEMORY_CACHE_BYTES`: 262,144 bytes for the cold-output LRU. Oversized individual results are transient. Metadata cache: 128 entries.
- `TEA_MEMORY_MAX_RESIDENT_BYTES`: 4,194,304 bytes of serialized live messages plus pinned user requirements.
- `TEA_SESSION_MAX_STORAGE_BYTES`: 536,870,912 bytes per session for log and artifact storage; quota exhaustion stops writes rather than silently destroying committed history.

Default auto mode creates an encrypted local session. Explicit session IDs aid resume. Requirements and observed project rules stay recoverable; valid rules are loaded and reanchored when assembling a request. If bounded summary attempts cannot relieve resident-history pressure, stop with `memory_limit_reached` rather than growing indefinitely or retrying paid calls.

These settings do not impose a hard Node.js heap/RSS ceiling: event metadata, requirements, runtime state and temporary deserialization remain additional allocations. Very long logs increase startup/search/collection latency. No constant-process-memory claim is made.

## Disk collection

After successful collection, mark every committed event artifact and nested archive/checkpoint artifact. Sweep only unreferenced regular hash-named artifacts older than 24 hours, scanning at most 1,000 directory entries per pass. Hold the single-writer lock and verify targets stay in this session's actual artifact directory. Corrupt committed roots fail closed.

Committed history, unresolved request liabilities, session keys and other sessions are never automatically deleted. No TTL deletes committed sessions. Space reclamation depends on orphaned writes; it does not guarantee a shrinking disk footprint. Manually remove an explicitly selected session with `tea sessions delete ID`.

## Resume and rollback

Resume decrypts events sequentially, selects the latest GC suffix and loads cold evidence on demand. Verify nested committed artifacts before continuing. Preserve original workspace/model/endpoint identity, budgets and unknown billing. `/new` resets active history and archive epoch while preserving spending, pending edits and disk history.

```sh
tea --interactive --memory-policy contextos --session work --max-cost-usd 1
tea --interactive --resume work --memory-policy contextos --max-cost-usd 1
tea --interactive --resume work --memory-policy full-history --compaction off --memory-gc off --max-cost-usd 1
```

The final command explicitly reloads original message events, trading more RAM for rollback. Local encryption does not protect against a user with both the key and ciphertext.

## Evidence boundaries

Tests cover interrupted commits, crash recovery, exact cold recall, stale source and rules, budgets, reset, cache bounds, orphan cleanup and corrupt nested artifacts. `node scripts/check-memory-gc.mjs OUTPUT` compares GC off/auto over 12/36/72 tool rounds with three repeats: 18 deterministic runs, one scripted summary per run, zero provider calls. Its metric is serialized resident history, not heap/RSS or provider tokens. New default-profile token and latency benefits require separate live measurements.
## Provider-token gate

The [TEA-only live comparison](../benchmarks/reports/contextos-gc-tokens-20261014/README.md) recorded 72 accepted attempts. Normal tasks used **6.54% more tokens** than the direct parent; no normal task compacted. Same-candidate, above-threshold pressure used **45.81% fewer tokens**, including summaries. Below-threshold pressure used **5.10% more**. The normal-workload token gate failed; these results do not establish universal savings or an independent token benefit of GC.
