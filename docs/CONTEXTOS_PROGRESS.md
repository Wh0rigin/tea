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

## M4 — rejected A, frozen B

A (`bbac783`) had short-control +19.70% provider tokens versus full history, 9/9 short acceptance, with 1,002 avoidable request bytes after source edits. Rejected and interrupted before long cases; all completed evidence and one unknown reservation retained. Conservative A spend USD 0.5767008. B removes stale-only recovery schemas, retains freshness safety, and adds a historical receipt recovery case. Same model/control settings; 63 live runs are planned within the remaining USD 7.4232992. Full pre-freeze suite 220/220; seven fixture preflights must pass. No target-token success claim yet.
