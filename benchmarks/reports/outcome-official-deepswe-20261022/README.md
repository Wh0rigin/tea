# TEA outcome validation: official GLM DeepSWE run

**Completed: TEA official full-task acceptance **1/4**; historical Pi **4/4**. All **213** TEA requests independently metered,4,593,245 tokens.** The single official-pass/known-usage historical pair uses **137.78%** more tokens for TEA; its client still stopped at a local context guard. No code-only benefit claim. See [Chinese results and diagnostics](RESULTS.zh-CN.md), [data](results.json), and [verification](verification.json).

Protocol frozen before task inference. Candidate runtime: `819bd728039a59ac7e9bb5ed1a0080c9f14ecbd8`. Two previously seen DeepSWE tasks, two repetitions, **four TEA attempts only**. Pi 0.87.1 results are reused from `../native-pi-s0-20261022/deepswe-results.json`; no Pi remeasurement.

Provider: official BigModel Anthropic-compatible endpoint, `https://open.bigmodel.cn/api/anthropic`; model `glm-5.3-flash`, streaming, thinking enabled/low, context216000, output ceiling131072. Original limits retained:128 submitted requests,4096 tools,900s per request,1800s agent wall,10USD conservative control allocation per trial/40USD suite; separate endpoint probe0.10USD allocation. These are guard allocations, not official CNY invoice estimates. Official published prices are0.8CNY input/0.23CNY cached input/2.8CNY output per million tokens.

Provider credentials are supplied only through process memory and an encrypted SSH stdin channel; task containers use a relay placeholder. No keys in source, archives or reports. All server assets remain under `/home/hjj`.

Task manifests, initial commits and instructions, client request controls, Docker images, command profiles and official separate verifier are held fixed. Native offline read/edit/CLI/SSE/patch-export preflight passed with10 synthetic responses and9 actual tool operations,0 provider calls; this is not official task acceptance. One separately metered official endpoint probe used16 input+3 output tokens and had message_stop.

**Provider endpoint changed from the historical Pi and historical TEA results. Source and provider changes are confounded: comparisons are historical/descriptive, not a same-provider controlled estimate of code benefit.** Preserve failed attempts, unknown usage and original allocations; never restart/retry an unknown-billed trial. Failed/unknown trials do not contribute zero to token bars. Report official full-task acceptance separately from native client completion.

The historical Pi Helm repeat2 has unknown usage despite official acceptance. Exclude it from known-token comparisons; retain it in acceptance. Scope is a small previously seen subset, not a full DeepSWE score or unseen qualification. Host-specific harness adapters remain private with hashes in protocol.json; full public paid reproduction is limited.

Official references: [connection endpoints](https://zcode.z.ai/en/docs/configuration), [model](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash), [pricing](https://docs.bigmodel.cn/cn/guide/start/pricing).
