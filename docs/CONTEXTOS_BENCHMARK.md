# ContextOS benchmark protocol

Baseline is immutable commit `8dfc6da`; original suite 169/169 passed on Windows / Node 24.14.0. Benchmark source, fixture hashes, exact candidate SHA, runtime controls and public acceptance criteria must be frozen before paid calls. Evidence directories are unique and never overwritten. Provider usage, byte diagnostics and scripted counters are separate.

## Hypotheses and gates

1. Persistence and resume should restore exact history and accounting without any additional model request. This foundation does not claim short-task token savings.
2. Recoverable old tool output can be removed from repeated requests while retaining user requirements, current source, failures, causal tool pairs and authoritative validation.
3. A selection strategy is accepted only if total provider input plus output, including cache input, all recovery and all summaries, is at least 5% lower in the predeclared long/repeated-history target group, with no acceptance decline. Individual scenarios and negative repeats remain visible. A greater-than-20% token increase, a recovery storm or any important correctness regression requires rejection or a new explained candidate and fresh result directory.

## Two evaluation layers

- Deterministic protocol/replay: short edits, cross-file evidence, discovery, 30–50 turns, repeated reads, long failures, changed source, real process restart, task switching, parameter handoff, budget exhaustion and tool errors. Include JavaScript/TypeScript/Python/Java source representations. Offline source representations alone do not establish live multi-language task success.
- Live E2E A/B: identical fixture commits/tasks/model/endpoint/thinking/effort/output caps and independent acceptance. Alternate order and repeat at least three times per selected scenario. Match persisted full-history versus ContextOS to isolate the assembler, disclose the shared persistence changes and also preserve the original baseline identity. Measure provider input/output/cache totals, requests, recoveries, all-run acceptance, spend per accepted task, median/P95 tokens and latency. Count every paid failure, rejection and unknown reservation. Stop at finite suite/run/request/time limits; missing usage is null and is never retried automatically.

Self-authored fixtures are diagnostic evidence, not a substitute for unseen repositories or a formal broad release gate. Changing thinking/model is tested as an interface contract unless explicitly included as a separate paid experiment; it must not contaminate a same-model token comparison. A byte guard is a transport safety bound, not a tokenizer. Full-history and existing compact-tools remain rollback controls.

## Current results

M0 baseline is measured locally. M1 tests and M2–M4 experiments are in progress. No ContextOS provider-token gain has been measured yet; no performance candidate has passed its gate.

## Frozen live matrix — candidate A

Six cases, three repeats, three arms (54 runs): `short-js`, `crossfile-ts`, `failure-python`, `large-source`, `long-30`, `stale-resume`. Arms rotate legacy/full/ContextOS order across repeats. Legacy source is materialized byte-for-byte from `8dfc6da`; full and ContextOS share the candidate's persistence foundation. Initial fixture commits, file/content hashes, seed hashes and full prompts are recorded before each case's paid run. Preflight confirms public success and independent hidden failure for every original fixture.

`crossfile-ts`, `failure-python` and `large-source` use scripted source-read seeds; Python's prior long failure log is explicitly synthetic. These are stress tests and not model-generated history. `long-30` starts empty, submits 30 real read-only user turns and then a repair; all calls are billed in the result. `stale-resume` changes an unrelated checkpoint module to an exact frozen value between turns. Current arms rehydrate native journals into new session objects; legacy retains its live object because original TEA has no persistent recovery. Two-process crash/resume is separately covered by deterministic integration tests.

GLM-5.3-Flash, enabled thinking, low effort, 4096 output cap, V1 context, compaction off, 160,000 UTF-8 request byte guard, 32,000 soft ContextOS target, recent two rounds, 10 tools/turn, 100 request attempts/run, 90 seconds/request and 180 seconds/turn. Suite cap **USD 8**, run cap **USD 1.40**. Conservative rates: USD 0.80/M input and 2.80/M output; cache reads receive no discount in the spend estimate. Public relay pricing checked 2026-10-11 at [pricing API](https://www.packyapi.ai/api/pricing) (model ratio 0.4, completion multiplier 3.5, eligible groups ratio 1). These estimates are not invoices. Temperature is the provider default and not explicitly controlled; stream off. No retries after unknown billing.

Node 24.14.0 / Python 3.13.9 / Windows. TypeScript uses Node 24's native type stripping, not an independent type checker. Java source/protocol replay is covered; Java live compilation is unavailable on this host and is not claimed. User constraints, failed output and signed thinking remain pinned. Pinned content can exceed the soft target; the native wire guard still applies.

Performance gate is evaluated against **both** legacy and full: all six cases require three equally accepted pairs; zero acceptance decline; no case's aggregate all-known token regression greater than 20%; no run has over eight recovery tools; target group (three seeded targets plus real workflow) saves at least 5%; the real `long-30` workflow separately saves at least 5%. Unknown usage, incomplete runs or changed source fail the gate. Individual negative repeats remain in the report. A failed candidate is retained as negative evidence and revised in a new result directory, within the same suite cap.

Reproduce fixtures without API calls: `node scripts/compare-contextos.mjs benchmarks/results/contextos-preflight --preflight` or `tea benchmark contextos --mode preflight --run-id contextos-preflight`. Live entry: `node scripts/compare-contextos.mjs benchmarks/results/contextos-live` or `tea benchmark contextos --mode live --run-id contextos-live`; set the frozen environment above, finite budget and current credentials/prices first. Existing output directories are rejected. Raw provider payload storage stays off.
