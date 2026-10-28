# Priority 2: retrieval progress feedback vs unmodified production

Status: frozen before paid calls; results pending. No production adoption or benefit claim.

Parent `a3571e56b597ac4f3b8458e929b4621c93e76c30` vs candidate `b62adb0255de6126337e1815f8ba085212ebc0eb`. No PR24 prompt, no priority-1 recovery; original PR16 numeric settings and original tool definitions/permissions/verification retained. This candidate only adds default-off bounded feedback after repeated structured lookups. All tools execute, original outputs remain intact, and necessary rereads remain permitted.

At most eight serial interleaved attempts: two seen DeepSWE tasks, two repetitions per variant. Same official GLM-5.3-flash endpoint, enabled/low thinking, streaming, 131072 output ceiling, 216000 context and task initial snapshots/acceptance. This is not a full/unseen benchmark score; Pi is not rerun.

Controls: 30 USD-equivalent/attempt, 240 maximum total; 128 transport submissions, 4096 tools, 900s request / 1800s agent. Controls are conservative bounds, not invoices. Existing explicit Internal Network Failure retry5 unchanged. Retain unknown allocations and stop on unrecovered unknown/infrastructure failure; never treat unknown or unstarted as zero, no replacement/relaunch.

Predeclared rejection-only futility: between trials, when every completed official reward is known, stop if candidate accepted + candidate unstarted < baseline accepted. Record the acceptance bounds and every unstarted trial; report no complete-cohort token ratio after early stopping. No early acceptance or changed criteria during trials.

Local targeted 74/74 and complete 491/491 passed, no failures/skips. Both server variants passed 14 scripted responses / 12 real tools / explicit error recovery / independent patch validation with zero provider calls. Candidate emitted one feedback event; parent none. Scripted fixtures do not measure model quality or token savings. Measure actual live activation and behavior before claiming benefit; no benefit established if never activated.

[Protocol](protocol.json) / [Preflight](preflight.json). No private reasoning or hidden verifier implementation inspection.
