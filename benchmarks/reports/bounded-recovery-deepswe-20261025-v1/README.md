# Priority 1: bounded context recovery — completed experiment

**Do not promote this candidate.** Parent official acceptance **4/4**, candidate **1/4**; observed change **-75 percentage points**. Parent 4,973,494 / candidate 4,773,189 all-attempt provider tokens; candidate change **-4.03%**.

Source baseline `a3571e56b597ac4f3b8458e929b4621c93e76c30`, candidate `836dfa5083f683a02e49c9fe96356dc8acc43913`. Frozen protocol commit `c49dec1f54dae490ae0fe4031856991efe2d386e` preceded paid calls. Original production prompt, full PR16 numeric settings, model/effort/endpoint/streaming, initial repositories and official acceptance were held fixed. Only agent/config runtime files differ. No Pi or Claude rerun.

## Every attempt

- baseline / helm-unified-manifest-stream / pair 1: official PASS, new 5/5, existing 2/2; native `cancelled`; 2,438,519 tokens, 97 submissions.
- candidate / helm-unified-manifest-stream / pair 1: official FAIL, new 0/5, existing 2/2; native `failed`; 2,275,732 tokens, 81 submissions.
- candidate / mnamer-daemon-watch-lifecycle / pair 1: official FAIL, new 50/51, existing 319/319; native `completed`; 416,102 tokens, 24 submissions.
- baseline / mnamer-daemon-watch-lifecycle / pair 1: official PASS, new 51/51, existing 319/319; native `completed`; 560,912 tokens, 26 submissions.
- baseline / mnamer-daemon-watch-lifecycle / pair 2: official PASS, new 51/51, existing 319/319; native `completed`; 605,280 tokens, 31 submissions.
- candidate / mnamer-daemon-watch-lifecycle / pair 2: official FAIL, new 50/51, existing 319/319; native `completed`; 502,695 tokens, 26 submissions.
- candidate / helm-unified-manifest-stream / pair 2: official PASS, new 5/5, existing 2/2; native `completed`; 1,578,660 tokens, 66 submissions.
- baseline / helm-unified-manifest-stream / pair 2: official PASS, new 5/5, existing 2/2; native `needs_validation`; 1,368,783 tokens, 65 submissions.

Native completed: parent 2/4, candidate 3/4. Native-completed and officially accepted: parent 2/4, candidate 1/4. Do not treat local completion as official correctness or official acceptance as local validation completion. Failed/cancelled attempts remain in totals. Unknown totals are never zero.

Both-officially-passed secondary subset: 1 pair(s), parent 1,368,783 / candidate 1,578,660 tokens, change +15.33%. This is not the full-cohort result. Parent native status was needs_validation while candidate completed, so this is not an equal-native-completion comparison.

## Mechanism evidence

One extra boundary recovery was observed in candidate Helm pair 1. Estimated input was 90,938 > 80,832. Actual assembled request bytes fell 226,445 -> 50,177, local estimated input 90,938 -> 20,349. This freed 176,268 serialized bytes and allowed execution to continue without changing output reservation or input guards. Local estimates/bytes are not provider usage.

The recovery summary itself used 24,366 provider tokens. After it, 39 subsequent model requests used another 1,324,631 tokens. First edit occurred at tool ordinal 115; the attempt ultimately stopped again at estimated input 82,425 > 80,832 after a build timeout. Official new tests passed 0/5 and existing tests 2/2. It avoided one immediate stop but did not finish the task.

The other candidate attempts never compacted. Candidate Mnamer pair 1 and pair 2 each passed 369/370 official checks and missed the nested-state-path log case. The feature was inactive there: these results do not prove that extra compaction caused the omission. Both parent Mnamer repeats passed 370/370. Candidate Helm pair 2 completed and passed 7/7 without compaction; its success likewise cannot be credited to recovery.

The two candidate Helm traces differ sharply: failed pair 1 made 90 reads and first edited at tool ordinal 115; successful pair 2 made 32 reads and first edited at ordinal 61. Repeated identical retrieval calls were 29 vs 13. Identical-parameter repeats are not necessarily useless when evidence has been removed or source changed. This motivates a separate retrieval-progress investigation, not a hard read limit or a requirement to edit prematurely.

Parent Helm pair 1 passed official 7/7 but reached the 1800-second agent limit while repeating a local suite containing a network-dependent chart-download assertion. All 97 model requests / 2,438,519 tokens were metered; native cancellation remains explicit. Its two adopted normal compactions reduced preview request bytes 167,826 -> 38,311 and 199,052 -> 47,002. Summaries did shrink context; later work grew it again.

## Interpretation and next direction

The adoption gate failed. Three of four candidate attempts did not exercise the changed recovery path, and the exercised attempt still failed. Eight attempts over two previously seen tasks are a small repeated screen, not a full/unseen DeepSWE score or proof that the flag caused the whole observed acceptance gap. No causal correctness or token benefit is established. A lower aggregate token count with poorer acceptance would not be an optimization.

Keep production PR16 configuration intact and leave this candidate default-off/draft. Do not add more unconditional recovery attempts based on this result. Priority 2 should independently investigate retrieval that makes no progress, evidence visibility/freshness and repeated patch failures, preserving useful rereads and exact-source safeguards. The existing residency invalidation tests already prevent an unchanged receipt standing in for absent source: do not assume that bug still exists. Run the next candidate from production, not on top of this failed experiment, and stop here for user review.

## Controls and verification

Eight interleaved attempts: two tasks, two repetitions per variant. 30 USD-equivalent control allocation each / 240 total; 128 transport submissions, 4096 tools, 900 seconds/request and 1800 seconds/agent. Controls are conservative bounds, not invoice costs. Explicit Internal Network Failure alone may retry the identical payload five times; retain unknown allocations and stop on unrecovered unknown. No replacement tasks or automatic relaunch.

Local targeted 63/63, complete regression 490/490, zero failures/skips. Windows/Ubuntu x Node 20/22/24 CI: six successes at frozen protocol head. Self-authored scripted recovery fixtures demonstrate bounded behavior, not live coding quality. Both source variants also passed zero-provider real-tool/retry/export/independent-patch server preflight. Source/archive/adapter/config/task/request/usage audits are in the verification artifact. Analysis uses observable operations and acceptance metadata, not private reasoning or hidden verifier implementation.

[中文结果](RESULTS.zh-CN.md) / [results](results.json) / [diagnostics](diagnostics.json) / [verification](verification.json) / [protocol](protocol.json) / [preflight](preflight.json)
