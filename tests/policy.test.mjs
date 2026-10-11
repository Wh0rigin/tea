import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPolicyState, decideEffort, POLICY_STRATEGIES } from '../src/policy.mjs';
import { loadPolicyManifest, materializePolicyTrace, runPolicyExperiment } from '../scripts/policy-experiment.mjs';

function validation(step, { attempt = step + 1, passed = true, sourceRevision = 'source-a', command = 'node --test value.test.mjs', duration = step + 1 } = {}) {
  return { step, sourceRevision, pendingValidation: !passed, validationPassed: passed, validationAttempts: attempt,
    changedFiles: [], remainingBudget: 100,
    latestToolEvidence: { name: 'run_tests', input: { command },
      output: `exit=${passed ? 0 : 1}\nstdout:\n# tests 1\n# pass ${passed ? 1 : 0}\n# fail ${passed ? 0 : 1}\n# duration_ms ${duration}\nstderr:\n`,
      is_error: false, attempt, sourceRevision } };
}

function sequence(observations, { strategy = 'bidirectional', initialEffort = 'low', config } = {}) {
  let state = createPolicyState({ strategy, ...(['fixed-strong', 'fixed-weak'].includes(strategy) ? {} : { initialEffort }) });
  return observations.map((observation) => {
    const result = decideEffort(state, observation, config);
    state = result.state;
    return result;
  });
}

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); }
  return value;
}

test('supports four distinct policies without manufacturing calls or retries', () => {
  assert.deepEqual(POLICY_STRATEGIES, ['fixed-strong', 'fixed-weak', 'upgrade-only', 'bidirectional']);
  const observations = [validation(0, { passed: false }), validation(1, { passed: false }), validation(2), validation(3)];
  const fixedStrong = sequence(observations, { strategy: 'fixed-strong' });
  const fixedWeak = sequence(observations, { strategy: 'fixed-weak' });
  const upgradeOnly = sequence(observations, { strategy: 'upgrade-only' });
  const bidirectional = sequence(observations);
  assert.ok(fixedStrong.every((row) => row.decision.effort === 'max' && row.decision.action === 'hold'));
  assert.ok(fixedWeak.every((row) => row.decision.effort === 'low' && row.decision.action === 'hold'));
  assert.equal(upgradeOnly.at(-1).decision.effort, 'high');
  assert.equal(bidirectional.at(-1).decision.effort, 'low');
  for (const row of [...fixedStrong, ...fixedWeak, ...upgradeOnly, ...bidirectional]) {
    assert.equal(row.decision.createsRetry, false);
    assert.equal(row.decision.createsValidationCall, false);
  }
});

test('repeated validation failures use source and command identity despite changing duration output', () => {
  const rows = sequence([validation(0, { passed: false, duration: 1 }), validation(1, { passed: false, duration: 999 })]);
  assert.equal(rows[0].decision.action, 'hold');
  assert.equal(rows[1].decision.action, 'up');
  assert.notEqual(rows[0].decision.evidence.outputSha256, rows[1].decision.evidence.outputSha256);
  assert.equal(rows[0].decision.evidence.failureKey, rows[1].decision.evidence.failureKey);
  assert.equal(rows[1].decision.observedFailureStreak, 2);
});

test('recovery trace upgrades and downgrades one level at a time after two new aligned results', () => {
  const observations = Array.from({ length: 8 }, (_, step) => validation(step, { passed: step >= 4 }));
  const rows = sequence(observations);
  assert.deepEqual(rows.map((row) => row.decision.action), ['hold', 'up', 'hold', 'up', 'hold', 'down', 'hold', 'down']);
  assert.deepEqual(rows.map((row) => row.decision.effort), ['low', 'high', 'high', 'max', 'max', 'high', 'high', 'low']);
  assert.ok(rows.filter((row) => ['up', 'down'].includes(row.decision.action)).every((row) => row.decision.stepsAtEffortBeforeDecision >= 2));
});

test('longer minimum hold records the actual larger streak instead of its configured threshold', () => {
  const rows = sequence(Array.from({ length: 8 }, (_, step) => validation(step, { passed: step >= 4 })), { config: { minimumHoldSteps: 4 } });
  assert.equal(rows[1].decision.reason, 'minimum-hold-before-upgrade');
  assert.equal(rows[3].decision.action, 'up');
  assert.equal(rows[3].decision.observedFailureStreak, 4);
  assert.equal(rows[5].decision.reason, 'minimum-hold-before-downgrade');
  assert.equal(rows[7].decision.action, 'down');
  assert.equal(rows[7].decision.observedSuccessStreak, 4);
});

test('alternating outcomes, different commands, and new source identities do not aggregate unrelated failures', () => {
  const alternating = sequence(Array.from({ length: 8 }, (_, step) => validation(step, { passed: step % 2 === 1 })));
  assert.ok(alternating.every((row) => row.decision.action === 'hold'));
  const commands = sequence([validation(0, { passed: false, command: 'node --test first.test.mjs' }), validation(1, { passed: false, command: 'node --test second.test.mjs' })]);
  assert.equal(commands[1].decision.action, 'hold');
  const sources = sequence([validation(0, { passed: false, sourceRevision: 'old-source' }), validation(1, { passed: false, sourceRevision: 'new-source' })]);
  assert.equal(sources[1].decision.action, 'hold');
});

test('caller success booleans, ordinary search, Git success, and help cannot downgrade', async () => {
  const { manifest } = await loadPolicyManifest();
  const task = manifest.tasks.find((task) => task.taskId === 'policy-diagnostics-no-downgrade');
  const observations = materializePolicyTrace(task);
  assert.ok(observations.every((observation) => observation.validationPassed));
  const rows = sequence(observations, { initialEffort: 'max' });
  assert.ok(rows.every((row) => row.decision.effort === 'max' && row.decision.action === 'hold'));
  assert.equal(rows.at(-1).state.consecutiveSuccesses, 0);
});

test('zero-test and incomplete outputs are consumed but cannot become later successful evidence at the same attempt', () => {
  const zero = validation(0);
  zero.latestToolEvidence.output = 'exit=0\nstdout:\n# tests 0\n# pass 0\nstderr:\n';
  const alteredSameAttempt = validation(1, { attempt: 1 });
  const rows = sequence([zero, alteredSameAttempt, validation(2, { attempt: 2 })], { initialEffort: 'max' });
  assert.equal(rows[0].decision.evidence.status, 'zero-test-result');
  assert.equal(rows[1].decision.evidence.status, 'already-observed-attempt');
  assert.equal(rows[2].decision.action, 'hold');
  const incomplete = validation(0);
  incomplete.latestToolEvidence.output = 'partial output';
  const unknown = sequence([incomplete, alteredSameAttempt], { initialEffort: 'max' });
  assert.ok(unknown.every((row) => row.decision.action === 'hold'));
});

test('duplicate attempts and assistant claims do not advance the success streak', () => {
  const first = validation(0, { attempt: 1 });
  const duplicate = validation(1, { attempt: 1 });
  const claim = { ...validation(2, { attempt: 1 }), latestToolEvidence: undefined, assistantClaim: 'all tests passed' };
  const second = validation(3, { attempt: 2 });
  const rows = sequence([first, duplicate, claim, second], { initialEffort: 'max' });
  assert.deepEqual(rows.map((row) => row.decision.action), ['hold', 'hold', 'hold', 'down']);
  assert.equal(rows[1].state.consecutiveSuccesses, 1);
  assert.equal(rows[2].state.consecutiveSuccesses, 1);
});

test('an edit resets prior validation, and mismatched source evidence cannot downgrade', () => {
  const first = validation(0, { attempt: 1 });
  const edit = { ...validation(1, { attempt: 1, sourceRevision: 'source-b' }), pendingValidation: true, validationPassed: false,
    latestToolEvidence: { name: 'apply_patch', input: { path: 'value.mjs' }, output: 'Updated value.mjs', is_error: false } };
  const stale = validation(2, { attempt: 1, sourceRevision: 'source-b' });
  stale.latestToolEvidence.sourceRevision = 'source-a';
  const fresh = validation(3, { attempt: 2, sourceRevision: 'source-b' });
  const secondFresh = validation(4, { attempt: 3, sourceRevision: 'source-b' });
  const rows = sequence([first, edit, stale, fresh, secondFresh], { initialEffort: 'max' });
  assert.equal(rows[1].state.consecutiveSuccesses, 0);
  assert.equal(rows[2].decision.evidence.status, 'stale-source-evidence');
  assert.equal(rows[3].decision.action, 'hold');
  assert.equal(rows[4].decision.action, 'down');
});

test('a successful result while pending validation is not reusable after caller flags change', () => {
  const pending = validation(0, { attempt: 1 });
  pending.pendingValidation = true;
  const unchangedAttempt = validation(1, { attempt: 1 });
  const rows = sequence([pending, unchangedAttempt], { initialEffort: 'max' });
  assert.equal(rows[0].decision.evidence.status, 'success-not-currently-validated');
  assert.equal(rows[1].decision.evidence.status, 'already-observed-attempt');
  assert.equal(rows[1].state.consecutiveSuccesses, 0);
});

test('returning to an old source identity cannot revive a formerly unaligned attempt', () => {
  const rejected = validation(0, { attempt: 1 });
  rejected.validationAttempts = 2;
  rejected.latestToolEvidence.sourceRevision = 'source-b';
  const edit = { ...validation(1, { attempt: 2, sourceRevision: 'source-b' }), pendingValidation: true, validationPassed: false,
    latestToolEvidence: { name: 'apply_patch', input: { path: 'value.mjs' }, output: 'Updated value.mjs', is_error: false } };
  const oldResult = validation(2, { attempt: 2, sourceRevision: 'source-a' });
  const repeatedOldResult = validation(3, { attempt: 2, sourceRevision: 'source-a' });
  const freshResult = validation(4, { attempt: 3, sourceRevision: 'source-a' });
  const rows = sequence([rejected, edit, oldResult, repeatedOldResult, freshResult], { initialEffort: 'max' });
  assert.equal(rows[0].decision.evidence.status, 'unaligned-validation-attempt');
  assert.equal(rows[0].state.lastEvidenceAttempt, 1);
  assert.equal(rows[1].state.lastEvidenceAttempt, 2);
  assert.equal(rows[2].decision.evidence.status, 'already-observed-attempt');
  assert.equal(rows[3].decision.evidence.status, 'already-observed-attempt');
  assert.ok(rows.every((row) => row.decision.action === 'hold'));
  assert.equal(rows.at(-1).state.consecutiveSuccesses, 1);
});

test('a source change expires previously declared attempts even without an explicit edit receipt', () => {
  const initial = { ...validation(0, { attempt: 2 }), latestToolEvidence: undefined };
  const changed = { ...validation(1, { attempt: 2, sourceRevision: 'source-b' }), latestToolEvidence: undefined };
  const returned = validation(2, { attempt: 2, sourceRevision: 'source-a' });
  const rows = sequence([initial, changed, returned], { initialEffort: 'max' });
  assert.equal(rows[0].state.lastEvidenceAttempt, 0);
  assert.equal(rows[1].state.lastEvidenceAttempt, 2);
  assert.equal(rows[2].decision.evidence.status, 'already-observed-attempt');
  assert.equal(rows[2].state.consecutiveSuccesses, 0);
});

test('a changed source can observe a genuinely newer validation attempt in the same turn', () => {
  const rows = sequence([validation(0, { attempt: 1, passed: false }), validation(1, { attempt: 2, sourceRevision: 'source-b' }),
    validation(2, { attempt: 3, sourceRevision: 'source-b' })], { initialEffort: 'max' });
  assert.equal(rows[1].decision.evidence.status, 'success');
  assert.equal(rows[1].state.consecutiveSuccesses, 1);
  assert.equal(rows[1].decision.validationAttemptWatermarkBefore, 1);
  assert.equal(rows[1].decision.validationAttemptWatermarkAfter, 2);
  assert.equal(rows[2].decision.action, 'down');
});

test('same-source edit invalidates earlier attempts while an invalid future attempt cannot poison the watermark', () => {
  const initial = { ...validation(0, { attempt: 2 }), latestToolEvidence: undefined };
  const edit = { ...validation(1, { attempt: 2 }), pendingValidation: true, validationPassed: false,
    latestToolEvidence: { name: 'apply_patch', input: { path: 'value.mjs' }, output: 'Updated value.mjs', is_error: false } };
  const rows = sequence([initial, edit, validation(2, { attempt: 2 })], { initialEffort: 'max' });
  assert.equal(rows[1].state.lastEvidenceAttempt, 2);
  assert.equal(rows[2].decision.evidence.status, 'already-observed-attempt');
  const future = validation(0, { attempt: 1 });
  future.latestToolEvidence.attempt = 99;
  const valid = sequence([future, validation(1, { attempt: 2 })], { initialEffort: 'max' });
  assert.equal(valid[0].state.lastEvidenceAttempt, 0);
  assert.equal(valid[1].state.lastEvidenceAttempt, 2);
});

test('budget protection preserves verification capacity even when the model request alone would fit', () => {
  const observation = { ...validation(0), remainingBudget: 25 };
  const stopped = decideEffort(createPolicyState({ strategy: 'fixed-weak' }), observation);
  assert.equal(stopped.decision.action, 'stop');
  assert.equal(stopped.decision.requestAllowed, false);
  assert.equal(stopped.decision.reason, 'cannot-reserve-request-and-validation');
  assert.equal(stopped.decision.budget.validationReserve, 20);
  const exact = decideEffort(createPolicyState({ strategy: 'fixed-weak' }), { ...observation, remainingBudget: 28 });
  assert.equal(exact.decision.requestAllowed, true);
  assert.equal(exact.decision.budget.totalRequired, 28);
  const terminal = decideEffort(stopped.state, { ...observation, step: 1, remainingBudget: 1000 });
  assert.equal(terminal.decision.action, 'stop');
  assert.equal(terminal.decision.reason, 'already-stopped');
});

test('unaffordable escalation stops and records its intended effort without lowering validation reserve', () => {
  const rows = sequence([validation(0, { passed: false }), { ...validation(1, { passed: false }), remainingBudget: 30 }]);
  assert.equal(rows[1].decision.action, 'stop');
  assert.equal(rows[1].decision.requestedEffort, 'high');
  assert.equal(rows[1].decision.effort, 'low');
  assert.equal(rows[1].decision.budget.totalRequired, 40);
  assert.equal(rows[1].state.switchCount, 0);
});

test('policy inputs including signed thinking and history remain byte-for-byte unchanged', () => {
  const state = deepFreeze(createPolicyState({ strategy: 'bidirectional' }));
  const observation = deepFreeze({ ...validation(0, { passed: false }),
    history: [{ role: 'assistant', content: [{ type: 'thinking', thinking: '原始思考', signature: 'signed-original-value' }] }] });
  const stateBefore = JSON.stringify(state);
  const inputBefore = JSON.stringify(observation);
  decideEffort(state, observation, deepFreeze({ requestReserveByEffort: { low: 8, high: 20, max: 40 } }));
  assert.equal(JSON.stringify(state), stateBefore);
  assert.equal(JSON.stringify(observation), inputBefore);
});

test('rejects malformed policy states, missing budgets, weaker hysteresis, and regressed attempt counters', () => {
  assert.throws(() => createPolicyState({ strategy: 'unknown' }), /Unknown policy/);
  assert.throws(() => createPolicyState({ strategy: 'fixed-strong', initialEffort: 'low' }), /Fixed strategy/);
  const state = createPolicyState();
  assert.throws(() => decideEffort({ ...state, stepsAtEffort: undefined }, validation(0)), /state.stepsAtEffort/);
  assert.throws(() => decideEffort({ ...state, stopped: 'false' }, validation(0)), /state.stopped/);
  assert.throws(() => decideEffort({ ...state, lastEvidenceAttempt: 2 }, validation(0)), /exceed declared/);
  assert.throws(() => decideEffort(state, { ...validation(0), remainingBudget: undefined }), /remainingBudget/);
  assert.throws(() => decideEffort(state, validation(0), { minimumHoldSteps: 1 }), /minimumHoldSteps/);
  assert.throws(() => decideEffort(state, validation(0), { successesBeforeDowngrade: 1 }), /successesBeforeDowngrade/);
  assert.throws(() => decideEffort(state, validation(0), { validationReserve: 0 }), /validationReserve/);
  assert.throws(() => decideEffort(state, validation(0), { requestReserveByEffort: { low: 9, high: 1, max: 40 } }), /nondecreasing/);
  const next = decideEffort(state, validation(0, { attempt: 2 })).state;
  assert.throws(() => decideEffort(next, validation(0, { attempt: 2 })), /strictly increasing/);
  assert.throws(() => decideEffort(next, validation(1, { attempt: 1 })), /cannot decrease/);
});

test('fixed simulation records policy counts and controls while leaving tokens and success unmeasured', async () => {
  const { run, outputDir } = await runPolicyExperiment({ runId: `policy-unit-${Date.now()}-${process.pid}` });
  assert.equal(run.mode, 'policy-simulation');
  assert.equal(run.totals.taskCount, 13);
  assert.equal(run.totals.strategyCount, 4);
  assert.equal(run.totals.protectionViolations, 0);
  assert.equal(run.totals.allInputsUnchanged, true);
  assert.equal(run.gateEligible, false);
  assert.equal(run.providerTotalActualTokens, null);
  assert.equal(run.estimatedOutputTokenSavings, null);
  assert.equal(run.modelTaskSuccessRate, null);
  assert.equal(run.actualCodeAcceptanceRate, null);
  assert.equal(run.sourceUnchangedDuringRun, true);
  const bidirectional = run.strategies.find((row) => row.strategy === 'bidirectional');
  const recovery = bidirectional.tasks.find((row) => row.taskId === 'policy-recovery');
  assert.deepEqual(recovery.rows.map((row) => row.decision.action), ['hold', 'up', 'hold', 'up', 'hold', 'down', 'hold', 'down']);
  assert.equal(recovery.stats.immediateReversals, 0);
  const diagnostics = bidirectional.tasks.find((row) => row.taskId === 'policy-diagnostics-no-downgrade');
  assert.equal(diagnostics.stats.actions.down, 0);
  const oldSource = bidirectional.tasks.find((row) => row.taskId === 'policy-return-to-old-source');
  assert.equal(oldSource.stats.actions.down, 0);
  assert.equal(oldSource.rows.at(-1).resultingState.consecutiveSuccesses, 1);
  const newSource = bidirectional.tasks.find((row) => row.taskId === 'policy-new-source-same-turn-validation');
  assert.equal(newSource.stats.actions.down, 1);
  assert.equal(bidirectional.totals.budgetViolations, 0);
  assert.ok(run.strategies.every((row) => row.totals.manufacturedRetries === 0 && row.totals.manufacturedValidationCalls === 0));
  assert.equal(JSON.parse(await readFile(path.join(outputDir, 'run.json'), 'utf8')).manifestSha256, run.manifestSha256);
  await assert.rejects(runPolicyExperiment({ runId: run.runId }), /EEXIST/);
  await assert.rejects(runPolicyExperiment({ runId: '../unsafe' }), /Run ID/);
});
