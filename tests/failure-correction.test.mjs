import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validationSucceeded, observeValidation } from '../src/validation.mjs';
import { toolFailureFeedback, ToolFeedbackError } from '../src/tool-feedback.mjs';
import { runTask } from '../src/agent.mjs';
import { loadConfig } from '../src/config.mjs';

test('empty Go selection stays pending until that command executes tests', () => {
  const command = 'go test ./pkg/... -run TestMissing';
  const empty = 'exit=0\nstdout:\nok\texample/pkg\t0.02s [no tests to run]\n?\texample/helper\t[no test files]\nstderr:\n';
  assert.equal(validationSucceeded(empty), false);
  let state = observeValidation({}, command, empty);
  assert.equal(state.pendingValidation, true);
  assert.equal(toolFailureFeedback({ output: empty, validation: true }).code, 'VALIDATION_EMPTY');
  state = observeValidation(state, 'go test ./pkg/...', 'exit=0\nok\texample/pkg\t0.02s');
  assert.equal(state.pendingValidation, true); // Different coverage cannot silently clear it.
  state = observeValidation(state, 'go test -v ./pkg/...', 'exit=0\n--- PASS: TestBehavior (0.00s)\nok\texample/pkg\t0.02s');
  assert.equal(state.validationPassed, true);
  assert.equal(state.validationUnavailable[0].kind, 'empty_selection');
  assert.equal(state.validationUnavailable[0].alternativeCommand, 'go test -v ./pkg/...');
  state = observeValidation(state, command, 'exit=0\nok\texample/pkg\t0.02s');
  assert.equal(state.validationPassed, true);
});

test('corrected pytest invocation can establish validation without erasing an earlier assertion failure', () => {
  const command = 'python -m pytest tests -k bad-option';
  let state = observeValidation({}, command, 'exit=4\nERROR: usage');
  assert.deepEqual(state.validationFailures, []);
  assert.equal(state.validationUnavailable[0].kind, 'invalid_invocation');
  state = observeValidation(state, 'python -m pytest tests', 'exit=0\n3 passed');
  assert.equal(state.validationPassed, true);
  assert.equal(state.validationUnavailable[0].command, command);
  state = observeValidation({}, command, 'exit=1\n1 failed');
  state = observeValidation(state, command, 'exit=4\nERROR: usage');
  state = observeValidation(state, 'python -m pytest tests', 'exit=0\n3 passed');
  assert.equal(state.pendingValidation, true);
  assert.equal(state.validationFailures.length, 1);
});

test('builds, package-only no-test-files and mixed Go selections retain existing semantics', () => {
  for (const output of ['exit=0\nstdout:\n\nstderr:\n', 'exit=0\n?\texample/pkg\t[no test files]',
    'exit=0\nok\texample/a\t0.02s [no tests to run]\nok\texample/b\t0.03s']) {
    assert.equal(validationSucceeded(output), true);
    assert.equal(toolFailureFeedback({ output, validation: true }), null);
  }
});

test('pytest usage failure requests invocation repair, never source repair or policy bypass', () => {
  for (const command of ['pytest tests/missing.py', 'python -m pytest -k wrong', 'python3 -m pytest tests']) {
    const feedback = toolFailureFeedback({ command, output: 'exit=4\nERROR: invalid invocation', validation: true });
    assert.equal(feedback.code, 'VALIDATION_INVOCATION_INVALID');
    assert.equal(feedback.retryable, false);
    assert.match(feedback.next, /not evidence of a source defect/);
  }
  for (const [command, exit] of [['python -m pytest tests', 1], ['python -m pytest tests', 2], ['node --test tests', 4]]) {
    assert.equal(toolFailureFeedback({ command, output: `exit=${exit}\nfailure`, validation: true }).code, 'VALIDATION_FAILED');
  }
  assert.equal(toolFailureFeedback({ command: 'pytest tests', output: 'exit=4', validation: true,
    error: new ToolFeedbackError('COMMAND_POLICY_DENIED', 'denied') }).code, 'COMMAND_POLICY_DENIED');
  assert.equal(toolFailureFeedback({ command: 'pytest tests', output: 'exit=4', validation: false }).code, 'EXECUTION_FAILED');
});

test('real skipped Node test receives actionable feedback, then same-command repair can complete', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-correction-'));
  try {
    const source = "import test from 'node:test'; test.skip('behavior', () => {});\n";
    await writeFile(path.join(root, 'check.test.mjs'), source);
    const steps = [
      [{ name: 'run_tests', input: { command: 'node --test check.test.mjs' } }],
      [{ name: 'read_file', input: { path: 'check.test.mjs' } }],
      [{ name: 'apply_patch', input: { path: 'check.test.mjs', search: 'test.skip(', replace: 'test(' } }],
      [{ name: 'run_tests', input: { command: 'node --test check.test.mjs' } }],
    ];
    const requests = [];
    const config = { ...loadConfig({ workspace: root, runId: 'correction', memoryPolicy: 'full-history' }, {}), capabilityFeedback: true };
    const result = await runTask('Run the existing test and resolve skipped validation', config, {
      adapterFactory: () => ({ complete: async request => {
        requests.push(structuredClone(request));
        const calls = steps.shift();
        return calls ? { content: calls.map((call, i) => ({ type: 'tool_use', id: `c-${requests.length}-${i}`, ...call })), stop_reason: 'tool_use' }
          : { content: [{ type: 'text', text: 'Validated.' }], stop_reason: 'end_turn' };
      } }),
    });
    const feedback = requests[1].messages.at(-1).content[0];
    assert.equal(feedback.is_error, true);
    assert.match(feedback.content, /VALIDATION_EMPTY/);
    assert.match(feedback.content, /validation_pending/);
    assert.equal(result.status, 'completed');
    assert.equal(result.validationPassed, true);
    assert.deepEqual(result.validationFailures, []);
    assert.equal(result.validationAttempts, 2);
    assert.equal(result.toolCalls, 4);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
});
