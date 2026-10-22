# S0: native Pi vs TEA baseline

Status: protocol frozen before any model calls; live results pending. This is baseline infrastructure, not a product optimization.

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

Verification: product suite **434 passed, 1 skipped, 0 failed**; relay suite **7/7 passed on Linux**, **6 passed and 1 Unix-socket skip on Windows**.

## Analysis policy

Report every attempt and official partial rewards. Primary metric: full-task acceptance. Provider tokens include input, output (including thinking), cache reads and cache creation. Reconcile independent client and relay request hashes and usage; unknown remains null. Report token savings only for matched task/repeat pairs where both agents pass and usage is known; show coverage explicitly. All-attempt usage is diagnostic and cannot establish savings at equal quality. Do not silently repair or rescore official grader failures. No raw conversation, reasoning, credentials or private workspace paths are published.

Frozen task inputs, order, image identities, source archives and adapter hashes: [DeepSWE protocol](deepswe-protocol.json), [WorkBuddy protocol](wb-protocol.json).
