# Compact evidence metadata TEA versus Pi

[中文](README.zh-CN.md)

![Provider token comparison](tea-vs-pi.png)

## Results

Planned 60 runs; attempted 60; submitted 653 requests, 0 with unknown usage.

### fresh

- small: TEA 74847 / Pi 108094 Token; 30.76% fewer; accepted TEA 9/9, Pi 8/9; measured pairs 9/9.
- medium: TEA 73938 / Pi 286969 Token; 74.23% fewer; accepted TEA 9/9, Pi 9/9; measured pairs 9/9.
- large: TEA 375718 / Pi 758901 Token; 50.49% fewer; accepted TEA 9/9, Pi 9/9; measured pairs 9/9.

All planned tasks in this cohort: 54.55% fewer; TEA 524503 / Pi 1153964 Token.

Conservative cost at configured rates: 53.45% fewer.

Both-accepted subset (26 pairs): 54.82% fewer. Diagnostic subset; does not replace the entire cohort including failures.

- tea: code behavior 27/27; native final validation 27/27; known conservative cost USD 0.4373464, unknown reservation USD 0.0000000.
  Actual model-summary/auto-compaction executions in this cohort: 0.
- pi: code behavior 27/27; native final validation 26/27; known conservative cost USD 0.9394832, unknown reservation USD 0.0000000.
  Actual model-summary/auto-compaction executions in this cohort: 0.
- `small-cache-key`: TEA 26080 / Pi 35609; 26.76% fewer; pairs 3/3.
- `small-retry-budget`: TEA 22034 / Pi 33496; 34.22% fewer; pairs 3/3.
- `small-unicode`: TEA 26733 / Pi 38989; 31.43% fewer; pairs 3/3.
- `medium-cache-key`: TEA 22905 / Pi 93194; 75.42% fewer; pairs 3/3.
- `medium-retry-budget`: TEA 24319 / Pi 96646; 74.84% fewer; pairs 3/3.
- `medium-unicode`: TEA 26714 / Pi 97129; 72.50% fewer; pairs 3/3.
- `large-cache-key`: TEA 110265 / Pi 272046; 59.47% fewer; pairs 3/3.
- `large-retry-budget`: TEA 160483 / Pi 184722; 13.12% fewer; pairs 3/3.
- `large-unicode`: TEA 104970 / Pi 302133; 65.26% fewer; pairs 3/3.

### long

- long-session: TEA 913350 / Pi 1036146 Token; 11.85% fewer; accepted TEA 3/3, Pi 2/3; measured pairs 3/3.

All planned tasks in this cohort: 11.85% fewer; TEA 913350 / Pi 1036146 Token.

Conservative cost at configured rates: 11.27% fewer.

Both-accepted subset (2 pairs): 41.24% fewer. Diagnostic subset; does not replace the entire cohort including failures.

- tea: code behavior 3/3; native final validation 3/3; known conservative cost USD 0.7407200, unknown reservation USD 0.0000000.
  Actual model-summary/auto-compaction executions in this cohort: 0.
  Read-only phases: 812592 tokens; repair: 100758 tokens.
- pi: code behavior 2/3; native final validation 2/3; known conservative cost USD 0.8347828, unknown reservation USD 0.0000000.
  Actual model-summary/auto-compaction executions in this cohort: 0.
- `long-30`: TEA 913350 / Pi 1036146; 11.85% fewer; pairs 3/3.

## Unaccepted and interrupted runs

- `small-unicode-r2/pi`: status `completed`, tokens `14294`, dimensions `nativePostEditValidation`.
  Code behavior and scope passed. The observer could not recognize the command form as final validation; conservative grading remains unchanged. This is not a code behavior failure.
- `long-30-r1/pi`: status `failed`, tokens `1591`, dimensions `codeCorrect, declaredReadRequirements, nativePostEditValidation, nativeCompleted`.
  Required full native read was not confirmed at phase 1; repair was not reached and the initial bug remains. Complete and interrupted sessions do not perform equal work; this token total is not an equal-completion efficiency claim.

Unknown usage halts remaining work; no retries or zero imputation. Formal acceptance failures are separate from code behavior failures; original decisions are not regraded.

## Controls and limitations

Loads the reverted, Git-preserved compact-metadata candidate bd41742 against pinned native Pi 0.87.1; current default TEA is unchanged. GLM-5.3-flash enabled/low, output/thinking caps 4096/4095. TEA ContextOS 32000 bytes, semantic summary off, 24 tools/turn; Pi native auto-compaction on, automatic retries off, advertised context window 200000. Common controls, task prompts, source snapshots and observer; each native prompt and tool API is retained.

Candidate deterministic tests rerun: 276/276. Native streaming loopback passed eight requests per client, all zero-paid scripted usage. Deterministic tests ran during early live tasks; elapsed times are not used for strict latency benefit claims.

Both arms are newly run; historical Pi samples are not spliced in. Tokens include all cache input and reasoning output. Order alternates but provider cache state cannot be reset. Three self-authored JavaScript bugs at 12/120/1200 files, three repeats; unrelated modules scale file counts without increasing defect complexity. Long sessions start empty and perform 30 native read-only inspections before repair. Not production generalization evidence or a direct-parent TEA optimization gate.

USD 8 suite guard; USD 1.4/run; 100 requests/run; requests/turn timeout 180/300 s. Known conservative cost USD 2.9523324; new unknown reservation USD 0.0000000. Configured input/cache-read 0.80, output 2.80 per million; cache-write conservative rate; not an invoice. Earlier unknown reservations stay separate.

[Summary](summary.json) · [All attempts](results.json) · [Accounting audit](accounting-audit.json) · [Frozen plan](frozen-plan.json) · [Protocol](frozen-protocol.md) · [Source audit](source-audit.json) · [Hashes](evidence.sha256)

These differences compare the complete compact-metadata TEA candidate with Pi, including native tools, prompts and memory. They are not the isolated contribution of metadata shortening. That contribution belongs to the separate direct-parent E1 comparison; the experiments are not combined.
