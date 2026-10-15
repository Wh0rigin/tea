# S1: existing-file edit guidance

**Outcome (2026-10-15): rejected and runtime change reverted.** All-attempt tokens fell 1.38%, but full acceptance fell from 23/24 to 20/24; source behavior checks alone fell from 23/24 to 22/24. See [the complete experiment](../benchmarks/reports/coding-s1-paired-glm-20261014-v1/README.md). The flag descriptions below refer to frozen candidate `e0787b1`, not the current CLI.

This experiment tests one change only: improve create/edit tool selection without granting overwrite permission. It does not add PowerShell, alter compaction thresholds, change validation or modify acceptance requirements.

## Candidate

- `write_file` is labeled CREATE ONLY for absent paths; inventory/search/read paths must use exact patches.
- `apply_patch` explicitly edits existing files, including replacing a complete implementation using observed exact text.
- A read receipt adds `Existing file: edit with apply_patch.` after its unchanged evidence fingerprint header.
- Create-over-existing feedback is shorter but still refuses the write. Source code hashes, unique patch checks, permissions and pending-validation tracking are unchanged.
- Capability identity changes when guidance is enabled so resumed sessions receive the current rule. Default is off; experimental enablement is `TEA_EDIT_GUIDANCE=1` or SDK `editGuidance: true`.

## Frozen protocol

Eight self-authored Node.js tasks, three fresh attempts per task and arm (48 runs). Direct parent commit `4ac8d9224f21ca330016c83aee72eff5e6a25f34`; candidate commit `e0787b1`. Engines are extracted from committed bytes without resetting the current checkout. Workspaces have no ancestor instructions. Both arms use identical initial files and independent acceptance; which arm runs first alternates by task and repetition.

Common controls: GLM-5.3-flash, enabled thinking / low, 4,096 output tokens, 32,768 configured context tokens with 4,096 safety reserve, 256,000 request bytes, ContextOS target 32,000 bytes, automatic compaction, 24 tool calls, 90-second request and ten-minute task deadlines. Conservative accounting uses previously recorded relay rates. Each task reserves 1 USD; the suite guard is 8 USD. Unknown usage retains its reservation and stops, with no automatic paid retry. Failed attempts remain in all-attempt totals and are shown as separate points rather than success bars.

```sh
node scripts/compare-coding-s1.mjs --mode=prepare --run-id=s1-preflight-example
node scripts/compare-coding-s1.mjs --mode=live --run-id=s1-live-example
```

## Adoption gate

Require complete coverage, known usage and unchanged frozen sources. Candidate acceptance must not decrease overall or in any task family, and all-attempt provider Token total must fall. Report each task and each repetition, along with existing-file creation errors, tool failures and requests. A narrower both-passed analysis never replaces the full gate. Three samples per task remain insufficient for broad production/generalization or significance claims.

The candidate stays disabled pending review even if it passes. If the gate fails, discard the runtime change while keeping frozen experiment evidence. Stop after S1; later optimization stages need the user's review.

## 中文说明

本次只调整英文工具说明、读取后的编辑提示与覆盖失败反馈。前版/候选各跑八题三次，统一模型、预算、初始状态和验收，轮换顺序。创建工具仍不能覆盖已有文件，不降低测试标准。先观察是否减少误用，再检查总 Token；质量下降或无收益都不默认采用。完成 S1 后停止，等待审核。
