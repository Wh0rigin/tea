# Three coding agents: frozen comparison protocol

Compare TEA's archived compact-evidence candidate `bd41742d683dfcda69f240223ff6b27815f3dd08`, Pi 0.87.1 and Claude Code 2.1.281. This measures coding-agent software with a common GLM model through an Anthropic Messages compatible endpoint; it does not compare GLM with Anthropic's Claude models or reproduce personalized interactive configurations.

## Fixed workload and controls

- Freeze all task source fingerprints, prompts, loaded TEA revision, Pi CLI hash, Claude executable version/hash and harness source before paid calls. Use newly measured runs for all three agents; never splice historical two-agent data into this experiment.
- Fresh tasks: primitive cache keys, retry budgets and Unicode truncation at 12/120/1,200 files, three repetitions each: 27 cases per agent, 81 runs. Extra files are unrelated modules; defect complexity does not scale with file count.
- Long workflow: start empty, perform 30 native full-file read-only inspections, then repair and validate; three repetitions per agent, nine runs. Total: 90 runs / 30 matched sets.
- Shared GLM-5.3-flash, enabled thinking, low effort, task output/thinking caps 4096/4095. The common wire gateway enforces these controls and removes temperature/top-p/top-k overrides while preserving native prompts, tools and cache directives.
- Rotate order among TEA/Pi/Claude for each task and repetition so each agent occupies each position across the three repeats. Provider cache state cannot be reset; record all cache input exactly once and reasoning inside output.
- Shared suite guard USD 12, USD 1.4 per agent/case, 100 requests per agent/case, 160000 UTF-8-byte payload guard, request timeout 180 seconds, native turn timeout 300 seconds. Configured conservative input/cache-read USD 0.80 and output USD 2.80 per million tokens; cache creation defaults to twice input. These are usage estimates, not invoices. Previous unknown reservations remain separate.

## Native profiles and observation

TEA uses its frozen native engine: v1 discovery/read reuse, ContextOS target 32000 bytes, semantic summaries off, capability feedback on, 24 tools/turn. The compact-metadata candidate remains reverted in the current default runtime.

Pi uses its native RPC client with read, platform shell, edit and write; native auto-compaction on, advertised model window 200000, provider retries and cache warming off. Extensions, skills, prompt templates, themes and persisted sessions are disabled.

Claude Code uses its native stream-JSON CLI in safe mode, not bare mode, with its original core system prompt and Bash/Edit/Glob/Grep/Read/Write tools. Separate empty configuration directories, no persisted sessions, no hooks/skills/plugins/MCP, automatic cross-session memory disabled, telemetry/update/background nonessential traffic disabled. Native conversation history and auto-compaction remain available. Agent delegation is outside this single-agent core comparison. Child processes receive only the local gateway credential, not the upstream credential. SDK retries may occur locally; after unknown submitted usage the gateway blocks further paid submissions.

Windows temporary roots are resolved to their full canonical paths for all agents. Local probes found that DOS short aliases caused Claude's permission checks to reject writes. Resolve the path rather than bypassing permissions. Read output is normalized only by removing verified contiguous line numbers from Claude's actual output; never read source to fill gaps. Retain both native and normalized output hashes. Missing, partial or malformed reads remain unconfirmed.

## Quality, accounting and decisions

Use the same native-positive-validation-v3 observer and independent public/hidden behavior, completion witness, scope and source-version checks. Map only native Claude tool event names/argument fields and line-number presentation. Do not alter model prompts or silently loosen validation. Formal acceptance, code behavior, required full reads and native post-edit verification remain separate dimensions. Preserve conservative recognition failures without regrading or calling them code failures.

Retain every attempt, unsuccessful tool call, interrupted conversation and negative result. Submitted unknown usage remains null with its reservation held; stop the remaining cohort and later cohorts. Do not retry a paid failure, release unknown reservations or count missing runs as zero. A complete-usage task failure remains in the primary totals and does not trigger a selective rerun.

Report each size and long workflows separately. Pairwise full-workload ratios require all planned usage-known pairs; include failures. Both-accepted subsets are diagnostic and do not replace full totals. Unequal completion means token totals are not an equal-completed-work efficiency claim. This is a small self-authored JavaScript experiment, not production generalization, official default-agent pricing or an isolated metadata optimization gate. No runtime reenablement, next optimization or merge is automatic.

## Before paid calls

Run the deterministic suite and native three-agent loopback contract. Separately verify Claude multi-turn history, full source reads and positive post-edit validation. Scripted local usage is never performance evidence. Retain local setup failures; one initial mock omitted SSE event headers and was corrected before paid calls. Freeze the complete source and plan only after these checks pass.

References: [Claude CLI](https://code.claude.com/docs/en/cli-reference), [programmatic execution](https://code.claude.com/docs/en/headless), [automatic memory controls](https://code.claude.com/docs/en/memory).
