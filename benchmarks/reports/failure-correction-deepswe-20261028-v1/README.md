# Failure correction: DeepSWE results

Status: stopped; stop reason: candidate_quality_futility. No production merge. [中文结果](RESULTS.zh-CN.md).

- baseline: 3/4 attempted official passes; 4/4 planned attempted. Native completed + official pass: 2. Metered attempts: 4. Known token subtotal: 6,233,170; transport submissions: 292. Correction feedback events: 0 across 0 attempts.
- candidate: 2/4 attempted official passes; 4/4 planned attempted. Native completed + official pass: 2. Metered attempts: 4. Known token subtotal: 3,489,889; transport submissions: 168. Correction feedback events: 0 across 0 attempts.

Complete all-attempt token change (candidate vs baseline): -44.01%. Official acceptance change: -25.00 percentage points. Lower tokens with worse acceptance are not an optimization gain.

## Every attempted run

- helm-unified-manifest-stream / baseline r1: official 5/5 new + 2/2 regression; native needs_validation; tokens 2530497; requests 103; correction feedback 0.
- helm-unified-manifest-stream / candidate r2: official 1/5 new + 2/2 regression; native needs_validation; tokens 1267429; requests 59; correction feedback 0.
- mnamer-daemon-watch-lifecycle / candidate r1: official 50/51 new + 319/319 regression; native completed; tokens 469740; requests 23; correction feedback 0.
- mnamer-daemon-watch-lifecycle / baseline r2: official 51/51 new + 319/319 regression; native completed; tokens 597354; requests 31; correction feedback 0.
- mnamer-daemon-watch-lifecycle / baseline r3: official 47/51 new + 319/319 regression; native completed; tokens 1760438; requests 97; correction feedback 0.
- mnamer-daemon-watch-lifecycle / candidate r4: official 51/51 new + 319/319 regression; native completed; tokens 1025703; requests 47; correction feedback 0.
- helm-unified-manifest-stream / candidate r3: official 5/5 new + 2/2 regression; native completed; tokens 727017; requests 39; correction feedback 0.
- helm-unified-manifest-stream / baseline r4: official 5/5 new + 2/2 regression; native completed; tokens 1344881; requests 61; correction feedback 0.

## Interpretation and scope

No candidate correction event activated; this cohort cannot establish a benefit or harm from the feedback. Outcome variation before activation is not a feedback effect.

Direct production a3571e5 vs candidate ca7a27a; no priority-1/2 experiments, no extra review round. Same frozen PR16 numeric settings, model/effort/endpoint/streaming, prompt, tool schemas, task snapshots and acceptance. Only three runtime files differ. Two seen tasks with up to two repetitions per variant are not a full/unseen DeepSWE score. Official patch acceptance and native completion are separate; retain failures and unknown billing, and never replace primary results with a selected-success subset.

Local targeted/related 74/74; full 485/485; pre-paid CI six of six. Both zero-provider server preflights passed. Source archives, adapter/config/task/request hashes and provider usage were reconciled by the accompanying audit. Scripted tests demonstrate mechanics, not autonomous agent quality.

[Frozen methods](protocol.json) / [Preflight](preflight.json) / [Results](results.json) / [Observable diagnostics](diagnostics.json) / [Integrity checks](verification.json). No private reasoning or hidden verifier implementation inspected.
