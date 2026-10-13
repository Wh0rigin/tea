# Frozen revision comparisons

[中文 S0 report](../benchmarks/reports/small-task-s0-20261012/README.zh-CN.md)

S0 adds an external comparison harness. Agent prompts, tool execution rights,
memory policy and stopping behavior are unchanged. S1–S5 remain separate stages.

## Zero-provider checks

```sh
npm test
npm run benchmark:pi:check
npm run benchmark:contextos-pi:check
npm run benchmark:revisions:check -- <baseline-commit> <candidate-commit>
```

The last command drives actual native TEA engines with a scripted SSE server
bound to loopback, on three small task families with three repetitions per arm.
It requires the exact dummy credential, records `scripted-loopback`, and withholds
provider ratios. Fake usage values test accounting only. The Pi checks require
the installed native Pi package; the revision check has no Pi dependency.

For preparation without a model or Pi installation:

```sh
node scripts/compare-contextos-pi.mjs --mode prepare --baseline-ref <parent-commit> --candidate-ref <candidate-commit> --groups fresh,long-session --scales small,medium,large --repeat 10 --run-id <unique-run-id>
```

Both revision flags are required. Supported repetitions are 3–20. Group and scale
selection only select fixtures; repeat 10 prepares the future cohort configuration
without executing 200 agent runs. Preparation executes independent initial
acceptance checks: public tests pass, hidden tests complete and detect the seeded
fault, and scope passes. Live execution additionally requires explicit finite
budgets, rates and provider configuration. S0 starts no live calls.

## Source identities and acceptance

The harness resolves each Git reference to a commit and extracts committed regular
`src/**/*.mjs` files plus `package.json` into a separate directory. It never checks
out, resets or runs setup scripts. It requires the native `runTask`,
`createAgentSession`, and `WorkspaceTools` interfaces; arbitrary unrelated Git
repositories or incompatible historical TEA APIs are unsupported. Existing
uncommitted files do not become either engine. Per-file SHA-256 values, commits
and aggregate identities are recorded and checked before each run and at the end.
The external harness has its own source identity. Source instability invalidates
provider ratios. Initial trees, common controls, full request accounting and
alternating arm order remain shared.

Acceptance `native-positive-validation-v3` records six dimensions independently:
code correctness (including a hidden completion witness), scope, declared reading
requirements, native post-edit validation, native completion, and complete usage.
Declared reading requirements are executable checks, not a proof of every possible
natural-language obligation. A functionally correct file alone is insufficient.
Failures and unknown usage remain in all-attempt accounting; missing usage keeps
its reservation and halts further paid submissions.

The current native recognizer supports declared **Node test targets and resolved
npm scripts**. It accepts relative/quoted paths and supported option order, and
requires executed positive test counts, zero failures, settled completion and
stable declared source hashes. TEA additionally requires an explicit zero exit;
Pi can expose no exit code, in which case the field remains null and complete
positive runner evidence is required. Filters, shards, inline eval, shell chains,
zero tests, missing events, nonzero exits and stale validation stay unconfirmed.
Python/Go runner recognition must be designed and tested before paid S5 runs.

Execution records contain command/argument hashes, program basename, parameter
shapes, observed approval outcome, exit and timing, and source versions. They do
not publish command bodies or test stdout. Source observations happen when events
reach the controller, including Pi IPC latency; they are not atomic process-time
measurements. This is an observational diagnostic harness without OS isolation.
Its small bounded source reads consume local time; it adds no model messages or
model requests. Scripted equality does not establish real token or latency gains.

Old paid reports and their acceptance versions are preserved. Improved command
recognition cannot retroactively promote old unconfirmed Pi runs whose command
evidence was not retained.

## Frozen generalization tasks

See [manifest and preparation](../benchmarks/holdouts/README.md). These 20 tasks
on five upstream projects are frozen before S1 tuning, with committed source,
license, exact fault, acceptance and task hashes. S0 checks original code passing
and seeded faults failing, including a multi-file JavaScript/TypeScript repair.
The harness has not run an Agent on them. Their public acceptance code and current
lack of OS isolation make them diagnostic holdouts, not confidential evaluation.

Each later S requires its own paired provider experiment and quality gates in
[the plan](SMALL_TASK_IMPROVEMENT_PLAN.md), followed by a report and a stage stop.
