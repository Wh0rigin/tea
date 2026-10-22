# Evidence residency: repeated streaming comparison

Status: completed. All eight fixed attempts were independently graded; all 278 provider requests have complete, reconciled usage.

[Frozen protocol](protocol.json) · [Offline preflight](preflight.json) · [Previous stopped round](../evidence-residency-deepswe-20261019/README.md)

## Design

Two previously seen DeepSWE repository tasks, two independent repeats per arm: **8 fixed attempts / 4 pairs**. Baseline `f03052a`, candidate `778a54f`; only the production evidence-residency implementation differs.

Both arms use GLM-5.3-flash, enabled/low thinking, streaming, output cap 4,096, 216,000 local context window and 32,000-byte ContextOS target. Each attempt has 96 tools, 128 transport submissions, 30 minutes and a 5 USD control allocation. Total new-round allocation: 40 USD, including full allocations retained after unknown usage. Control estimates are not invoices.

Common changes from the separately preserved interrupted round: request deadline **90 → 300 seconds**, relay socket timeout 315 seconds, and artifact exports under a dedicated subdirectory to avoid Pier's manifest inventory. No production source, task instruction, model or thinking changes. The previous failed request elapsed 90.004 seconds, consistent with its configured deadline; this alone does not identify every possible transport failure cause.

Unknown usage stops the affected attempt and retains its full allocation. Remaining predeclared independent attempts may proceed; no ad hoc retry or additional sample is added. Infrastructure exceptions stop the suite. Both candidate source archives and all execution-adapter hashes were frozen before paid calls.

## Decision rules

- Primary: complete-task acceptance from the independent official verifier. Existing-behavior regressions are reported separately. Agent status and its own validation do not substitute for independent acceptance.
- Report input, output and all cache input. Reasoning is not added a second time to output. Unknown totals stay null; old interrupted-round consumption is not pooled into this new comparison.
- Audit native request counts, request hashes and usage against upstream SSE metadata. Compare token totals only when those records reconcile.
- All-attempt token movement includes failures and is consumption, not necessarily efficiency. An efficiency claim requires paired, fully accepted work and complete metering on both sides. Show that subset and its size separately.
- Four pairs on two seen tasks do not establish broad or unseen-task generalization. Report individual pairs and repeat variability; do not describe the deterministic mechanism test success as model coding accuracy.

## Preflight

Both arms passed the real adapter's synthetic SSE lifecycle: 10 responses, 9 real tools per arm, matching exported patches and independent patch tests. Zero provider calls. A first fixture run used the old collector output location after the export-subdirectory change; its failure was preserved, and the corrected fixture passed before paid calls.

Additional local synthetic checks cover fragmented LF/CRLF/Unicode SSE, incomplete and malformed metadata, plus a delayed response rejected by a short native deadline and accepted by a longer deadline. The diagnostic relay observer forwards original bytes and cannot turn malformed diagnostic metadata into a forwarding interruption.

## Results

[Sanitized results and request audits](results.json) · [Controlled mechanism measurement](../evidence-residency-fixed-trace-glm-20261019/README.md)

- Baseline: **0/4** complete tasks accepted, **4,440,517** provider tokens; input including all cache **4,393,695**, output **46,822**, 140 requests.
- Candidate: **1/4** complete tasks accepted, **2,720,007** provider tokens; input including all cache **2,671,484**, output **48,523**, 138 requests.
- Observed complete-task acceptance: **0% → 25%, +25 percentage points**. A relative improvement percentage from a zero baseline is undefined.
- All-attempt consumption: **−38.75%**. This includes failed and unequal work and **is not a same-work efficiency result**.
- Paired, fully accepted work: **0/4 pairs**. Its token-saving percentage is **null, not zero**.
- Existing-behavior checks passed in every attempt: Helm 2/2 and mnamer 319/319. This does not make incomplete tasks correct.

### Every fixed pair

1. **Repeat 1, Helm:** B 1,617,693 tokens, tool limit, F2P 0/5; C 1,294,082, completed, F2P 5/5. Only C passed the complete task. Raw consumption −20.00%.
2. **Repeat 1, mnamer:** B 618,132, internally completed, F2P 50/51; C 156,460, output-truncated, F2P 0/51. Neither passed. Raw consumption −74.69% reflects unequal completion.
3. **Repeat 2, Helm:** B 2,041,092, cost-reservation stop, F2P 0/5; C 199,049, output-truncated, F2P 0/5. Neither passed. Raw consumption −90.25% is not an efficiency win.
4. **Repeat 2, mnamer:** B 163,600, tool-JSON parse failure, F2P 0/51; C 1,070,416, internally completed, F2P 50/51. Neither passed. Raw consumption **+554.29%** reflects more attempted work by C.

Official F2P values are verifier report items, not independent tasks. The two mnamer attempts with 50/51 still fail whole-task acceptance. Both arms' self-authored/local tests and internal completion status do not replace official verification.

## Metering and constraints

All 278 native requests match the relay's request count, SHA-256, usage and model controls. Every stream has complete usage and a terminal event. Input totals include cache reads exactly once: B 732,096 cache-read tokens; C 189,632; cache writes zero. Reasoning is not separately reported by this provider and is not added again to output. No new unknown reservations or ad hoc retries occurred.

Common control-rate estimates are B 3.6460576 USD and C 2.2730516 USD, **not invoices**. The old interrupted round's 5 USD unknown-usage reservation remains separate and is excluded from this complete new-round ratio.

The frozen limits materially constrained solving:

- Two C attempts ended with explicit `max_tokens` at 4,096 output tokens, before successful edits.
- R2 B mnamer returned malformed `write_file` JSON with 4,096 reported output tokens. The adapter failed before retaining a stop reason; this is a parse failure with cap-sized output, not a confirmed `max_tokens` event.
- R2 B Helm hit `MODEL_COST_LIMIT` at a **1.6585896 USD control estimate**, not after spending 5 USD. The adapter reserved the configured maximum request size; its next worst-case reserve (~3.366912 USD) exceeded the remaining allocation (~3.341410 USD).
- Both arms share residual native-command policy gaps, including denied `grep`/`gofmt` commands. No permissions or limits were widened during the experiment.
- No compaction requests occurred. No short `read_file` receipts occurred in **either** arm. Duplicate complete same-version/range reads still occurred: B 65, C 35. Different autonomous trajectories do not establish that the repair caused those counts or the token difference.

## Assessment and disposition

**Retain the patch for its verified evidence-correctness repair. The controlled reuse path saves real tokens when deliberately activated; stable autonomous token efficiency and coding improvement are not established.**

The observed +25-point acceptance difference is one successful attempt on two previously seen task types, with strong repeat variability, no controlled provider seed and common capability limits. It is not a full DeepSWE score or a causal/general coding-quality gain. There are no both-accepted pairs, so same-work savings cannot be estimated from this autonomous run.

The separate controlled experiment isolates the actual cache path and retains answer acceptance (3/3 per arm), with −57.08% input and −56.91% total provider tokens. Its scripted setup and small fixtures cannot predict production savings. These fixture successes are never pooled into DeepSWE acceptance.

No production changes were added during this assessment, no new stage was started, and no PR was merged. Await user review. Future effectiveness work should first address output truncation, complete-work comparability and the conservative request-reservation stop under a newly frozen protocol.
