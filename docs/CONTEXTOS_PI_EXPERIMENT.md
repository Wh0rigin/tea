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
