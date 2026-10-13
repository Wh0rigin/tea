# TEA

<p align="center">
  <img src="assets/tea-logo.png" alt="TEA — Token Efficient Agent" width="320">
</p>

**English** | [Chinese](README.zh-CN.md)

**TEA Coding Agent**

> Every optimization serves one goal: save tokens while preserving performance.

TEA is an independent terminal coding agent built with Node.js. It brings together an agent loop, workspace tools, an Anthropic Messages adapter, token accounting, and reproducible experiments.

Our mission is to reduce token consumption while preserving task correctness, code quality, and execution performance. We measure each change, record failures and tradeoffs, and keep a recovery path when reduced context is insufficient.

## Measured token usage

### TEA / Pi / Claude Code

Measured October 13, 2026 with the same **GLM-5.3-flash, enabled/low thinking, 4096/4095 output/thinking caps**, task prompts and initial source snapshots. All three arms were newly measured.

This compares coding-agent software: **TEA archived candidate bd41742, Pi 0.87.1 and native Claude Code 2.1.281 safe-mode CLI**. Claude Code also uses GLM here, not an Anthropic Claude model. Native core prompts/tools are retained; host plugins, skills, MCP and cross-session automatic memory are disabled.

![Three coding agents: provider tokens and quality](benchmarks/reports/tea-pi-claude-glm-20261013/three-agents.png)

- **12 files:** TEA vs Pi 34.02% fewer; vs Claude Code 73.70% fewer tokens.
- **120 files:** TEA vs Pi 75.68% fewer; vs Claude Code 76.58% fewer tokens.
- **1,200 files:** TEA vs Pi 50.12% fewer; vs Claude Code 18.32% fewer tokens.

Fresh-task total: TEA vs Pi **55.63% fewer**, vs Claude Code **51.93% fewer** tokens.

Fresh code behavior checks (TEA / Pi / Claude Code): **27/27 / 27/27 / 27/27**; full acceptance: **27/27 / 27/27 / 1/27**. Command forms outside the frozen observer grammar remain unconfirmed final validation, not code behavior failures.

Long workflow: empty start, 30 native read-only inspections then repair; all attempts TEA vs Pi 76.35% more, vs Claude Code 61.78% fewer tokens; full acceptance 3/3 / 1/3 / 2/3. Interrupted workflows perform unequal work; token gaps are not equal-completion efficiency claims. Both-accepted diagnostic subsets are separate in the report.

90 planned runs, 90 attempted; 968 submitted requests, 0 with unknown usage. Includes cache input, reasoning output, failures and individual regressions. Three self-authored JavaScript defects, three repeats per size, one long workflow; extra files are unrelated modules. Not production generalization. **The measured TEA candidate remains reverted; default runtime is not reenabled.**

[Full three-agent report](benchmarks/reports/tea-pi-claude-glm-20261013/README.md) · [All attempts](benchmarks/reports/tea-pi-claude-glm-20261013/results.json) · [Frozen protocol](benchmarks/reports/tea-pi-claude-glm-20261013/frozen-protocol.md)

<details>
<summary>Earlier two-agent experiment (2026-10-13)</summary>

In the **October 13, 2026** comparison, the compact evidence metadata candidate used **54.55% fewer provider tokens** than **Pi 0.87.1** across 27 fresh task pairs:

- **Small — 12 files:** 30.76% fewer tokens.
- **Medium — 120 files:** 74.23% fewer tokens.
- **Large — 1,200 files:** 50.49% fewer tokens.

![Measured TEA candidate versus Pi provider token usage](benchmarks/reports/e1-metadata-vs-pi-glm-20261013/tea-vs-pi.png)

Both agents used **GLM-5.3-flash**, **enabled/low** thinking, a **4,096-token** output cap, identical task prompts and initial source snapshots. All **60 runs and 653 requests** are recorded with complete provider usage, including cached input, reasoning output, failures and individual regressions. Fresh-task code behavior passed **27/27 for both**; full acceptance was **TEA 27/27, Pi 26/27**. One Pi run had unconfirmed final validation rather than a code behavior failure.

For the **30-read + repair long conversations**, TEA used **11.85% fewer tokens across all attempts**, with full acceptance **3/3 versus 2/3**. One Pi conversation stopped at its first required read before repair, so completed work differs. The two pairs where both passed used **41.24% fewer TEA tokens**; that diagnostic subset does not replace the result including failures.

These are three self-authored JavaScript defects, three repeats at each repository size, and one long-conversation workflow. Added files are unrelated modules; this is sample evidence rather than a production-wide savings guarantee. Results compare the complete experimental TEA configuration with Pi, including native prompt/tool differences, and do not isolate metadata shortening. TEA enabled ContextOS and capability feedback; model summaries were not executed by either agent. **The measured candidate `bd41742` remains reverted in this branch; these figures describe its archived implementation.**

[Full report](benchmarks/reports/e1-metadata-vs-pi-glm-20261013/README.md) · [All attempts and usage](benchmarks/reports/e1-metadata-vs-pi-glm-20261013/results.json) · [Frozen protocol](benchmarks/reports/e1-metadata-vs-pi-glm-20261013/frozen-protocol.md) · [Source and verification](benchmarks/reports/e1-metadata-vs-pi-glm-20261013/source-audit.json)

</details>

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

### Earlier TEA / Pi comparisons

Earlier opt-in **ContextOS C** versus native **Pi 0.87.1**, measured on October 11–12, 2026: same **GLM-5.3-flash**, **enabled/low** thinking, **4,096** output cap and initial Git contents. Three repeats per configuration; all provider input, cache and reasoning output count. These experiments are recorded separately from the October 13 candidate comparison above.

- **Fresh tasks, existing CLI default of 24 tools/turn:** 27 pairs at 12/120/1,200 files; TEA **708,844** / Pi **1,080,626** tokens, **34.40% fewer** for TEA. Full acceptance **26/27 vs 25/27**. [Default-quota report](benchmarks/reports/contextos-c-vs-pi-default24-glm-20261011/README.md).
- **Actual empty-start 30-inspection + repair conversation:** three pairs, TEA **905,224** / Pi **1,558,908**, **41.93% fewer**, both **3/3** accepted. This used the original 10-tool/turn profile. P95 TEA/Pi **485.60/463.18s**; it does not establish a speed benefit. [Long conversation and primary failures](benchmarks/reports/contextos-c-vs-pi-glm-20261011/README.md).
- **Original 10-tool fresh profile:** TEA accepted **16/27 vs 27/27**. Quota/validation failures remain recorded; its lower token total does not establish a performance-preserving improvement. The entire fresh matrix was selected for the separate default-quota follow-up before any follow-up paid calls.

Default-quota results differ by size: small tasks use **52.26% more** TEA tokens (both 8/9 fully accepted); medium/large use **57.42%/37.64% fewer**. Both agents pass independent code/scope checks in all 27 follow-up runs; full acceptance also requires native post-edit testing and completion, whose conservative command recognition can produce false negatives. This is not evidence that TEA produces more correct code.

These are self-authored JavaScript bug fixtures; larger repositories add unrelated modules. Three repeats do not prove unseen-project generalization. Native prompts, tool protocols and cache policies differ. ContextOS remains opt-in. Token reductions are not invoice reductions; stronger compression can reduce cache reuse. Earlier full-history TEA/Pi results remain [recorded separately](benchmarks/reports/tea-vs-pi-glm-20261011/README.md): +4.49% at 64k bytes and +8.78% in the 80k large-only profile. [Protocol and comparison guide](docs/PI_COMPARISON.md).

[Small-task diagnosis](benchmarks/reports/contextos-c-vs-pi-small-diagnosis-20261012/README.md): 79/46 requests, 21 denied shell calls and one dominant recovery loop explain the observed aggregate regression; proposed fixes have no measured savings yet.

[Improvement plan](docs/SMALL_TASK_IMPROVEMENT_PLAN.md): evaluation, capability feedback, structured validation, progress/completion, versioned patch receipts and independent confirmation. Each candidate is measured separately against its direct parent; targets are not measured gains.

[S0 evaluation checks](benchmarks/reports/small-task-s0-20261012/README.md) are complete: 254/254 tests, 18/18 native revision contract tasks and 20/20 frozen fault preflights. No paid calls or measured token gains; stopped before S1.

[S1 measured feedback experiment](benchmarks/reports/small-task-s1-glm-20261012/README.md): 102 parent/candidate runs, **11.38% fewer total provider tokens**, small **41.44% fewer**, long workflow **3.67% more**. Candidate acceptance 51/51 versus 47/51; default remains off pending review. Use `TEA_CAPABILITY_FEEDBACK=1` for the experimental option; this narrow result does not prove every-task or unseen-project savings.

![Default-24 fresh tasks](benchmarks/reports/contextos-c-vs-pi-default24-glm-20261011/tea-contextos-vs-pi-fresh.png)

![Actual long conversation](benchmarks/reports/contextos-c-vs-pi-glm-20261011/tea-contextos-vs-pi-long.png)

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
