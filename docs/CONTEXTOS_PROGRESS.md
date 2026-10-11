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

## Remaining gates

- M1: deterministic/protocol and cross-process checks passed; additional edge cases remain part of stabilization.
- M2/M3: version-checked evidence lookup, structured task state and reversible context assembly with on-demand recovery.
- M4: frozen replay and live A/B; retain negative outcomes, remove candidates that regress acceptance or fail the token gate. No performance claims before provider measurements.
