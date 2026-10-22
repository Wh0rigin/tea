# Runtime repairs following the workflow benchmark

[中文设计、验证与限制](../../../docs/RUNTIME_REPAIR.zh-CN.md)

This is a **zero-provider-call repair verification**, not a new DeepSWE or WB-Bench-Code performance result. The previous 24 paid attempts, failures and grades remain unchanged.

- Core commit `da5faeb`: separate unavailable runners from observed test failures; retain explicit unverified-check limitations; bound subprocess settlement; accept safe single-file search scopes.
- Subsequent guidance is a separate commit: check real entry points and requirement edges using existing inputs. No benchmark names or hidden answers are included.
- Final Windows Node 24: **434 passed + 1 Go-unavailable skip / 435**; targeted **81 passed + 1 skip / 82**.
- Linux Node 24: **435/435**, including real Go execution, with networking disabled.
- Linux Node 20: targeted **81 passed + 1 Go-unavailable skip / 82**, with networking disabled.
- Original pipe-reproduction script: all **six repaired-version probes** settle before the 1,200ms watchdog. Historical failures across both old versions are retained separately.
- Real Python fixture: pytest is absent, unittest actually runs two passing tests. Old controller ends `needs_validation`; repaired controller completes and reports the original pytest command as unverified. Model choices are scripted, so this is not autonomous solving or provider-token savings.
- Existing scripted runtime fixtures: independent acceptance **12/12**. Core fixes without the new guidance: Windows **433 passed + 1 skip / 434**.

## Evidence

- [Counts, source identity, initial failures and limitations](verification.json)
- [Source/test byte hashes in the tested archive](source-hashes.json)
- [Original-script pipe checks](pipe-recheck.json)
- [Actual Python fallback observations](real-python-fallback.json) · [fixture source](real-python-fallback.mjs)
- [Previous real benchmark results](../workflow-native-screen-20261020/RESULTS.zh-CN.md)

The fixture defaults to a source mount at `/candidate`; override `TEA_REPAIR_SOURCE` when reproducing. It requires Python without pytest and actual Node/Python tools, creates only its own temporary workspace, and makes no model calls. A missing dependency inside a running test must not be treated as an unavailable runner.

Alternative validation does **not** prove coverage equivalence. Original unverified commands remain visible. Terminating escaped descendants is not guaranteed; incomplete pipes return explicit failure rather than hanging or claiming successful validation. Token and coding-quality improvements remain unmeasured pending a separately frozen real-model comparison.
