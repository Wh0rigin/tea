import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContextMemory, validToolProtocol } from '../src/context-assembler.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { loadConfig } from '../src/config.mjs';
import { runTask, createAgentSession } from '../src/agent.mjs';
import { attachSessionJournal, closeSessionJournal } from '../src/session-memory.mjs';

const command = 'node --test value.test.mjs';
const failure = 'exit=1\nFAILED_ASSERTION_ORIGINAL\n' + 'stack trace details\n'.repeat(650);
const pair = (id, output, cmd = command, name = 'run_tests', error = false) => [
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'signed thought', signature: 'sig-' + id }, { type: 'tool_use', id, name, input: { command: cmd } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output, is_error: error }] },
];
const tail = () => [...pair('recent', 'a.mjs', undefined, 'list_files'), ...pair('pass', 'exit=0\n# tests 1\n# pass 1\n')];
async function scenario(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tea-s4-')));
  try {
    const tools = new WorkspaceTools({ workspace: root }); await tools.init();
    const config = { ...loadConfig({ workspace: root, memoryPolicy: 'contextos' }, {}), contextosTargetBytes: 1000000, compactResolvedTests: true };
    await fn({ root, tools, config, memory: new ContextMemory(tools) });
  } finally {
    const target = await realpath(root), rel = path.relative(await realpath(os.tmpdir()), target);
    assert.ok(rel.startsWith('tea-s4-') && !path.isAbsolute(rel) && !rel.includes('..'));
    await rm(target, { recursive: true, force: true });
  }
}
const assemble = (s, messages, overrides = {}, state = {}) => s.memory.assemble({ messages, canonical: messages,
  system: 'fixed system', tools: s.tools.modelToolDefinitions({ includeMemory: false }), config: { ...s.config, ...overrides },
  state: { pendingValidation: false, validationPassed: true, changedFiles: [], ...state } });

test('S4 off preserves error output; on projects exact-command resolved failure and can recall it', async () => scenario(async s => {
  const messages = [{ role: 'user', content: 'Keep this requirement.' }, ...pair('failed', failure, command, 'run_tests', true), ...tail()];
  const original = structuredClone(messages);
  const off = await assemble(s, messages, { compactResolvedTests: false });
  assert.equal(off.diagnostics.evictedUnits, 0);
  const on = await assemble(s, messages);
  assert.ok(on.diagnostics.sentWireBytes < on.diagnostics.fullWireBytes);
  assert.ok(validToolProtocol(on.request.messages));
  assert.doesNotMatch(JSON.stringify(on.request), /FAILED_ASSERTION_ORIGINAL/);
  assert.match(JSON.stringify(on.request), /supersededBy/);
  assert.match(JSON.stringify(on.request), /sig-failed/);
  assert.deepEqual(messages, original);
  const ref = on.diagnostics.units.find(x => x.decision === 'reference').ref;
  assert.match(await s.memory.recall({ ref }), /FAILED_ASSERTION_ORIGINAL/);
  assert.equal(on.request.messages.at(-1).content[0].content, messages.at(-1).content[0].content);
}));

test('S4 retains unresolved, other-command, zero-test and diagnostic successes', async () => scenario(async s => {
  for (const [cmd, output, name] of [
    ['node --test other.test.mjs', 'exit=0', 'run_tests'],
    [command, 'exit=0\n# tests 0\n# pass 0\n', 'run_tests'],
    ['git status', 'exit=0', 'run_tests'],
    [command, 'exit=1\nstill fails', 'run_tests'],
  ]) {
    const messages = [{ role: 'user', content: 'Task' }, ...pair('failed', failure), ...pair('r', 'a', undefined, 'list_files'), ...pair('last', output, cmd, name)];
    assert.match(JSON.stringify((await assemble(s, messages)).request), /FAILED_ASSERTION_ORIGINAL/);
  }
}));

test('S4 retains execution errors and does not match whitespace variants or cross user boundaries', async () => scenario(async s => {
  for (const output of ['Command timed out\n' + failure, 'spawn node ENOENT\n' + failure, 'Command denied by user.\n' + failure]) {
    const messages = [{ role: 'user', content: 'Task' }, ...pair('failed', output, command, 'run_tests', true), ...tail()];
    assert.match(JSON.stringify((await assemble(s, messages)).request), /FAILED_ASSERTION_ORIGINAL/);
  }
  for (const extra of [[{ role: 'user', content: 'Explain the previous failure before continuing.' }], []]) {
    const messages = [{ role: 'user', content: 'Task' }, ...pair('failed', failure, extra.length ? command : command + ' '), ...extra, ...tail()];
    assert.match(JSON.stringify((await assemble(s, messages)).request), /FAILED_ASSERTION_ORIGINAL/);
  }
}));

test('S4 retains recent failures and falls back when retrieval overhead costs more', async () => scenario(async s => {
  for (const [output, recent] of [[failure, 2], ['exit=1\nx', 0]]) {
    const messages = [{ role: 'user', content: 'Task' }, ...pair('failed', output), ...pair('pass', 'exit=0\n# tests 1\n# pass 1\n')];
    const plan = await assemble(s, messages, { contextosKeepRecent: recent });
    assert.equal(plan.diagnostics.evictedUnits, 0);
    assert.deepEqual(plan.request.messages, messages);
    assert.equal(plan.request.tools.some(x => x.name === 'recall_context'), false);
  }
}));

test('S4 never hides a later regression and retains pending runtime obligations', async () => scenario(async s => {
  const messages = [{ role: 'user', content: 'Task' }, ...pair('failed', failure), ...tail(), ...pair('regression', 'exit=1\nLATEST_FAILURE'), ...pair('r2', 'a', undefined, 'list_files'), ...pair('r3', 'b', undefined, 'list_files')];
  const plan = await assemble(s, messages, {}, { pendingValidation: true, validationPassed: false, changedFiles: ['value.mjs'] });
  assert.match(JSON.stringify(plan.request), /LATEST_FAILURE/);
  assert.match(plan.request.system, /pending=true; passed=false/);
  assert.match(plan.request.system, /value.mjs/);
}));

test('S4 preserves complete mixed tool batches and learns resolution through validation run_shell', async () => scenario(async s => {
  const first = pair('failed', failure, command, 'run_shell', true);
  first[0].content.push({ type: 'tool_use', id: 'other', name: 'read_file', input: { path: 'missing' } });
  first[1].content.push({ type: 'tool_result', tool_use_id: 'other', content: 'UNRESOLVED_MISSING_FILE', is_error: true });
  const messages = [{ role: 'user', content: 'Task' }, ...first, ...tail()];
  const plan = await assemble(s, messages);
  assert.ok(validToolProtocol(plan.request.messages));
  assert.match(JSON.stringify(plan.request), /UNRESOLVED_MISSING_FILE/);
  assert.doesNotMatch(JSON.stringify(plan.request), /FAILED_ASSERTION_ORIGINAL/);
}));

test('S4 actual execution, encrypted journal and resume keep original failure and validation', async () => scenario(async s => {
  await writeFile(path.join(s.root, 'value.mjs'), 'export const value = 1;\n');
  await writeFile(path.join(s.root, 'value.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('value',()=>{if(value!==2)for(let n=0;n<80;n++)console.log('TRACE_ORIGINAL '+n+' '+'.'.repeat(80));assert.equal(value,2)});\n");
  const config = { ...s.config, runId: 's4-runtime', compaction: 'off', maxToolCalls: 12 };
  const session = createAgentSession(config), captured = [];
  const steps = [
    [{ name: 'run_tests', input: { command } }],
    [{ name: 'read_file', input: { path: 'value.mjs' } }],
    [{ name: 'apply_patch', input: { path: 'value.mjs', search: 'value = 1', replace: 'value = 2' } }],
    [{ name: 'run_tests', input: { command } }],
  ];
  let serial = 0;
  const adapterFactory = () => ({ complete: async request => {
    captured.push(structuredClone(request)); const calls = steps.shift();
    return { content: calls ? calls.map(call => ({ type: 'tool_use', id: 'actual-' + ++serial, ...call })) : [{ type: 'text', text: 'Verified.' }], stop_reason: calls ? 'tool_use' : 'end_turn' };
  } });
  const result = await runTask('Repair value without changing tests.', config, { session, adapterFactory });
  assert.equal(result.status, 'completed'); assert.equal(result.validationPassed, true); assert.equal(result.validationAttempts, 2);
  assert.doesNotMatch(JSON.stringify(captured.at(-1)), /TRACE_ORIGINAL/);
  assert.match(JSON.stringify(session.messages), /TRACE_ORIGINAL/);
  const resumeConfig = { ...config, resume: session.sessionId }, restored = createAgentSession(resumeConfig);
  await attachSessionJournal(restored, resumeConfig);
  try {
    assert.match(JSON.stringify(restored.messages), /TRACE_ORIGINAL/);
    assert.equal(restored.validationPassed, true);
    assert.equal(restored.pendingValidation, false);
  } finally { await closeSessionJournal(restored); }
  assert.doesNotMatch(await readFile(path.join(s.root, '.tea/sessions', session.sessionId, 'journal.jsonl'), 'utf8'), /TRACE_ORIGINAL/);
}));
