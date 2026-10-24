# Production PR22 DeepSWE capability screen — complete

[中文](RESULTS.zh-CN.md)

Runtime: production `a3571e56b597ac4f3b8458e929b4621c93e76c30`. Protocol frozen before model calls in `027f8a4172fffae710ac97a36888352d4f28e13d`.

## Outcome

- **4/4 attempts evaluated; 3/4 whole tasks passed (75%).** These are two previously seen tasks repeated twice, not a full/unseen DeepSWE score.
- All four agents completed normally with their own validation passing. Official acceptance is reported independently: Mnamer repeat 1 still missed one check.
- Complete all-attempt provider tokens: **4,824,790**, including the failed task. **223** submitted requests. All four attempts fully metered; no network retries or unknown usage.
- Automatic summary compactions: **0**; ContextOS remained enabled. This screen cannot establish benefits of summary compaction or isolate ContextOS effects.
- PR19 requirement review is absent from production and was not enabled. Pi/Claude/parent revisions were not rerun. No causal token-saving or correctness-uplift percentage is claimed.

- helm-unified-manifest-stream / repeat 1: new 5/5, original 2/2; native completed; **1,323,164 tokens**, 57 model requests.
- mnamer-daemon-watch-lifecycle / repeat 1: new 50/51, original 319/319; native completed; **1,391,537 tokens**, 61 model requests.
- mnamer-daemon-watch-lifecycle / repeat 2: new 51/51, original 319/319; native completed; **1,234,506 tokens**, 53 model requests.
- helm-unified-manifest-stream / repeat 2: new 5/5, original 2/2; native completed; **875,583 tokens**, 52 model requests.

Token components: input **2,728,505**, output **71,005**, cache read **2,025,280**, cache creation **0**. Thinking is counted once in output. Estimates, wire bytes and synthetic preflight usage are not substituted for provider tokens.

## What execution showed

The first Helm run executed the same quoted multi-test regex twice: an actual hook-filter assertion failed, then passed after changes. The command was not rejected as a shell pipeline. A separate actual pipeline/redirection attempt was still blocked, as intended. This demonstrates the parsing fix in a real coding trajectory, not its causal performance impact.

Mnamer repeat 1 passed 50/51 new and 319/319 original official checks. The sole failure was `test_daemon_logs_respects_state_path_with_subdirectory`. Inspection of the model-authored patch found state writes and log appends without parent-directory creation, consistent with the failed scenario. Exact official traceback and hidden verifier implementation were not inspected.

This run also spent several rounds on 120-second self-test timeouts and unsupported `--timeout=90`. Plugin installation was denied by the frozen command policy. The agent then added root `conftest.py` implementing POSIX signal timers; it did not merely ignore the option. This is additional test-infrastructure scope and cost, not a TEA runtime change. Local passes alone did not prevent the remaining requirement omission.

Both tasks also encountered blocked inline scripts, pipelines or cleanup commands. Invalid patch attempts and guessed Go APIs added repair rounds. These operational costs remain in all-attempt totals. The complete operation audit is in diagnostics; no private reasoning was read.

## Controls and limits

Official GLM-5.3-flash, enabled thinking /low effort, streaming; original PR16 quality model/context settings, 24KB working set, 216k context, 131072 output cap, reserved-output scheduling and production five explicit-error retries. Four serial attempts: Helm r1, Mnamer r1, Mnamer r2, Helm r2. Same pinned original task snapshots/instructions and independent official verifier.

Controls: 30 USD-equivalent per attempt, 120 this cohort, 128 submitted requests, 4096 tools, 900-second request timeout, 1800-second agent wall. Conservative control estimates are not an invoice. Prior failed cohorts/unknown reservations remain separate; no task replacement or automatic paid relaunch. No runtime or frozen harness changes after model calls began.

The sample is narrow and seen; 75% is only this four-attempt task acceptance, not a general benchmark score. The historical PR16 3/4 and PR19 3/4 have different run identities/conditions and are not interchangeable evidence. No contemporaneous baseline was run, so historical token differences cannot be attributed to PR22.

## Verification

[Results](results.json) · [Operation diagnostics](diagnostics.json) · [Frozen protocol](protocol.json) · [Zero-provider preflight](preflight.json) · [Publication audit](verification.json)

Frozen protocol/source/archive/config/task hashes, request identities, usage components, retry identities and bounded working-set audit passed. Preflight executed nine real tool operations, quoted Node regex, one synthetic retry, independent patch validation and nine relay unit tests with zero provider calls. Production fix regression had 27/27 targeted, 480/480 full, and six Windows/Ubuntu Node 20/22/24 CI jobs passing; those offline tests are not DeepSWE score evidence. This report adds no runtime code and does not alter previous results.
