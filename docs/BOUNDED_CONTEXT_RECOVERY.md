# Bounded context recovery experiment

Status: opt-in candidate, no production adoption or live benefit claim.

`TEA_BOUNDED_CONTEXT_RECOVERY=1` (or SDK `boundedContextRecovery: true`) permits at most one additional summary per task turn when ordinary automatic compaction attempts are exhausted and the actual assembled next request still exceeds the estimated input guard. Default is off. The PR16 numeric profile, output reservation, model prompt, permissions, source validation and five-retry policy remain unchanged. The profile override is visible in exported configuration.

Recovery requires automatic compaction, no unresolved billing/recovery block, no rejected/nonreducing regular summary in this turn, a finite exhausted regular cap and a request fingerprint not already attempted. It never lowers the output reserve or disables the adapter guard. A rejected, nonreducing or insufficient recovery cannot loop; further growth can still stop safely. Protected/latest history can remain too large to recover. Automatic summaries still use the existing adapter, budget and timeout; summary errors propagate rather than silently retrying. This can add a paid summary and more subsequent work: lower token usage is not promised.

Each completed summary attempt emits `compaction_pressure` into ledger and events. It records before/after actual assembled request bytes, local estimated input tokens, input/trigger limits, resident history bytes, attempt counts, bytes/tokens freed and whether the next request fits. These are estimates and serialized sizes, not provider token usage. Full transcripts and source are not added to this event.

Self-authored scripted regression tests exercise recovery after the regular cap, default-off equivalence, rejected summaries, later growth, compaction off, no-pressure tasks, unresolved validation and ContextOS assembly. These do not establish model performance. Existing compaction/profile/adapter tests also remain authoritative.

Live gate: retain a production-parent baseline, freeze identical tasks/model/effort/stream/output controls, alternate order and keep every failure/unknown allocation. Report official acceptance and native completion separately. Reject token savings accompanied by worse acceptance. Do not apply this candidate to formal PR16 configuration without evidence and user review.

## Measured outcome

The [paired DeepSWE screen](../benchmarks/reports/bounded-recovery-deepswe-20261025-v1/README.md) completed: production parent 4/4 accepted, candidate 1/4; all-attempt tokens -4.03% with lower acceptance. Do not promote this candidate. One recovery worked at the immediate boundary but that attempt still failed after later regrowth. Three candidate attempts never activated recovery, so the small screen does not prove that the flag caused the whole acceptance gap.
