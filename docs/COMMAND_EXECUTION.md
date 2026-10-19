# Command execution and benchmark artifacts

[中文](COMMAND_EXECUTION.zh-CN.md)

## Direct execution

`run_tests` and `run_shell` use the same parsed executable and argument array. They do not evaluate a shell. Balanced single/double quotes group arguments, including paths with spaces. Backslashes are literal except immediately before double quotes, where pairs produce literal backslashes and an odd remainder escapes the quote. Shell operators and multiline commands remain blocked, including inside quotes.

Validation entries include Node tests, npm test/lint/check/typecheck, Python/Python 3 pytest/unittest, pytest, and Go test/build/vet. Common read-only Git diagnostics accept forms such as:

```text
git branch --show-current
git log --oneline -3
git log --format="%H %s" -1
git diff --stat
```

Git diagnostics, help/collection commands and ordinary project CLI commands do not satisfy post-edit validation. A passing validation command still does not establish complete feature coverage.

Destructive-operation checks inspect the executable and Git operation. A literal `format` in a Git format string, commit message or filename is not the `format` executable. Use `run_shell` to request approval for options outside `run_tests`. Explicit interpreter commands retain conservative checks. These tool policies are not an operating-system filesystem sandbox.

On Windows, Node/Python/Git/Go execute directly and support quoted arguments. npm uses a separate CMD bridge, quotes space-containing arguments and rejects CMD metacharacters. The capability notice describes that narrower restriction.

## Approval callbacks

SDK `approveCommand(command)` can return:

- `true`: approve the parsed command.
- `false`: legacy handler did not approve; no human refusal is inferred.
- `{ decision: 'allow', source: 'policy' }`: explicit host policy approval.
- `{ decision: 'deny', source: 'policy', reason: 'Outside the configured project commands' }`: `COMMAND_POLICY_DENIED`.
- `{ decision: 'deny', source: 'user', reason: 'Command denied by user.' }`: `USER_APPROVAL_DENIED`.

Omitted object `source` means host policy. Other truthy values, invalid decisions, handler errors and cancellation do not grant permission. Approval duration is separate from execution duration.

A trusted handler may provide up to four short `commandHints` examples and a 16-character hexadecimal `commandPolicyId`. Examples are included in the versioned capability notice; changing the policy ID announces the changed capability once per session. Hints describe permissions; they do not grant them. Do not load approval rules or executable callbacks automatically from repository instructions.

The terminal returns explicit user decisions. Existing boolean SDK handlers remain supported. The historical pre-feedback request fixture is retained; its compatibility test normalizes only the intentional correction of legacy-handler attribution.

## Subprocess environment

Commands receive execution-path/system/temp variables, explicit home paths, UTF-8 Python settings and a temporary Go build cache. API credentials and arbitrary inherited environment variables are not copied. Project CLI execution still needs explicit interactive or host approval. Native subprocesses can access resources permitted by the OS; tool edit-path rules do not confine them.

## DeepSWE integration helpers

`scripts/lib/deepswe-policy.mjs` exports `createDeepSweApproval({ cliModules, baseRef })`. The trusted runner freezes module names and base ref before inference. It permits declared `python -m MODULE` CLI entry points and scoped branch/add/commit operations, including an explicit branch starting point. Undeclared Python modules and inline scripts are denied. CLI calls remain distinct from test validation.

After coding, trusted runners can export artifacts with:

```sh
node scripts/finalize-deepswe.mjs --workspace TASK_PATH --base-commit BASE_SHA --output ARTIFACT_DIRECTORY
```

Prerequisites: the workspace must be the repository root, the pinned base must be an ancestor, `.tea` must be ignored and untracked, and the artifact directory must be outside the workspace. The helper:

1. Stages ordinary task changes with `git add -A -- .` and checks private state is excluded.
2. Saves `working-tree.patch` **before committing**.
3. Commits staged changes with a DCO `Signed-off-by` trailer.
4. Exports `model.patch`, checks it equals the saved candidate, and writes hashes/file names to a manifest.

Existing artifact files are never overwritten. A commit failure retains the candidate snapshot for inspection without another coding attempt. A commit that changes the patch fails the equality check and preserves both files. An artifact-export manifest's `modelCalls: 0` applies only to that helper, not to the preceding coding attempt.

These changes have deterministic regression evidence. No new provider-token saving or DeepSWE acceptance improvement is claimed before a fresh frozen live comparison.
