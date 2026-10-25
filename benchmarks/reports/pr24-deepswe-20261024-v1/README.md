# PR24 DeepSWE fresh-output guidance screen

Completed; **do not promote this candidate**. Official whole-task acceptance is **2/4 (50%)**, versus the previous PR22 cohort's **3/4 (75%)**. This is a 25 percentage-point lower observed acceptance rate. The parent was not rerun, so this is descriptive, not causal evidence that the prompt caused the difference.

## Attempts

- Helm repeat 1: official 7/7, passed; native `needs_validation`; **1,567,257 tokens**, 80 requests.
- Mnamer repeat 1: official 370/370, passed; native `completed`; **524,799 tokens**, 29 requests.
- Mnamer repeat 2: official 368/370, failed (new 49/51, existing 319/319); native `completed`; **863,047 tokens**, 38 requests.
- Helm repeat 2: official 1/7, failed (new 0/5, existing 1/2); native `MODEL_CONTEXT_LIMIT` failure; **1,265,197 tokens**, 51 requests.

All four attempts are fully metered: **4,220,300 tokens** across 198 submitted requests, comprising 2,713,062 input, 109,734 output, 1,397,504 cache-read and zero cache-creation tokens. Thinking is included once in output. There were no network retries or unknown-usage responses. The incomplete Helm attempt remains in totals and acceptance.

The prior cohort used 4,824,790 tokens. The observed total is **12.53% lower**, with worse task acceptance; this is not a useful optimization claim. By task, Helm used 28.82% more and Mnamer 47.15% less than their respective historical totals. These are small, noncontemporaneous repeated samples, not controlled treatment effects.

## Behavior and failures

Helm repeat 1 passed official checks but retained a local unresolved `go test ./pkg/action/`. Its `TestPullRun_ChartNotFound` expected an HTTP 404, while the container could not reach the network. The native `needs_validation` state is preserved; it is not counted as native completed. Normal command-package tests and the previously timed-out build were rerun successfully. One model compaction occurred.

Mnamer repeat 2 failed the batch-size-zero and nested-state-path log cases. Its model-authored state/log write functions omitted parent creation, consistent with the nested-path failure; the passing repeat created those parents. The batch loop contains a zero-budget guard, so the exact cause of the batch-zero failure is **not established** by the failure name alone. The prompt did not reliably produce the desired edge-case coverage. This inspection did not access hidden verifier implementations.

Helm repeat 2 made 22 repeated identical read/search/recall calls and first edited at tool ordinal 82. Two compactions completed with normal `end_turn` and summary outputs of 1,274/1,512 tokens. It then reached the unchanged PR16 input guard: estimated 83,984 > 80,832 tokens, with 131,072 output tokens reserved in a 216,000-token window. The blocked request was not submitted. No validation command was run before stopping, so the partial patch failed official checks. This was not a 1,200-token summary truncation or a provider network interruption.

## Method and decision

Runtime `ae96163c05071c896cb37456b6216745c11bc2a9`; protocol frozen and pushed as `c9b847406ef4bb03c4413795468f9274c19d9d8e` before paid calls. Only `src/prompts.mjs` differs in the runtime archive from PR22. Full PR16 configuration, command policy and five-retry policy were retained. Same official GLM-5.3-flash endpoint, enabled/low thinking, streaming, tasks, initial repositories and acceptance criteria as PR22. Pi and the parent were not rerun.

Two previously seen tasks, repeated twice, are not a full or unseen DeepSWE score. Officially accepted and native-completed counts are reported separately: two officially accepted, two native completed, and one satisfying both. Do not weaken official acceptance or exclude the context-stop failure to improve the result. PR24 remains a draft experiment; production is unchanged.

The next separate investigation should examine repeated retrieval and compaction recovery, plus observable edge-case coverage. Preserve PR16 as the reference and test any change independently rather than adding more mandatory prompt text based on this result.

Control bounds: 30 USD-equivalent per attempt / 120 total; 128 requests, 4096 tools, 900 seconds/request and 1800 seconds/agent. These are conservative controls, not invoices. All four attempts completed without a relaunch or replacement.

[中文分析](RESULTS.zh-CN.md) · [Results](results.json) · [Diagnostics](diagnostics.json) · [Verification](verification.json) · [Frozen protocol](protocol.json) · [Zero-provider preflight](preflight.json)
