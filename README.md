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

## Interactive terminal

Start a continuous conversation:

```sh
npm run tea -- --interactive --workspace ../my-project --max-cost-usd 0.10
```

With the CLI linked locally (`npm link`), running `tea` without a task opens the same interface. A quoted task keeps the original single-task mode; `--interactive "task"` starts a conversation with that task.

Preview the interface without credentials or API calls:

```sh
npm run tea -- --demo
```

The terminal shows TEA branding, streamed answer lines, tool progress, small patch previews, and session token/budget status. Use `/tools` or `/tools N` to expand retained tool results, `/diff` for a Git diff preview, `/status` for usage, and `/help` for all commands. End an input line with a backslash to compose a multi-line task.

Press **Esc** or **Ctrl+C** to stop a running turn. Completed edits are retained, and outstanding validation remains required. `/new` clears the conversation and learned vocabulary while retaining spending and outstanding edits; `/clear` only clears the display. The configured cost and input budgets cover the entire terminal session. `/exit` closes it.

The demo uses scripted responses and read-only local tools. It does not solve coding tasks or provide model usage measurements. Conversation state is currently kept in memory; sessions cannot yet be resumed after exiting. See the [terminal guide](docs/TERMINAL.md).

## How TEA works

Give TEA a task and a workspace. It discovers files, reads source evidence, applies exact local patches, and runs validation commands. After an edit, the runtime requires successful validation before reporting completion.

- **Progressive discovery.** Start with a small ranked file inventory, then expand through paginated listings and scoped searches. A partial search result is not proof of repository-wide absence.
- **Evidence reuse.** Repeated reads can return a short reference when the same complete source range was already shown and its hash is unchanged.
- **Session vocabulary.** After a failed search, the task model can discover a real corresponding code name and save a mapping backed by source it has read. The runtime checks current evidence and name presence; the model judges semantic relevance. Mappings stay within the current in-memory conversation, including follow-up turns.
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

### Persistent and retrievable memory

ContextOS is opt-in: exact session history is stored locally in an encrypted journal, while older recoverable tool output can be replaced with references in model requests. Requirements, current evidence, failures and validation obligations are retained. Source changes invalidate old evidence. Full history remains the default and rollback control.

```sh
npm run tea -- --interactive --session work --memory-policy contextos --max-cost-usd 1.00
npm run tea -- --interactive --resume work --memory-policy contextos --max-cost-usd 1.00
npm run tea -- sessions inspect work
npm run tea -- sessions delete work
npm run tea -- benchmark contextos --mode preflight --run-id contextos-check
```

Resume uses the original workspace/model/endpoint and preserves spending; `/new` preserves outstanding edits too. `/memory` explains the last request projection. `--memory-policy full-history` disables selection; `--session` still enables persistence. The soft target uses UTF-8 request bytes, not provider tokens. See the [architecture](docs/CONTEXTOS_ARCHITECTURE.md), [benchmark protocol](docs/CONTEXTOS_BENCHMARK.md) and [Chinese usage guide](docs/CONTEXTOS.zh-CN.md). [Candidates A/B were rejected](benchmarks/reports/contextos-glm-20261011/README.md). [C passed the frozen live gate](benchmarks/reports/contextos-c-glm-20261011/README.md): seven self-authored cases, three repeats, 21/21 ContextOS acceptance; **62.99% fewer provider tokens** versus persisted full history and **52.12% fewer** in the real 30-turn workflow. An additional fresh-read audit gives original/full/C 21/21, 20/21 and 21/21; the frozen checks missed one full-history omission. These results do not establish unseen-project generalization. ContextOS remains opt-in.

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

These are offline character/byte measurements, not verified provider token savings or model task success rates. Direct-parent TEA live evaluation, broader language coverage, and independent holdout evaluation remain unfinished. Recent session-vocabulary and discovery changes have no isolated provider-token savings measurement.

### TEA / Pi comparison

Measured on **2026-10-11**, using **GLM-5.3-flash**, **enabled/low** thinking and a shared **4,096-token** output cap. Pi was **0.87.1**. Every pair started from identical Git snapshots; a shared gateway recorded actual provider input, output and cache tokens.

- **64,000-byte request guard, nine task pairs:** TEA **168,282** tokens; Pi **161,046**. TEA used **4.49% more**. Acceptance was **9/9** for TEA and **7/9** for Pi; two Pi runs stopped at the input guard. Failed runs remain in the totals, so this ratio does not compare equal completion.
- **80,000-byte guard, separate rerun of all three large tasks:** TEA **117,126** tokens; Pi **107,674**. TEA used **8.78% more**, with **3/3** acceptance on both sides.

These results do **not establish consistent token savings**. Each profile has one repetition and uses self-authored JavaScript fixtures across 12-, 120- and 1,200-file repositories. Larger fixtures add unrelated modules. The two profiles are reported separately; an earlier pilot with changing ancestor instructions was excluded. See the [measured report](benchmarks/reports/tea-vs-pi-glm-20261011/README.md) and [comparison guide](docs/PI_COMPARISON.md).

![TEA and Pi provider token usage with a 64,000-byte request guard](benchmarks/reports/tea-vs-pi-glm-20261011/tea-vs-pi.png)

![Separate large-task rerun with an 80,000-byte request guard](benchmarks/reports/tea-vs-pi-glm-large-80k-20261011/tea-vs-pi.png)

## Conversation compaction

Use `/compact [retention instructions]` in the terminal to summarize older conversation. Enable automatic compaction with `tea --interactive --compaction auto --max-cost-usd 0.10`. It sends a structured checkpoint plus recent complete messages, preserves the original in-memory transcript, and keeps outstanding validation in authoritative runtime state.

Summary requests share the session model, usage ledger and hard budget. Automatic compaction is opt-in; default ledgers retain hashes rather than raw summaries. In paired GLM-5.3-flash experiments on self-authored JavaScript fixtures, the tested 35% trigger reduced total provider tokens by **72.33%** in scripted seed stress and **63.14%** in model-generated inspection/repair workflows, including all summaries. All 16 re-run tasks passed acceptance. These are small-sample results for an experimental profile, not measured savings for the default 80% trigger. See [the report and chart](benchmarks/reports/compaction-glm-20261011/README.md) and [the design and configuration](docs/COMPACTION.md).

![Paired compaction off/auto provider token usage, including summaries](benchmarks/reports/compaction-glm-20261011/tokens.png)

## Usage records and budgets

Runs write their ledger to `.tea/runs/<run-id>/`. By default, records contain hashes and counts rather than raw prompts or source. `TEA_STORE_RAW=1` enables local raw storage.

TEA reserves request costs against your configured budget before sending a request. It does not guess provider prices. Failed transmissions retain their reservation; missing or invalid usage leaves the complete actual token total unknown. Estimates, serialized bytes, and provider-reported tokens are recorded as separate measurements.

## Development

All changes are submitted through pull requests targeting `main`. See [Contributing](CONTRIBUTING.md) for setup, verification and experiment evidence requirements.

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
