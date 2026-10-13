# S1 capability and failure feedback

Experimental, disabled by default. Enable with `TEA_CAPABILITY_FEEDBACK=1`.
The requested flag is recorded in comparison profiles. An older parent revision
ignores this new setting, so its native requests retain parent behavior.

## Hypothesis

Declaring the existing command policy and approval availability, followed by
specific failure reasons, can reduce repeated unavailable commands and edits
made without evidence of a source defect. The added text also costs input tokens;
the live comparison must measure its net effect.

## Implementation

- Announce a short versioned notice once at conversation start, and once when the
  platform or approval availability changes. Preserve the declaration through
  session resume and reset it for a new conversation. A provided approval handler
  indicates availability, not that the user will approve a request.
- Describe workspace-relative paths, existing validation command forms, shell
  operator restrictions and Windows command limitations. Command syntax being
  allowed does not imply the program is installed or tests cover every obligation.
- Give failures a stable code, same-condition `retryable` field, missing capability
  and next action. A retryable transient execution failure is not permission to
  replay automatically. Source mismatch requires fresh source and a new patch;
  test failure requires investigation and relevant revalidation.
- Append feedback to the existing failure text, retaining actual stdout/exit and
  tool-use pairing. With S1 enabled, a denied command or nonzero command exit is
  correctly marked as an error result. Neither establishes successful validation.
  Success output and tool definitions are unchanged.
- Preserve command filters, approval decisions, executable launch, environment,
  path restrictions, test classification, budgets, tool limits and stop rules.
  This stage supplies feedback; it does not enforce a new progress/stop policy.
- Persist capability identity and observed failure metadata. Old messages,
  thinking blocks and signatures are not rewritten.

The opt-out native request fixture was captured from parent
`c97b950797294f48e31752508af11a80814e66d8` with an offline actual read/denied-command
scenario. Workspace paths are normalized; it has no credentials or provider
usage. The deterministic test compares the exact system, messages, tool schemas,
denial flags, tool IDs and outcome against this fixture without requiring Git
history or network access in CI.

## Frozen measurement rules

The S1 parent is `c97b950797294f48e31752508af11a80814e66d8` (completed S0). Freeze
the candidate commit before paid requests. Both engines use the external S0
revision harness and `native-positive-validation-v3` acceptance.

Initial cohort: all three small fixture families, ten repetitions, alternating
parent/candidate order: 60 runs and 30 pairs. Requested model is GLM-5.3-flash,
enabled thinking/low effort, 4,096 output tokens, 24 tools per turn, 100 requests
per run, 160,000 UTF-8 input-byte guard, 90-second request/180-second turn timeout.
ContextOS is enabled for both, 32,000-byte target, model summaries off. Execution
permissions are identical and no interactive approval is available to either arm.
The parent ignores the S1 flag; the candidate uses it. All native cache input,
reasoning output, retries, failures and unknown reservations count.

Before first paid submission, fix a USD 8 combined experiment cap and USD 1.40
per-run cap, using the existing conservative input/output rates of USD 0.80/2.80
per million tokens. These are budgeting rates, not invoices or current pricing
claims. Keep any unknown reservation and stop; never silently retry a paid run.

Proceed to the 42-run medium/large/30-inspection protection cohort only when the
full small cohort has known usage, no paired quality regressions, at least 10%
all-attempt token reduction and the plan's latency gate. Reuse the remaining
combined cap. A failed gate rejects this runtime change; keep all evidence and
restore parent runtime behavior. A successful protection cohort still does not
establish S5 holdout generalization or default full-history provider savings.

Report every family, pair, quality dimension and positive/negative result,
medians/P95, measured tokens and conservative spend. Cluster uncertainty by task,
not repeated runs as separate projects. Stop after S1 for user review; do not
begin S2.

The completed [S1 report](../benchmarks/reports/small-task-s1-glm-20261012/README.md)
records 102 runs, 11.38% fewer overall provider tokens, 41.44% fewer small-task
tokens and 3.67% more long-workflow tokens. Planned scale-group gates pass. The
option remains disabled by default while awaiting review; S2 has not started.
