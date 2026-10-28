# Priority 2: retrieval progress feedback vs unmodified production

Status: stopped after six attempts under the predeclared quality-futility rule. Not recommended for production; keep the flag off. No causal benefit established. [中文结果](RESULTS.zh-CN.md).

Observed official acceptance: baseline 3/3 attempted, candidate 1/3 attempted. Each variant has one unstarted attempt. Candidate maximum possible acceptance is 2/4, below the baseline minimum of 3/4. Unstarted attempts are neither failures nor zero-token samples. No complete-cohort acceptance delta or token ratio is reported.

All six attempts were fully metered: baseline subtotal 3,497,530 tokens / 151 requests; candidate subtotal 5,682,088 / 270 requests. These are partial-cohort subtotals, not a complete benchmark benefit estimate. No retries or unknown usage occurred. Two baseline native executions were cancelled at the time limit despite officially accepted patches; native-completed-and-officially-passed counts are 1 per variant. Official acceptance does not imply native completion.

No live candidate notice activated in any attempt. Paired first request hashes match. Therefore outcome differences cannot establish an effect of the feedback; the experiment primarily exposes insufficient activation coverage. Identical-parameter reads are not necessarily identical outputs or consecutive observations. Edits, tests, shell operations and novel results reset the streak. The candidate failures concerned Mnamer lifecycle start/restart (three new tests) and nested state-path logs (one new test). Self-authored tests passing did not establish those behaviors. See [results](results.json), [observable diagnostics](diagnostics.json) and [integrity checks](verification.json). The three completed pairs are retained with all failed attempts; the remaining Helm pair was not started. Neither a filtered-success ratio nor a full/unseen DeepSWE score is claimed.

Parent `a3571e56b597ac4f3b8458e929b4621c93e76c30` vs candidate `b62adb0255de6126337e1815f8ba085212ebc0eb`. No PR24 prompt, no priority-1 recovery; original PR16 numeric settings and original tool definitions/permissions/verification retained. This candidate only adds default-off bounded feedback after repeated structured lookups. All tools execute, original outputs remain intact, and necessary rereads remain permitted.

At most eight serial interleaved attempts: two seen DeepSWE tasks, two repetitions per variant. Same official GLM-5.3-flash endpoint, enabled/low thinking, streaming, 131072 output ceiling, 216000 context and task initial snapshots/acceptance. This is not a full/unseen benchmark score; Pi is not rerun.

Controls: 30 USD-equivalent/attempt, 240 maximum total; 128 transport submissions, 4096 tools, 900s request / 1800s agent. Controls are conservative bounds, not invoices. Existing explicit Internal Network Failure retry5 unchanged. Retain unknown allocations and stop on unrecovered unknown/infrastructure failure; never treat unknown or unstarted as zero, no replacement/relaunch.

Predeclared rejection-only futility: between trials, when every completed official reward is known, stop if candidate accepted + candidate unstarted < baseline accepted. Record the acceptance bounds and every unstarted trial; report no complete-cohort token ratio after early stopping. No early acceptance or changed criteria during trials.

Local targeted 74/74 and complete 491/491 passed, no failures/skips. Both server variants passed 14 scripted responses / 12 real tools / explicit error recovery / independent patch validation with zero provider calls. Candidate emitted one feedback event; parent none. Scripted fixtures do not measure model quality or token savings. Measure actual live activation and behavior before claiming benefit; no benefit established if never activated.

[Protocol](protocol.json) / [Preflight](preflight.json). No private reasoning or hidden verifier implementation inspection.
