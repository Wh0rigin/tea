# S1a: shorter resident capability notice

[中文](README.zh-CN.md) · [All runs and requests](results.json) · [Summary](summary.json) · [Frozen protocol](frozen-protocol.md)

## Result and decision

Proposal 1 reduces the Windows/headless notice **699 → 398 UTF-8 bytes (43.06% fewer bytes)**. Detailed failure feedback and execution policy are unchanged. **The candidate is reverted and not retained.**

Long provider tokens: **1,840,548 → 1,848,598, consumption change +0.44%**. Combined 108-run token change: **+1.25%**. Positive means more consumption, negative means less. Byte savings are not provider token savings.

Predeclared quantitative gates: **failed: longSavings, longBootstrapLowerBoundAboveZero, otherScaleTokenNonregression, quality, scope, latency**. Separately, the compact Windows notice omits the allowlisted-command qualifier. A native offline check demonstrates that an explicitly approved unlisted `node -e` containing quotes and parentheses succeeds. This notice-accuracy defect prevents retention regardless of token results. The additional finding does not change frozen thresholds, acceptance grades or attempted records. No corrected candidate has a paid measurement; these percentages cannot be transferred to it.

![All-attempt provider comparison](s1a-tokens.png)

## Frozen comparison

Parent `eb39591bd7e6fcee354a5ee660abb356c936c701`, candidate `efc942daab0d09da196d515c8f0e7799833bf417`: current S1 full notice versus compact notice, not S0 or Pi. Identical task snapshots; requested GLM-5.3-flash, enabled/low, output 4096, ContextOS target 32,000 bytes, 24 tools/turn, 100 requests/run, request/turn timeout 90/180 seconds, semantic summaries off and no interactive approval. Tools, actual permissions, failure feedback, memory algorithm and stop rules are unchanged. Different request sizes can naturally shift eviction timing.

Fixed **108 runs / 54 pairs**: six long pairs, ten repeats per small family and three repeats per medium/large family. **1,366 known-usage paid requests**. Native harness alternates arm order; all attempts, failures and unfavorable pairs remain. Repeats and unrelated-file scale variants are not independent projects. Conservative spend **USD 4.1605176 / 8**, per-run guard 1.4; budgeting rates 0.80/2.80 per million input/output count cache input at full price for reservations. Not an invoice. An offline launcher prepared-state string mismatch was repaired before any API call without changing the source or plan; no paid retry or replacement occurred.

## Scale results

- **small**: 243,660 → 261,014, token change **+7.12%**.
- **medium**: 78,542 → 84,344, token change **+7.39%**.
- **large**: 357,289 → 357,507, token change **+0.06%**.
- **long-session**: 1,840,548 → 1,848,598, token change **+0.44%**.

Input **2,495,635 → 2,524,209**; output **24,404 → 27,254**; requests **668 → 698**; tools **512 → 538**. All cache input and provider-counted thinking output remain included. Frozen full acceptance **53/54 → 53/54**; **30/54 pairs increase tokens**. Candidate `large-unicode-r2` modifies protected `tests/public.test.mjs`, causing a paired scope decline. Parent `small-unicode-r9` fails hidden correctness while its candidate passes. Paired quality declines remain in the summary, with no regrading from explanatory source audits.

## Long workflow

Read-only phase: **1,653,055 → 1,645,601, change -0.45%**. Final repair: **187,493 → 202,997, change +8.27%**.

Diagnostic paired-repeat bootstrap 95% token-reduction interval **[-0.69%, -0.19%]**: 10,000 resamples, seed 20261012, whole paired runs sampled together. Six repetitions of one workflow do not establish unseen-project generalization. Individual results remain in the summary and chart.

![Long turn and paired differences](s1a-long-tokens.png)

## Observed overhead mechanisms

- Long requests **393 → 396**, repair requests **33 → 36**, tools **214 → 217**. Some pairs add reads, others regroup tools; these are observations, not a proven deterministic batching effect of the notice.
- Serialized notice content falls **117,087 bytes**, while assistant text blocks grow **34,574 bytes** and tool results grow **57,404 bytes**. Net wire bytes grow **22,153**. Byte categories are not exact causal token shares.
- First-request input is **1,222 → 1,170 (52 fewer tokens)** in all six pairs. Removing notices and normalizing workspace strings makes first-request hashes identical; subsequent contexts differ, so 52 cannot be multiplied by all later requests for exact savings.
- Smaller notices delay some output eviction; historical replies and repair round trips offset the input reduction.
- Small-task denials **0 → 7**: all inline JavaScript with blocked operators, five containing semicolons. The concrete quoted-JavaScript reminder becomes “even quoted”; lost examples/action guidance may affect reliability. Sentences were not independently ablated, so a unique cause is not established. [Sanitized command-shape audit](small-denial-shapes.json) publishes no raw commands.

## Correctness and verification

[approval-diagnostic.json](approval-diagnostic.json): one real approval callback, successful quoted/parenthesized unlisted command, expected output, zero model calls. Actual execution rules are unchanged; the error is the new notice's broader wording.

Before freeze: **15/15 targeted**, **269/269 full deterministic tests**, no skips; exact disabled parent request parity; native revision contract **18/18**, 72 scripted requests. Scripted counts are not provider benefits. All six implementation CI checks passed (linked in the summary). Those checks missed the notice's approval-scope ambiguity; the later offline check exposed it.

After reverting: **268/268 full deterministic tests**, including the new regression for Windows allowlist scope and approved quoted execution. Runtime is restored to the parent; experimental commits remain in history, with evidence and regression coverage delivered via PR.

Read-only audit of 108 closed journals matches every **1,366 native request hash** to gateway evidence without changing journal bytes. Long reconstruction matches **789/789** complete serialized hashes and byte counts, using recorded historical freshness rather than today's final edited source.

## Status and limitations

Candidate reverted; all paid evidence retained. Proposals 5/3/4 and S2–S5 remain unstarted, awaiting maintainer review. Only three self-authored JavaScript bug families, unrelated-file scale pressure and one repeated-reading workflow. Paid runs are headless, with no Agent result for interactive approval or unseen production projects. No raw thinking, signatures, conversations, keys or private absolute paths are published.

[SHA-256 manifest](evidence.sha256) · [Source alignment](source-audit.json) · [Journal audit](journal-audit.json) · [Long reconstruction](long-diagnosis.json) · [Frozen config](frozen-config.json).
