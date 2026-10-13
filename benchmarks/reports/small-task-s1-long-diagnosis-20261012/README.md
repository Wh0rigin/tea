# Why S1 long sessions use more tokens

[中文](README.zh-CN.md) · [Frozen S1 report](../small-task-s1-glm-20261012/README.md) · [Request-level diagnosis](diagnosis.json)

## Result

Long-session provider tokens increase **899,968 → 932,988: +33,020 (+3.67%)**. Input accounts for **32,545, or 98.56% of the increase**; output increases 475. All six runs pass frozen acceptance.

The main mechanism is that the capability notice is appended to the first user message and retained as authoritative user history. It is declared once but sent repeatedly. These workflows have no denied or failed tools, so S1 avoids no failed retries. Different tool grouping, historical assistant text and earlier replacement of old tool output also affect totals. The entire token increase cannot be assigned to the notice.

This is read-only diagnosis: **zero new API calls**, no Agent implementation changes, no S2 work. S1 remains opt-in and off by default, awaiting maintainer review.

![Observed read-only turn tokens and final repair differences](long-session-diagnosis.png)

## Source and method

Source cohort: `small-task-s1-protected-glm-20261012-1791784495519984400`, `long-30`, three paired repeats of 30 native file-reading turns followed by one repair. Parent `c97b950797294f48e31752508af11a80814e66d8`; candidate `efaca4129ae2ea1fe58510749ada7464439daff7`. Both use GLM-5.3-flash enabled/low, output cap 4096, ContextOS target 32,000 bytes, 24 tools/turn and semantic compaction off. Full controls remain in the source report.

Read-only decryption verifies six closed journal chains and unchanged file hashes. Original messages, tool memory, runtime state and recorded historical freshness reconstruct **393/393 exact serialized request hashes and byte counts**, matching gateway evidence. Recorded freshness is used instead of evaluating old reads against today's edited final workspace. No responses are regenerated and acceptance is not regraded.

With the original private evidence available, run `node scripts/diagnose-s1-long.mjs` at the repository root. The [script](../../../scripts/diagnose-s1-long.mjs) writes ignored `.tea/s1-long-diagnosis.json`. Public artifacts contain hashes, counts, names and lengths, without raw conversations, thinking, signatures, keys or private absolute paths.

## 1. One declaration becomes 197 transmissions

`src/agent.mjs` appends the notice to the first user message; `src/context-assembler.mjs` preserves all original user text even when replacing old tool results.

- Three declarations, one per candidate session; **197 request occurrences**.
- **699 UTF-8 text bytes**, or **703 serialized bytes** including separators and escaping, per occurrence.
- Removing only the notice from reconstructed candidate requests, holding actual context choices and responses fixed, removes **138,491 bytes**.
- Net observed candidate wire increase is **141,628 bytes**. Notice bytes equal **97.79%** of that net increase. This is byte accounting, **not a measured attribution of 97.79% of extra tokens or a demonstrated optimization gain**.
- First-request input is **1,073 → 1,223 (+150 tokens)** in all three pairs. Removing the notice and normalizing workspace strings makes all six first-request hashes identical. Later contexts and cache outcomes differ; 150 cannot be multiplied by all later requests for exact token attribution.

## 2. No avoided denials; repair tool grouping differs

Each of the six runs makes exactly **36 tool calls**: 33 `read_file`, one `search_code`, one `apply_patch` and one `run_tests`. No failed tools, denials, recovery calls or semantic summaries occur.

The first 30 turns have **180 requests per arm**: **811,565 → 834,138 tokens, +22,573 (+2.78%)**, representing **68.36%** of the whole-session increase. Request count is unchanged here; repeated input is larger.

Repair turns have **16 → 17 requests** and **88,403 → 98,850 tokens, +10,447 (+11.82%)**, representing **31.64%** of the increase:

- Repeat 1: repair requests **5 → 6**, repair tokens **+7,544**; full session **298,969 → 314,797 (+5.29%)**.
- Repeat 2: repair requests **5 → 6**, repair tokens **+6,583**; full session **301,204 → 313,970 (+4.24%)**.
- Repeat 3: repair requests **6 → 5**, repair tokens **−3,680**; full session **299,795 → 304,221 (+1.48%)**.

In repeat 1 the parent groups two reads; the candidate spreads reads across responses. In repeat 2 the parent groups a read with testing; the candidate separates them. In repeat 3 the candidate groups two initial reads with search. Thus equal tool counts do not imply equal request counts. Extra requests resend the assembled context. These are observed model choices, **not proof that S1 deterministically changes batching**. The entire repair delta also cannot be equated to the cost of its one net additional request.

## 3. Historical replies accumulate; earlier eviction offsets some overhead

ContextOS mainly replaces older tool results, retaining user messages and assistant replies. Generated assistant text in the read-only turns totals **2,310 → 3,010 bytes**, **2,636 → 2,640**, and **1,920 → 2,404** across the three pairs. Subsequent requests resend that text. All-request serialized assistant text blocks increase **46,146 bytes**. This observed text difference is not an independently established effect of the notice. Tool arguments, IDs and message structures differ too.

Candidate eviction starts at turn 12 in repeat 1, and the first request of turn 13 in repeats 2–3; all parents start at the second request of turn 13. Larger inputs cross the replacement condition earlier. Serialized tool results decrease **67,592 bytes**, while directories, anchors and retrieval definitions grow. Several candidate turn-12/13 token totals are lower. Earlier eviction provides an offset; the evidence does not establish broken compaction or assign the whole increase to eviction timing.

## 4. Cache fields remain included

- Uncached input: **479,972 → 485,253 (+5,281)**.
- Cache-read input: **415,168 → 442,432 (+27,264)**.
- Output: **4,828 → 5,303 (+475)**.

Cache-creation tokens are zero. Input counts include uncached input, cache reads and cache writes under the frozen accounting rule. More cache reads do not imply a cache failure; more content can hit cache while total input grows. **+3.67% tokens is not +3.67% invoiced cost** without verified billing rates and an invoice.

## Possible next experiments

1. Manage versioned runtime capabilities separately from authoritative user requirements. Current capabilities must remain reliably visible; obsolete environment notices should not persist as user instructions. Moving the notice into another user message alone would still pin it.
2. Keep resident notices short and provide detailed operation-specific feedback. Compare both denial-free and denial-heavy workflows with unchanged permissions and validation rules; check whether fewer input tokens cause more failed retries.
3. Investigate compacting completed assistant replies separately from user text, preserving useful conclusions, protocol signatures and recoverable sources. Avoid rules tailored to this repetitive reading fixture.
4. Investigate grouping independent tools while preserving dependencies between reading, editing and post-edit validation. Repeat 3 already groups tools more efficiently; this is not an established deterministic S1 defect.

These suggestions are **not implemented or measured improvements**. One self-authored workflow and three repeats do not establish exact global causal shares or guarantee improvements. S2–S5 remain unstarted.

## Evidence

[diagnosis.json](diagnosis.json) preserves six runs, 393 requests, per-turn usage, byte categories and response shapes. The [plot script](../../../scripts/plot-s1-long-diagnosis.py) plots observed provider tokens only. [SHA-256 manifest](evidence.sha256) covers reports, data, figures and reproduction scripts. Original S1 paid totals and acceptance remain unchanged.
