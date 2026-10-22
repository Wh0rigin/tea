# Evidence reuse: controlled provider-token measurement

Status: completed after the eight autonomous DeepSWE attempts. Six real streaming completions, complete provider usage throughout, no retry.

[Protocol](protocol.json) · [Offline checks](preflight.json) · [Runner](../../../scripts/measure-evidence-fixed-trace.mjs) · [Autonomous comparison](../evidence-residency-deepswe-r2-20261019/README.md)

## What this measures

The first autonomous Helm pair had different solving outcomes but no short read receipts. An independent fixed-trace experiment tests whether the specific read-after-edit cache repair changes real provider-token usage when that path is actually exercised.

For each of three small JavaScript fixtures, both source versions perform the same actual operations: read version 1, apply an exact patch, read version 2, assemble context, repeat the same complete read twice and assemble after each read. The original version-1 evidence is stale; current version-2 evidence remains resident. Baseline re-sends complete source, while the candidate returns two short receipts.

Preflight asserts that the two projected histories differ only in those repeated read result bodies. Projected observations are supplied as one user message, with identical tool definitions and model controls. This avoids inventing model thinking signatures or claiming the scripted setup was autonomously chosen. **This is a controlled context experiment, not a native autonomous coding workflow.**

One real streaming completion then implements `inverseScale` for the current source. Independent numeric checks verify its behavior. Comments, code fences and exported arrow functions are accepted; wrong results and nonterminating output fail. This tiny coding question is not counted as a DeepSWE success or general agent accuracy.

## Controls

- Same frozen baseline `f03052a` and candidate `778a54f` archives as the autonomous comparison.
- GLM-5.3-flash, enabled/low, streaming, output cap 4,096, 216k local window, ContextOS target 32,000 bytes, 300-second request deadline.
- Three fixed pairs, alternating arm order: **six single completions**, no follow-up model repair.
- **1 USD allocation per attempt / 6 USD total control limit**, separately accounted from the 40 USD autonomous schedule and prior interrupted-round reservation. Estimates are not invoices.
- Unknown usage retains the affected allocation; no silent retry or missing-usage zeros. Report real input, output and all cache input separately from scripted bytes.
- Native agent histories and solving outcomes are evaluated in the separate DeepSWE comparison. Do not pool these fixture results with that score or present the controlled percentage as expected production savings.

## Preflight

Zero provider calls: request differences restricted to two read results, two candidate receipts per fixture, and six synthetic adapter completions accepted. Eleven additional validation checks accept equivalent function formatting and calls to the existing `scale()` function, and reject wrong behavior, tool requests and nontermination. Synthetic usage is labeled non-provider and never enters real-token totals. Final answer text is retained privately for offline review; thinking blocks are excluded.

## Reproduction layout

Extract the protocol's two `git archive` source snapshots (`src`, `scripts`, `package.json`) into `.tea/evidence-causal/baseline/` and `candidate/`; copy `protocol.json` to `.tea/evidence-causal/`. After the autonomous schedule ends, copy its completed progress or aggregate results to `.tea/evidence-causal/main-round-complete.json`.

Run `node scripts/measure-evidence-fixed-trace.mjs` for offline context checks. Optional `--scripted-provider --tag NAME` exercises the fake streaming adapter without provider calls. **`--live` deliberately submits the six paid completions** using the local TEA API configuration. The runner verifies its frozen source hash, refuses to overwrite existing paid results and requires proof that all eight autonomous attempts have ended.

## Actual provider results

[Per-completion usage](results.json) · [Derived aggregates and all pairs](summary.json)

- Baseline: 3/3 independently accepted answers; **25,695 input + 72 output = 25,767 total tokens**.
- Candidate: 3/3 independently accepted answers; **11,028 input + 76 output = 11,104 total tokens**.
- Input including cache: **−57.08%**; total provider tokens: **−56.91%**. Output increased 4 tokens (+5.56%); the saving comes from input.
- Each arm made exactly three single completions. Cache reads/writes were zero; all six usage records are complete. No new reservation remains.
- Candidate produced two read receipts per fixture, six in total; baseline produced none. Equal system/tools and all observations outside those two repeated read bodies were verified before calls.

Every pair, baseline → candidate:

1. Input **8,558 → 3,673**; total **8,584 → 3,698**; both accepted.
2. Input **8,558 → 3,669**; total **8,583 → 3,695**; both accepted.
3. Input **8,579 → 3,686**; total **8,600 → 3,711**; both accepted.

The provider returned input and output usage; no additional reasoning figure is added to output. The percentages use provider tokens, not serialized bytes or synthetic SSE usage. Original final answers are retained privately for independent regrading without thinking blocks.

## Interpretation

**The repaired cache path demonstrably reduces real input tokens while retaining correctness on these three controlled questions.** The repeated current-version source was already resident, so the two later reads could use receipts instead of copying the source again. This does not add model summarization calls or discard the current source needed to compute the answer.

This is a narrow mechanism result: three variants of one small scalar-function family, scripted setup, and observations supplied in one user message. It does not measure autonomous tool choice, how often real workflows exercise the path, native multi-turn behavior or general coding accuracy. The autonomous DeepSWE schedule produced no short read receipts and no both-accepted pairs; **do not advertise 56.91% as overall agent or DeepSWE savings**.

Retain the correctness repair for review. Broader performance adoption remains unproven; no next optimization stage or merge is included.
