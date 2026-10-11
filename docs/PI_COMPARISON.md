# TEA / Pi comparison

[中文](PI_COMPARISON.zh-CN.md)

## Status

The harness and nine pinned fixtures are prepared. The installed Pi version is **0.87.1**. A local contract check exercised both real clients through the shared gateway: each read instructions and source, applied a patch, ran the public tests and completed. Its responses and usage values were scripted; there were **zero paid provider requests**.

**Provider token comparison: measured on 2026-10-11.** GLM-5.3-flash, enabled thinking, low effort and a shared 4,096-token output cap were used. The 64,000-byte profile measured all nine pairs: TEA 168,282 tokens / 9 accepted; Pi 161,046 tokens / 7 accepted. TEA consumed 4.49% more, including two Pi input-limit failures. A separate 80,000-byte rerun of all three large tasks accepted 3/3 on both sides: TEA 117,126 versus Pi 107,674 tokens, or 8.78% more for TEA. These are separate single-repetition profiles, not evidence of consistent savings. [Report, evidence and charts](../benchmarks/reports/tea-vs-pi-glm-20261011/README.md).

An earlier paid pilot was excluded because Pi inherited changing instructions from ancestor directories. Its usage remains in private records and the cost cap. All accepted results were rerun in clean external workspaces. Total conservative accounting for the smoke, excluded pilot and both isolated profiles was $0.692810 against a $3 cap; this is not a provider invoice.

## Matching the initial conditions

- Every pair receives the same task text and clones the same pinned Git commit. A SHA-256 fingerprint of every repository file is checked before either agent starts.
- Live workspaces are created outside the TEA checkout. Ancestor directories are checked for `AGENTS`/`CLAUDE` instruction files before every run; unexpected files block execution. Pi retains native discovery of the fixture's own instructions. This prevents unrelated repository guidance from entering only Pi's prompt.
- Both use the same Anthropic Messages endpoint, model ID, thinking mode, reasoning effort and output cap. The gateway replaces those controls with a single common profile and records the controls actually sent upstream.
- Input byte guard, per-task request cap and per-agent/task cost allowance are equal. The total budget covers the entire suite. A reservation must fit before a request can be submitted.
- Each run has a fresh conversation. Pi uses a fresh configuration directory with no stored session, extensions, skills or prompt templates. Automatic retries, compaction and cache warming are disabled. TEA starts a fresh native session.
- Agent order alternates between TEA-first and Pi-first. Provider cache state is external and cannot be cleared by this harness. Cache directives remain native; token totals include **all** input tokens, including cache reads and writes.
- TEA's and Pi's prompts, discovery behavior and tool APIs remain native. This compares the two stated agent configurations. Pi uses `read`, `edit`, `write` and `powershell` on Windows (`bash` elsewhere). It does not load user customization.

Request controls and initial fingerprints must agree before the report is eligible for token ratios. The TEA source snapshot and Pi CLI hash are recorded; TEA's source is checked during and after the experiment.

## Tasks and scale

The suite has three task families at three repository sizes, for **nine paired tasks**:

- Small: 12 files, approximately 110 lines.
- Medium: 120 files, approximately 1,400 lines.
- Large: 1,200 files, approximately 14,400 lines.

The task families repair primitive cache-key collisions, retry-budget off-by-one behavior and Unicode code-point truncation. Larger repositories add generated, unrelated modules. These are self-authored JavaScript fixtures; increasing repository size does not increase the complexity of the target bug. They are an exploratory repository-size experiment, not diverse production projects or an unseen real-world holdout.

Public tests pass on the initial version, while independent assertions fail. Final acceptance requires public and independent assertions to pass, an independent completion witness, modifications limited to the relevant service, and an agent completion status. Test files are unchanged. Independent assertions execute after the agent finishes, outside its workspace. There is no OS sandbox, so this is not a confidential adversarial evaluation.

## Prepare without an API

Node.js 20+, Git and an installed Pi CLI are required. Pin the Pi version you intend to report. `--pi-package` can point to its installed package directory; the default is the Windows global npm location.

```powershell
node scripts/compare-pi.mjs --mode prepare --run-id tea-pi-prepare-NEW
node scripts/check-pi-protocol.mjs
node --test tests/comparison.test.mjs
```

The preparation step validates all nine initial fixtures. The protocol check is local and scripted; its values cannot be used by the provider-token chart.

## Run a live experiment

Configure the credential in the process environment. Use a model/endpoint that supports the selected thinking mode, effort and output limit. Do not place keys in tracked files or CLI arguments.

```powershell
$env:ANTHROPIC_BASE_URL = 'YOUR_ANTHROPIC_MESSAGES_BASE_URL'
$env:ANTHROPIC_MODEL = 'YOUR_MODEL_ID'
$env:TEA_REASONING_EFFORT = 'low'
$env:TEA_THINKING_MODE = 'enabled'
$env:TEA_MAX_OUTPUT_TOKENS = '4096'
$env:TEA_MAX_REQUEST_INPUT_TOKENS = '64000'
$env:TEA_INPUT_PRICE_USD_PER_MTOK = 'YOUR_INPUT_RATE'
$env:TEA_OUTPUT_PRICE_USD_PER_MTOK = 'YOUR_OUTPUT_RATE'
$env:TEA_MAX_COST_USD = 'YOUR_TOTAL_BUDGET'

node scripts/compare-pi.mjs --mode live --repeat 3 --run-id tea-pi-live-NEW
```

`ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) must already be configured. All run IDs must be unique. The explicit common output cap overrides both clients' defaults. The example uses enabled thinking, as in the GLM run; choose a mode supported by your endpoint. The 4,096-token cap worked in this experiment and is not a verified setting for every model. Both agents receive the same selected cap. The input setting is a conservative serialized UTF-8 byte guard despite the environment variable's legacy `TOKENS` name; it is not an exact tokenizer limit.

The suite budget is divided equally across all planned agent/task runs. For each request, the conservative reservation is:

```text
(input byte bound × max(input rate, cache-write allowance)
 + output cap × output rate) / 1,000,000
```

The default cache-write allowance is twice the input rate; cached reads are conservatively costed at the ordinary input rate. Accounted USD is a budget estimate under supplied rates, not a provider invoice. The runner rejects a total budget that cannot reserve one request for each planned run. Actual task completion may need several requests. `--scales small` selects a smaller initial experiment; `--repeat 1` is exploratory.

Missing, malformed or interrupted usage stops further provider submissions and retains the full request reservation. Completed request totals and any incomplete reported lower bound remain in the ledger. Failures and budget stops are recorded, not dropped from the experiment.

## Reports and charts

Each run saves these files under `benchmarks/results/<run-id>/`:

- `comparison.json`: versions, controls, snapshots, acceptance and token totals.
- `wire-usage.jsonl`: incremental per-request evidence, including provider usage, hashes, guards and reservations.
- `summary.json` and `REPORT.md`: acceptance coverage, all-task comparisons and the separately labeled subset where both agents passed.
- `tea-vs-pi.png` and `tea-vs-pi.svg`: automatic chart exports when valid live data is available.

Python with matplotlib is needed for the chart. Set `TEA_PYTHON` if your interpreter has a different executable path. Export again with:

```powershell
node scripts/chart-pi.mjs benchmarks/results/tea-pi-live-NEW/comparison.json
```

The chart separates input and output, shows acceptance beside every measured run, and marks failures. Missing usage is labeled unknown, never a zero-height savings bar. Overall token reduction is withheld when any planned pair has unknown usage. The both-passed subset is shown separately so failures cannot silently disappear.

Reported token reduction is `(1 - TEA total / Pi total) × 100%`. A negative result means TEA consumed more tokens. Lower tokens with lower acceptance do not satisfy TEA's performance-preserving goal. One repetition cannot establish stable savings or generalization; repeat runs and evaluate different task families and real repositories before publishing a broad claim.

Raw benchmark workspaces are Git-ignored. Review and copy a completed report/chart into `benchmarks/reports/` when preparing a public result; the harness does not automatically publish or push it.

## Pi references

- [Pi source and README](https://github.com/earendil-works/pi)
- [Model configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)
- [CLI interface](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md)

The locally installed package documentation determines the options actually executed; GitHub main may describe a newer release.
