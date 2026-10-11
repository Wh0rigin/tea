# ContextOS C · offline evidence only

[中文](README.zh-CN.md) · [Replay](replay.json) · [Fixture preflight](preflight.json) · [Rejected paid A/B](../contextos-glm-20261011/README.md)

Frozen engine commit `66b3350d93eda170d1b14d8c888e93dbe05bc44c`, SHA256 `bb2a16aab854d5ef4fe175ea8aae6042b369bbe1ad7fc868c4fd17a6012a9d06`. No provider calls and **no C provider-token claim**. Candidate C remains experimental until its same-model repeated comparison passes. Default remains full history.

## Actual checks

- 229/229 deterministic tests, including real two-process recovery, unknown billing, signed thinking, exact tool pairing, source/search/recall staleness, inferred provenance, protected storage and requirement repinning.
- Seven fixture preflights pass: initial public tests succeed while independent hidden tests witness the defect. Their source snapshots and task prompts match B exactly.
- Eight replay scenarios: original user text, tool protocol and failure preservation pass; every tested recoverable reference returns the exact available tool output. Replay uses actual workspace reads but synthetic assistant thinking/signatures, and makes no model requests.

- short: 4,791 → 4,791 UTF-8 request bytes; 0.00% byte reduction.
- 30-source-turns: 69,389 → 23,984 UTF-8 request bytes; 65.44% byte reduction.
- 50-source-turns: 113,989 → 35,044 UTF-8 request bytes; 69.26% byte reduction.
- repeated-reads: 80,439 → 80,439 UTF-8 request bytes; 0.00% byte reduction.
- active-crossfile: 80,539 → 30,130 UTF-8 request bytes; 62.59% byte reduction.
- long-failure: 93,553 → 39,763 UTF-8 request bytes; 57.50% byte reduction.
- stale-source: 80,539 → 26,747 UTF-8 request bytes; 66.79% byte reduction.
- task-switch: 78,977 → 26,873 UTF-8 request bytes; 65.97% byte reduction.

Short requests and repeated reads of the same active source provide explicit zero controls. Full wire bytes include model controls and tool definitions; they are not provider tokens. The source/comment shape differs from B's older offline helper, so do not compare the two replay totals as a controlled candidate improvement. Reproduce with `node scripts/replay-contextos.mjs benchmarks/results/contextos-replay-new` and `node scripts/compare-contextos.mjs benchmarks/results/contextos-preflight-new --preflight` from the repository root; output directories must not exist. Node 24 is required for the TypeScript preflight.

## Pending paid comparison

Same seven cases × three repeats × original/full/ContextOS arms, GLM-5.3-flash enabled/low, output cap 4096, unchanged quality and token thresholds. Current goal/rules anchors and all retrieval follow-ups count. An independent candidate acceptance failure stops future submissions. A/B costs/reservations are USD 7.0620096 under the original USD 8 cap. A USD 8 increase (combined cap USD 16) has been requested and is pending; C has no paid calls. No release optimization or performance-percentage commit is justified at this point.
