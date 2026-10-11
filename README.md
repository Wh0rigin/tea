# Token-Efficient Coding Agent (TEA)

TEA is an independent terminal coding agent built on Node.js. It has its own runtime, workspace tools, Anthropic Messages adapter, token ledger, and benchmark commands. `baseline-v0` records the initial scaffold. The user authorized V1 as an offline experiment checkpoint and continuation into V2; that checkpoint fixes runtime defects found by executable integration checks. No V1–V5 optimization has passed a live model benchmark yet.

## Requirements

- Node.js 20 or later
- Git (needed for source tracking and future paired runs)
- For live tasks only: an Anthropic Messages compatible provider, an API key in the process environment, the current input/output price for the selected provider group, and a positive cost budget

There are no npm runtime dependencies.

## Run locally

```powershell
cd token-efficient-coding-agent
npm test
npm run tea -- --help
```

The agent uses the current directory as its workspace unless `--workspace` is supplied. It lists files, searches and reads text source files, applies unique exact-span patches, and runs approved validation commands. After an edit, the runtime requires a successful test run before it reports `completed`. Workspace writes stay inside the selected repository. Shell commands outside the test/read-only allowlist require explicit interactive approval; destructive commands are blocked.

The default context strategy (`v1`) starts with up to 8 ranked file paths, pins applicable `AGENTS.md` files plus root README/package manifests, and expands task terms with a small domain synonym list when path overlap is weak. The full file/search tools remain available for discovery. Set `--context-strategy baseline` to compare the original 160-path inventory, or change the candidate cap with `--initial-file-limit N` (1–250). These are still experimental heuristics; synthetic replay does not establish live task correctness.

## Configure live model calls

Set credentials and prices in the launching process. Do not store the real API key in this repository, `.env`, benchmark files, or shell history.

```powershell
$env:ANTHROPIC_API_KEY = 'your-key'
$env:ANTHROPIC_BASE_URL = 'https://cf.api.fan'
$env:ANTHROPIC_MODEL = 'glm-5.3-flash'
$env:TEA_INPUT_PRICE_USD_PER_MTOK = 'price-from-your-token-group'
$env:TEA_OUTPUT_PRICE_USD_PER_MTOK = 'price-from-your-token-group'
$env:TEA_MAX_COST_USD = '0.10'
$env:TEA_MAX_REQUEST_INPUT_TOKENS = '12000'
$env:TEA_MAX_OUTPUT_TOKENS = '1200'
$env:TEA_REASONING_EFFORT = 'low' # low, high, or max
$env:TEA_THINKING_MODE = 'adaptive'
tea "Fix the session expiration bug" --max-cost-usd 0.10
```

The provider rates are intentionally not guessed. Before every request TEA reserves a worst-case amount using the configured input/output limits and rates. Canonical input totals include ordinary input, cache reads, and cache writes. Cache reads use the full input rate; cache writes default to twice that rate as a conservative guard based on [Anthropic's cache pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), rather than a measured PackyAPI bill. Failed transport requests retain their reservation. Missing, invalid, or interrupted usage makes the run's complete actual-token total `null`, while known counters remain as a reported lower bound. Live fixture runs share one suite cost/input budget and stop after a failure or unknown usage.

The Anthropic Messages transport currently requests adaptive thinking plus `output_config.effort`, matching the supplied compatibility hint. Z.AI's GLM-5.3-Flash docs specify `low`, `high`, and `max` as the supported reasoning-effort levels; thinking cannot be disabled. PackyAPI's model-square entry determines whether the selected token group exposes Anthropic Messages for that model. PackyAPI's published Anthropic examples use `https://cf.api.fan` and `/v1/messages`; the supplied `https://www.packyapi.ai` is the product URL and has not been verified as an API endpoint. Read the [GLM-5.3-Flash guide](https://docs.z.ai/guides/vlm/glm-5.3-flash), [GLM Chat Completion parameter reference](https://docs.z.ai/api-reference/llm/chat-completion), and [PackyAPI Anthropic Messages setup](https://docs.packyapi.com/docs/cli/7-kimi-code.html). See [Decisions](docs/DECISIONS.md) and [Benchmark specification](docs/BENCHMARK_SPEC.md).

## Benchmarks

```powershell
npm run benchmark:replay
tea benchmark run --suite core --mode replay
tea benchmark run --suite core --mode replay --strategy v1 --initial-file-limit 8
tea benchmark report --run replay-YYYY-MM-DDTHH-MM-SS.sssZ
tea benchmark compare --base-run RUN_A --candidate-run RUN_B
npm run benchmark:runtime
tea benchmark run --suite runtime-smoke --mode runtime --strategy baseline
tea benchmark run --suite runtime-smoke --mode live --max-cost-usd 0.10
```

Replay mode screens payload sizes using 23 self-authored traces. Its prior candidate estimate of 13,431 → 2,106 tokens (-84.32%) is diagnostic, not provider usage or correctness evidence.

`runtime` mode executes 12 self-authored JavaScript repositories with reproducible initial commits, scripted tool choices, real patches, public tests, and separate acceptance tests. Both context strategies passed 12/12; returned tool characters fell 15,552 → 11,910 (23.42%). This validates runtime behavior under supplied patches, not model task success. The `baseline` strategy here uses the current engine with original inventory/read settings, rather than executing the historical Git revision. `live` mode runs the same smoke fixtures through the provider only when explicit credentials, current rates, and a total budget are configured. It has not been run. Formal 40–60 core / 100+ holdout sets and paired Git-revision scheduling remain unfinished. These fixtures run without OS isolation; source tests/solutions are in the project manifest, so they are not confidential production acceptance tests. All current runs remain gate-ineligible. See [runtime experiment](benchmarks/reports/v1-runtime.md).

Every provider request writes its usage to `.tea/runs/<run-id>/`; default ledgers retain hashes/counts rather than prompts/code. Set `TEA_STORE_RAW=1` only when contents are safe to retain locally. Benchmark task workspaces necessarily retain fixture code and are ignored by Git. Per-task checkpoints preserve charges and failures before acceptance runs. Long command output keeps stream beginnings and endings with a full-stream hash; successful commands use smaller output limits. Output volume no longer terminates tests, while timeouts remain enforced. `npm test` selects project test files explicitly so archived fixture tests do not accumulate in the test scan.

## Current completion state

- Implemented: independent CLI/runtime, file tools, bounded command output, validation classification, streaming UTF-8 and usage accounting, cost preflight, offline replay and executable smoke harness, ranked initial context, repeat-read references, integration tests.
- Not measured: first provider-backed baseline, any real task success rate, live input/output token totals, and every V1–V5 gate.
- Not yet implemented: diverse pinned 40–60 task core and 100+ holdout sets, isolated confidential acceptance, paired A/B over Git revisions, and release reports based on live evidence.

See [PROGRESS.md](PROGRESS.md) for exact Git state and continuation steps.
