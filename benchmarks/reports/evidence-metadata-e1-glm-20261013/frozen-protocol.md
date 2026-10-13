# E1: compact source evidence metadata

## Frozen change and hypothesis

Baseline: `f4589fa9bb0858902a804d926c142055bf135af2`. The candidate
removes only the redundant ` sha256=<64 hex characters>` field from full
`read_file` output. File path, requested line range, 16-character display
version, line numbers and source text remain. This saves 72 serialized ASCII
bytes per complete header occurrence, not a measured provider token count.

The existing runtime sidecar retains the complete source hash. Its old
128-entry eviction is removed because compact canonical evidence now depends
on it. Entries live for the conversation and are cleared by `/new`; persistence
uses the existing encrypted runtime state. This increases sidecar memory and
journal metadata for long conversations. Finding versions use the sidecar.
Missing compact source metadata is treated as stale; legacy full-hash headers
continue to work. No new tools, routing, summary policy or prompts are added.

For tiny files the existing shortest-output rule can return compact original
lines instead of a longer unchanged-reference notice. This is intentional;
unchanged-read cache membership, content and current source checks still apply.

## Functional and native checks before paid work

- Full deterministic suite, including eight new metadata checks.
- Content/redaction/Unicode/range preservation, incomplete-range behavior.
- More than 128 read outputs, full-hash comparison beyond the display prefix,
  missing metadata, legacy headers, persistent resume and `/new`.
- Native frozen-revision streaming loopback contract: 18 repairs / 72 requests.
  Scripted usage is not eligible for provider performance percentages.

## Fixed live A/B protocol

Use the unchanged `scripts/compare-contextos-pi.mjs` native revision mode.
Each task starts from identical code and empty history. Existing independent
public/hidden behavioral acceptance, scope checks and positive validation remain.
All attempts and failures count, including incomplete or unknown usage.

Freeze three cohorts before submitting any paid request:

1. Fresh small: three self-authored defect families, 10 repeats, 60 runs / 30 pairs.
2. Fresh medium and large: the same families, three repeats, 36 runs / 18 pairs.
3. Long session: existing 30-inspection-and-repair workflow, three repeats,
   six runs / three pairs. These are model-generated interactions with existing
   synthetic repositories, not independent production projects.

Total: 102 planned runs / 51 pairs. Existing harness alternates A/B ordering by
task index and repetition. No favorable-subset exclusion or paid retry.

Common controls: GLM-5.3-flash, enabled/low thinking, output cap 4096,
thinking cap 4095, streaming Anthropic Messages; v1 inventory/read dedup;
ContextOS 32000-byte target, summary off, capability feedback on;
24 tools/turn, 100 provider requests/run, 160000-byte input guard;
request timeout 180 seconds, turn timeout 300 seconds.

Shared conservative cost guard USD 8; per run USD 1.4. Input/cache-read 0.80,
output 2.80 USD per million are conservative configured rates, not invoice
prices. Unknown provider usage keeps its reservation and halts further work.
The earlier B1 unknown reservation remains separate and is never released.

## Decision and reporting

Primary endpoint is all-attempt small-task provider input + output tokens,
including cache input and thinking output exactly once. Report every cohort,
scale, defect family, paired acceptance regression and elapsed time separately.
No success claim when usage is incomplete. A known-usage subset is diagnostic
only. Keep all negative and zero controls.

Keep the runtime candidate only if the completed small cohort saves tokens,
no cohort/scale shows increased aggregate token consumption and no paired
acceptance regression occurs. Otherwise revert runtime changes and retain the
candidate commit, tests, protocol and honest report. Passing this narrow gate
does not establish generalization or statistical significance; inspect paired
variation and disclose uncertainty. Stop after this stage for user review.

Publish sanitized aggregate results, controls, source identities and evidence
hashes only. Do not publish credentials, raw conversations/thinking/signatures,
raw workspaces or private absolute paths. Update the existing topic-branch PR;
never merge it automatically.
