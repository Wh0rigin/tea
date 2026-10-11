# ContextOS implementation progress

[Architecture](CONTEXTOS_ARCHITECTURE.md) · [Benchmark protocol](CONTEXTOS_BENCHMARK.md)

## M0 — frozen baseline

- Baseline: `8dfc6da` (merged PR #2), branch `feature/contextos` created from remote `main`.
- Windows / Node 24.14.0; original deterministic suite: **169/169 passed**.
- Existing runtime: in-memory `session.messages` → optional semantic checkpoint → optional `compact-tools` projection → Anthropic adapter → workspace tools → validation state. Source references and learned terms also live only in memory.
- The token ledger records accounting, not a recoverable session. V3 routing is a standalone experiment and is not used by `runTask`.
- No destructive reset, main push, merge, model change or baseline replacement.

## M1 — persistence candidate

Append-only journal, encrypted content-addressed artifacts, writer exclusion, crash-tail recovery, durable request liability, runtime validation state, source fingerprints and opt-in session CLI are implemented. Original thinking/signatures are restored unchanged. Interrupted tool batches receive explicit uncertainty results; they are not executed again. Resume retains spent budgets, rejects workspace/model/endpoint mismatch and stops unresolved billing. **23 new tests; full suite 192/192 passed**, including actual two-process editing/validation and a synthetic native-adapter billing check (not provider performance data). This foundation has no measured token optimization claim.

## M2/M3 — retrievable working set candidate

Implemented version-checked `recall_context`/`search_history`, observed/inferred task state, a future handoff data contract (no model routing), reversible references and an explainable request inspector. Requirements, recent source, active files, failures, mutation receipts and signed thinking are retained. UTF-8 retrieval is paged; stale source is withheld and requires a fresh read. Non-reducing projections fall back to full history. Current deterministic suite: **218/218**. Six fixture preflights passed with initial public success and independent hidden failure; no API calls used.

## Remaining gates

- M1: deterministic/protocol and cross-process checks passed; additional edge cases remain part of stabilization.
- M2/M3: implemented; stabilize and freeze candidate before paid measurements.
- M4: frozen replay and live A/B; retain negative outcomes, remove candidates that regress acceptance or fail the token gate. No performance claims before provider measurements.

## M4 — rejected A and B

A (`bbac783`) had short-control +19.70% provider tokens versus full history, 9/9 short acceptance, with 1,002 avoidable request bytes after source edits. Rejected and interrupted before long cases; all completed evidence and one unknown reservation retained. Conservative A spend USD 0.5767008.

B (`07d6070`) removed stale-only recovery schemas and added historical receipt recovery. All 63 runs completed with known usage; 62 accepted. One ContextOS TypeScript run also edited `text.mjs` despite the task and project rule allowing only `points.ts`. B is rejected on correctness, regardless of its 50.35%/49.84% descriptive real-30-turn savings versus legacy/full. A stop file was written after B had already completed; it did not interrupt any B calls. B spend USD 6.4853088; combined conservative spend/reservation USD 7.0620096 within the original USD 8 cap. [Negative evidence and charts](../benchmarks/reports/contextos-glm-20261011/README.md) retain failures, all-run and equally accepted subset statistics separately.

## Candidate C — working memory and provenance repair (offline snapshot)

Candidate C reanchors actual current user text and observed valid project rules, pages complete unsigned old tool rounds, reinserts original user text across optional checkpoints and propagates version dependencies through read/search/recall copies. It adds no paid memory model or domain dictionary. Deterministic suite: **229/229**. No C provider-token improvement is claimed before a frozen repeated comparison. The same seven-case, three-repeat, three-arm matrix and unchanged correctness/token gates are retained. Live calls require a finite approved remaining budget; there are no C calls while the additional-budget question is pending.

C engine frozen at `66b3350`, SHA256 `bb2a16aab854d5ef4fe175ea8aae6042b369bbe1ad7fc868c4fd17a6012a9d06`. All six Windows/Ubuntu × Node 20/22/24 CI jobs passed. [Public C offline evidence](../benchmarks/reports/contextos-c-offline-20261011/README.md) includes eight replay scenarios and seven preflights whose fixture/task hashes match B exactly. A supplementary posthoc B audit verified all 270 read-only inspection outputs against expected complete-file hashes, without new provider calls; B remains rejected for scope. At this offline snapshot no C calls had been submitted and no additional budget had been assumed; the continuation below supersedes that pending state.

## C continuation — diagnosis and risk-first comparison

The user delegated budget choice on continuation; combined finite cap is now USD 16 (remaining USD 8.9379904 before C). The complete matrix runs `crossfile-ts` first, then all six other original cases, without changing fixture content or gates. C's actual assembler remains the tested `66b3350` implementation; the harness records an exact full-matrix permutation and rejects narrowing. Full deterministic suite **230/230**.

B's first three native requests were reconstructed and their hashes matched the original settled requests exactly. Both the original scope rule and current user text were present; the wrong shadow source became recent resident evidence before a response requested two patches. Confirmed failure is an unnecessary out-of-scope repair. Compression causation or a particular attention mechanism is not established by one failure. C tests renewed current-goal/rule presentation and reduced old tool metadata, with all added bytes and paid recoveries counted.

## C completed live comparison — 2026-10-11

- Frozen engine `454b09b`, SHA256 `1501f0380b2c30d03f73abe49011939c3277019acf5ccc9eb917c98b4f2c7c43`; assembler remains `66b3350`. All 63 submissions completed with known usage and unchanged source; frozen gate passed, 21/21 per arm.
- Provider totals: original 3,592,474; full 3,411,071; C 1,262,602. C saves 64.85% / 62.99% respectively. Predeclared target group saves 62.31% / 61.19%; empty-start real 30-turn workflow saves 51.99% / 52.12%. Short control saves 6.13% / 3.28%; individual repeats remain visible.
- Full deterministic suite **230/230** passed again after the live experiment. C made five recovery calls across 21 tasks; all are counted. Source hashes establish versions, not semantic correctness.
- Additional actual-ledger audit: 270/270 required complete inspection reads and no inspection edits/tests. Fresh checkpoint reads 8/9: all C repeats passed, one full-history repeat omitted the read. Under this stricter posthoc requirement, original/full/C acceptance is 21/21, 20/21, 21/21. Frozen results are not rewritten; future benchmark gates will include read requirements.
- Cache-discount sensitivity yields 25.29% aggregate and 3.70% real-30 cost reduction versus full at public rates, **not an invoice**. Full real-30 cached input is 95.69%, C 50.35%. Token savings cannot be used as actual money savings. P95 latency is 373.50s for C vs 366.58s full; speed improvement is not established.
- Offline relocation of the reference directory reconstructs 60 original requests exactly but saves only about 0.07% wire bytes; no live improvement or D experiment is claimed. The speculative runtime change is not adopted.
- A USD 0.5767008 + B USD 6.4853088 + C USD 6.6711896 = **USD 13.7331992** conservative spend/reservation, within the delegated USD 16 cap. Unknown A reservation remains included.
- [B diagnosis](../benchmarks/reports/contextos-b-diagnosis-20261011/README.md) and [C report, audits and plots](../benchmarks/reports/contextos-c-glm-20261011/README.md) preserve all failures. Self-authored fixtures and three repeats do not prove unseen-repository generalization. Default is full history; no main merge.
