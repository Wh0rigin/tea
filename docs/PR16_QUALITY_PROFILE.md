# PR16 quality profile

## Decision

Correctness is the maintainer's first priority. The GLM daily CLI defaults to `pr16-quality`, preserving the complete model and context algorithm settings of the accepted PR16 candidate, rather than combining its source working set with subsequent Pi budget defaults. Other configured models use the existing Pi fallback; explicit profile selection remains available.

Historical runtime: `8ed56262b3c41d701f8a3a55834683af2e1331ef`; protocol freeze: `3e3aa78`. The sanitized, deeply frozen manifest is [src/profiles/pr16-frozen.json](../src/profiles/pr16-frozen.json). Credentials and temporary relay routing are excluded. The official provider endpoint is retained.

## Preserved settings

- GLM-5.3-flash, streaming, enabled thinking, low effort; 131,072 output ceiling.
- 216,000-token window; reserved-output scheduling; 4,096 safety reserve; 80% trigger. Input limit 80,832 and trigger 64,665 are local estimates, not measured provider usage.
- Automatic compaction, 16,000 recent bytes, 16,384 summary reserve, at most two compactions per turn; fitted output experiment disabled.
- ContextOS target 32,000 bytes, source working set 24,000 bytes, two recent rounds; original source freshness and validation protections remain.
- V1 retrieval, eight initial files, full history; automatic memory GC, 256KiB cache, 4MiB resident bound and 512MiB session storage bound.
- Original request byte guard, timeout, capability feedback and native file creation. No S7 completion-review behavior is added.

Every original exported configuration field is retained in `expectedConfig`. `loadPr16BenchmarkConfig()` reconstructs that configuration without credentials; regression tests compare every field. This is configuration parity, not identical source code or a rerun of the model experiment.

## Daily use versus benchmark controls

Daily use retains the user's requested unlimited monetary and tool-call defaults. Provider prices are supplied by the user, never inferred from historical experiment rates. All other frozen algorithm/model fields are compared with the original snapshot; `/status` reports explicit differences.

The exact historical benchmark settings remain separate: 4,096 tool calls, USD 10 allocation per attempt, 128 requests, 900-second request timeout and 1,800-second agent wall limit; the eight-attempt cohort had USD 80 total allocation. Allocations and historical price estimates are not actual bills or current prices. The profile loader does not enforce external request/wall/cohort controls; a live harness must enforce them separately and freeze a fresh protocol before calls.

## Configuration

In `~/.tea/config.json`, add `"configurationProfile": "pr16-quality"` while keeping existing credentials. Use `"pi"` to select the alternate profile. Options and explicit environment/user settings override defaults. `TEA_CONFIG_PROFILE` selects the profile; `contextosWorkingSetBytes` and `compactionMaxPerTurn` are also supported JSON overrides. Restart the CLI after changing settings.

For other models, select provider-supported capacities explicitly. Choosing the frozen profile for another model will show differences in `/status`; it does not establish equivalent behavior.

## Evidence and limits

[Original paid report](../benchmarks/reports/source-working-set-ab-deepswe-20261023-v2/RESULTS.zh-CN.md): two seen tasks, two paired repetitions each. Official acceptance rose from 2/4 to 3/4. Total provider tokens fell 6.66%, but the comparable both-passed/native-complete subset increased 25.26%; the preregistered efficiency gate failed. Activation is an explicit correctness-first decision, not a claim of stable token savings or universal 75% success.

Current offline validation: 467 passed, one skipped, zero failed, including four new profile tests and existing working-set freshness, compaction and Pi compatibility coverage. No paid API calls were made for this activation.
