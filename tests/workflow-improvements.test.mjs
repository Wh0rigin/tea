import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceTools, TOOL_DEFINITIONS } from '../src/tools.mjs';
import { buildSystemPrompt } from '../src/prompts.mjs';
import { runTask, createAgentSession, resetConversation } from '../src/agent.mjs';
import { loadConfig } from '../src/config.mjs';
import { attachSessionJournal, closeSessionJournal, inspectSession } from '../src/session-memory.mjs';
import { sessionContext } from '../src/compaction.mjs';
import { collectCompactedHistory } from '../src/memory-gc.mjs';
import { observeValidation, validationCommandKey } from '../src/validation.mjs';
import { TerminalView } from '../src/terminal.mjs';

async function temporary(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-workflow-'));
  try { await fn(root); }
  finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('tea-workflow-'));
    await rm(root, { recursive: true, force: true });
  }
}

test('prompt guidance follows available tools and describes batching and failure coverage', () => {
  const prompt = buildSystemPrompt(TOOL_DEFINITIONS);
  assert.match(prompt, /coherent set of edits/);
  assert.match(prompt, /Batch disjoint changes/);
  assert.match(prompt, /narrower pass cannot clear/);
  assert.match(prompt, /Preserve unrelated user changes/);
  assert.equal(buildSystemPrompt([...TOOL_DEFINITIONS, ...TOOL_DEFINITIONS]), prompt);
  const readOnly = buildSystemPrompt(TOOL_DEFINITIONS.filter(tool => tool.name === 'read_file'));
  assert.match(readOnly, /read_file/);
  assert.doesNotMatch(readOnly, /apply_patch|write_file|Finish a coherent/);
});

test('batch replacements use original positions, not preceding replacement output', async () => temporary(async root => {
  await writeFile(path.join(root, 'a.txt'), 'alpha\r\nbeta\r\n尾部😀\r\n');
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  assert.equal(await tools.applyPatch({ path: 'a.txt', edits: [
    { search: 'beta', replace: 'gamma' }, { search: 'alpha', replace: 'beta' },
  ] }), 'Updated a.txt');
  assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'beta\r\ngamma\r\n尾部😀\r\n');
}));

for (const [name, edits, code] of [
  ['missing later span', [{ search: 'abc', replace: 'X' }, { search: 'missing', replace: 'Y' }], 'PATCH_NOT_FOUND'],
  ['ambiguous later span', [{ search: 'abc', replace: 'X' }, { search: 'd', replace: 'Y' }], 'PATCH_AMBIGUOUS'],
  ['overlapping spans', [{ search: 'abc', replace: 'X' }, { search: 'bc', replace: 'Y' }], 'PATCH_OVERLAP'],
]) {
  test(`batch refuses ${name} without partial edits`, async () => temporary(async root => {
    const original = 'abc dd\n'; await writeFile(path.join(root, 'a.txt'), original);
    const tools = new WorkspaceTools({ workspace: root }); await tools.init();
    await assert.rejects(tools.applyPatch({ path: 'a.txt', edits }), error => error.feedbackCode === code);
    assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), original);
  }));
}

test('overlapping occurrences of one search are also ambiguous', async () => temporary(async root => {
  await writeFile(path.join(root, 'a.txt'), 'aaa');
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  await assert.rejects(tools.applyPatch({ path: 'a.txt', search: 'aa', replace: 'x' }), error => error.feedbackCode === 'PATCH_AMBIGUOUS');
  assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'aaa');
}));

test('patch input rejects mixed forms, malformed entries, empty and oversized batches', async () => temporary(async root => {
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  const valid = { search: 'a', replace: 'b' };
  for (const input of [
    { edits: [] }, { edits: Array(33).fill(valid) }, { edits: [null] }, { edits: Array(1) },
    { edits: [{ search: '', replace: 'b' }] }, { edits: [{ ...valid, extra: true }] },
    { edits: [valid], search: 'a' }, { edits: [valid], ...valid }, { search: 'a' },
  ]) await assert.rejects(tools.applyPatch({ path: 'a.txt', ...input }), error => error.feedbackCode === 'INPUT_INVALID');
}));

test('batch approvals include all immutable changes once and preserve deny rules', async () => temporary(async root => {
  await writeFile(path.join(root, 'a.txt'), 'alpha beta');
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  tools.setEditPermissions({ ask: ['a.txt'] }); let approvals = 0;
  tools.approveEdit = event => {
    approvals++; assert.equal(event.change.edits.length, 2);
    assert(Object.isFrozen(event.change.edits)); assert(Object.isFrozen(event.change.edits[0]));
    assert.throws(() => { event.change.edits[0].replace = 'tampered'; }); return true;
  };
  await tools.applyPatch({ path: 'a.txt', edits: [{ search: 'alpha', replace: 'A' }, { search: 'beta', replace: 'B' }] });
  assert.equal(approvals, 1); assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'A B');
  tools.setEditPermissions({ deny: ['a.txt'] });
  await assert.rejects(tools.applyPatch({ path: 'a.txt', edits: [{ search: 'A', replace: 'C' }] }), /blocked by policy/);
  assert.equal(approvals, 1); assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'A B');
}));

test('manual changes during approval are retained instead of overwritten', async () => temporary(async root => {
  const file = path.join(root, 'a.txt'); await writeFile(file, 'original');
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  tools.setEditPermissions({ ask: ['a.txt'] });
  tools.approveEdit = async () => { await writeFile(file, 'manual change'); return true; };
  await assert.rejects(tools.applyPatch({ path: 'a.txt', edits: [{ search: 'original', replace: 'agent change' }] }), error => error.feedbackCode === 'SOURCE_MISMATCH');
  assert.equal(await readFile(file, 'utf8'), 'manual change');
}));

test('invalid or oversized replacement output never modifies the file', async () => temporary(async root => {
  const file = path.join(root, 'a.txt'); await writeFile(file, 'original');
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  for (const replace of ['\0', '\ud800', 'x'.repeat(160001)]) {
    await assert.rejects(tools.applyPatch({ path: 'a.txt', search: 'original', replace }), error => error.feedbackCode === 'INPUT_INVALID');
    assert.equal(await readFile(file, 'utf8'), 'original');
  }
}));

test('terminal patch previews show batched edits and bound the default preview', () => {
  let output = '';
  const view = new TerminalView({ write: chunk => { output += chunk; }, isTTY: false }, loadConfig({}, {}));
  view.event({ type: 'tool_end', name: 'apply_patch', input: { path: 'a.txt', edits: [
    { search: 'first', replace: 'ONE' }, { search: 'second', replace: 'TWO' },
    { search: 'third', replace: 'THREE' }, { search: 'fourth', replace: 'FOUR' },
  ] }, output: 'Updated a.txt', elapsedMs: 1 });
  assert.match(output, /- first/); assert.match(output, /\+ TWO/);
  assert.match(output, /1 more replacements/); assert.doesNotMatch(output, /\+ FOUR|undefined/);
});

test('command identity follows parsed argv without conflating different scopes or quoted spaces', () => {
  assert.equal(validationCommandKey('node   --test "a.test.mjs"'), validationCommandKey('node --test a.test.mjs'));
  assert.notEqual(validationCommandKey('node --test'), validationCommandKey('node --test a.test.mjs'));
  assert.notEqual(validationCommandKey('node --test "a  b"'), validationCommandKey('node --test "a b"'));
  let state = observeValidation({}, 'node --test', 'exit=1\nfailed');
  state = observeValidation(state, 'node --test a.test.mjs', 'exit=0\n# pass 1');
  assert.equal(state.validationPassed, false); assert.equal(state.validationFailures.length, 1);
  state = observeValidation(state, 'node  --test', 'exit=0\n# pass 2');
  assert.deepEqual(state, { validationPassed: true, pendingValidation: false, validationFailures: [] });
});

test('each failing command remains outstanding independently, including zero-test results', () => {
  let state = observeValidation({}, 'node --test a.test.mjs', 'exit=1');
  state = observeValidation(state, 'node --test b.test.mjs', 'exit=0\n# tests 0\n# pass 0\n');
  state = observeValidation(state, 'node --test a.test.mjs', 'exit=0\n# pass 1\n');
  assert.equal(state.pendingValidation, true); assert.equal(state.validationFailures.length, 1);
  assert.equal(state.validationFailures[0].command, 'node --test b.test.mjs');
  assert.equal(observeValidation(state, 'node --test b.test.mjs', 'exit=0\n# pass 1', true).pendingValidation, true);
});

let serial = 0;
const done = { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' };
const call = (name, input) => ({ name, input });
const calls = list => ({ content: list.map(item => ({ type: 'tool_use', id: `workflow-${++serial}`, ...item })), stop_reason: 'tool_use' });
const broad = call('run_tests', { command: 'node --test broad.test.mjs narrow.test.mjs' });
const narrow = call('run_tests', { command: 'node --test narrow.test.mjs' });
const patch = call('apply_patch', { path: 'value.mjs', search: 'value = 1', replace: 'value = 2' });
const factory = (steps, captured = []) => () => ({ complete: async request => { captured.push(structuredClone(request)); return steps.shift() || done; } });
async function codingFixture(root) {
  await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'broad.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('broad',()=>assert.equal(value,2));\n");
  await writeFile(path.join(root, 'narrow.test.mjs'), "import test from 'node:test';test('unrelated pass',()=>{});\n");
  return loadConfig({ workspace: root, runId: 'workflow', compaction: 'off' }, {});
}

test('real broad failure plus narrow pass cannot finish, even without edits', async () => temporary(async root => {
  const config = await codingFixture(root), captured = [];
  const result = await runTask('Check the workspace', config, { adapterFactory: factory([calls([broad, narrow])], captured) });
  assert.equal(result.status, 'needs_validation'); assert.equal(result.validationPassed, false);
  assert.equal(result.validationFailures.length, 1);
  assert.match(JSON.stringify(captured.at(-1).messages), /Rerun unresolved commands/);
}));

test('fixing source then repeating the full failing command permits completion', async () => temporary(async root => {
  const config = await codingFixture(root);
  const result = await runTask('Fix and verify', config, { adapterFactory: factory([calls([broad, narrow]), calls([patch, broad])]) });
  assert.equal(result.status, 'completed'); assert.equal(result.validationPassed, true);
  assert.deepEqual(result.validationFailures, []); assert.equal(result.validationAttempts, 3);
}));

test('scripted same-file batching removes a model round with identical validated source', async () => {
  const observations = [];
  for (const batch of [false, true]) await temporary(async root => {
    const config = await codingFixture(root), captured = [];
    await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n// old label\n');
    const label = call('apply_patch', { path: 'value.mjs', search: '// old label', replace: '// new label' });
    const read = call('read_file', { path: 'value.mjs' });
    const edits = [patch.input, label.input].map(({ search, replace }) => ({ search, replace }));
    const steps = batch
      ? [calls([read]), calls([call('apply_patch', { path: 'value.mjs', edits }), broad])]
      : [calls([read]), calls([patch]), calls([label, broad])];
    const result = await runTask('Update value and label, then validate', config, { adapterFactory: factory(steps, captured) });
    assert.equal(result.status, 'completed'); assert.equal(result.validationPassed, true);
    assert.equal(await readFile(path.join(root, 'value.mjs'), 'utf8'), 'export const value = 2;\n// new label\n');
    observations.push({ requests: captured.length, tools: result.toolCalls });
  });
  assert.deepEqual(observations, [{ requests: 4, tools: 4 }, { requests: 3, tools: 3 }]);
});

test('failed checks survive resume and /new until the same command passes', async () => temporary(async root => {
  const config = { ...await codingFixture(root), sessionId: 'workflow-session' };
  await runTask('Check', config, { adapterFactory: factory([calls([broad])]) });
  const next = { ...config, sessionId: undefined, resume: 'workflow-session', runId: 'resumed' };
  const session = createAgentSession(next);
  const result = await runTask('Check a subset', next, { session, adapterFactory: factory([calls([narrow])]) });
  assert.equal(result.status, 'needs_validation'); assert.equal(session.validationFailures.length, 1);
  await resetConversation(session, next);
  assert.equal(session.validationFailures.length, 1); assert.equal(session.pendingValidation, true);
  const inspection = await inspectSession(next, 'workflow-session'); assert.equal(inspection.validationFailures.length, 1);
  // Start a new adapter only for a new process/session, just as a real resume.
  const finalConfig = { ...next, runId: 'repaired' }, finalSession = createAgentSession(finalConfig);
  const repaired = await runTask('Repair', finalConfig, { session: finalSession, adapterFactory: factory([calls([patch, broad])]) });
  assert.equal(repaired.status, 'completed'); assert.deepEqual(repaired.validationFailures, []);
}));

test('compaction state and a durable GC checkpoint retain unresolved checks', async () => temporary(async root => {
  const config = { ...await codingFixture(root), sessionId: 'workflow-gc', memoryGc: 'auto' };
  const session = createAgentSession(config);
  await runTask('Check', config, { session, adapterFactory: factory([calls([broad])]) });
  session.compaction = { firstKeptIndex: 2, summary: 'Historical summary claims success.' };
  assert.match(JSON.stringify(sessionContext(session)), /unresolvedValidationCommands/);
  await attachSessionJournal(session, config);
  try { assert.equal((await collectCompactedHistory(session, config)).status, 'collected'); }
  finally { await closeSessionJournal(session); }
  const resumedConfig = { ...config, sessionId: undefined, resume: 'workflow-gc', runId: 'after-gc' };
  const restored = createAgentSession(resumedConfig);
  await attachSessionJournal(restored, resumedConfig);
  try {
    assert.equal(restored.validationFailures.length, 1); assert.equal(restored.pendingValidation, true);
    assert.equal(restored.validationPassed, false);
    assert.match(JSON.stringify(sessionContext(restored)), /node --test broad.test.mjs narrow.test.mjs/);
  } finally { await closeSessionJournal(restored); }
}));
