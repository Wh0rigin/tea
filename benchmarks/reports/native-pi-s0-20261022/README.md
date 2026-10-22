# S0: native Pi vs TEA baseline

Status: **completed — 24/24 attempts, 871 provider requests**. The protocol was frozen in commit `48dcc8a` before model calls. TEA product runtime was unchanged.

[中文结果](RESULTS.zh-CN.md) · [执行诊断与 S1 建议](DIAGNOSTICS.zh-CN.md) · [aggregate JSON](summary.json)

## Observed results

- DeepSWE full-task acceptance: **TEA 1/4 (25%)**, **Pi 4/4 (100%)**.
- WorkBuddy full-task acceptance: **TEA 6/8 (75%)**, **Pi 3/8 (37.5%)**. Official mean rewards: **0.9375 / 0.6511**.
- Total full-task acceptance: **7/12 each**. The long-task deficit remains; equal pooled counts do not establish equivalent coding ability.
- **4/12 matched pairs** passed official grading on both sides and had independently reconciled usage: TEA **2,878,108**, Pi **2,621,222** provider tokens; TEA used **9.80% more**. DeepSWE covers one such pair (+47.67%); WorkBuddy covers three (−28.13%). These are subset measurements.
- **21/24 attempts** have independently reconciled usage. Two responses ended without `message_stop`; another request was interrupted by the agent wall deadline. Usage for those three attempts is unknown, with 30 USD of original control allocations retained and no retries. **All-attempt token totals and an overall saving percentage remain unknown.**

![Official acceptance and matched token use](native-pi-s0.png)

The chart includes every attempt in acceptance denominators. Only matched official passes with known usage enter token bars; native client completion states are listed separately. These six tasks were previously seen, with two repetitions per agent. S0 does not establish a product optimization or an unseen benchmark score.

## Question and scope

Can the current TEA runtime match native Pi on the six previously seen tasks? Two DeepSWE v1.1 tasks and four WorkBuddy Bench tasks, two repeats per agent: 24 fresh attempts. These tasks were used during earlier debugging. This is a diagnostic comparison, not an unseen benchmark score or proof of generalization. S1 starts only after user review of S0.

## Frozen controls

- TEA runtime: `d0b566b36c6babe287fb96e4b2f63c31af5a752c`; native Pi: `0.87.1`, unchanged package and dependency bundle. Shared Node `24.12.0`.
- Same initial task snapshots, native official verifiers, GLM-5.3-flash endpoint, streaming, enabled thinking with 8,000-token budget and low effort. The relay normalizes only model controls; system prompts, messages and native tool definitions remain untouched. Original and forwarded payload hashes are recorded separately.
- Context configuration: 216,000 tokens. Task output ceiling: 131,072 tokens; lower native compaction and context-dependent output choices are retained and recorded. Pi originally requests its native low thinking budget; the shared relay forwards the same 8,000-token budget for both clients.
- Native auto-compaction enabled on both. TEA retains ContextOS and GC. Pi retains native compaction, read/bash/edit/write, without TEA tools, extensions or added strategy prompts. Native retry and cache-warming calls disabled.
- Shared guards per attempt: 128 submitted provider requests, 4,096 tool calls, 900 seconds per request, 1,800 seconds agent wall time, 10 USD control allocation. Total allocation: **240 USD**, not an invoice estimate. Control rates per million tokens: input 0.8, output 2.8, cache read 0.8, cache creation 1.6 USD; conservative reservations use 1.6 USD per million serialized input bytes.
- No retry after failure or unknown usage. Unknown usage stays null, retains the full allocation, and stops further submissions in that trial. Independent predeclared trials can continue only after the relay drains. Known unsubmitted guards are explicitly distinguished from provider responses.
- Counterbalanced serial order within each cohort is in the protocols. Cohorts may run concurrently; each has its own relay and budget.

The high tool ceiling intentionally differs from earlier 96-tool experiments. Historical totals are not reused. The clients retain different native prompts, tool interfaces, command safety policies and context policies; this measures the complete agents rather than an isolated ContextOS effect. Both use identical OS roles within each cohort and the same Node PATH overlay. Official task acceptance is primary; native completion and observed validation are reported separately.

## Offline qualification

No provider calls: native Linux Pi startup; actual RPC read/write/edit/bash; TEA native tools; ten synthetic SSE responses and nine tools per client per cohort; independent client/server original request hashes; complete scripted usage. DeepSWE exported fixture patches also passed an independent fresh-container application and test. Synthetic token values are not token savings.

Offline setup failures are retained privately: missing runtime parent directory, missing shared export-helper dependencies and an invalid fake SSE fixture without a JSON root `type`. These were corrected before paid calls and are not scored as agent failures. Both agents use the same trusted patch export helpers.

Verification: product suite **434 passed, 1 skipped, 0 failed**; relay suite **7/7 passed on Linux**, **6 passed and 1 Unix-socket skip on Windows**; collector fixtures **6/6 passed on both Linux and Windows**. Chart and publication smoke checks used synthetic records and are not performance measurements.

## Analysis policy

Report every attempt and official partial rewards. Primary metric: full-task acceptance. Provider tokens include input, output (including thinking), cache reads and cache creation. Reconcile independent client and relay request hashes and usage; unknown remains null. Report token savings only for matched task/repeat pairs where both agents pass and usage is known; show coverage explicitly. All-attempt usage is diagnostic and cannot establish savings at equal quality. Do not silently repair or rescore official grader failures. No raw conversation, reasoning, credentials or private workspace paths are published.

Frozen task inputs, order, image identities, source archives and adapter hashes: [DeepSWE protocol](deepswe-protocol.json), [WorkBuddy protocol](wb-protocol.json).

## Reproduction and audit boundaries

The public scripts in `scripts/native-pi-baseline/` cover native Pi driving, the shared relay, offline fixtures, aggregation and rendering. Host-specific native framework adapters and raw request/event ledgers remain private; their frozen hashes are recorded in the protocols. This limits independent reproduction of the full paid orchestration from the public files alone. Raw conversations and private host paths are excluded from publication.

- Run `python scripts/native-pi-baseline/test_relay.py` and `python scripts/native-pi-baseline/test_collect.py` for offline fixtures; the Unix socket case skips on Windows.
- Regenerate the chart with `python scripts/native-pi-baseline/plot.py benchmarks/reports/native-pi-s0-20261022` (optional Python dependencies: matplotlib and numpy). Both PNG and SVG are included.
- `protocolSha256` hashes the remote execution copy. `sortedJsonProtocolSha256` hashes `json.dumps(protocol, sort_keys=True, separators=(',', ':')).encode()` so line-ending changes do not obscure the frozen settings. Independent usage reconciliation compares original client request hashes before shared model-control normalization.
- Official WorkBuddy aggregation is preserved in [wb-official-metrics.json](wb-official-metrics.json), with the host path redacted and a hash of the private original. Native acceptance records are never replaced by command-recognition heuristics or post-hoc regrading.

The next candidate should strengthen observable outcome verification and unresolved crash handling. S1 awaits user review of [the process diagnosis](DIAGNOSTICS.zh-CN.md).
