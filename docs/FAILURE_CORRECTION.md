# Actionable validation failure correction

This focused repair starts from production a3571e5, without priority-1 recovery or priority-2 retrieval feedback. It adds no model call, automatic command retry, permission grant or task-specific prompt.

## Problem and behavior

A pytest usage error (exit 4) previously received generic source-repair guidance and became an exact-command failure obligation. Correcting the invocation could not close that obligation. Recognized direct pytest and Python `-m pytest` usage failures now ask for argument/path correction. They remain explicitly unverified checks; a same-language, nonempty alternative may establish fresh validation, while the original command and coverage limitation remain recorded. Any earlier observed source failure still blocks completion until its original check passes.

Go `ok ... [no tests to run]` could previously count as validation. If all reported Go packages contain no selected tests or no test files, and at least one reports `[no tests to run]`, the result now stays unverified. Relevant verbose Go output containing an executed `--- PASS:` can establish alternative validation. Mixed package selections retain existing semantics: this repair does not require every package to contain tests, and does not reject quiet builds or ordinary package-only `[no test files]` results.

Already recognized empty Node/Python validation now receives `VALIDATION_EMPTY` feedback instead of a silent exit-zero result. Their existing exact-check obligations remain unchanged. Pytest assertion/import failures retain ordinary failure handling. Explicit host policy errors take precedence over text classification. Incomplete background-process output retains its existing `EXECUTION_INCOMPLETE` handling; this repair neither restarts it nor claims that it passed.

Raw tool output remains present. Feedback is bounded static text and only appears for the relevant failure when capability feedback is enabled. Validation-state correctness does not depend on that display flag. These are observations about execution/discovery, not proof of an implementation defect or complete task coverage.

## Verification and limits

Targeted and related regressions: 74/74. Full deterministic suite: 485/485, zero failures/skips, with local Go 1.24 available. The test count is against production (480), not the discarded priority-2 branch (491). New cases cover empty and mixed Go selection, quiet builds, corrected pytest invocations, retained earlier source failures, policy precedence, and real skipped Node test output followed by a same-command passing repair. The latter uses a scripted model adapter and real tools; it demonstrates feedback/state mechanics, not autonomous model success.

No paid model or DeepSWE run was performed for this repair. Real correctness and provider-token effects remain unmeasured. The changes do not solve untested lifecycle behavior or missing nested-path handling themselves. A subsequent frozen live comparison should measure whether the model changes its next action, whether failed checks actually recover, official task acceptance, and all-attempt provider usage. Passing self-authored tests alone is insufficient for a performance claim.
