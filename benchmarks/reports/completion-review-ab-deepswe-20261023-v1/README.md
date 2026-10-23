# S7 completion review: paired DeepSWE screen

[中文](RESULTS.zh-CN.md)

Same runtime `c83be7a`; only completion review off/on differs. Two previously seen tasks, two paired repeats per task, serial balanced AB/BA (8 attempts). Protocol frozen in `071a03c` before inference. Pi/Claude not rerun.

- Official full passes: 1/4 -> 1/4.
- Native completed: 1/4 -> 0/4.
- All-attempt provider tokens: unknown -> unknown; reduction unknown. Negative means more tokens.
- Both-passed/native-completed pairs: 0/4; reduction unknown.

All failures retained; unknown usage is not zero. Token unit is input + output + cache read + cache creation; thinking is included once in output. Control allocation: 10 USD-equivalent per attempt, 80 total, not an invoice. Correctness screening checks: {'officialAcceptanceNotWorse': True, 'nativeCompletionNotWorse': False, 'allCandidateP2PPreserved': True, 'eightMetered': False, 'mechanismActivated': False}. Feature stays off pending review and unseen evaluation. These samples do not prove generalization or statistical significance.

## Interpretation

**S7 efficacy remains unmeasured.** No candidate triggered the review (0/4): three failed during streaming before completion, and one retained unresolved validation. Official acceptance is unchanged at 25% in this screen; no causal quality benefit or regression can be assigned to the inactive mechanism. Both arms have zero native-completed plus official-passed attempts.

322 submitted requests: 317 fully metered and five incomplete. Four malformed SSE failures and one deadline cancellation prevent complete all-attempt totals. The observed token lower bound is 10,474,398; it must not be substituted for the unknown total. All same-task first request hashes match across both variants. No retries or new provider probes were made.

The only fully metered pair (Mnamer pair 2) uses 502,077 vs 1,459,720 tokens (+190.74%). Official tests improve 369/370 to 370/370, but candidate native status is needs_validation and review never ran. This is not a same-quality efficiency pair. Candidate test calls include five repetitions of the broad command and three of its -x variant; unresolved broad checks prevented review activation. The detailed report distinguishes network-error evidence from proven baseline/environment failures.

Next work should diagnose SSE framing, permit a bounded coverage review without erasing pending failures, and prevent unchanged failure rerun loops. These changes have not been implemented or paid-tested. Feature remains disabled by default. All paid controllers have exited. See verification.json for separate executed-CRLF and published-Git-LF protocol hashes; normalized contents are identical.
