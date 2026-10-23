import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { runTask } from '../src/agent.mjs';
import { loadConfig } from '../src/config.mjs';
import { ModelError } from '../src/model.mjs';

const patch = { name: 'apply_patch', input: { path: 'value.mjs', search: 'value = 1', replace: 'value = 2' } };
const verify = { name: 'run_tests', input: { command: 'node --test value.test.mjs' } };
let toolSerial = 0;
function toolResult(calls) {
  return { content: calls.map((call) => ({ type: 'tool_use', id: `call_${++toolSerial}`, ...call })), stop_reason: 'tool_use' };
}
function scriptedFactory(steps, captured = []) {
  return () => ({ complete: async (request) => {
    captured.push(structuredClone(request.messages));
    const step = steps.shift();
    if (step instanceof Error) throw step;
    return step || { content: [{ type: 'text', text: 'Finished.' }], stop_reason: 'end_turn' };
  } });
}
async function scenario(steps, callback, { maxToolCalls = 24, initializeGit = false, historyStrategy = 'full', verbose = false, completionReview = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-agent-'));
  try {
    await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
    await writeFile(path.join(root, 'value.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from './value.mjs';\ntest('value', () => assert.equal(value, 2));\n");
    if (verbose) await writeFile(path.join(root, 'verbose.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from './value.mjs';\ntest('verbose actual validation', () => { for (let i = 0; i < 200; i++) console.log('fixed log ' + i + ' ' + 'x'.repeat(80)); assert.equal(value, 2); });\n");
    if (initializeGit) await promisify(execFile)('git', ['init', '-q'], { cwd: root, windowsHide: true });
    const config = { ...loadConfig({ workspace: root, runId: 'integration', historyStrategy, compaction: 'off', completionReview }, {}), maxToolCalls };
    const captured = [];
    const result = await runTask('修复 value 的值', config, { adapterFactory: scriptedFactory(steps, captured) });
    await callback(result, root, captured);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('runs the actual patch/test loop and hashes arbitrary task text correctly', async () => {
  await scenario([toolResult([{ name: 'read_file', input: { path: 'value.mjs' } }]), toolResult([patch, verify])], async (result, root) => {
    assert.equal(result.status, 'completed');
    assert.equal(result.validationPassed, true);
    assert.equal(result.validationAttempts, 1);
    assert.equal(result.runType, 'offline-runtime');
    assert.match(await readFile(path.join(root, 'value.mjs'), 'utf8'), /value = 2/);
    const [started] = (await readFile(path.join(result.runDirectory, 'ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(started.taskSha256, createHash('sha256').update('修复 value 的值').digest('hex'));
    assert.equal(started.runType, 'offline-runtime');
    assert.equal(started.usageSource, 'scripted');
    assert.ok(result.wallElapsedMs > 0);
  });
});

test('successful Git diagnostics cannot satisfy post-edit validation', async () => {
  await scenario([toolResult([patch, { name: 'run_tests', input: { command: 'git status' } }])], async (result) => {
    assert.equal(result.status, 'needs_validation');
    assert.equal(result.validationPassed, false);
    assert.equal(result.validationAttempts, 0);
  }, { initializeGit: true });
});

test('run_shell counts an actual safe test command', async () => {
  await scenario([toolResult([patch, { ...verify, name: 'run_shell' }])], async (result) => {
    assert.equal(result.status, 'completed');
    assert.equal(result.validationPassed, true);
  });
});

test('an edit after a passing test restores pending validation', async () => {
  await scenario([toolResult([patch, verify, { name: 'apply_patch', input: { path: 'value.mjs', search: 'value = 2', replace: 'value = 3' } }])], async (result) => {
    assert.equal(result.status, 'needs_validation');
    assert.equal(result.validationPassed, false);
  });
});

test('a zero-test Node run cannot satisfy post-edit validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-agent-zero-'));
  try {
    await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
    await writeFile(path.join(root, 'zero.test.mjs'), "import test from 'node:test';\ntest.skip('not executed', () => {});\n");
    const result = await runTask('Update value', loadConfig({ workspace: root, runId: 'zero' }, {}), {
      adapterFactory: scriptedFactory([toolResult([patch, { name: 'run_tests', input: { command: 'node --test zero.test.mjs' } }])]),
    });
    assert.equal(result.status, 'needs_validation');
    assert.equal(result.validationPassed, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a later failed validation invalidates an earlier pass', async () => {
  await scenario([toolResult([patch, verify, { name: 'run_tests', input: { command: 'node --test absent.test.mjs' } }])], async (result) => {
    assert.equal(result.status, 'needs_validation');
    assert.equal(result.validationPassed, false);
    assert.equal(result.validationAttempts, 2);
  });
});

test('a tool budget cannot mark an unvalidated edit complete', async () => {
  await scenario([toolResult([patch, verify])], async (result) => {
    assert.equal(result.status, 'tool_limit_reached');
    assert.equal(result.validationPassed, false);
  }, { maxToolCalls: 1 });
});

test('stops on a truncated final response or provider error', async () => {
  await scenario([{ content: [{ type: 'text', text: 'Partial' }], stop_reason: 'max_tokens' }], async (result) => assert.equal(result.status, 'incomplete'));
  await scenario([new ModelError('Provider stopped')], async (result) => assert.equal(result.status, 'failed'));
});

test('failed turns preserve structured errors in results, events and ledger without an onText observer', async () => {
  await scenario([new ModelError('Context budget reached', undefined,
    { code: 'MODEL_CONTEXT_LIMIT', submitted: false, budget: { estimatedInputTokens: 30091, inputLimit: 24576 } })], async result => {
    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'MODEL_CONTEXT_LIMIT');
    assert.equal(result.error.requestSubmitted, false);
    assert.equal(result.error.budget.inputLimit, 24576);
    assert.deepEqual(result.summary.error, result.error);
    const rows = (await readFile(path.join(result.runDirectory, 'ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.find(r => r.type === 'agent_error').error, result.error);
    assert.deepEqual(rows.at(-1).error, result.error);
  });
});

test('throwing presentation callbacks cannot hide a failed request or its error record', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-error-observer-'));
  try {
    const events = [];
    const result = await runTask('Inspect source', loadConfig({ workspace: root, runId: 'observer', compaction: 'off' }, {}), {
      onText: () => { throw new Error('UI failed'); },
      onEvent: event => { events.push(event); },
      adapterFactory: () => ({ complete: async () => { throw new ModelError('Local context limit', undefined,
        { code: 'MODEL_CONTEXT_LIMIT', submitted: false }); } }),
    });
    assert.equal(result.status, 'failed');
    assert.deepEqual(events.find(e => e.type === 'agent_error').error, result.error);
    assert.deepEqual(events.at(-1).error, result.error);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a failed request keeps unknown billing and structured diagnostics in a transient session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-error-billing-'));
  try {
    const { createAgentSession } = await import('../src/agent.mjs');
    const config = loadConfig({ workspace: root, runId: 'unknown-error', compaction: 'off' }, {});
    const session = createAgentSession(config); let calls = 0;
    const result = await runTask('Inspect source', config, { session, adapterFactory: () => ({ complete: async function () {
      calls++;
      await this.onRequest({ requestId: 'unknown', payload: {}, usage: {}, usageStatus: 'unknown', error: 'transport lost' });
      throw new ModelError('transport lost', undefined, { submitted: true });
    } }) });
    assert.equal(calls, 1); assert.equal(session.budgetUnknown, true);
    assert.equal(result.error.requestSubmitted, true);
    assert.equal(result.summary.unknownUsageRequests, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('live runtime still requires credentials', async () => {
  await assert.rejects(runTask('task', loadConfig({}, {})), /API_KEY/);
});

test('compact history leaves short runtime payloads unchanged and reports no provider tokens', async () => {
  await scenario([toolResult([{ name: 'read_file', input: { path: 'value.mjs' } }]), toolResult([patch, verify])], async (result) => {
    assert.equal(result.status, 'completed');
    assert.equal(result.contextDiagnostics.sentRequestPayloadBytes, result.contextDiagnostics.fullRequestPayloadBytes);
    assert.equal(result.contextDiagnostics.compactedResultOccurrences, 0);
    assert.equal(result.summary.totalActualTokens, null);
  }, { historyStrategy: 'compact-tools' });
});

test('compresses old successful logs in actual agent requests while retaining read evidence and validation', async () => {
  const read = { name: 'read_file', input: { path: 'value.mjs' } };
  const verboseVerify = { name: 'run_tests', input: { command: 'node --test verbose.test.mjs' } };
  const steps = [toolResult([read, patch]), ...Array.from({ length: 6 }, () => toolResult([verboseVerify]))];
  await scenario(steps, async (result, root, captured) => {
    assert.equal(result.status, 'completed');
    assert.equal(result.validationAttempts, 6);
    assert.equal(result.validationPassed, true);
    assert.ok(result.contextDiagnostics.compactedResultOccurrences > 0);
    assert.ok(result.contextDiagnostics.sentRequestPayloadBytes < result.contextDiagnostics.fullRequestPayloadBytes);
    const last = captured.at(-1);
    const allResults = last.flatMap((message) => Array.isArray(message.content) ? message.content.filter((block) => block.type === 'tool_result') : []);
    assert.ok(allResults.some((block) => String(block.content).includes('export const value = 1')));
    assert.equal(result.summary.totalActualTokens, null);
    assert.deepEqual(result.summary.contextDiagnostics, result.contextDiagnostics);
    const rows = (await readFile(path.join(result.runDirectory, 'ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).filter((row) => row.type === 'context_request');
    assert.equal(rows.length, result.contextDiagnostics.requestCount);
    assert.ok(rows.every((row) => row.sentPayloadBytes <= row.fullPayloadBytes));
  }, { historyStrategy: 'compact-tools', verbose: true });
});

// Scripted responses test orchestration, not real model accuracy or token savings.
test('completion review runs once after validation and keeps the public evidence checklist', async () => {
  await scenario([toolResult([patch, verify])], async (result, root, captured) => {
    assert.equal(result.status, 'completed');
    assert.equal(result.validationPassed, true);
    const reviews = captured.at(-1).filter(m => typeof m.content === 'string' && m.content.startsWith('Completion review'));
    assert.equal(reviews.length, 1);
    assert.match(reviews[0].content, /fixtures pre-created/);
    assert.match(reviews[0].content, /rather than implementation helpers/);
    assert.equal(captured.length, 3);
  }, { completionReview: true });
});

test('review repairs invalidate validation and do not trigger another review', async () => {
  await scenario([toolResult([patch, verify]),
    { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' },
    toolResult([{ name: 'apply_patch', input: { path: 'value.mjs', search: 'value = 2', replace: 'value = 3' } }])], async result => {
      assert.equal(result.status, 'needs_validation');
      assert.equal(result.validationPassed, false);
    }, { completionReview: true });
});

test('review does not spend an extra request on unchanged or unvalidated work', async () => {
  await scenario([], async (result, root, captured) => assert.equal(captured.length, 1), { completionReview: true });
  await scenario([toolResult([patch])], async (result, root, captured) => {
    assert.equal(result.status, 'needs_validation');
    assert.ok(!captured.flat().some(m => typeof m.content === 'string' && m.content.startsWith('Completion review')));
  }, { completionReview: true });
});

test('completion review configuration is explicit and disabled by default', () => {
  assert.equal(loadConfig({}, {}).completionReview, false);
  assert.equal(loadConfig({}, { TEA_COMPLETION_REVIEW: '1' }).completionReview, true);
  assert.equal(loadConfig({ completionReview: false }, { TEA_COMPLETION_REVIEW: '1' }).completionReview, false);
});
