# Evidence residency: 128K-output streaming reassessment

Status: running. Protocol committed before paid calls; all offline gates and the single provider compatibility probe passed. No new performance or coding-quality claim.

[Frozen protocol](protocol.json) · [Previous complete 4K round](../evidence-residency-deepswe-r2-20261019/README.md) · [Earlier interrupted round](../evidence-residency-deepswe-20261019/README.md)

## Scope and fixed schedule

The user requested testing after raising the configured maximum output from 4,096 to **131,072 tokens**. This is the GLM-5.3-flash model's documented maximum output ([official model page](https://docs.z.ai/guides/vlm/glm-5.3-flash)); compatibility of the user's actual relay is checked separately before repository attempts. A short accepted response can demonstrate parameter acceptance, not actual 128K-length generation.

Baseline `f03052a5b41453c206f9375bd5c004842cab0dc4` and candidate `778a54ff1773e51d4f1ca1211fda4249a1eb848c` use the original verified archives. Their only production difference is version/range-aware retention of resident source evidence. Two previously seen DeepSWE v1.1 tasks, two independent repeats per arm: **eight fixed attempts / four pairs**. Arm order matches the previous round. No hidden-test feedback is supplied to the agent.

Both arms use GLM-5.3-flash, enabled thinking / low effort, streaming, 216,000 local context tokens, 32,000-byte ContextOS target, automatic compaction/GC, 96 tools, 128 transport requests and a 30-minute agent wall limit. Permissions and artifact export match the previous completed comparison. Ordinary tool/test failures already enter the agent feedback loop; terminal output/JSON recovery behavior is unchanged.

## Shared changes from the 4K round

- Maximum output **4,096 → 131,072**. Existing adapter logic derives thinking budget **4,095 → 8,000**; both arms receive the same controls.
- Request deadline **300 → 900 seconds**, relay deadline 915 seconds, to accommodate longer responses.
- Per-task control allocation **5 → 10 USD**, suite allocation **80 USD**. The larger allocation accommodates conservative maximum-output reservation; the production reservation formula and 2 MiB wire guard are unchanged.
- A separately bounded, single streaming `READY` compatibility completion, **1 USD allocation**. The combined new-round allocation is at most **81 USD**, including unknown reservations. These are accounting controls, not invoice claims.

This is a **new common execution profile**, not an isolated causal test of changing only `max_tokens`. In particular, reserving more output also changes input scheduling headroom under the same context window. The old 4K results remain historical sensitivity data and are never pooled with this round.

## Gates and reporting

1. Full local regression and both real-tool adapter lifecycle fixtures must pass without provider calls. Check archive/adapter hashes before launch.
2. Freeze the probe source hash. Run exactly one real streaming parameter probe. A rejected, incomplete or unknown probe stops before the main schedule; do not silently fall back or retry.
3. If accepted, execute only the eight predeclared trials. Each retains its entire 10 USD allocation after unknown billing. Infrastructure exceptions stop the suite; no ad hoc paid retry or extra sample.
4. Official independent whole-task acceptance is primary. Report existing-behavior checks separately; self-authored test passes and internal completion are not official acceptance.
5. Reconcile provider usage with native request counts/hashes and upstream SSE metadata. Include cache input once; do not add reasoning twice. Unknown totals stay null and never become zero.
6. Report all-attempt consumption with every failure. A same-work efficiency percentage requires paired, fully accepted work with complete metering on both sides. Show that subset and its size separately.
7. Two seen task types/four pairs, uncontrolled provider randomness and residual command-policy gaps do not establish a broad DeepSWE score or generalization.

Results, all failures, unknown reservations and the retention assessment will be recorded after the fixed schedule ends or an infrastructure stop occurs. No runtime change or PR merge is part of this reassessment.

## Completed preflight

- Local full regression: **393 passed, one Go-unavailable skip, zero failures / 394**.
- Real adapter lifecycle fixture: both arms passed, ten synthetic SSE responses and nine actual tools each, identical exported patch hashes and independent patch tests. Zero provider calls. These are self-authored infrastructure checks, not task acceptance.
- Synthetic transport checks: **17 passed**, covering fragmented Unicode/LF/CRLF and incomplete/malformed SSE metadata; zero provider calls.
- [Provider parameter probe](provider-probe.json): one real streaming call accepted **131,072 output / 8,000 thinking budget**, returned `READY` with normal termination and complete usage: **26 input + 9 output = 35 provider tokens**. No unknown reservation or retry. This confirms parameter acceptance, not full-length generation.
- [Dual-arm offline lifecycle result](preflight.json). Eight autonomous attempts are now in progress under the separately frozen 80 USD allocation.
