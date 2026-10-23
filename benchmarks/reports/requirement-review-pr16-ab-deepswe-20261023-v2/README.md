# Requirement evidence review on the complete PR16 profile

Status: protocol frozen before paid calls; real evaluation pending. Runtime `c63fb1344f22790c207bc0c71980494f3b82705a` is identical in both variants. Only `requirementReview` changes. Complete frozen `pr16-quality` model/context settings are asserted before inference, including 24KB working set, reserved-output budgeting and original compaction settings.

Two previously seen DeepSWE tasks (Helm, Mnamer), two paired repetitions each, eight TEA attempts, balanced serial AB/BA. Pi/Claude are not rerun. Original task source/instruction and archive hashes are in protocol.json. Preflight is self-authored, synthetic SSE with real container tools and independently applied patches; zero provider calls, not task accuracy evidence.

Controls: 128 requests per attempt, 900-second client request timeout, 1,800-second Agent wall time, 4,096 tool calls, USD 10-equivalent allocation per attempt / 80 total. Historical conservative allocation arithmetic is not an actual bill or a current price quote. Stop starting tasks at first unknown usage or pre-inference infrastructure failure; retain reservations, failures and unstarted tasks. No automatic retries.

Primary outcome: official whole-task acceptance, preserve regressions; native completion separately. Report provider tokens for all attempts and the both-passed/native-completed subset separately. Unknown usage is null, never zero. Count review activation before attributing effects. No generalization or new success/token claim is made before results.

Separate round explicitly authorized after v1 returned HTTP401 using a different local credential. V1 remains preserved and is not substituted with these results. This round uses the previously supplied official credential, in memory only.
