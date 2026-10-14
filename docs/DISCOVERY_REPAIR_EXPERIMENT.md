# Fair discovery repair: frozen experiment

This stage repairs discovery coverage and default listing output. It leaves
ContextOS selection, compaction, GC, permissions, validation and model settings
unchanged. No directory name, language or fixture symbol is special-cased.
Two discovery capability booleans are persisted for session restore; permissions
and memory selection remain unchanged.

## Mechanism

- Rotate directory iterators; discover child directories before sibling files.
  Task ranking then sees paths from small sibling directories within its budget.
- Default `list_files` returns at most 32 paths and roughly 2,048 UTF-8 body bytes.
  One complete long path can exceed that byte budget. Explicit `maxFiles` retains
  the existing 250-path maximum. `nextOffset` continues the same scope.
- `search_code` returns `nextOffset` and `nextLine`; pass the latter as
  `startLine` to resume a partially scanned file. File, byte and result limits
  produce a continuation rather than an exhaustive absence claim.
- Small inventories preserve the previous model-facing schemas until a search
  actually reaches a limit. Broad inventories expose continuation immediately.
  This avoids adding schema input tokens to unrelated short tasks.
- Cursors are offsets into a deterministic live filtered traversal, not immutable
  snapshots. Restart from zero if the file tree changes. Depth, size and secret
  filters remain in force; `complete` applies to that filtered scope.

## Provider comparison, fixed before calls

Baseline: 990321efb5ff4e2e443d3eb64fafd8dc4e31793a (previous GC candidate;
documentation changed since 381a937, runtime unchanged).
Candidate: the committed repair snapshot recorded in the private frozen plan.
Both use native ContextOS, **automatic compaction and GC enabled**. This isolates
the discovery repair from the earlier old/off versus new/auto comparison.

Six self-authored JavaScript bug fixtures: three families at small (12-file) and
large (1,200-file) scales. Three repetitions, 18 pairs / **36 runs**. Small tasks
are an overhead control. Repository size does not increase defect complexity.
No Pi/Claude requests, no model-generated seed history, no long-session claim.

GLM-5.3-flash, enabled thinking / low effort, 4,096 output cap, same endpoint,
initial repository contents and prompts within each pair. ContextOS target
32,000 bytes; request guard 160,000 bytes; 24 tools per turn; 100 provider
requests per run; 180-second request and 300-second turn limits. Suite cap
USD 8; per-run USD 1.4. Conservative rates: input/cache-read USD 0.80, output
USD 2.80 per million; cache creation uses the existing conservative reservation.

Rotate arm order. Include every provider request, cache input, reasoning output,
summary and failed attempt. Unknown usage stays unknown and halts new paid calls;
retain old unknown reservations separately. No automatic paid retries, no
replacement samples. Prepare manifests and verify committed source fingerprints
before calling the provider; never overwrite an existing result directory.

Public tests, independent hidden acceptance, post-edit native validation and
final file-scope checks remain identical. Full failures are preserved; any
both-accepted token comparison must be labeled separately. Do not describe
scripted usage or serialized bytes as measured token savings. Stop this stage
and wait for review after publishing results.

Run the native loopback contract before live calls:

```sh
node scripts/check-revision-comparison.mjs BASELINE CANDIDATE both-auto-gc small,large
```

Prepare then live (credentials and the stated model settings in environment):

```sh
node scripts/compare-contextos-pi.mjs --mode prepare --baseline-ref BASELINE --candidate-ref CANDIDATE --both-auto-gc true --groups fresh --scales small,large --repeat 3 --timeout-ms 300000 --max-cost-usd 8 --run-id UNIQUE_PREPARE_ID
node scripts/compare-contextos-pi.mjs --mode live --baseline-ref BASELINE --candidate-ref CANDIDATE --both-auto-gc true --groups fresh --scales small,large --repeat 3 --timeout-ms 300000 --max-cost-usd 8 --run-id UNIQUE_LIVE_ID
```
