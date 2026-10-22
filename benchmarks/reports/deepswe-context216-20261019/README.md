# DeepSWE v1.1: TEA with a configured 216k context window

Date: 2026-10-19. This is a two-task diagnostic pilot with a custom TEA adapter and recovered artifact export, **not a full 113-task leaderboard score**.

## Results

Both preselected tasks received one paid attempt. The official separate verifier accepted **0/2 complete tasks**:

- **Helm — unified manifest stream:** 3/5 fail-to-pass entries and 2/2 pass-to-pass entries passed. TEA changed four files, reached its 96-tool limit, and used **1,525,396 provider tokens** across 61 requests. Its first successful edit was tool call 80. No valid test execution was recorded by TEA.
- **mnamer — daemon watch lifecycle:** 47/51 fail-to-pass entries and 319/319 pass-to-pass entries passed. TEA changed four files, marked the task completed after 55 tool calls, and used **625,476 provider tokens** across 41 requests. Its first successful edit was tool call 9. Agent-run validation passed, but the official verifier rejected the incomplete implementation.

The fail-to-pass counts are official report entries; Helm includes a parent test and a subtest. They are not independent tasks or equally weighted requirements. Passing existing behavior does not substitute for completing the requested feature.

All **102 provider requests** have reconciled usage: **2,150,872 total tokens**, including 496,640 cache-read input tokens. Input including cache was 2,124,629; output was 26,243. Provider output is counted once, without adding separately reported reasoning again. The control-rate estimate was **1.7731836 USD**, not an invoice. Failed attempts remain in these totals.

## Frozen configuration

- TEA: `cdc5397aef1741961c11a0c96b910546cd8f9d28`.
- DeepSWE: `0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea`; Pier: `4d3c14041d16443f3f9f460dcdf23629994a304e`.
- Deterministic original selection: sort all 113 task IDs by `sha256(tea-deepswe-smoke-v1:seed=0:<id>)`, take the first two. Task bases and image digests are recorded in [results.json](results.json).
- GLM-5.3-flash; enabled thinking, low effort, streaming; maximum output 4,096 tokens.
- Configured context window 216,000; output reserve 4,096 and safety reserve 4,096; local input limit **207,808**, automatic compaction trigger **166,246** estimated input tokens. This is a local scheduling configuration, not proof of provider support for a full 216k request.
- ContextOS and automatic compaction enabled. ContextOS target remains **32,000 bytes**, independently of the token window. Wire guard: 2 MiB.
- Per task: 96 tools, 128 transport calls, 90-second request timeout, 30-minute agent wall cap. Official agent wall cap is three hours; this pilot does not reproduce that full allowance.
- Per-task/suite control caps: 5/10 USD. Control rates: 0.8/2.8 USD per million input/output tokens. Unknown usage retains the full task reservation and stops the suite; no automatic paid retry.
- Official no-network agent images and separate verifier containers. A dedicated Unix socket relays only the fixed model endpoint; credentials stay in host process memory. Hidden test source and reference solutions were not read or supplied to the agent.

No request hit the local context or wire guard. Peak local input estimates were 118,096 for Helm and 42,284 for mnamer. **Zero summary requests** occurred, so this pilot does not validate automatic summarization quality or its token benefit. ContextOS still projected older tool results into references.

## Infrastructure failures and recovery

The first v3 launch failed before inference because Pier represents empty command stdout as `None`. Its zero-call, zero-cost record was retained. The corrected v3b adapter normalized empty output and exercised actual branch preparation in offline preflight before paid calls.

Trusted setup verified the pristine task base, created a feature branch from `main`, configured a local Git identity, and ignored `.tea` locally. Benchmark approvals were widened for scoped Git operations. However, the frozen policy still rejected `git checkout -b NAME main`; the pre-created feature branch satisfied the task requirement. TEA also blocked compound commands and some valid Git diagnostic forms. These limitations were preserved during the attempts.

After each paid attempt, trusted finalization failed: `git add -A -- . ':!.tea'` returned exit 1 when `.tea` was already ignored. Thus the original trial exceptions are **artifact-export errors**, not official task verdicts. An offline fixture reproduced the failure and verified `git add -A -- .`, a signed commit, and exclusion of private state.

Official verification was recovered **without another model call or solution edit**:

1. Start a pristine container at the same task base.
2. Replay only the original successful `write_file` and `apply_patch` inputs through the same pinned production `WorkspaceTools`.
3. Require identical tool outputs and changed-file lists: 6 successful mutations for Helm, 11 for mnamer.
4. For mnamer, also require changed-file SHA-256 hashes to match a read-only snapshot captured after the original final result was written. Helm has deterministic mutation replay, but no final workspace snapshot; no original exported patch existed for a direct hash comparison.
5. Export a signed commit with the corrected staging command, then run the official separate verifier. Original paid records and exceptions remain intact.

The recovered patches were not repaired using verifier feedback. Patch hashes, mutation fingerprints, adapter hashes and fidelity records are in [results.json](results.json). These are artifact evaluations recovered from the original attempts, not additional coding attempts.

## Interpretation

Earlier restricted 32k runs made no edits and passed 0/5 and 0/51 fail-to-pass entries. This run produced partial implementations, but **complete-task acceptance remains 0/2**. The context window and benchmark Git contract changed together, trajectories are stochastic, and each task has only one attempt. No causal token-saving or universal accuracy percentage is claimed.

Observed problems:

- Helm spent 84/96 tool calls on listing, reading, searching or recalling; 18 retrieval calls repeated identical earlier arguments. Little budget remained for implementation and validation.
- mnamer passed its own validation while missing official lifecycle requirements. Recorded failures concern nested state/log paths and start/restart behavior.
- Helm's remaining official failures concern deterministic ordering in upgrade dry-run rendering. Failure names are verifier feedback, not a proven source-level diagnosis.
- The fixed 32 KB evidence target and a larger token window may need coordinated working-set policies. Repeated retrieval is observed; its causal contribution needs a controlled comparison.
- Preflight covered individual capabilities but initially missed the full artifact-export lifecycle. Future paid runs need that lifecycle check first.

See [the Chinese process review](../../../docs/DEEPSWE_CONTEXT216_REVIEW.zh-CN.md). Production source was not changed by this follow-up. The earlier rejected summary-budget/recovery candidate remains reverted.
