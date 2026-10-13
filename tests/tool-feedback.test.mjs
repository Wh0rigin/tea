import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runtimeCapabilities, capabilityNotice, ToolFeedbackError, toolFailureFeedback, appendFailureFeedback } from '../src/tool-feedback.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { createAgentSession, runTask, resetConversation } from '../src/agent.mjs';
import { loadConfig } from '../src/config.mjs';

const unavailable = { platform: 'win32', stdinIsTTY: false, stdoutIsTTY: false };
const done = { content: [{ type: 'text', text: 'Finished.' }], stop_reason: 'end_turn' };
const calls = (items, thinking = false) => ({ content: [
  ...(thinking ? [{ type: 'thinking', thinking: 'preserved thought', signature: 'preserved-signature' }] : []),
  ...items.map((item, index) => ({ type: 'tool_use', id: `call-${index}`, ...item })),
], stop_reason: 'tool_use' });
function adapter(steps = [done], captured = []) {
  return () => ({ complete: async request => { captured.push(structuredClone(request)); return steps.shift() || done; } });
}
async function fixture({ persistent = false, policy = 'full-history' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-feedback-'));
  await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'value.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('value',()=>assert.equal(value,3));\n");
  const config = { ...loadConfig({ workspace: root, runId: 'feedback', memoryPolicy: policy }, {}), capabilityFeedback: true, ...(persistent ? { sessionId: 'feedback-session' } : {}) };
  return { root, config };
}
const notices = captured => JSON.stringify(captured.messages).match(/Runtime capabilities v1-/g)?.length || 0;

test('capability identity is stable and changes only for platform, policy or approval availability', () => {
  const a = runtimeCapabilities(unavailable), b = runtimeCapabilities({ ...unavailable });
  assert.deepEqual(a, b); assert.match(a.version, /^v1-[a-f0-9]{12}$/);
  for (const change of [{ platform: 'linux' }, { stdinIsTTY: true, stdoutIsTTY: true }, { approveCommand: () => false }]) {
    assert.notEqual(runtimeCapabilities({ ...unavailable, ...change }).version, a.version);
  }
  assert.equal(runtimeCapabilities({ ...unavailable, approveCommand: () => true }).version,
    runtimeCapabilities({ ...unavailable, approveCommand: () => false }).version);
});

test('S1 is explicitly opt-in and disabled by default', () => {
  assert.equal(loadConfig({}, {}).capabilityFeedback, false);
  assert.equal(loadConfig({}, { TEA_CAPABILITY_FEEDBACK: '0' }).capabilityFeedback, false);
  assert.equal(loadConfig({}, { TEA_CAPABILITY_FEEDBACK: '1' }).capabilityFeedback, true);
});

test('disabled S1 preserves parent requests except the explicit E1 compact evidence header', async () => {
  const { root, config } = await fixture();
  const requests = [];
  const steps = () => [calls([{ name: 'read_file', input: { path: 'value.mjs' } }, { name: 'run_shell', input: { command: 'node --version' } }]), done];
  const disabled = { ...config, capabilityFeedback: false };
  const current = await runTask('Inspect value', { ...disabled, runId: 'current' }, { approveCommand: () => false, adapterFactory: adapter(steps(), requests) });
  const payloads = list => list.map(({ system, messages, tools }) => ({ system, messages, tools }));
  const normalize = value => typeof value === 'string' ? value.replaceAll(root, '[WORKSPACE]')
    : Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v)])) : value;
  const baseline = JSON.parse(await readFile(new URL('./fixtures/s1-default-parent-requests.json', import.meta.url), 'utf8'));
  assert.equal(baseline.parentCommit, 'c97b950797294f48e31752508af11a80814e66d8');
  const expected = structuredClone(baseline.requests);
  for (const request of expected) for (const message of request.messages) {
    if (Array.isArray(message.content)) for (const block of message.content) {
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        block.content = block.content.replace(/^(\[evidence ref=[^\n]+) sha256=[a-f0-9]{64}\]/, '$1]');
      }
    }
  }
  assert.deepEqual(normalize(payloads(requests)), expected);
  assert.equal(notices(requests[0]), 0); assert.equal(requests[1].messages.at(-1).content[1].is_error, false);
  assert.deepEqual([current.status, current.toolCalls, current.validationPassed], baseline.outcome);
});

test('capability notices describe headless/interactive Windows and other platforms without granting runners', () => {
  const windows = capabilityNotice(runtimeCapabilities(unavailable));
  assert.match(windows, /cannot obtain approval/); assert.match(windows, /including quoted JavaScript/);
  assert.match(windows, /Windows allowlisted commands/); assert.match(windows, /Installed runners depend on the project/);
  const interactive = capabilityNotice(runtimeCapabilities({ ...unavailable, stdinIsTTY: true, stdoutIsTTY: true }));
  assert.match(interactive, /needs explicit approval/); assert.doesNotMatch(interactive, /cannot obtain approval/);
  assert.doesNotMatch(capabilityNotice(runtimeCapabilities({ ...unavailable, platform: 'linux' })), /Windows allowlisted/);
});

test('failure categories distinguish policy, approval, input, source, tests and transient execution', () => {
  for (const code of ['CAPABILITY_DENIED', 'APPROVAL_UNAVAILABLE', 'INPUT_INVALID', 'SOURCE_MISMATCH']) {
    const result = toolFailureFeedback({ error: new ToolFeedbackError(code, 'failure') });
    assert.equal(result.code, code); assert.equal(result.retryable, false); assert.ok(result.missingCapability && result.next);
  }
  assert.equal(toolFailureFeedback({ output: 'Command denied by user.' }).code, 'APPROVAL_DENIED');
  assert.equal(toolFailureFeedback({ output: 'exit=1\nfailure', validation: true }).code, 'VALIDATION_FAILED');
  assert.equal(toolFailureFeedback({ output: 'exit=1\nfailure', validation: false }).code, 'EXECUTION_FAILED');
  assert.equal(toolFailureFeedback({ error: Object.assign(new Error('not found'), { code: 'ENOENT' }), toolName: 'read_file' }).code, 'INPUT_INVALID');
  assert.equal(toolFailureFeedback({ error: Object.assign(new Error('not found'), { code: 'ENOENT' }), toolName: 'run_tests' }).code, 'EXECUTABLE_UNAVAILABLE');
  assert.equal(toolFailureFeedback({ error: new Error('Command timed out after 10 ms') }).retryable, true);
  assert.equal(toolFailureFeedback({ error: new Error('Command cancelled') }).retryable, false);
  assert.equal(toolFailureFeedback({ output: 'exit=0\npassed' }), null);
  assert.equal(appendFailureFeedback('unchanged', null), 'unchanged');
});

test('policy still blocks before approval and approved unlisted commands retain explicit authorization', async () => {
  const { root } = await fixture(), tools = new WorkspaceTools({ workspace: root }); await tools.init();
  let approvals = 0; tools.approveCommand = () => { approvals++; return true; };
  for (const command of ['node -e "x=>x;"', 'git reset --hard']) {
    await assert.rejects(tools.runShell({ command }), e => e.feedbackCode === 'CAPABILITY_DENIED');
  }
  assert.equal(approvals, 0);
  assert.match(await tools.runShell({ command: 'node --version' }), /^exit=0\b/); assert.equal(approvals, 1);
  tools.approveCommand = () => false;
  assert.equal(await tools.runShell({ command: 'node --version' }), 'Command denied by user.');
});

test('input/source categories retain path, secret and unique patch restrictions', async () => {
  const { root } = await fixture(), tools = new WorkspaceTools({ workspace: root }); await tools.init();
  await writeFile(path.join(root, '.env'), 'not-a-credential');
  await assert.rejects(tools.resolveFile(root), e => e.feedbackCode === 'INPUT_INVALID');
  await assert.rejects(tools.resolveFile('../outside', { mustExist: false }), e => e.feedbackCode === 'CAPABILITY_DENIED');
  await assert.rejects(tools.readFile({ path: '.env' }), e => e.feedbackCode === 'CAPABILITY_DENIED');
  await assert.rejects(tools.runTests({ command: 42 }), e => e.feedbackCode === 'INPUT_INVALID');
  await assert.rejects(tools.applyPatch({ path: 'value.mjs', search: 'absent', replace: 'different' }), e => e.feedbackCode === 'SOURCE_MISMATCH');
});

test('unchanged capabilities are announced once per conversation and never mutate tool definitions', async () => {
  const { config } = await fixture(), session = createAgentSession(config), captured = [];
  await runTask('Inspect', config, { session, adapterFactory: adapter([done, done], captured) });
  await runTask('Continue', { ...config, runId: 'feedback-next' }, { session, adapterFactory: adapter() });
  assert.equal(captured.length, 2); assert.equal(notices(captured[0]), 1); assert.equal(notices(captured[1]), 1);
  assert.deepEqual(captured[0].tools, captured[1].tools);
  resetConversation(session);
  await runTask('New task', { ...config, runId: 'feedback-new' }, { session, adapterFactory: adapter() });
  assert.equal(notices(captured[2]), 1);
});

test('persistent resume restores capabilities and announces changed approval once without rewriting old messages', async () => {
  const { config } = await fixture({ persistent: true });
  const first = createAgentSession(config), captured = [];
  await runTask('Inspect', config, { session: first, adapterFactory: adapter([done], captured) });
  const snapshot = structuredClone(first.messages), oldVersion = first.capabilities.version;
  const next = { ...config, sessionId: undefined, resume: 'feedback-session', runId: 'resume' }, restored = createAgentSession(next), requests = [];
  await runTask('Continue', next, { session: restored, approveCommand: () => false, adapterFactory: adapter([done, done], requests) });
  assert.notEqual(restored.capabilities.version, oldVersion); assert.equal(notices(requests[0]), 2);
  assert.deepEqual(restored.messages.slice(0, snapshot.length), snapshot);
  await runTask('Continue again', { ...next, runId: 'resume-next' }, { session: restored, approveCommand: () => true, adapterFactory: adapter() });
  assert.equal(notices(requests[1]), 2); assert.equal(restored.capabilities.approval, 'handler');
});

test('same-capability resume retains one notice, including ContextOS', async () => {
  for (const policy of ['full-history', 'contextos']) {
    const { config } = await fixture({ persistent: true, policy }), session = createAgentSession(config);
    await runTask('Inspect', config, { session, adapterFactory: adapter() });
    const next = { ...config, sessionId: undefined, resume: 'feedback-session', runId: 'restored' }, captured = [];
    await runTask('Continue', next, { session: createAgentSession(next), adapterFactory: adapter([done], captured) });
    assert.equal(notices(captured[0]), 1);
  }
});

test('failed validation can still be repaired, with signed thinking and matched tool messages preserved', async () => {
  const { root, config } = await fixture(), captured = [], events = [];
  const verify = { name: 'run_tests', input: { command: 'node --test value.test.mjs' } };
  const result = await runTask('Fix value', config, { adapterFactory: adapter([
    calls([{ name: 'apply_patch', input: { path: 'value.mjs', search: 'value = 1', replace: 'value = 2' } }, verify], true),
    calls([{ name: 'apply_patch', input: { path: 'value.mjs', search: 'value = 2', replace: 'value = 3' } }, verify]), done,
  ], captured), onEvent: e => events.push(e) });
  assert.equal(result.status, 'completed'); assert.equal(result.validationPassed, true); assert.equal(result.validationAttempts, 2);
  assert.match(await readFile(path.join(root, 'value.mjs'), 'utf8'), /value = 3/);
  const messages = captured[1].messages;
  assert.deepEqual(messages.find(m => m.role === 'assistant').content[0], { type: 'thinking', thinking: 'preserved thought', signature: 'preserved-signature' });
  const batch = messages.at(-1).content; assert.equal(batch[1].tool_use_id, 'call-1'); assert.equal(batch[1].is_error, true);
  assert.match(batch[1].content, /VALIDATION_FAILED/); assert.match(batch[1].content, /^exit=1\b/);
  assert.equal(events.filter(e => e.type === 'tool_end' && e.isError).length, 1);
});

test('approval denial is failed feedback and never proves validation or changes source', async () => {
  const { root, config } = await fixture(), captured = [];
  const result = await runTask('Inspect', config, { approveCommand: () => false, adapterFactory: adapter([
    calls([{ name: 'run_shell', input: { command: 'node --version' } }]), done,
  ], captured) });
  const response = captured[1].messages.at(-1).content[0];
  assert.equal(response.is_error, true); assert.match(response.content, /^Command denied by user\./); assert.match(response.content, /APPROVAL_DENIED/);
  assert.equal(result.validationPassed, false); assert.equal(result.validationAttempts, 0);
  assert.equal(await readFile(path.join(root, 'value.mjs'), 'utf8'), 'export const value = 1;\n');
});

test('headless unlisted execution reports unavailable approval without validating or executing', async () => {
  const { config } = await fixture(), captured = [];
  assert.equal(Boolean(process.stdin.isTTY && process.stdout.isTTY), false);
  const result = await runTask('Inspect', config, { adapterFactory: adapter([
    calls([{ name: 'run_shell', input: { command: 'node --version' } }]), done,
  ], captured) });
  const response = captured[1].messages.at(-1).content[0];
  assert.equal(response.is_error, true); assert.match(response.content, /APPROVAL_UNAVAILABLE/);
  assert.match(response.content, /"retryable":false/); assert.equal(result.validationPassed, false);
  assert.equal(result.validationAttempts, 0); assert.equal(result.toolCalls, 1);
});
