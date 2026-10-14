# Current measured comparison: fresh v5 / long v6

[中文](README.zh-CN.md)

![Three native coding agents](three-agents.png)

Two independently frozen cohorts: 81 fresh v5 runs and nine Long v6 runs. Same archived TEA bd41742 / Pi 0.87.1 / Claude Code 2.1.281, GLM-5.3-flash enabled/low, output/thinking caps 4096/4095, task prompts and initial source. This is not one unified 90-run source freeze. The superseded v5 Long cohort remains in its report.

## fresh

- teaVsPi: 50.60% fewer (full all-attempt totals); both-accepted diagnostic subset 50.60% fewer (27 pairs).
- teaVsClaude: 48.26% fewer (full all-attempt totals); both-accepted diagnostic subset 47.07% fewer (18 pairs).
- tea: tokens 487388; acceptance 27/27; behavior 27/27; workflow completion 27/27; declared read compliance 27/27.
- pi: tokens 986602; acceptance 27/27; behavior 27/27; workflow completion 27/27; declared read compliance 27/27.
- claude: tokens 942024; acceptance 18/27; behavior 27/27; workflow completion 27/27; declared read compliance 27/27.

## long

- teaVsPi: 41.36% fewer (full all-attempt totals); both-accepted diagnostic subset 41.36% fewer (3 pairs).
- teaVsClaude: 62.40% fewer (full all-attempt totals); both-accepted diagnostic subset 62.40% fewer (3 pairs).
- tea: tokens 905432; acceptance 3/3; behavior 3/3; workflow completion 3/3; declared read compliance 3/3.
- pi: tokens 1544126; acceptance 3/3; behavior 3/3; workflow completion 3/3; declared read compliance 3/3.
- claude: tokens 2407974; acceptance 3/3; behavior 3/3; workflow completion 3/3; declared read compliance 3/3.

## Markers, grading and limits

Claude Code fresh uncertainty fell from 26/27 to 9/27; full acceptance rose from 1/27 to 18/27. Common recognition failures are fixed, not all complex-command uncertainty. Historical grades are unchanged. Circles passed, triangles have only final validation unconfirmed and remain eligible, crosses are failures excluded from bars. All attempts/unknown usage remain recorded. Bar subsets are separate from full totals; unfiltered ratios are not annotated on failure-filtered bars.

v6 continues normally completed turns with complete tool events; missed reads, read-only violations and workspace changes still fail compliance. Runtime/protocol failures, exceptions, timeouts and usage/budget guards still stop. Continuation never grants a pass.

This compares agent software: Claude Code uses the same GLM, not an Anthropic Claude model. Native core prompts/tools retained; host personalization and cross-session memory disabled. Self-authored JavaScript defects and unrelated-module scaling do not establish production generalization. Gaps do not isolate metadata shortening; the default runtime candidate remains reverted.

Displayed cohort known conservative cost USD 5.9191288; v5 plus successful retry attempted-work cost USD 9.4054536; configured rates, not invoice. Reservations USD 0.0000000; earlier reservations separate.

[Fresh v5 evidence](../tea-pi-claude-v5-glm-20261013/README.md) · [Long v6 evidence](../tea-pi-claude-v6-retry1-glm-20261014/README.md) · [Full displayed records](results.json) · [Chart audit](chart-audit.json) · [Summary](summary.json) · [Hashes](evidence.sha256)


This is a separate, explicitly user-authorized rerun: 9/9 accepted, 587 known-usage requests and no unknown requests. The prior interrupted cohort remains separate: its known cost USD 0.3135940 and unknown reservation USD 0.2674688 are additional to this rerun and excluded from its complete token ratios. New usage never fills the old missing request.

[Prior interrupted cohort](../tea-pi-claude-v6-glm-20261014/README.md)
