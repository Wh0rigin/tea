# PR19 continuation: complete four-attempt result

[中文](RESULTS.zh-CN.md) · [Previous interrupted cohort](../pr19-r5-deepswe-20261023-v3/README.md)

All **4/4** previously unstarted schedule entries completed evaluation in this separate cohort. Runtime archive `46a475393e5afbe14edc3fdd54ab73ab208a07bf`, protocol frozen before calls in `08b4849c6b68b882c2e524722a35ccbd4337d0f7`. Same official GLM-5.3-flash, enabled/low, streaming, complete PR16 model/context profile and five explicit-error retries in both arms. Only requirementReview differs. Pi/Claude not rerun.

## Results

- Official full-task acceptance: baseline **0/2**, candidate **1/2** (observed +50 percentage points across only two seen tasks).
- Native completion: baseline 1/2, candidate 2/2. Candidate review triggered once on each task.
- Complete all-attempt provider tokens: **1,369,100 → 3,075,019**, an **increase of 124.60%**. Failures are retained, not assigned zero or removed.
- Both-passed/native-completed pairs: **0/2**. No equal-quality efficiency ratio is available.
- All four attempts are fully metered; no network retry or unknown usage occurred in this continuation.

- helm-unified-manifest-stream: baseline 861,306 → candidate 1,836,983 provider tokens (+113.28%); full pass False → False.
- mnamer-daemon-watch-lifecycle: baseline 507,794 → candidate 1,238,036 provider tokens (+143.81%); full pass False → True.

Helm candidate passed 1/5 new and 2/2 original checks, despite passing its local tests. Failure names concern deterministic ordering through install/template/upgrade entry points. Review added tests for upgrade/get-manifest but did not repair product code. Baseline performed 65 reads and no source edit, exhausted two automatic compactions and hit a local input guard: estimated 83,283 > 80,832 with a 216,000 window, 131,072 output reservation and 4,096 safety reserve. That final blocked request was not submitted or billed.

Mnamer baseline passed 47/51 new and 319/319 original checks; its four failures concerned start/restart/status lifecycle. Candidate passed all **370/370**. Candidate real-entry lifecycle probes and product repairs occurred before review; review later tested dry-run input/state behavior and reran local tests without further product repair. Therefore this trajectory does not establish that review caused the acceptance difference.

## Review cost and interpretation

Helm post-review: 20 model requests, **675,440 tokens**. Mnamer post-review: 11 requests, **103,305 tokens**, including compaction. These are observed follow-up costs, not causal overhead estimates. Trajectories already differed before the review trigger. Quoted Go test regex was blocked by the existing shell filter; separate commands succeeded.

**Verdict:** observed higher acceptance with substantially higher all-attempt tokens; no demonstrated token optimization or causal quality benefit. Baseline early termination also shortens its token count. Keep review default off pending maintainer review. No claim of statistical significance or unseen-task generalization.

## Earlier records retained

Together v3 and v4 have attempted the original eight scheduled entries: candidate 3/4 passed, baseline 1/4. These are two repeats of two seen tasks, not four independent tasks, and one baseline failure is transport-confounded. Candidate complete total is 5,883,005 tokens; baseline full total and combined reduction remain **unknown** because both v3 baselines have missing usage. Do not compare this 3/4 to historical PR16 as the same benchmark result.

Controls: 30 USD-equivalent per attempt, 120 additional allocation for this continuation; prior 60 unknown allocations retained separately. Estimates are controls, not an invoice. Unit is provider input + output + cache read + cache creation, with thinking counted once in output.

## Evidence

[Results](results.json) · [Diagnostics](diagnostics.json) · [Frozen protocol](protocol.json) · [Preflight](preflight.json) · [Publication audit](verification.json)

Source/config/task hashes, request hashes and provider usage reconciliation, bounded review activation, retry identity and working-set limits passed audit. Zero-provider container preflight passed both variants and nine relay unit tests. No runtime/harness edits after paid launch. Existing integration regression: 487 passed, one skipped, zero failed (not rerun for this report-only change).
