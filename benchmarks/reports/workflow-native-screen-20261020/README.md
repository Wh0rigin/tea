# Current TEA workflow: native benchmark screen

Status: live fixed schedules dispatched. Protocols were committed before their respective model calls. Final outcomes are pending.

Compare direct-parent `b400577185f0b224850540cc9289672f62450f33` with current workflow package `7bd236f4d548af1214ddf498ccaf7a5c3b928100`.

The candidate changes workflow guidance, same-file batch edits and persistent unresolved validation commands together. This is a package comparison, not a batch-only ablation. The later improvement plan has not been implemented in these snapshots.

## Planned cohorts

- DeepSWE v1.1: two previously seen cached tasks, two repeats per arm, eight attempts. Use native Pier execution and independent official verification. This is a small regression subset, not a full leaderboard score.
- WB-Bench-Code: four tasks selected by a frozen task-ID hash order with distinct categories, two repeats per arm, sixteen attempts. Official dataset and Harbor verifier remain unchanged. This is a subset, not the full 80-task Code track or the other WorkBuddy tracks.

Each benchmark retains separate acceptance, usage and failure records. Same-work efficiency requires both arms to pass the task with complete metering. Unknown usage is never zero. All-attempt consumption includes failures and is not automatically an efficiency comparison.

## Common model profile

GLM-5.3-flash, enabled thinking / low effort, streaming, maximum output 131,072, derived thinking budget 8,000, local context window 216,000, ContextOS target 32,000 bytes, automatic compaction/GC, maximum 96 tools / 128 transport requests, 900-second request deadline, 30-minute task wall. Both arms use the same profile; this is not a measurement of the ordinary CLI's 90-second deadline.

Control allocations: 10 USD per attempt; at most 80 USD for DeepSWE and 160 USD for WB-Bench-Code, 240 USD combined. These are finite accounting bounds, not invoice or expected-spend claims. No new parameter probe; prior unknown reservations stay separate. Never retry an unknown paid attempt automatically.

## Completed local checks

- Specialist regression: 176/176 passed.
- Full regression: 411 passed, one Go-unavailable skip, zero failures / 412.
- Native DeepSWE lifecycle preflight: both source snapshots passed, ten synthetic SSE responses / nine actual tools each; identical independently validated exported patches. Zero provider calls; these are infrastructure fixtures, not DeepSWE task successes or Token measurements.

[Frozen DeepSWE protocol](deepswe-protocol.json), [frozen WorkBuddy protocol](workbuddy-protocol.json), [Chinese methodology and environment adaptations](METHODS.zh-CN.md). WorkBuddy uses a fixed dependency compatibility layer and native grading with a verifier-user compatibility override; it is not an unmodified official leaderboard environment. Per-cohort final evidence will be appended after the fixed runs.
