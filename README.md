# Token-Efficient Coding Agent (TEA)

TEA is an independent terminal coding agent built on Node.js. It has its own runtime, workspace tools, Anthropic Messages adapter, token ledger, and benchmark commands. The initial `baseline-v0` is a working scaffold; no V1–V5 optimization has passed a live model benchmark yet.

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

The provider rates are intentionally not guessed. Before every request TEA reserves a worst-case amount using `TEA_MAX_REQUEST_INPUT_TOKENS`, `TEA_MAX_OUTPUT_TOKENS`, and the two configured rates. It charges reported provider input/output usage at the undiscounted input rate, checks the remaining hard budget before another call, and stops on an unknown or exceeded reservation. Failed network requests retain their reservation because the provider may have processed them. Cached tokens are reported separately but no discount is assumed in the local guard.

The Anthropic Messages transport currently requests adaptive thinking plus `output_config.effort`, matching the supplied compatibility hint. Z.AI's GLM-5.3-Flash docs specify `low`, `high`, and `max` as the supported reasoning-effort levels; thinking cannot be disabled. PackyAPI's model-square entry determines whether the selected token group exposes Anthropic Messages for that model. PackyAPI's published Anthropic examples use `https://cf.api.fan` and `/v1/messages`; the supplied `https://www.packyapi.ai` is the product URL and has not been verified as an API endpoint. Read the [GLM-5.3-Flash guide](https://docs.z.ai/guides/vlm/glm-5.3-flash), [GLM Chat Completion parameter reference](https://docs.z.ai/api-reference/llm/chat-completion), and [PackyAPI Anthropic Messages setup](https://docs.packyapi.com/docs/cli/7-kimi-code.html). See [Decisions](docs/DECISIONS.md) and [Benchmark specification](docs/BENCHMARK_SPEC.md).

## Benchmarks

```powershell
npm run benchmark:replay
tea benchmark run --suite core --mode replay
tea benchmark report --run replay-YYYY-MM-DDTHH-MM-SS.sssZ
tea benchmark compare --base-run RUN_A --candidate-run RUN_B
```

Replay mode is a controlled, synthetic fixture for testing the harness only. It reports heuristic text-size estimates; provider actual tokens, task correctness, cost, and latency remain `NOT_MEASURED`. It cannot pass an optimization gate. Live suite execution and the diverse pinned repositories/acceptance tests are not yet implemented. Every recorded live request writes provider usage to `.tea/runs/<run-id>/`; by default the ledger stores hashes and counts, not prompts or model output. Set `TEA_STORE_RAW=1` only when the workspace contents are safe to retain locally. `.tea/` and benchmark run data are ignored by Git.

## Current completion state

- Implemented: independent CLI/runtime, workspace-limited tools, manual approval for other shell commands, streaming and tool-use handling, provider usage ledger, hard-cost preflight, deterministic offline replay harness, unit tests.
- Not measured: first provider-backed baseline, any real task success rate, live input/output token totals, and every V1–V5 gate.
- Not yet implemented: a pinned 40–60 task live core set, 100+ holdout set, real task runner/restoration, A/B runs over Git revisions, and release reports based on live evidence.

See [PROGRESS.md](PROGRESS.md) for exact Git state and continuation steps.
