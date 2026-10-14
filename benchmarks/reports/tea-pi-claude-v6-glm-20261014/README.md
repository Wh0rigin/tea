# TEA / Pi / Claude Code measured comparison

[中文](README.zh-CN.md)

![Three native coding agents](three-agents.png)

9 planned long runs; 2 attempted. 88 submitted requests; 1 with unknown usage. Complete plan: False.

## long

- long-session: TEA vs Pi unknown; TEA vs Claude Code unknown.
  tea: tokens unknown (cohort incomplete), accepted 1/3, code behavior 1/1.
  pi: tokens unknown (cohort incomplete), accepted 0/3, code behavior 0/1.
  claude: tokens unknown (cohort incomplete), accepted 0/3, code behavior 0/0.

- teaVsPi: All planned task tokens: unknown; known pairs 0/3.
  Diagnostic both-accepted subset: unknown (0 pairs); does not replace the full cohort.
- teaVsClaude: All planned task tokens: unknown; known pairs 0/3.
  Diagnostic both-accepted subset: unknown (0 pairs); does not replace the full cohort.
- tea: attempted 1/3, accepted 1/3, code behavior 1/1, native final validation 1/1, compactions 0, known conservative cost USD 0.2511916, reservation USD 0.0000000.
- pi: attempted 1/3, accepted 0/3, code behavior 0/1, native final validation 0/1, compactions 0, known conservative cost USD 0.0624024, reservation USD 0.2674688.
- claude: attempted 0/3, accepted 0/3, code behavior 0/0, native final validation 0/0, compactions 0, known conservative cost USD 0.0000000, reservation USD 0.0000000.

## Unaccepted runs

- `long-30-r1/pi`: failed, tokens unknown (cohort incomplete); codeCorrect, declaredReadRequirements, nativePostEditValidation, nativeCompleted, usageComplete.
  Long workflow interrupted; completed work differs. Token differences are not equal-completion efficiency claims.

## Conditions and limits

Common GLM-5.3-flash enabled/low, output/thinking caps 4096/4095, identical tasks and initial source. TEA is archived compact-metadata candidate bd41742: ContextOS 32000 bytes, capability feedback on, summaries off, 24 tools/turn. Default runtime is not reenabled. Native Pi 0.87.1 RPC; native Claude Code 2.1.281 safe-mode CLI (not bare), preserving core prompts and Bash/Edit/Glob/Grep/Read/Write. Host customization and cross-session automatic memory disabled; native history and auto-compaction retained. This compares coding-agent software under one GLM model, not GLM against Anthropic Claude models.

Only TEA and Pi started; Claude was not started after the unknown-usage halt. No historical samples replace missing runs. Input includes all cache reads/writes; output includes thinking. Order rotates but provider cache cannot be reset. Three self-authored defects, three planned Long repeats per agent; unrelated modules scale repositories. No production generalization. Native prompts/tools/cache directives differ; gaps do not isolate metadata shortening. Source/harness/binary fingerprints frozen per cohort. Authoritative observer version is native-positive-validation-v6; opaque run IDs retain the exact prepared-plan spelling. Claude numbering is only a verified presentation conversion; missing source is never filled.

Known conservative cost USD 0.3135940; unknown reservation USD 0.2674688; not invoice. USD6 shared guard, USD1.4/run, 100 requests/run, 160000-byte input guard, request/turn timeout 180/300 seconds. Previous unknown reservations remain separate. No paid retry after unknown usage.

Deterministic tests: 280/280. Native extra-shell continuation contract: 9 workflows, 576 scripted requests; deliberate first-turn shell noncompliance still fails acceptance but reaches repair. Native three-agent loopback: 27/27, 108 scripted requests; Claude multi-turn: 8 scripted requests. Zero paid calls in functional checks. Initial Windows short-path and mock SSE-header failures retained and corrected before paid calls. Scripted usage is not performance evidence.

[All attempts](results.json) · [Summary](summary.json) · [Accounting audit](accounting-audit.json) · [Frozen plan](frozen-plan.json) · [Protocol](frozen-protocol.md) · [Functional checks](functional-checks.json) · [Hashes](evidence.sha256)

Protocol Markdown only rebases relative links for publication; [exact frozen source](frozen-protocol-source.txt) SHA-256: `12001442075525f2f93813f0b383e5181f80ff465bfcef14172775c8f816900b`.
