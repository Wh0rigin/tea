# Contributing to TEA

[中文](CONTRIBUTING.zh-CN.md)

TEA's goal is to save tokens while preserving task correctness, code quality and execution performance. Contributions that improve discovery, tool feedback, recovery, accounting, terminal usability, documentation and evaluation are welcome.

## Start with a focused change

Search existing issues and pull requests before starting. For a larger behavior change, describe the problem and proposed approach in an issue first. A small bug fix or documentation correction can go directly to a PR.

Include reproducible steps, expected behavior, actual behavior, Node/OS versions and a sanitized log when reporting a bug. Keep model credentials and private source out of public issues. Use the repository's private vulnerability reporting channel for security issues when available; do not put credentials or exploitable private details in public tickets.

## Local development

Install Node.js 20+ and Git. TEA has no npm runtime dependencies; the built-in test runner needs no API credentials.

```sh
git clone https://github.com/Wh0rigin/tea.git
cd tea
git switch -c fix/describe-the-change
npm test
npm run tea -- --help
npm run tea -- --demo
```

External contributors should fork the repository first, create their topic branch in that fork and target `Wh0rigin/tea:main`. Maintainers use topic branches in the main repository. Use names such as `fix/discovery-pagination`, `feat/session-recovery` or `docs/benchmark-guide`.

## Pull requests are required

All changes, including documentation and benchmark reports, go through a PR targeting `main`. Push your topic branch and open a PR. Do not push directly to `main`; merge and release decisions remain with the maintainer.

Keep the patch focused, preserve unrelated behavior, and add regression coverage where appropriate. State what changed, why it changed, what you actually checked, and any limits that remain. Explain any new dependency. English and Chinese README/guide links should remain consistent when relevant.

Use descriptive commit messages, for example `fix: preserve validation after cancellation` or `docs: explain paired token accounting`. A performance percentage in a commit must name its measurement unit and workload. Do not describe offline byte reductions as measured provider token savings.

The PR template includes verification and experiment fields. Documentation-only changes can mark irrelevant experiment fields as not applicable. Submit a draft while substantial work or required evidence is outstanding; otherwise submit a PR ready for review. Respond to review comments with a patch or a concrete explanation.

## Verification

```sh
npm test
git diff --check
npm run benchmark:replay
npm run benchmark:runtime
```

Run relevant checks for the changed code; `npm test` selects only the project's tests, not generated benchmark workspaces. CI runs the deterministic suite on Windows and Ubuntu with Node 20, 22 and 24. It does not need model secrets or make paid requests.

For the Pi comparison integration, install and pin the Pi CLI separately, then run `npm run benchmark:pi:check`. Its local scripted responses verify the actual clients and protocol; its token values are not performance data. See [the comparison guide](docs/PI_COMPARISON.md).

## Performance evidence

An optimization PR should record:

- A concrete hypothesis and the mechanism expected to reduce input or output.
- Baseline/candidate source identities, task manifest, initial repository snapshots and exact run configuration.
- The same model, endpoint, thinking mode, effort, output cap and acceptance checks on both sides.
- Provider-reported input, output and all cache tokens, or a clearly labeled offline measurement unit. Unknown usage remains unknown.
- All attempted tasks, failures, budget stops, acceptance counts, repetitions and limitations. If a both-passed subset is reported, show it separately from the full experiment.
- Total cost cap, per-request limits, timeouts, price source and cache assumptions for paid runs.

A smaller token count with worse task acceptance does not establish a useful optimization. Self-authored examples are diagnostic evidence; broader task families and unseen real projects are needed for generalization. A Pi comparison is not a direct-parent TEA optimization gate. Experimental infrastructure and honestly labeled partial/offline reports may be reviewed without claiming that a release gate passed.

## Publishing artifacts

Raw ledgers and generated workspaces live in Git-ignored `.tea/` and `benchmarks/results/`. Review an artifact before copying a report, sanitized aggregate JSON or chart into `benchmarks/reports/`. Never copy API keys, account balances, raw conversation transcripts or absolute private workspace paths into a public report. Keep the source run ID, version hashes, units and acceptance status with each chart.

## License

Contributions are distributed under the project's [MIT license](LICENSE). Submit work you have the right to contribute, and preserve required third-party notices.
