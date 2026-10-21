# TEA workflow: DeepSWE and WB-Bench-Code results

Status: **all 24 fixed attempts finished; the general performance gate did not pass**. Report finalized on 2026-10-21.

Compare direct-parent `b400577185f0b224850540cc9289672f62450f33` with candidate `7bd236f4d548af1214ddf498ccaf7a5c3b928100`: workflow guidance, same-file batch edits and durable unresolved-validation commands together. This is a package comparison, not a batch-only ablation.

## Findings

- **DeepSWE v1.1:** two seen tasks, two repeats per arm, eight attempts. Baseline completed and fully passed **1/4**; candidate **0/4**. One baseline runtime failure has no original official grade. All-attempt provider tokens: **2,970,434 → 3,725,034 (+25.40%)**. There are **no both-complete/full-pass pairs**, so same-work efficiency is unavailable.
- **WB-Bench-Code:** four categories, two repeats per arm, sixteen attempts. Official mean `reward`: **0.7611 → 0.7043**; full-pass rate: **4/8 → 3/8 (−12.5 percentage points)**. All-attempt tokens: **2,441,127 → 1,777,033 (−27.20%)**, with worse acceptance; this is consumption, not a general efficiency win.
- **Both-passed subset:** only the Black repair task qualifies, twice. Combined tokens **1,081,718 → 583,671 (−46.04%)**; each arm passed 6/6 checks in both repeats. One task repeated twice does not establish a general improvement.
- **Local checks:** existing specialist suite **176 passed**; full suite **411 passed, one Go-unavailable skip**. Additional adversarial process checks expose **12 behavior failures across both versions**. Existing suite passes do not cover this defect.

![Acceptance and same-work efficiency](outcomes.png)

The Token panel contains only matched completed, fully passed workflows. Failed or unmatched attempts do not enter its bars. Acceptance panels count all planned attempts; DeepSWE's ungraded execution failure is explicitly retained.

## Evidence

- [完整中文对照分析与下一步建议](RESULTS.zh-CN.md)
- [方法、参数、环境适配与边界](METHODS.zh-CN.md)
- [DeepSWE every attempt and audited usage](deepswe-results.json)
- [WB-Bench-Code every attempt and audited usage](workbuddy-results.json)
- [Baseline official metrics and report](workbuddy-baseline/report.md) · [candidate official metrics and report](workbuddy-candidate/report.md)
- [Visible operation diagnostics](visible-operation-diagnostics.json) · [actual patch metadata before verifier injection](workbuddy-patch-metadata.json) · [post-run failure signatures](failure-signatures.json)
- [Local check summary](local-checks.json) · [process defect reproduction](pipe-repro.json)
- [Recovered failed-attempt metering](deepswe-failed-attempt-accounting.json) · [separate zero-model postmortem diagnostic](deepswe-postmortem-diagnostic.json)
- Frozen protocols: [DeepSWE](deepswe-protocol.json), [unstarted-slot continuation](deepswe-continuation-protocol.json), [WB-Bench-Code](workbuddy-protocol.json).

## Controls and limits

Both arms: GLM-5.3-flash, thinking enabled / low effort, streaming, maximum output 131,072, derived thinking budget 8,000, local context window 216,000, ContextOS target 32,000 **bytes**, automatic compaction/GC, 96 tools / 128 transport requests, 900-second request deadline, 30-minute Agent wall limit. The fixed output reservation leaves an estimated input allowance of 80,832 tokens. This is not the ordinary CLI deadline profile.

All **794** model requests reconcile with independent transport counts, request hashes, usage and controls. One failed attempt's terminal TEA summary is missing; its 38 complete request records recover **626,135** actual tokens, with the original failure and 10 USD reservation retained. No failed paid attempt was retried. Continuation executed only four previously unstarted slots from the original schedule and allocation.

Input includes cache reads/writes once. Provider output is not increased by counting thinking again. Monetary allocations (80 USD DeepSWE + 160 USD WB-Bench-Code) are limits, not invoices. Raw transcripts, credentials and workspaces are not published.

This is a **seen two-task DeepSWE regression subset and a four-task subset of the 80-task WB-Bench-Code track**, not a full leaderboard score. WorkBuddy uses native Harbor trials and the official verifier/scorer with documented environment adaptations and custom serial orchestration. No reference solution or hidden verifier source was used for model execution; failure outputs were analyzed afterward.

Recreate the figure with Python and Matplotlib: `python benchmarks/reports/workflow-native-screen-20261020/plot_results.py`. [SVG](outcomes.svg) is also available.
