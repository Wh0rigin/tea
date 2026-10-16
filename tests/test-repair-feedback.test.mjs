import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { toolFailureFeedback, appendFailureFeedback, ToolFeedbackError } from '../src/tool-feedback.mjs';
import { runTask, createAgentSession } from '../src/agent.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { loadConfig } from '../src/config.mjs';

const failed = { toolName: 'run_tests', validation: true, output: 'exit=1\nORIGINAL_ASSERTION' };
const timeout = { toolName: 'run_tests', validation: true, error: new Error('Command timed out after 1000 ms') };
const repair = input => toolFailureFeedback({ ...input, repairGuidance: true });

test('S5 explicitly off preserves default feedback byte for byte', () => {
  for (const input of [failed, timeout, { output: 'exit=0\npassed' }, { error: new Error('Command cancelled') }]) {
    assert.deepEqual(toolFailureFeedback(input), toolFailureFeedback({ ...input, repairGuidance: false }));
  }
  assert.equal(toolFailureFeedback(timeout).code, 'EXECUTION_TRANSIENT');
  assert.equal(toolFailureFeedback(timeout).retryable, true);
});

test('S5 assertion advice preserves original output, demands contract evidence and existing tests', () => {
  const feedback = repair(failed);
  assert.equal(feedback.code, 'VALIDATION_FAILED'); assert.equal(feedback.retryable, false);
  assert.match(feedback.next, /task contract/); assert.match(feedback.next, /only with evidence/);
  assert.match(feedback.next, /preserve existing tests and user changes/);
  assert.match(feedback.next, /smallest relevant check/); assert.match(feedback.next, /required suite/);
  assert.ok(appendFailureFeedback(failed.output, feedback).startsWith(failed.output + '\n[tool_feedback]'));
  assert.equal(repair({ output: 'exit=0\npassed', toolName: 'run_tests', validation: true }), null);
});

test('S5 identifies only an exact validation command deadline and permits diagnostic repair', () => {
  for (const toolName of ['run_tests', 'run_shell']) {
    const feedback = repair({ ...timeout, toolName });
    assert.equal(feedback.code, 'VALIDATION_TIMEOUT'); assert.equal(feedback.retryable, false);
    assert.match(feedback.next, /test cleanup/); assert.match(feedback.next, /new evidence or a relevant change/);
    assert.match(feedback.next, /does not identify a code or environment defect/);
  }
  for (const change of [{ validation: false }, { toolName: 'read_file' }, { toolName: undefined },
    { error: Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' }) }]) {
    const input = { ...timeout, ...change };
    assert.deepEqual(repair(input), toolFailureFeedback(input));
  }
});

test('S5 preserves explicit error priorities, cancellation, diagnostics and permission failures', () => {
  for (const error of [new ToolFeedbackError('CAPABILITY_DENIED', timeout.error.message),
    new ToolFeedbackError('APPROVAL_DENIED', 'refused'), new ToolFeedbackError('EXECUTION_TRANSIENT', timeout.error.message),
    new Error('Command cancelled'), Object.assign(new Error('not found'), { code: 'ENOENT' })]) {
    const input = { ...timeout, error }; assert.deepEqual(repair(input), toolFailureFeedback(input));
  }
  const input = { ...failed, validation: false };
  assert.deepEqual(repair(input), toolFailureFeedback(input));
});

async function scenario(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tea-s5-')));
  try { await fn(root); } finally {
    const target = await realpath(root), relative = path.relative(await realpath(os.tmpdir()), target);
    assert.ok(relative.startsWith('tea-s5-') && !relative.includes('..') && !path.isAbsolute(relative));
    await rm(target, { recursive: true, force: true });
  }
}
const end = () => ({ content: [{ type: 'text', text: 'Checks described accurately.' }], stop_reason: 'end_turn' });
const call = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const adapter = (steps, captured) => () => ({ complete: async request => {
  captured.push(structuredClone({ system: request.system, messages: request.messages, tools: request.tools }));
  return steps.shift() || end();
} });
const configFor = root => ({ ...loadConfig({ workspace: root, compaction: 'off', historyStrategy: 'full' }, {}), capabilityFeedback: true });

test('S5 first request is identical, real failure then repair keeps validation and schemas unchanged', async () => scenario(async root => {
  await writeFile(path.join(root, 'value.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('value',()=>assert.equal(value,2));\n");
  const captures = {};
  for (const enabled of [false, true]) {
    await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
    const captured = captures[String(enabled)] = [];
    const steps = [call('read', 'read_file', { path: 'value.mjs' }),
      call('fail', 'run_tests', { command: 'node --test value.test.mjs' }),
      call('patch', 'apply_patch', { path: 'value.mjs', search: 'value = 1', replace: 'value = 2' }),
      call('pass', 'run_tests', { command: 'node --test value.test.mjs' })];
    const result = await runTask('Fix value and preserve tests.', { ...configFor(root), runId: 's5-' + enabled, testRepairFeedback: enabled }, { adapterFactory: adapter(steps, captured) });
    assert.equal(result.status, 'completed'); assert.equal(result.validationPassed, true); assert.equal(result.validationAttempts, 2);
    const failure = captured[2].messages.at(-1).content[0];
    assert.equal(failure.is_error, true); assert.match(failure.content, /^exit=1/);
    assert.equal(failure.content.includes('task contract'), enabled);
    assert.deepEqual(captured.at(-1).tools, captured[0].tools);
    assert.equal(captured.at(-1).system, captured[0].system);
  }
  assert.deepEqual(captures.false[0], captures.true[0]);
}));

test('S5 real timeout keeps pending edits unverified and does not execute additional commands', async () => scenario(async root => {
  await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'hang.test.mjs'), "import test from 'node:test';test('hang',async()=>{await new Promise(()=>setInterval(()=>{},1000));});\n");
  const config = { ...configFor(root), runId: 's5-timeout', testRepairFeedback: true, maxToolCalls: 4 };
  const session = createAgentSession(config); session.tools = new WorkspaceTools({ workspace: root, maxCommandMs: 1000 });
  const captured = [], steps = [call('read', 'read_file', { path: 'value.mjs' }),
    call('edit', 'apply_patch', { path: 'value.mjs', search: 'value = 1', replace: 'value = 2' }),
    call('timeout', 'run_tests', { command: 'node --test hang.test.mjs' })];
  const result = await runTask('Edit and validate.', config, { session, adapterFactory: adapter(steps, captured) });
  assert.equal(result.status, 'needs_validation'); assert.equal(result.validationPassed, false); assert.equal(result.validationAttempts, 1);
  assert.equal(session.pendingValidation, true); assert.equal(result.toolCalls, 3);
  const output = captured[3].messages.at(-1).content[0];
  assert.equal(output.is_error, true); assert.match(output.content, /Command timed out after 1000 ms/);
  assert.match(output.content, /VALIDATION_TIMEOUT/); assert.match(output.content, /"retryable":false/);
}));

test('S5 does not enable capability feedback when explicitly disabled', async () => scenario(async root => {
  await writeFile(path.join(root, 'fail.test.mjs'), "import test from 'node:test';test('failure',()=>{throw new Error('visible assertion');});\n");
  const captured = [];
  await runTask('Run checks.', { ...configFor(root), capabilityFeedback: false, testRepairFeedback: true, runId: 's5-disabled' },
    { adapterFactory: adapter([call('failure', 'run_tests', { command: 'node --test fail.test.mjs' })], captured) });
  assert.match(captured[1].messages.at(-1).content[0].content, /visible assertion/);
  assert.doesNotMatch(captured[1].messages.at(-1).content[0].content, /tool_feedback|task contract/);
}));
