# Requirement evidence review on the complete PR16 profile

[中文](RESULTS.zh-CN.md)

Status: stopped; stop reason: unrecovered_unknown_usage_stop. Runtime `46a4753` is identical in both variants; only requirement review 0/1 changes. Full frozen PR16 model/context settings are retained. Two seen tasks, two paired repeats each, eight planned attempts. Pi/Claude not rerun. Both variants enable the same production five-retry policy; recovered unknown usage is still unknown.

- Attempts: baseline 2/4; candidate 2/4.
- Official full passes among attempts: 1/2 -> 2/2.
- Native completed: 1/2 -> 2/2.
- All-attempt provider tokens: unknown -> unknown; reduction unknown. Unfinished/unknown cohorts have no full total or ratio.
- Both-passed/native-completed pairs: 0/4; reduction unknown.
- Actual candidate review activations: 2.

All failures and unstarted tasks retained; unknown usage is null, never zero. Token unit: provider input + output + cache read + cache creation; thinking included once in output. Controls: USD 30-equivalent allocation per attempt, 240 planned total, not an invoice. Correctness screen: {'allEightAttempts': False, 'allEightOfficialGrades': False, 'officialAcceptanceNotWorse': None, 'nativeCompletionNotWorse': None, 'allCandidateP2PPreserved': None, 'mechanismActivated': True}. Candidate stays off. This small seen-task screen does not establish generalization or statistical significance.

The fourth attempt (Mnamer baseline) timed out after receiving HTTP 200, without message_stop or complete usage. This is not the explicit Internal Network Failure event targeted by the production retry policy, so it was not retried. Four scheduled attempts were not started. Candidate 2/2 versus baseline 1/2 is an observed partial outcome, not a demonstrated accuracy improvement. No complete metered pair is available.

## Measured candidates and observed follow-up

- Helm candidate: 1,671,147 complete provider tokens; official 7/7. Review fired once. The subsequent 21 requests consumed 599,152 tokens, including additional tests and repairs to model-authored tests.
- Mnamer candidate: 1,136,839 complete provider tokens; official 370/370. Review fired once. The subsequent 13 requests consumed 376,850 tokens, including fresh-input CLI checks and persisted state/log inspection. No post-review source repair is recorded.
- Complete total for the two attempted candidates: 2,807,986 tokens. This is not the planned four-candidate total. Baseline known subtotal: 1,546,049 tokens; both baseline full totals remain unknown.

These follow-up counts are not causal net overhead estimates: a disabled continuation is not observed for the same trajectory. Added checks demonstrate activation, not that review caused either success. Quoted Go test-name regex commands were rejected by the existing shell filter; the agent continued using other commands. The frozen runtime was not changed mid-run.

## Verification and limitations

The same runtime archive and effective PR16 model/context settings were independently checked against the frozen protocol. Request hashes, usage reconciliation, same-payload retry identity, review bounds and working-set limits passed the publication audit. Integration regression: 487 passed, one skipped, zero failed. Six Windows/Ubuntu Node 20/22/24 CI jobs passed before paid evaluation.

**Verdict: correctness and net token benefit are undetermined.** Leave review disabled pending review. The interrupted baseline failed in transport before source editing, not as evidence of worse reasoning. A separate future timeout/EOF recovery policy would need its own bounded retry and unknown-usage accounting; the explicit-error policy cannot be retroactively expanded for this cohort.

[Results](results.json) · [Operation diagnostics](diagnostics.json) · [Frozen protocol](protocol.json) · [Audit](verification.json)

## Subsequent continuation

The four previously unstarted entries were evaluated separately in [v4](../pr19-r5-deepswe-20261024-v4/README.md). This interrupted cohort and its unknown usage remain unchanged.
