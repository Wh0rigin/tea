# Completion review experiment (S7)

Enable with `TEA_COMPLETION_REVIEW=1`, or SDK option `completionReview: true`.
Disabled by default pending real task evaluation.

## Motivation

A previous repository task passed self-authored checks but failed an artifact-path
acceptance case. Its fixtures had already created a parent directory that the
program needed to create itself. Successful commands therefore did not establish
coverage of every public requirement.

## Runtime behavior

After workspace changes and successful runtime validation, the first attempted
final response triggers one additional review through the normal model loop.
The review compares public requirements with observed outcomes, checks fixture
preconditions and independently derived artifact paths, and asks the agent to
repair concrete gaps. It does not inject benchmark-specific paths or assertions.
Unchanged work and unresolved validation do not trigger this review.

The request uses the same context assembly, metering, compaction and configured
limits as ordinary requests. Only one review nudge is added per turn; subsequent
repairs use the existing loop and limits. A new edit still invalidates validation.
The review marker and request are recorded in the task state, session journal and
ledger. A response is not a machine-verified semantic acceptance certificate.
`validationPassed` continues to describe executed checks only.

## Evidence and limitations

Scripted offline tests cover trigger timing, bounded review, fixture guidance,
configuration, validation invalidation and exclusion of unchanged/unvalidated work.
They do not establish better real task acceptance or lower provider token usage.
An additional model request adds input/output cost and can introduce regressions.

Before enabling by default, compare latest-main baseline with this option enabled
using identical model, endpoint, thinking, output/context limits and initial tasks.
Retain failures and unknown usage. Include unseen tasks and repeats, independently
check persisted artifacts, and report whole-task acceptance before token savings.
No paid evaluation is launched by this implementation.

Verification: targeted agent suite 18/18 passed; full suite 467 passed, 1 skipped, 0 failed (468 tests). These are offline results.
