# S1b: bounded historical reference directory

[中文](README.zh-CN.md)

## Result and decision

**Core 108 runs / 54 pairs: 2,561,901 → 2,422,093 provider tokens (-5.46% consumption).** Separate seeded historical-recovery cohort: 146,262 → 86,029 (-41.18%). All 120 runs / 60 pairs combined: 2,708,163 → 2,508,122 (-7.39%). Do not silently pool the seeded diagnostic into an empty-start claim.

Rejected and runtime reverted to the baseline; evidence is retained. Main is not merged. Frozen gates do not all pass. Only proposal 5 was tested; stop for user review. Assistant reply compaction, tool batching and S2–S5 remain unstarted.

- **long-session**: 1,864,219 → 1,740,351, **-6.64%** consumption; accepted 6/6 → 6/6.
- **small**: 235,379 → 266,955, **+13.41%** consumption; accepted 30/30 → 30/30.
- **large**: 371,386 → 336,488, **-9.40%** consumption; accepted 9/9 → 9/9.
- **medium**: 90,917 → 78,299, **-13.88%** consumption; accepted 9/9 → 9/9.
- **recovery-control**: 146,262 → 86,029, **-41.18%** consumption; accepted 6/6 → 6/6.

Every attempted run is included. 23/60 pairs consume more tokens. Both arms pass 60/60 full acceptances; no paired quality decline is observed.

![All attempts](s1b-tokens.png)

## What changed

Only runtime file `src/context-assembler.mjs` changed. Display the latest eight complete directory entries when more than eight old unsigned tool references are archived. Add explicit omitted-entry discovery through `search_history`, then `recall_context`. The complete canonical messages and index remain available. Existing active/changed source protection remains; no new vocabulary, semantic task classifier, embedding service or summarizer.

At most eight entries is an entry-count bound, not a byte bound for arbitrary path lengths. Source freshness, exact reference IDs, original user constraints, signed assistant blocks, failures, tool permissions, capability wording and validation rules remain unchanged. Directory diagnostics report total, shown and omitted counts.

Frozen-revision same-input projection checks: 8/10 unaffected scenarios send byte-identical native requests. At nine synthetic entries the added discovery instruction costs **15 extra wire bytes**; at 40 entries it saves **3,146 bytes**. Both observations are retained, neither is a provider token result. The compact directory cannot guarantee monotonic byte savings near its threshold.

## Long-session decomposition

Read-only phase: 1,657,900 → 1,560,988 (-5.85% consumption). Repair: 206,319 → 179,363 (-13.07%). All searches, recalls and repair attempts count. Whole-session paired-repeat bootstrap diagnostic 95% consumption-change interval **[-8.50%, -4.80%]**, 10,000 samples, seed 20261012. Six repeats of one workflow are not six independent projects.

![Long session and wire directory](s1b-long-tokens.png)

`long-diagnosis.json` reconstructs the exact frozen native payloads using recorded historical freshness decisions, avoiding evaluation against today's final edited workspace. Serialized component bytes explain traffic shapes, not exact causal token shares. Model replies and grouping can vary; observed scale differences in unchanged projections are not automatically caused by the directory patch.

## Small-task negative control

The small cohort passes 30/30 in both arms but consumes **13.41% more** candidate provider tokens (235,379 → 266,955); P95 elapsed time rises **13.36%**. Requests increase 142 → 157 and tools 151 → 163. All **299/299 native request hashes** reconstructed exactly. Holding each recorded history, reply, cache snapshot and freshness decision fixed, both frozen assemblers produce **299/299 byte-identical native requests**. No directory is shown or omitted. Thus this cohort does not establish a direct directory-induced token regression; model trajectories, timing and workspace names still differ. It nevertheless fails the predeclared observed nonregression and latency gates. No new run is selected to erase it, and the gates remain unchanged.

Medium and large cohorts also never omit directory entries (at most three shown). After restoring the recorded dynamic term-mapping tool availability, **263/263** native requests reconstruct exactly and **263/263** counterpart projections are identical. Their observed 13.88% / 9.40% token reductions are not attributed to this directory patch. The initial read-only counterpart replay omitted unresolved-query state; corrected before publication, with no provider calls or changes to paid grades.

## Historical recovery control

12 runs / six pairs of the existing self-authored receipt fixture. Both arms receive identical frozen scripted history from an actual past successful command and source reads. The historical test must not be reread or rerun. Correctness additionally requires a successful retrieval result containing the observed receipt. All paid discovery, recall, repair and validation requests count. Seed construction itself is unbilled and not model-generated.

Parent/candidate recovery calls: 11 / 9. Additional read-only provenance checks authenticate 12/12 retrievals to the original observed tool reference, beyond matching the number; no fresh reread/rerun signals are found. This single fixture does not prove arbitrary long-history semantic recall or multilingual production generalization; Unicode, staleness and resume have additional deterministic coverage.

## Quality and predeclared gates

- None / 无。

- `stableKnownComplete`: PASS
- `longSavings`: PASS
- `longReadOnlySavings`: PASS
- `longBootstrapLowerBoundAboveZero`: PASS
- `otherScaleAndRecoveryTokenNonregression`: FAIL
- `quality`: PASS
- `scope`: PASS
- `historicalObservationAndRecovery`: PASS
- `latency`: FAIL
- `commonControlsMatched`: PASS

No frozen grade, attempted run, pair or threshold is rewritten after the result. Per-cohort P95 changes and every quality dimension remain in `summary.json`; all run grades and token counts remain in `results.json`.

## Verification and accounting

- 39 focused tests; implementation full suite 275/275, zero skips. Final delivered full suite 268/268. The seven experimental directory tests are preserved at the frozen candidate commit; they were removed by rollback. They cover search/recall of omitted content, Unicode/staleness, journal resume, signed protocol, small directory parity and no-eviction equality.
- Native revision core contract 18/18 / 72 scripted requests; separate recovery contract 6/6 / 36 scripted requests, 34 → eight visible references. Scripted tokens are never measured provider savings. [Implementation CI](https://github.com/Wh0rigin/tea/actions/runs/38244641744): six Windows/Ubuntu × Node 20/22/24 checks passed.
- 120 closed encrypted journals audited read-only, 1419 native/gateway request hashes matched, journal bytes unchanged, no additional provider calls. Original acceptance preserved. Source audit checks every non-target runtime file and package against the frozen parent.
- A first zero-paid recovery contract assertion incorrectly expected a first-turn workspace banner in seeded sessions. Fixed before the paid plan; failed scripted evidence retained. No paid replacement or retry.
- Credentials stay private; no raw conversations, thinking/signatures, commands or absolute private workspace paths are published.

## Reproduction and evidence

Use frozen implementation Git bytes, `frozen-protocol.md` and `frozen-config.json`. Core harness unchanged: `scripts/compare-contextos-pi.mjs`; seeded diagnostic and contract are present at the candidate commit. The paid seed is frozen from preparation, identical across arms; its hash is published, raw history stays ignored. `scripts/plot-bounded-directory-s1b.py` regenerates the figures from public aggregate JSON. `evidence.sha256` covers report files and the plot script.

- `bounded-directory-s1b-long-glm-20261012-1791805441427116200`
- `bounded-directory-s1b-small-glm-20261012-1791805441427116200`
- `bounded-directory-s1b-scale-glm-20261012-1791805441427116200`
- `bounded-directory-s1b-recovery-glm-20261012-1791805441427116200`

Savings require enough archived unsigned tool rounds; signed assistant batches are retained and receive no directory savings. Other models were not tested. Self-authored JavaScript bug families at three unrelated-file scales plus one long workflow and one seeded receipt fixture. No unseen real-project Agent run, no Pi comparison, no default-full-history benefit claim, no invoice claim and no universal savings claim.
