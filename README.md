# TEA

<p align="center">
  <img src="assets/tea-logo.png" alt="TEA — Token Efficient Agent" width="320">
</p>

**English** | [Chinese](README.zh-CN.md)

**TEA Coding Agent**

> Every optimization serves one goal: save tokens while preserving performance.

TEA is an independent terminal coding agent built with Node.js. It brings together an agent loop, workspace tools, an Anthropic Messages adapter, token accounting, and reproducible experiments.

Our mission is to reduce token consumption while preserving task correctness, code quality, and execution performance. We measure each change, record failures and tradeoffs, and keep a recovery path when reduced context is insufficient.

## Getting started

TEA requires **Node.js 20 or newer** and **Git**. It has no npm runtime dependencies. Run it from a local checkout:

```sh
cd token-efficient-coding-agent
npm run tea -- --help
```

Live tasks require a compatible Anthropic Messages endpoint, a model supported by that endpoint, an API key supplied through the process environment, current input/output prices, and a positive spending limit.

Configure these values before starting TEA. The following PowerShell example uses placeholders; replace them with your provider's settings and USD prices per million tokens:

```powershell
$env:ANTHROPIC_API_KEY = '<API_KEY>'
$env:ANTHROPIC_BASE_URL = '<MESSAGES_API_BASE_URL>'
$env:ANTHROPIC_MODEL = '<MODEL_ID>'
$env:TEA_INPUT_PRICE_USD_PER_MTOK = '<INPUT_PRICE>'
$env:TEA_OUTPUT_PRICE_USD_PER_MTOK = '<OUTPUT_PRICE>'
$env:TEA_REASONING_EFFORT = 'low'
$env:TEA_THINKING_MODE = 'adaptive'

npm run tea -- "Fix the session expiration bug" --workspace ../my-project --max-cost-usd 0.10
```

Use your credential manager or a secure environment injection mechanism for real keys. The selected endpoint and model must support the configured thinking mode and effort settings. TEA currently accepts `low`, `high`, and `max` effort, and `adaptive` or `enabled` thinking.

## How TEA works

Give TEA a task and a workspace. It discovers files, reads source evidence, applies exact local patches, and runs validation commands. After an edit, the runtime requires successful validation before reporting completion.

- **Progressive discovery.** Start with a small ranked file inventory, then expand through paginated listings and scoped searches. A partial search result is not proof of repository-wide absence.
- **Evidence reuse.** Repeated reads can return a short reference when the same complete source range was already shown and its hash is unchanged.
- **Session vocabulary.** After a failed search, the task model can discover a real corresponding code name and save a mapping backed by source it has read. The runtime checks current evidence and name presence; the model judges semantic relevance. Mappings stay within one run.
- **Text discovery across languages.** Unknown suffixes are checked for valid UTF-8 text without NUL bytes. Ordinary excluded folders can be explored explicitly. File size and scan limits still apply.
- **Bounded command output.** Long logs retain their beginning, end, and full stream hash. Omitted middle content may still need further diagnosis.
- **Accountable usage.** Request usage, costs, and experiment diagnostics are recorded locally. Missing provider usage remains unknown rather than being reported as zero.

File edits stay inside the selected workspace. Allowlisted validation and read-only Git commands run directly; other shell commands require interactive approval. These checks do not provide operating-system isolation.

## Context controls

The default `v1` strategy starts with up to eight ranked paths. You can adjust the inventory or compare it with the original listing strategy:

```sh
npm run tea -- "Fix the pagination bug" --initial-file-limit 16 --max-cost-usd 0.10
npm run tea -- "Fix the pagination bug" --context-strategy baseline --max-cost-usd 0.10
```

Optional tool history compaction replaces older, long discovery results and successful logs with recovery records:

```sh
npm run tea -- "Fix the pagination bug" --history-strategy compact-tools --history-keep-recent 2 --max-cost-usd 0.10
```

Source evidence, failures, patch receipts, recent results, and original assistant blocks remain available. The authoritative history stays intact. Requests fall back to full history when compaction plus its guidance does not reduce the measured input size. Full history remains the default.

## Experiments

Run offline experiments without a provider connection:

```sh
npm run benchmark:replay
npm run benchmark:runtime
npm run tea -- benchmark memory --history-keep-recent 2
```

Current recorded results:

- **V1:** offline scripted fixtures reduced tool output characters by **23.41%**, with **12/12** acceptance checks on both sides. See the [V1 report](benchmarks/reports/v1-runtime.md).
- **V2:** an artificial verbose-log stress experiment reduced cumulative prepared input bytes by **20.90%**, with **12/12** scripted acceptance checks on both sides. Ordinary traces showed **0%** reduction. See the [V2 report](benchmarks/reports/v2.md).
- **V3:** reasoning-effort routing and request-budget checks are local candidates. Routing has not been integrated into the live agent loop. See the [V3 report](benchmarks/reports/v3.md).

These are offline character/byte measurements, not verified provider token savings or model task success rates. Live paired evaluation, broader language coverage, and independent holdout evaluation remain unfinished. Recent session-vocabulary and discovery changes have no measured savings yet.

## Usage records and budgets

Runs write their ledger to `.tea/runs/<run-id>/`. By default, records contain hashes and counts rather than raw prompts or source. `TEA_STORE_RAW=1` enables local raw storage.

TEA reserves request costs against your configured budget before sending a request. It does not guess provider prices. Failed transmissions retain their reservation; missing or invalid usage leaves the complete actual token total unknown. Estimates, serialized bytes, and provider-reported tokens are recorded as separate measurements.

## Development

Run the project's tests when working on an implementation change:

```sh
npm test
```

Optimization work should record its hypothesis, baseline, candidate, quality checks, measurement unit, and limitations. Improvements must be evaluated on tasks beyond the examples used to design them.

## Documentation

Supporting research documents currently include Chinese content.

- [Optimization record and generalization review](docs/TOKEN_OPTIMIZATIONS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Benchmark specification](docs/BENCHMARK_SPEC.md)
- [Experiment log](docs/EXPERIMENT_LOG.md)
- [Version roadmap](docs/VERSION_ROADMAP.md)
- [Project progress](PROGRESS.md)

## License

[MIT](LICENSE) — Copyright (c) 2026 Wh0rigin.
