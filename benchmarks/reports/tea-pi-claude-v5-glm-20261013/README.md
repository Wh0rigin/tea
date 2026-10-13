# TEA / Pi / Claude Code measured comparison

[中文](README.zh-CN.md)

![Three native coding agents](three-agents.png)

90 planned runs; 90 attempted. 1027 submitted requests; 0 with unknown usage. Complete plan: True.

## fresh

- small: TEA vs Pi 26.27% fewer; TEA vs Claude Code 70.02% fewer.
  tea: tokens 78872, accepted 9/9, code behavior 9/9.
  pi: tokens 106969, accepted 9/9, code behavior 9/9.
  claude: tokens 263065, accepted 6/9, code behavior 9/9.
- medium: TEA vs Pi 77.18% fewer; TEA vs Claude Code 76.48% fewer.
  tea: tokens 71945, accepted 9/9, code behavior 9/9.
  pi: tokens 315208, accepted 9/9, code behavior 9/9.
  claude: tokens 305902, accepted 6/9, code behavior 9/9.
- large: TEA vs Pi 40.37% fewer; TEA vs Claude Code 9.78% fewer.
  tea: tokens 336571, accepted 9/9, code behavior 9/9.
  pi: tokens 564425, accepted 9/9, code behavior 9/9.
  claude: tokens 373057, accepted 6/9, code behavior 9/9.

- teaVsPi: All planned task tokens: 50.60% fewer; known pairs 27/27.
  Diagnostic both-accepted subset: 50.60% fewer (27 pairs); does not replace the full cohort.
- teaVsClaude: All planned task tokens: 48.26% fewer; known pairs 27/27.
  Diagnostic both-accepted subset: 47.07% fewer (18 pairs); does not replace the full cohort.
- tea: attempted 27/27, accepted 27/27, code behavior 27/27, native final validation 27/27, compactions 0, known conservative cost USD 0.4066404, reservation USD 0.0000000.
- pi: attempted 27/27, accepted 27/27, code behavior 27/27, native final validation 27/27, compactions 0, known conservative cost USD 0.8042676, reservation USD 0.0000000.
- claude: attempted 27/27, accepted 18/27, code behavior 27/27, native final validation 18/27, compactions 0, known conservative cost USD 0.7869292, reservation USD 0.0000000.

## long

- long-session: TEA vs Pi 13.18% fewer; TEA vs Claude Code 61.89% fewer.
  tea: tokens 904069, accepted 3/3, code behavior 3/3.
  pi: tokens 1041288, accepted 2/3, code behavior 2/3.
  claude: tokens 2372334, accepted 3/3, code behavior 3/3.

- teaVsPi: All planned task tokens: 13.18% fewer; known pairs 3/3.
  Diagnostic both-accepted subset: 41.89% fewer (2 pairs); does not replace the full cohort.
- teaVsClaude: All planned task tokens: 61.89% fewer; known pairs 3/3.
  Diagnostic both-accepted subset: 61.89% fewer (3 pairs); does not replace the full cohort.
- tea: attempted 3/3, accepted 3/3, code behavior 3/3, native final validation 3/3, compactions 0, known conservative cost USD 0.7332972, reservation USD 0.0000000.
- pi: attempted 3/3, accepted 2/3, code behavior 2/3, native final validation 2/3, compactions 0, known conservative cost USD 0.8389044, reservation USD 0.0000000.
- claude: attempted 3/3, accepted 3/3, code behavior 3/3, native final validation 3/3, compactions 0, known conservative cost USD 1.9141232, reservation USD 0.0000000.

## Unaccepted runs

- `small-unicode-r1/claude`: completed, tokens 34306; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-unicode-r1/claude`: completed, tokens 27568; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-cache-key-r1/claude`: completed, tokens 42189; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-unicode-r1/claude`: completed, tokens 28571; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `small-unicode-r2/claude`: completed, tokens 39273; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-unicode-r2/claude`: completed, tokens 27400; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `large-unicode-r2/claude`: completed, tokens 28709; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `small-unicode-r3/claude`: completed, tokens 23435; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `medium-retry-budget-r3/claude`: completed, tokens 32735; nativePostEditValidation.
  Code behavior passed; final native validation unconfirmed. Keep conservative grading; do not call it a code behavior failure.
- `long-30-r2/pi`: failed, tokens 9294; codeCorrect, declaredReadRequirements, nativePostEditValidation, nativeCompleted.
  Long workflow interrupted; completed work differs. Token differences are not equal-completion efficiency claims.

## Conditions and limits

Common GLM-5.3-flash enabled/low, output/thinking caps 4096/4095, identical tasks and initial source. TEA is archived compact-metadata candidate bd41742: ContextOS 32000 bytes, capability feedback on, summaries off, 24 tools/turn. Default runtime is not reenabled. Native Pi 0.87.1 RPC; native Claude Code 2.1.281 safe-mode CLI (not bare), preserving core prompts and Bash/Edit/Glob/Grep/Read/Write. Host customization and cross-session automatic memory disabled; native history and auto-compaction retained. This compares coding-agent software under one GLM model, not GLM against Anthropic Claude models.

All arms newly measured, no historical sample reuse. Input includes all cache reads/writes; output includes thinking. Order rotates but provider cache cannot be reset. Three self-authored defects, three repeats per scale; unrelated modules scale repositories. No production generalization. Native prompts/tools/cache directives differ; gaps do not isolate metadata shortening. Source/harness/binary fingerprints frozen. Claude numbering is only a verified presentation conversion; missing source is never filled.

Known conservative cost USD 5.4841620; unknown reservation USD 0.0000000; not invoice. USD12 shared guard, USD1.4/run, 100 requests/run, 160000-byte input guard, request/turn timeout 180/300 seconds. Previous unknown reservations remain separate. No paid retry after unknown usage.

Deterministic tests: 280/280. Native continuation contract: 9 workflows, 567 scripted requests; deliberately missed first reads still fail acceptance but reach repair. Native three-agent loopback: 27/27, 108 scripted requests; Claude multi-turn: 8 scripted requests. Zero paid calls in functional checks. Initial Windows short-path and mock SSE-header failures retained and corrected before paid calls. Scripted usage is not performance evidence.

[All attempts](results.json) · [Summary](summary.json) · [Accounting audit](accounting-audit.json) · [Frozen plan](frozen-plan.json) · [Protocol](frozen-protocol.md) · [Functional checks](functional-checks.json) · [Hashes](evidence.sha256)

Protocol Markdown only rebases relative links for publication; [exact frozen source](frozen-protocol-source.txt) SHA-256: `2bf0e618e68b1c80f95a40fdf8f4edce293cf2760d3b2eb9e9c15f539f97c63d`.
