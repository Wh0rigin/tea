# TEA / Pi / Claude Code measured comparison

[中文](README.zh-CN.md)

![Three native coding agents](three-agents.png)

90 planned runs; 90 attempted. 968 submitted requests; 0 with unknown usage. Complete plan: True.

## Long continuation follow-up (v5)

The first phase requested the full native read of `src/generated/domain-00/module-0000.mjs`, a 1,378-byte synthetic unrelated utility. Two Pi attempts recorded zero tool calls; the old harness stopped after the missed read. Future runs record missed inspections and continue the remaining reads and repair, without granting acceptance. Workflow completion and read compliance are separate. Timeouts, unknown usage, budget guards, mutations and protocol errors still stop execution.

Current Long bars average only workflows reaching all scheduled phases, with TEA/Pi/Claude sample counts 3/1/3 and no aggregate ratio. Interrupted attempts remain points; historical grades and token totals remain unchanged. Numerical totals below remain historical all-attempt statistics. No v5 paid measurements yet; a new experiment must rerun all three agents rather than replace Pi failures selectively.

[Historical all-attempt chart](three-agents-all-attempts.png) · [Policy and chart statistics](long-continuation.json)

## fresh

- small: TEA vs Pi 34.02% fewer; TEA vs Claude Code 73.70% fewer.
  tea: tokens 72897, accepted 9/9, code behavior 9/9.
  pi: tokens 110482, accepted 9/9, code behavior 9/9.
  claude: tokens 277132, accepted 0/9, code behavior 9/9.
- medium: TEA vs Pi 75.68% fewer; TEA vs Claude Code 76.58% fewer.
  tea: tokens 73911, accepted 9/9, code behavior 9/9.
  pi: tokens 303904, accepted 9/9, code behavior 9/9.
  claude: tokens 315539, accepted 1/9, code behavior 9/9.
- large: TEA vs Pi 50.12% fewer; TEA vs Claude Code 18.32% fewer.
  tea: tokens 335519, accepted 9/9, code behavior 9/9.
  pi: tokens 672665, accepted 9/9, code behavior 9/9.
  claude: tokens 410752, accepted 0/9, code behavior 9/9.

- teaVsPi: All planned task tokens: 55.63% fewer; known pairs 27/27.
  Diagnostic both-accepted subset: 55.63% fewer (27 pairs); does not replace the full cohort.
- teaVsClaude: All planned task tokens: 51.93% fewer; known pairs 27/27.
  Diagnostic both-accepted subset: 80.70% fewer (1 pairs); does not replace the full cohort.
- tea: attempted 27/27, accepted 27/27, code behavior 27/27, native final validation 27/27, compactions 0, known conservative cost USD 0.4049796, reservation USD 0.0000000.
- pi: attempted 27/27, accepted 27/27, code behavior 27/27, native final validation 27/27, compactions 0, known conservative cost USD 0.8843968, reservation USD 0.0000000.
- claude: attempted 27/27, accepted 1/27, code behavior 27/27, native final validation 1/27, compactions 0, known conservative cost USD 0.8397244, reservation USD 0.0000000.

## long

- long-session: TEA vs Pi 76.35% more; TEA vs Claude Code 61.78% fewer.
  tea: tokens 920730, accepted 3/3, code behavior 3/3.
  pi: tokens 522099, accepted 1/3, code behavior 1/3.
  claude: tokens 2409039, accepted 2/3, code behavior 3/3.

- teaVsPi: All planned task tokens: 76.35% more; known pairs 3/3.
  Diagnostic both-accepted subset: 41.77% fewer (1 pairs); does not replace the full cohort.
- teaVsClaude: All planned task tokens: 61.78% fewer; known pairs 3/3.
  Diagnostic both-accepted subset: 61.71% fewer (2 pairs); does not replace the full cohort.
- tea: attempted 3/3, accepted 3/3, code behavior 3/3, native final validation 3/3, compactions 0, known conservative cost USD 0.7465560, reservation USD 0.0000000.
- pi: attempted 3/3, accepted 1/3, code behavior 1/3, native final validation 1/3, compactions 0, known conservative cost USD 0.4208212, reservation USD 0.0000000.
- claude: attempted 3/3, accepted 2/3, code behavior 3/3, native final validation 2/3, compactions 0, known conservative cost USD 1.9432352, reservation USD 0.0000000.

## Observer compatibility follow-up (v4)

Recognize an optional exact-workspace `cd … && node --test …` and terminal `2>&1`, including Windows Git Bash drive paths. Require positive completion counts, successful results and stable source versions. Pipelines, status masking, substitutions, outside directories and filtered tests remain unconfirmed. Deterministic tests: 278/278; native three-agent loopback: 27/27 tasks; new paid requests: 0.

Historical v3 grades and token totals remain unchanged. Exact SHA-256 reconstruction identified 19 compatible workspace-change test commands and one tail pipeline; it does not prove their original tests passed or regrade them. Old unrecognized commands lack result summaries; future observations retain sanitized summaries. Chart markers: circles accepted, triangles final validation unconfirmed (27), crosses other acceptance failure (2). The first local check was stopped by the source-change guard during development; that record is retained. The check passed with source fixed.

[Compatibility audit](validation-compatibility.json)

## Unaccepted runs

- `small-cache-key-r1/claude`: completed, tokens 28388; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `small-retry-budget-r1/claude`: completed, tokens 28704; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `small-unicode-r1/claude`: completed, tokens 30281; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-cache-key-r1/claude`: completed, tokens 31744; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-retry-budget-r1/claude`: completed, tokens 32972; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-unicode-r1/claude`: completed, tokens 42265; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-cache-key-r1/claude`: completed, tokens 26509; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-retry-budget-r1/claude`: completed, tokens 66534; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-unicode-r1/claude`: completed, tokens 33852; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `small-cache-key-r2/claude`: completed, tokens 31209; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `small-retry-budget-r2/claude`: completed, tokens 28715; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `small-unicode-r2/claude`: completed, tokens 36967; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-cache-key-r2/claude`: completed, tokens 32242; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-retry-budget-r2/claude`: completed, tokens 32795; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-unicode-r2/claude`: completed, tokens 39363; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-cache-key-r2/claude`: completed, tokens 31040; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-retry-budget-r2/claude`: completed, tokens 67971; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-unicode-r2/claude`: completed, tokens 81421; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `small-cache-key-r3/claude`: completed, tokens 36282; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `small-retry-budget-r3/claude`: completed, tokens 28680; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `small-unicode-r3/claude`: completed, tokens 27906; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-retry-budget-r3/claude`: completed, tokens 41278; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-unicode-r3/claude`: completed, tokens 32756; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-cache-key-r3/claude`: completed, tokens 33943; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-retry-budget-r3/claude`: completed, tokens 29138; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-unicode-r3/claude`: completed, tokens 40344; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `long-30-r1/pi`: failed, tokens 1586; codeCorrect, declaredReadRequirements, nativePostEditValidation, nativeCompleted.
  Long workflow interrupted; completed work differs. Token differences are not equal-completion efficiency claims.
  Phase 1 did not satisfy the full native source-read requirement; the workflow stopped before repair. Complete usage records are not classified as missing API usage.
- `long-30-r2/pi`: failed, tokens 1577; codeCorrect, declaredReadRequirements, nativePostEditValidation, nativeCompleted.
  Long workflow interrupted; completed work differs. Token differences are not equal-completion efficiency claims.
  Phase 1 did not satisfy the full native source-read requirement; the workflow stopped before repair. Complete usage records are not classified as missing API usage.
- `long-30-r2/claude`: completed, tokens 824646; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.

## Conditions and limits

Common GLM-5.3-flash enabled/low, output/thinking caps 4096/4095, identical tasks and initial source. TEA is archived compact-metadata candidate bd41742: ContextOS 32000 bytes, capability feedback on, summaries off, 24 tools/turn. Default runtime is not reenabled. Native Pi 0.87.1 RPC; native Claude Code 2.1.281 safe-mode CLI (not bare), preserving core prompts and Bash/Edit/Glob/Grep/Read/Write. Host customization and cross-session automatic memory disabled; native history and auto-compaction retained. This compares coding-agent software under one GLM model, not GLM against Anthropic Claude models.

All arms newly measured, no historical sample reuse. Input includes all cache reads/writes; output includes thinking. Order rotates but provider cache cannot be reset. Three self-authored defects, three repeats per scale; unrelated modules scale repositories. No production generalization. Native prompts/tools/cache directives differ; gaps do not isolate metadata shortening. Source/harness/binary fingerprints frozen. Claude numbering is only a verified presentation conversion; missing source is never filled.

Known conservative cost USD 5.2397132; unknown reservation USD 0.0000000; not invoice. USD12 shared guard, USD1.4/run, 100 requests/run, 160000-byte input guard, request/turn timeout 180/300 seconds. Previous unknown reservations remain separate. No paid retry after unknown usage.

Deterministic tests: 274/274. Native three-agent loopback: 27/27, 108 scripted requests; Claude multi-turn: 8 scripted requests. Zero paid calls in functional checks. Initial Windows short-path and mock SSE-header failures retained and corrected before paid calls. Scripted usage is not performance evidence.

[All attempts](results.json) · [Summary](summary.json) · [Accounting audit](accounting-audit.json) · [Frozen plan](frozen-plan.json) · [Protocol](frozen-protocol.md) · [Functional checks](functional-checks.json) · [Hashes](evidence.sha256)
