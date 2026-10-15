# TEA coding ability evaluation / 编码能力评测

Eight self-authored Node.js tasks, four author-assigned difficulty levels, two tasks per level. This measures actual model-directed source changes, not a scripted patch replay. It is a small diagnostic suite, not an industry benchmark or a claim of general coding accuracy.

## Tasks

- **L1 基础**: create a narcissistic-number module in a fresh workspace; repair interval merging, validation and input immutability.
- **L2 进阶**: implement a quoted CSV state machine; repair an injected-clock TTL cache across public exports and implementation.
- **L3 复杂**: bounded asynchronous scheduling with ordered settled outcomes; stable cursor pagination across API/store/implementation layers.
- **L4 挑战**: atomic transfers with idempotency and immutable receipts; incremental build planning with full-graph cycle checks and deterministic ordering.

The title "挑战" is relative to this suite, not a standardized measure. Additional unrelated files exercise retrieval; file count alone does not determine difficulty. The suite currently uses JavaScript/Node.js only and does not cover frontend rendering, dependency installation, distributed deployment or a production repository.

## Acceptance

Before paid execution, every initial fixture must pass its public regression test, fail a completed hidden acceptance check, and pass both checks with the author reference solution. Reference code and hidden tests are never copied into the Agent workspace. The acceptance checker copies candidate sources to a separate temporary directory after the Agent stops.

Final acceptance requires all of:

1. Original public regression test passes without modification.
2. Independent hidden assertions pass and their completion witness is observed.
3. All added public tests pass.
4. Protected files remain unchanged; only source and new regression tests change, with no original deletions.
5. TEA reports completion and recorded actual post-edit validation.

Functional pass is recorded separately from workflow acceptance. Failures are retained, even if they use fewer tokens. There is no early first-read gate, no silent retry and no substitution of reference code for a failed model attempt. Hidden acceptance is unavailable to workspace tools but exists on the same host; this is not an OS sandbox or a confidential benchmark.

## Reproduce

```sh
node scripts/test-coding-ability.mjs --mode=preflight --run-id=coding-preflight-example
node scripts/test-coding-ability.mjs --mode=live --run-id=coding-live-example --task-cap=1 --suite-cap=6
```

Use a new run ID each time. Live mode loads personal API settings without printing credentials, fixes GLM-5.3-flash / enabled thinking / low effort / 4,096 output tokens / 24 tool calls, and records the effective capacity and fixture/source hashes. Each task is a fresh independent workspace. Guarded execution uses a 256,000-byte wire cap, 90-second request timeout, ten-minute task timeout, finite per-task/suite monetary caps and previous relay accounting rates ($0.8/$2.8 per million input/output tokens). These rates are accounting controls rather than verified account billing. Cache writes use the Agent's conservative reservation policy.

Before submission, the whole task cap is reserved in the durable checkpoint; unknown usage retains that reservation and stops the suite. Complete reported usage replaces it with the accounted spend. Raw workspaces and ledgers remain in ignored `benchmarks/results/`; public reports contain reviewed aggregate data. No credentials, private paths or raw conversations are published.

## 首轮约定

用户确认：8 道真实任务，每题一次。先冻结题目与验收，再运行；失败题不临时修改验收或自动重试。报告每题正确性、完成状态、测试行为、Token、耗时和工具调用数。一次样本只能帮助定位问题，不能证明稳定成功率，也不能和此前不同任务的 Pi/Claude 对照直接比较。
