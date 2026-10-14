# TEA fair discovery versus recorded Pi / Claude Code

[中文](README.zh-CN.md)

![Three agents on matched small and large tasks](three-agents.png)

## Case-aligned historical comparison

This combines **already measured** TEA repair d76f45f with **historical fresh-v5** Pi 0.87.1 and Claude Code 2.1.281. **Zero new provider calls.** It is not a simultaneous three-agent rerun. No historical tokens or grades are changed.

Six matching tasks at small (12 files) and large (1,200 files), three repeats: **18 runs per agent, 54 recorded attempts / 302 known-usage requests**. All six prompt hashes, initial source hashes and file counts match. Effective model controls match: **GLM-5.3-flash, enabled thinking / low effort, output 4096 / thinking budget 4095**; same endpoint hash, 160,000-byte guard, 100-request run cap and 300-second turn limit. Native agent prompts/tools and memory policies differ, as intended for an agent-software comparison. Claude Code runs GLM here, not an Anthropic Claude model.

## Token results

All selected known attempts, including cache input and thinking output:

- Small: TEA **76,095**, Pi **106,969**, Claude Code **263,065**. TEA **28.86% fewer than Pi**, **71.07% fewer than Claude**.
- Large: TEA **75,583**, Pi **564,425**, Claude Code **373,057**. TEA **86.61% fewer than Pi**, **79.74% fewer than Claude**.
- Combined: TEA **151,678**, Pi **671,394**, Claude Code **636,122**. TEA **77.41% fewer than Pi**, **76.16% fewer than Claude**.

## Quality and chart policy

Full acceptance: **TEA 18/18, Pi 18/18, Claude 12/18**. Code behavior, scope, declared reads and workflow completion pass **18/18 for all three**. Claude's other six attempts have only native post-edit validation unconfirmed; they are not reclassified as code failures or passes. The confirmed-only diagnostic subset (12 case-aligned TEA/Claude pairs) gives **78.99% fewer TEA tokens**, not a replacement for the 18-case result.

Circles are fully accepted; triangles mean final validation unconfirmed. Failure crosses would be retained as points but excluded from bar means; unknown usage is never zero. There are no failed/unknown attempts in the selected subset, so the bars include all nine measured runs per agent/scale and match the displayed all-attempt ratios. All 54 points and grades are retained. Middle-size and long-session records are omitted because the current TEA repair was not measured there; previous charts remain historical.

## Alignment and limitations

[Alignment audit](alignment.json) records exact task/prompt fingerprints. The fixture generator, per-turn observer, source-capture and independent acceptance wrapper have identical committed hashes between cohorts. The later continuation rule differs only after turns; each selected task has one completed turn, and acceptance dimensions are unchanged. Historical grades are preserved.

[Summary](summary.json) · [All selected runs and requests](results.json) · [Chart audit](chart-audit.json) · [Artifact hashes](evidence.sha256)

Sources: [new TEA repair](../discovery-repair-20261014/README.md), [historical fresh-v5 comparison](../tea-pi-claude-v5-glm-20261013/README.md). The source-file hashes and software identities are recorded in summary.json. Reproduce the aggregation and PNG/SVG with `python scripts/compare-recorded-agents.py` from the repository root (Matplotlib installed); it makes no network requests.

Measurements came from separate rounds. Provider cache state, server load, backend updates and random generation are not controlled across rounds. Repeat numbers align case labels, not random seeds. This is descriptive historical evidence, not a fresh simultaneous performance gate or a causal estimate of a single optimization. Six self-authored JavaScript defects with unrelated-module scaling do not establish production-project or language generalization. The new TEA repair's small-Unicode direct-parent regression remains in its own report; the comparison does not erase it. Earlier unknown reservations remain independent and unresolved.
