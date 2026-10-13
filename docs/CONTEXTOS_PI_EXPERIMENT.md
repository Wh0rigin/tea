# ContextOS C / Pi experiment protocol

This protocol is frozen before paid calls. Previous Pi comparisons measured the earlier TEA implementation; ContextOS C's previous 52.12% long-session reduction was against TEA full history, not Pi.

## Planned matrix

- Nine fresh tasks: three JavaScript bug families (primitive cache-key collisions, retry budgets, Unicode truncation) at 12, 120 and 1,200 files.
- One genuine empty-start conversation: read 30 unrelated modules completely in 30 separate model turns, then repair the retry service. No scripted seed messages.
- Three repetitions, alternating agent order: 60 runs / 30 pairs.
- Report fresh and long-session groups separately; repeated synthetic bug families are not unseen production projects.

## Native agents and common controls

- Installed Pi 0.87.1, pinned by CLI SHA-256; do not substitute the latest release during the experiment.
- Current TEA ContextOS C runtime; source tree hashed before and after every run.
- Same GLM-5.3-flash, enabled thinking, low effort, 4,096 output tokens, endpoint and native Messages protocol through one usage gateway.
- Common 160,000-byte native request guard (the legacy configuration name contains `TOKENS`; the guard is bytes, not measured tokens).
- Native prompts, tool APIs and cache directives are retained. TEA uses ContextOS with a 32,000-byte soft target and semantic compaction off. Pi native automatic compaction is enabled with a 200,000-token advertised model window. Actual compaction events are counted.
- Pi uses native RPC with a persistent in-memory conversation per run, settled-turn events and isolated configuration. No extensions, skills, templates, themes, automatic retry or cache warming. TEA uses its native persistent session engine. Both start empty; neither resumes prior benchmark sessions.
- TEA's native per-turn tool limit is 10; Pi has its native loop behavior. Both have a shared 100-provider-request per-run guard and 180-second per-turn timeout. These are native-agent comparisons, not identical prompt comparisons.

## Budget and accounting

- New experiment budget: USD 8 total, separate from prior experiments; USD 1.40 per agent/run, bounded by the shared suite remainder. No paid retries after unknown billing.
- Conservative rates: input USD 0.80/M and output USD 2.80/M; cache writes reserve twice the input price. These rates are not an invoice. Cache-read tokens remain included in total tokens even if discounted.
- All submitted requests, failed tasks and unknown reservations are retained. Total tokens include uncached input, cache reads, cache writes and output; reasoning is included in output.
- Ratios require identical initial tree hashes, unchanged sources, matching normalized model controls and complete provider usage. All-attempt results and the both-accepted subset are reported separately.

## Acceptance

- Initial public suite passes and independent hidden acceptance fails before either agent starts.
- Final public and hidden suites must pass; changes are limited to the relevant service, with no test/instruction/dependency edits or extra files.
- Both agents must actually complete the relevant public test command after their latest edit; independent harness tests cannot substitute for the agent's requested work.
- Each inspection requires a settled native read of the correct path with the full tool-output hash matching the source. Hashes differ naturally because TEA adds source metadata while Pi returns plain text.
- Inspection turns forbid shell/test/edit/write calls and require an unchanged workspace fingerprint. Skipped, partial or mutated inspections fail the run; low token use from incomplete work cannot establish a useful saving.

## Reproduction

```sh
npm test
npm run benchmark:contextos-pi:check
npm run benchmark:contextos-pi -- --mode prepare --run-id contextos-pi-preflight
# Set credential/model/thinking/effort/output/rates in the process environment.
npm run benchmark:contextos-pi -- --mode live --run-id contextos-pi-live --max-cost-usd 8
```

The loopback check uses actual TEA and Pi clients across three turns, checking complete reads, preserved conversation history, post-edit validation and matching wire controls. Its scripted token counts are protocol evidence only and never enter performance reports. Raw workspaces and runtime data remain ignored; only reviewed, sanitized evidence is published.

## Predeclared tool-limit sensitivity follow-up

After the first large-cache-key run hit TEA's inherited 10-tool benchmark limit, its independent code tests passed but its native post-edit validation had not run. It remains a failed primary run. The primary matrix and sources are not changed mid-experiment.

If the completed primary matrix contains tool-limit failures, run all three large task families again, three repetitions per family and both agents (18 runs), using TEA's actual CLI default of 24 tools per turn. Keep model, thinking, endpoint, output cap, fixtures, memory mechanism and native Pi configuration unchanged. This is a separately labeled resource sensitivity experiment, not a replacement for the primary failed runs or a runtime optimization. Use only the remainder of this experiment's USD 8 total cap; do not launch if primary billing is unknown. Include all selected families regardless of whether they failed at 10 tools. Freeze and check the extended task-selector harness before this follow-up.

Before any follow-up paid calls, the second small-Unicode run also hit the 10-tool cap. Therefore expand the follow-up selection to **all nine fresh task types at all three sizes, three repetitions and both agents (54 runs)**. This supersedes the 18-run large-only plan. Preserve the original primary profile and failures, report the default-24 profile separately, and keep the combined USD 8 cap. Long inspections use one source read per turn and retain their original three-repetition profile; no unmeasured default-24 long-session claim is made.

### Exact measured controls (PowerShell)

Keep the credential in the process environment. These supplied rates reproduce budget accounting, not an invoice. Pi 0.87.1 must be installed separately; pass `--pi-package` if it is not at the Windows global npm location.

```powershell
$env:ANTHROPIC_BASE_URL = 'YOUR_MESSAGES_ENDPOINT'
$env:ANTHROPIC_MODEL = 'glm-5.3-flash'
$env:TEA_THINKING_MODE = 'enabled'
$env:TEA_REASONING_EFFORT = 'low'
$env:TEA_MAX_OUTPUT_TOKENS = '4096'
$env:TEA_MAX_REQUEST_INPUT_TOKENS = '160000'
$env:TEA_REQUEST_TIMEOUT_MS = '90000'
$env:TEA_INPUT_PRICE_USD_PER_MTOK = '0.80'
$env:TEA_OUTPUT_PRICE_USD_PER_MTOK = '2.80'
$env:TEA_STORE_RAW = '0'
$env:TEA_STREAM = '1'
$env:TEA_MAX_TOOL_CALLS = '10'
node scripts/compare-contextos-pi.mjs --mode live --run-id primary-NEW --max-cost-usd 8

$teaPrimary = Get-Content benchmarks/results/primary-NEW/comparison.json -Raw | ConvertFrom-Json
if (!$teaPrimary.complete -or !$teaPrimary.sourceUnchanged -or
    ($teaPrimary.requests | Where-Object { $_.submitted -and !$_.complete })) {
    throw 'Do not continue after incomplete or unknown primary accounting'
}
$teaComparisonRemaining = 8 - $teaPrimary.accountedUsd
$env:TEA_MAX_TOOL_CALLS = '24'
node scripts/compare-contextos-pi.mjs --mode live --run-id default24-NEW --groups fresh --scales 'small,medium,large' --max-cost-usd $teaComparisonRemaining
python scripts/plot-contextos-pi.py benchmarks/results/default24-NEW/comparison.json
```

Source identities cover the runtime and experiment `.mjs` files under `src/` and `scripts/`; publication-only Python plots and Markdown are separate. Native shell permissions differ: TEA retains its validation allowlist and refuses unapproved shell calls in this headless experiment, while Pi uses its native `--no-approve` mode. No human approvals or OS sandbox are injected. Pi's window and automatic-compaction behavior are configuration limits, not a claim about the provider's physical context window.

## Completion-witness acceptance revision

After all 60 primary paid runs settled with known usage and unchanged sources, a zero-provider-call regression demonstrated that the older ContextOS hidden runner accepted a service that called `process.exit(0)` before assertions. This is a benchmark defect; no such model patch was inferred from the primary data. Future hidden acceptance requires a fresh completion witness after the successful assertion path. JavaScript and Python branches are repaired; the normal Node test suite covers valid JavaScript acceptance and the early-zero-exit regression.

Recheck every settled primary final workspace with the stronger gate, recording results in a separate audit without rewriting the frozen original acceptance. Then freeze this acceptance revision and the task selector before the default-24 follow-up. The follow-up uses the stronger gate from the start. Source hashes distinguish the two harness versions; the Agent memory/runtime mechanism is unchanged. A code-test audit cannot substitute for required native reads, post-edit validation or a completed native agent turn.
