# TEA ContextOS B · rejected controlled experiment

[中文](README.zh-CN.md) · [Machine-readable B](candidate-b.json) · [Rejected A checkpoint](candidate-a-checkpoint.json) · [A liability record](candidate-a-aborted.json) · [Replay](replay.json)

## Result

**B is rejected: one TypeScript run edited a file outside the declared scope. Functional tests passed but task correctness did not. No release performance claim.**

Frozen gate **FAIL**. Legacy `8dfc6dafb257f183a31a76a28b5e93a8413f7919`; B `07d6070168bd5c6f7c4a2408a1ae4fcf9857996b`; engine SHA256 `5cf944e904ba49523ad5eed6ca6275816cdbd8ce45baccca67ccb1941d1b8457` (unchanged at completion). Seven cases × three arms × three repeats: 63 paid runs, 62 accepted, 0 incomplete-usage runs. Final agent validation passed in 63/63 runs. No semantic summary requests. Descriptive reduction on equally accepted pairs only (failed scope pair excluded; not a passed gate): **54.59% versus original**, **57.66% versus persisted full history**. Real 30-turn workflow: **50.35% / 49.84%**, respectively.

All values count provider input plus output, cache included; reasoning output is not added twice. Recovery follow-up requests and failed paid work are included. Acceptance is external public/hidden tests, scope checks and the historical-receipt constraint, with identical bug snapshots and controls within each comparison. Gate reasons: ['crossfile-ts/legacy: acceptance-matched repeats missing', 'crossfile-ts/legacy: acceptance decline', 'crossfile-ts/full: acceptance-matched repeats missing', 'crossfile-ts/full: acceptance decline'].

![Provider totals](tokens.png)

![Net changes and repeat variation](savings.png)

![Real workflow](workflow.png)

## Per-case totals across three repeats

- **long-30** — legacy: 1,914,026 tokens, 3/3 accepted; full: 1,894,506 tokens, 3/3 accepted; contextos: 950,279 tokens, 3/3 accepted. All-known reduction, including failed runs: 50.35% versus legacy; 49.84% versus full.
- **short-js** — legacy: 17,151 tokens, 3/3 accepted; full: 19,197 tokens, 3/3 accepted; contextos: 18,441 tokens, 3/3 accepted. All-known reduction, including failed runs: -7.52% versus legacy; 3.94% versus full.
- **crossfile-ts** — legacy: 233,896 tokens, 3/3 accepted; full: 269,392 tokens, 3/3 accepted; contextos: 70,011 tokens, 2/3 accepted. All-known reduction, including failed runs: 70.07% versus legacy; 74.01% versus full.
- **failure-python** — legacy: 225,885 tokens, 3/3 accepted; full: 225,469 tokens, 3/3 accepted; contextos: 78,873 tokens, 3/3 accepted. All-known reduction, including failed runs: 65.08% versus legacy; 65.02% versus full.
- **large-source** — legacy: 313,897 tokens, 3/3 accepted; full: 486,133 tokens, 3/3 accepted; contextos: 109,003 tokens, 3/3 accepted. All-known reduction, including failed runs: 65.27% versus legacy; 77.58% versus full.
- **stale-resume** — legacy: 306,320 tokens, 3/3 accepted; full: 326,275 tokens, 3/3 accepted; contextos: 74,614 tokens, 3/3 accepted. All-known reduction, including failed runs: 75.64% versus legacy; 77.13% versus full.
- **historical-recall** — legacy: 218,521 tokens, 3/3 accepted; full: 218,565 tokens, 3/3 accepted; contextos: 64,887 tokens, 3/3 accepted. All-known reduction, including failed runs: 70.31% versus legacy; 70.31% versus full.

## All-run accounting and latency

- **Original TEA**: 21/21 accepted; input 3,220,289, output 9,407, cache input 2,997,696; all-run tokens 3,229,696; 274 requests; 0 recoveries; conservative USD 2.602571; USD 0.123932/accepted run; median/P95 tokens 75,346/636,197; median/P95 latency 19.38/271.65s.
- **Persisted full history**: 21/21 accepted; input 3,429,878, output 9,659, cache input 3,252,480; all-run tokens 3,439,537; 284 requests; 0 recoveries; conservative USD 2.770948; USD 0.131950/accepted run; median/P95 tokens 89,857/632,550; median/P95 latency 22.94/297.27s.
- **ContextOS B**: 20/21 accepted; input 1,356,656, output 9,452, cache input 843,968; all-run tokens 1,366,108; 288 requests; 3 recoveries; conservative USD 1.111790; USD 0.055590/accepted run; median/P95 tokens 26,254/317,749; median/P95 latency 28.67/339.43s.

Nearest-rank median/P95 is descriptive for these 21 runs per arm, not a population confidence interval or SLA. Latency includes tools and local persistence. B uses up to three concurrent independent runs, with disjoint preallocated caps and rotated launch order. Original and full share exactly the same fixture/task/model controls; full and ContextOS also share persistence. This isolates selection and reveals foundation overhead separately.

## Rejected attempt and total budget

A's nine short runs all passed but used 7.43% more tokens than legacy and 19.70% more than full. Stale-only recovery schemas added 1,002 final-request bytes; model-choice variance also contributed. The avoidable overhead was removed. A was stopped before long runs; eleven complete runs and five settled requests in the interrupted run remain, plus one unknown request charged its full USD 0.2674688 reservation. Original A checkpoint is preserved; its interrupted total remains null. A conservative spend USD 0.5767008; B USD 6.4853088; combined **USD 7.0620096**, below USD 8. Estimates/reservations are not invoices.

A and B use different schedules and domain comment padding (A fourteen lines, B eight); B adds a receipt case. Do not treat their overall totals as an A/B comparison of one identical workload. B uses exact-request native byte reservations beneath the same 160,000 maximum; payload controls are unchanged. Every B case has three repeats per arm; the failed scope pair is excluded only from the separately labeled equally accepted subset.

## Protocol and limits

Requested model GLM-5.3-Flash; enabled thinking (4095 budget tokens), low effort, output cap 4096; V1 inventory, semantic compaction off, stream off, provider default temperature (not explicitly controlled). Model identity is the requested relay model; internal provider routing is not independently verified. Guard 160,000 complete UTF-8 request bytes; soft target 32,000; recent two rounds; 10 tools/turn, 100 requests/run, 90s/request, 180s/turn. Conservative prices USD 0.80/M input and 2.80/M output without cache discount, [public relay pricing](https://www.packyapi.ai/api/pricing). B budget 7.4232992, each concurrent cap at most USD 1.40 and at most one-third of the remainder.

Self-authored diagnostic fixtures. Three target cases seed scripted actual source reads; Python's old long failure log is synthetic. Historical receipt is an actual scripted successful test output. These seeds are not model-generated or billed. Long-30 starts empty and counts all 30 inspections plus repair. Stale/resume rehydrates native journals into new session objects; original preserves its live object because it has no journal. Real two-process crash/edit/verify is separately tested offline. Scope/hidden validation is outside the agent workspaces. TypeScript uses Node 24 stripping, not type checking; Python 3.13.9 and JavaScript execute real tests. Java has source/protocol replay only; no host compiler.

Replay metrics are bytes and heuristics, not provider savings. Repeated reads of the same active source show no additional selector gain. Pinned requirements, failures and thinking can exceed the soft target. Complete history remains in RAM and on disk, not bounded RAM. Already truncated stdout cannot be recovered. Source hashes establish version identity, not semantics; excluded dependency/build directories and external concurrent edits remain limitations. No model routing or additional paid memory model is enabled. These results do not establish universal savings or unseen-repository reliability.

Reproduction controls and gates: [benchmark protocol](../../../docs/CONTEXTOS_BENCHMARK.md). Architecture: [ContextOS](../../../docs/CONTEXTOS_ARCHITECTURE.md). Canonical ignored results are in `benchmarks/results/contextos-glm-a-20261011` and `contextos-glm-b-20261011`; public files contain aggregate usage, hashes and synthetic fixture prompts, without keys/raw responses/private workspaces. Hashes of exported artifacts are in `evidence.sha256`.

## Supplementary read-only inspection audit

A posthoc audit compared settled read_file output hashes with the expected complete file output for all 270 inspection turns (9 runs × 30). Every turn matched; no apply_patch/run_tests occurred. This verifies the stated inspection task using existing evidence without a provider call. [Aggregate audit](inspection-audit.json). It does not change B's frozen report or overturn its scope rejection.
