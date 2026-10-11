# Benchmark harness

Replay code is in `src/benchmark.mjs`; executable fixtures are in `src/runtime-benchmark.mjs`. CLI commands are `tea benchmark run|compare|report`.

- `--suite core --mode replay`: controlled payload/recall diagnostics.
- `--suite runtime-smoke --mode runtime`: 12 pinned self-authored JavaScript repositories, scripted tools/patches, real public and independent acceptance tests.
- `--suite runtime-smoke --mode live --max-cost-usd USD`: the same fixtures through the provider, with one suite budget; requires configured current rates and credentials. Never executed yet.

Task initialization is reproducible and checked (public pass / acceptance fail). Acceptance runs outside the workspace only while the agent is stopped, requires a completion witness, and records failure on early exit. Checkpoints retain attempted-task ledgers and local budget consumption before acceptance. Source identities are captured before and after the run. Scripted provider tokens and model success are always null. `compare` supports replay only.

There is no OS isolation or confidential test corpus: solutions and acceptance source are checked into the self-authored manifest. Formal core/holdout corpora, paired Git-revision scheduling, provider compatibility smoke and a real optimization gate remain unfinished. The historical `baseline-v0` has neither this harness nor the later runtime fixes.
