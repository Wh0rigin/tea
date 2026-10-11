# Working on TEA

TEA aims to save tokens while preserving task correctness and performance.

## Pull requests

- All repository changes use a topic branch and a pull request targeting `main`.
- Continue an existing suitable PR branch; otherwise branch from the current remote `main`.
- Push the topic branch and open or update its PR when the user requests repository work to be delivered. Do not push directly to `main`.
- Keep unrelated local changes intact. Never rewrite published history or merge a PR without explicit user authorization.
- Give the PR a clear summary, actual verification results and material limitations. Attach every created PR to the current Codex task.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md) for development and experiment records.

## Experiment integrity

- Distinguish provider tokens from estimates, serialized bytes and scripted usage.
- Compare identical tasks and initial repository snapshots with the same model, thinking mode, effort and output cap. Record failures and unknown usage.
- Set finite request limits, timeouts and a total budget before live calls. Preserve reservations after unknown billing; never silently retry or treat missing usage as zero.
- Keep credentials in process memory/environment. Do not commit keys, raw account information or unreviewed runtime workspaces.
- Label self-authored fixtures and sample sizes. Do not generalize a narrow experiment into a universal performance claim.
