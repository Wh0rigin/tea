# Evidence residency: repeated streaming comparison

Status: running. No final improvement claim yet.

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

Results and the retention decision will be recorded after the fixed schedule completes or an infrastructure stop occurs.
