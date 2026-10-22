# Pi-style summary budget: DeepSWE comparison

[中文报告](RESULTS.zh-CN.md)

Completed four TEA attempts against the same official GLM endpoint and two previously seen tasks, two repeats each. Historical baseline reused; Pi and Claude were not rerun.

- Official full acceptance: 1/4 → 2/4. Native completion: 1/4 → 4/4.
- Context-limit stops: 3 → 0. Truncated summaries: 3/5 → 0/3.
- All-attempt provider tokens, including failed attempts, cache and thinking: 4,593,245 → 3,805,216 (17.16% lower); 208 submitted requests, all independently reconciled.

The aggregate token decrease is **not an isolated summary-efficiency result**: neither candidate Mnamer run compacted, while both Helm runs used more tokens and continued farther. Only one historical pair passed both official graders; its baseline did not complete natively and its candidate did not compact. No pair both completed natively and passed. Two seen tasks and sequential historical runs cannot establish generalization or causal savings. Summary-only thinking reservation also increases under the unchanged adapter formula; see the Chinese methods section.

Candidate runtime `cda9cea`; baseline `819bd72`; protocol frozen in `eb09095` before paid calls. No runtime changes during attempts. See protocol.json, preflight.json, results.json, diagnostics.json and verification.json. Local regression: 450 passed, 1 skipped; targeted: 49 passed. No merge performed.
