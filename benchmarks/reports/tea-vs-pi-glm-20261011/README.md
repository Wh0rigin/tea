# GLM-5.3-flash: TEA / Pi measurements

[中文](README.zh-CN.md)

Measured on 2026-10-11. These exploratory results **do not establish consistent token savings** for TEA. Negative results and input-limit failures are retained.

## Nine tasks with a 64,000-byte request guard

- TEA: **168,282 provider tokens**, acceptance **9/9**.
- Pi 0.87.1: **161,046 provider tokens**, acceptance **7/9**.
- TEA consumed **4.49% more** across all planned pairs, including failures.
- Pi's large cache-key and retry-budget runs stopped when serialized requests reached 64,674 and 64,592 bytes. Their submitted requests still count; the rejected requests were not sent to the provider. This total does not compare equal completion.
- The seven pairs where both passed total 102,913 TEA / 138,023 Pi tokens, or 25.44% fewer for TEA. That selected subset is not the whole experiment.
- Small tasks: TEA 40,940 / Pi 39,443 tokens; TEA used 3.80% more; both accepted 3/3.
- Medium tasks: TEA 24,396 / Pi 83,921 tokens; TEA used 70.93% fewer; both accepted 3/3.
- Large tasks at this guard: TEA 102,946 / Pi 37,682 tokens; acceptance 3/3 versus 1/3. Early failures make the raw token ratio unsuitable as an equal-completion savings claim.

![Nine pairs with a 64,000-byte request guard](tea-vs-pi.png)

[Per-task report](REPORT.md), [provider request evidence and configuration](comparison.json), [recomputed analysis](summary.json), [SVG](tea-vs-pi.svg).

## Separate large-task rerun with an 80,000-byte guard

After observing the two input-limit failures, all three large task families were rerun in fresh workspaces with the same 80,000-byte guard on both sides. This includes Unicode, which had already passed. Model, thinking, effort, source and initial repositories stayed the same. Both sides received an equal remaining-budget allowance within the new profile. This is a separate experiment; its limit and allowance differ from the nine-task profile.

- TEA: **117,126 provider tokens**; Pi: **107,674**; both accepted **3/3**.
- TEA consumed **8.78% more** across these three pairs.
- Cache-key: TEA 9,964 / Pi 81,401 tokens.
- Retry-budget: TEA 89,835 / Pi 9,787 tokens. TEA made 11 provider requests and 12 tool calls; Pi made 5 requests and 4 tool calls.
- Unicode: TEA 17,327 / Pi 16,486 tokens.

![All three large tasks rerun with an 80,000-byte guard](../tea-vs-pi-glm-large-80k-20261011/tea-vs-pi.png)

[Per-task report](../tea-vs-pi-glm-large-80k-20261011/REPORT.md), [provider request evidence and configuration](../tea-vs-pi-glm-large-80k-20261011/comparison.json), [analysis](../tea-vs-pi-glm-large-80k-20261011/summary.json), [SVG](../tea-vs-pi-glm-large-80k-20261011/tea-vs-pi.svg).

## Controls and provenance

- Model request: `glm-5.3-flash`; Anthropic Messages API; enabled thinking with `budget_tokens=4095`; `output_config.effort=low`; `max_tokens=4096`.
- Identical task text and pinned Git snapshot within each pair; whole-repository fingerprints checked before each start. Conversations and Pi configuration directories are fresh. Run order alternates.
- Live workspaces are outside the TEA checkout. Ancestors are checked for unexpected instructions before every start. Both agents read the same fixture instructions through their own discovery behavior.
- TEA uses its native default `v1` discovery and full history. Pi uses native read/edit/write/PowerShell, with extensions, skills, templates, automatic retries, automatic compaction and cache warming disabled. Prompts and tool APIs differ. No claim is made about every possible Pi configuration.
- At most 24 provider requests per agent/task; 90-second request timeout and 300-second task timeout. TEA also retains its native 24-tool-call cap. None of the accepted runs hit those caps.
- Input totals include uncached input, cache reads and cache writes. Output includes reasoning. All submitted requests in both reported profiles have complete provider usage; missing usage is never zero. Provider cache state could not be reset.
- TEA source SHA-256 before and after both profiles: `fba9a98ced61424549dc4a0a5ed44eaad739fce6555c2007d3a67c444a0df9e6` (the runner hashes `src/*.mjs` and `scripts/*.mjs`). Pi CLI SHA-256: `e79626f2dd6f94aa45d30f3fa63cd84319a6eefcd150b353cfaf274366926774`.
- Run IDs: `tea-pi-glm-isolated-20261011` (105 provider requests), `tea-pi-glm-large-80k-20261011` (43 requests). Sanitized JSON retains individual counts, request/response hashes, controls and acceptance. Raw conversations and private paths are excluded.

An earlier pilot, `tea-pi-glm-live-20261011`, is excluded from every performance metric because Pi inherited changing instructions from the TEA checkout's ancestors. All nine pairs were rerun after detecting this. The pilot's 111 submitted requests and complete usage remain in local records and budget accounting.

## Cost accounting

The total testing cap was **$3**, including the real tool-call smoke, excluded pilot and both valid profiles. Conservative accounted costs were:

- Smoke: $0.00018080.
- Excluded pilot: $0.27861760.
- Nine-task profile: $0.24810516.
- Large-task profile: $0.16590600.
- Total: **$0.69280956**. This is a supplied-rate accounting estimate, **not a provider invoice**.

For the two valid profiles, the [public pricing API](https://www.packyapi.ai/api/pricing) supplied model ratio 0.4, completion ratio 3.5 and published group/model factors 0.9 and 0.5 on 2026-10-11. We used the higher applicable published factor, yielding **$0.72 input / $2.52 output per million tokens** under the [NewAPI pricing formula](https://docs.newapi.pro/en/docs/guide/console/settings/rate-settings). Cache reads were conservatively charged at full input price; cache writes reserved at twice input price. The smoke and excluded pilot used the earlier, more conservative $0.80/$2.80 accounting rates. No invoice-level savings claim is made.

## Limits and next investigation

Each task/profile has one repetition. There are three self-authored JavaScript bug families across 12-, 120- and 1,200-file repositories. Larger repositories add unrelated generated modules; they do not add harder bugs. Independent assertions run outside the agent workspace, but there is no OS sandbox or confidential holdout. These are not diverse production projects or a direct-parent TEA optimization gate.

The large retry rerun shows that low output alone is insufficient: almost all of TEA's extra tokens were accumulated input over more requests. Investigating discovery and extra tool loops is warranted, but these measurements do not identify a causal optimization. Further experiments should isolate a proposed change, use repeated runs and include unseen real repositories.

[Reproduction guide](../../../docs/PI_COMPARISON.md), [contribution evidence requirements](../../../CONTRIBUTING.md).
