# Why ContextOS B failed scope

[中文](README.zh-CN.md) · [Reconstructed request evidence](diagnosis.json) · [Original rejected B experiment](../contextos-glm-20261011/README.md)

## Confirmed observations

The first three native B requests before the erroneous patch were rebuilt on a clone of the exact initial fixture, using frozen B code `07d6070`. Every complete serialized request hash matches its original settled hash. This is a verified reconstruction, not an approximate prompt description. No model calls were made for diagnosis.

- The project rule allowing only `src/services/points.ts` remained valid and resident in all three requests.
- The current user goal was present verbatim. Its position in serialized message text moved from about 98.5% to 83.4%; it was not deleted or summarized away.
- The model inspected `text.ts`, listed nearby service filenames, read `points.ts` and the unrelated shadow `text.mjs`, then requested patches to both `points.ts` and `text.mjs` in one response.
- The shadow file's source was recent resident evidence before the patch. Merely being recently read does not establish relevance or authorization to edit it.
- Public/hidden tests imported the TypeScript path and passed after the helper fix. The separate scope check caught the unnecessary JavaScript edit. Passing functionality alone missed this task violation. The agent also ran the same public tests twice.

## Hypotheses and next test

C repeats the original current goal and observed, version-valid project rules near the latest results, pages complete unsigned old tool rounds, and keeps the canonical history. On the identical B history, C's counterfactual native requests are 15,673 / 15,667 / 14,883 bytes versus B's 22,557 / 22,793 / 22,248 bytes. These are deterministic request bytes, not provider-token or correctness gains. Live repeated comparison remains necessary.

This trace rules out deleted scope instructions. It does not establish that compression caused the failure, that instruction position is the unique cause, or that C guarantees adherence. One failure in three TypeScript repeats is insufficient to distinguish a systematic policy effect from model variance.

[ACE](https://arxiv.org/abs/2510.04618) motivates preserving structured requirements and observations through incremental context updates. [Lost in the Middle](https://arxiv.org/abs/2307.03172) motivates testing instruction placement; its experiments are not this GLM coding workload and do not prove this failure's cause. TEA's current test adds no reflector model or embedding service.

## Privacy and reproducibility

Only public synthetic action names/paths, request hashes, byte counts and inclusion booleans are exported. Original thinking, signatures, full transcripts, keys and private workspace paths remain local. The authenticated source journal and initial fixtures are retained under ignored experiment storage; reconstructing these exact original requests needs that local journal. The public fixture/task recipe is in `src/contextos-benchmark.mjs`; the baseline commit and hashes are in JSON. Published evidence is descriptive; the original B report and gate are unchanged.
