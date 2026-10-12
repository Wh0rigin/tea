# Small-task holdout v1

[Frozen manifest](small-task-v1.json) · [S0 report](../reports/small-task-s0-20261012/README.md)

Frozen on October 12, 2026, before S1 tuning or provider experiments: **20 distinct
seeded-fault tasks, five real upstream projects, four tasks per project**. They
are self-authored faults on pinned upstream source, not claims of upstream bugs.
Repository URLs/commits, license IDs and license hashes are in the manifest.
Canonical file identities use committed Git blob bytes, independent of checkout
line-ending conversion. The preflight copies a Git archive and restores declared
targets/license from those exact blobs. It retains upstream license notices.

Coverage includes async abort/error/order/queue semantics, iterator depth, bounds
and padding, network/hash validation, and a multi-file JavaScript/TypeScript
implementation/declaration repair. Languages are JS, TS, Python and Go. Repeated
tasks within a project are not independent projects: later uncertainty estimates
must cluster by task and disclose that only five projects are represented.

Each task fixes its goal, allowed files, unique exact mutation and acceptance
programs. Scope checks and native positive completion must accompany these
programs when integrated into S5. Public task hashes do not create confidentiality
or prevent a privileged agent from accessing acceptance; proper confidential
evaluation requires an isolated controller. The generic S0 native validator
currently understands Node/npm only. S5 adapters and equal authorization policies
for Python/Go are pending; none of these samples has a measured Agent completion
rate or provider token comparison yet.

## Reproduce the offline preflight

Use the pinned commits from `small-task-v1.json` in local clones under
`.tea/s0-holdout-sources/{repository-id}`. Fetching those public upstream repositories
does not call a model. The script refuses a different current commit or source hash.

The S0 environment uses Node 24.14.0, Python 3.13.9, TypeScript 5.9.3, yocto-queue
1.2.2 and Go 1.24.0. Prepare dependencies in the ignored workspace:

```sh
npm install --prefix .tea/s0-deps --ignore-scripts --no-audit --no-fund typescript@5.9.3 yocto-queue@1.2.2
python scripts/check-small-task-holdout.py --sources .tea/s0-holdout-sources --deps .tea/s0-deps/node_modules --go <go-executable>
```

Go was installed as an isolated portable runtime, without changing global PATH:
official `https://go.dev/dl/go1.24.0.windows-amd64.zip`, SHA-256
`96b7280979205813759ee6947be7e3bb497da85c482711116c00522e3bb41ff1`.
Use the matching official distribution for other platforms. Compiler flags disable
Go telemetry, network proxy and toolchain auto-downloads; its selected acceptance
test uses `-vet=off`. This is not the upstream full test suite.

The check validates task hashes, commits, source/notice hashes, runtime pins,
original acceptance and fault detection. **20/20 tasks, 21 checks per side, 42
process executions** passed S0. Temporary copies and failure evidence remain in
ignored `.tea`; originals are not modified. It starts no Agent or provider request.
Ordinary `npm test` does not download these projects/runtimes or run this preflight.
