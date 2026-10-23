# Bounded source working set: balanced paid confirmation

[中文结果](RESULTS.zh-CN.md)

Eight scheduled attempts on two previously seen DeepSWE tasks, two matched pairs each, serial balanced AB/BA. Same exact runtime archive; only source working-set budget changes from 0 to 24000 bytes. Frozen protocol commit: `3e3aa78`.

Official full passes: baseline 2/4, candidate 3/4. All-attempt provider tokens: 5,112,329 -> 4,771,719; reduction +6.66%. Both-passed/native-completed/fully-metered pairs: 1/4; reduction -25.26%. Negative reduction means increased usage. Failures remain in all-attempt totals; unknown usage is never zero.

Predeclared screening gate: not passed. Feature remains off by default, pending review. These are small seen-task results, not statistical significance or unseen generalization. Provider cache/timing/model randomness remain limitations. Pi and Claude were not rerun. Control allocations (10 USD-equivalent per attempt, 80 total) are conservative controls, not actual invoices.

Only one of four pairs reduced tokens. Omitting the first Helm pair increases the remaining total by 35.83% (descriptive sensitivity only). Helm pooled reduction was 29.17%, while Mnamer pooled usage increased 81.16%. The only both-passed/native-completed pair increased usage 25.26%; the predeclared minimum of two eligible pairs was not met. This does not confirm stable token savings. The second Mnamer pair failed the same log-subdirectory requirement on both sides (369/370), despite substantially more candidate operations.

All 468 submitted requests have independently reconciled usage, hashes and controls; unknown usage and paid retries are both zero. Exit metadata audits confirmed all eight variants and budget bounds, with no missing assembly artifacts in these runs. Private reasoning and hidden verifier implementations were not read.
