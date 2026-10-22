import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceTools } from '../src/tools.mjs';
import { observeValidation, validationRunnerUnavailable, validationSucceeded, invalidateUnavailableValidation } from '../src/validation.mjs';
import { runTask, createAgentSession, resetConversation } from '../src/agent.mjs';
import { loadConfig } from '../src/config.mjs';
import { attachSessionJournal, closeSessionJournal, inspectSession } from '../src/session-memory.mjs';
import { collectCompactedHistory } from '../src/memory-gc.mjs';
import { sessionContext } from '../src/compaction.mjs';
import { buildSystemPrompt } from '../src/prompts.mjs';
import { toolFailureFeedback } from '../src/tool-feedback.mjs';

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-repair-'));
  try { await fn(root); }
  finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('tea-repair-'));
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
const missing = 'exit=1\nstdout:\n\nstderr:\n/usr/bin/python: No module named pytest\n';
const unitPass = 'exit=0\nstdout:\n\nstderr:\n.\nRan 1 test in 0.001s\n\nOK\n';
const pytest = 'python -m pytest tests -q';
const unittest = 'python -m unittest discover -s tests -q';

test('a nonempty alternative resolves only runner blockage and preserves the unavailable-check limitation', () => {
  let state = observeValidation({}, pytest, missing);
  assert.equal(state.pendingValidation, true); assert.deepEqual(state.validationFailures, []);
  assert.equal(state.validationUnavailable[0].command, pytest);
  state = observeValidation(state, unittest, unitPass);
  assert.equal(state.validationPassed, true);
  assert.equal(state.validationUnavailable[0].alternativeCommand, unittest);
  state = observeValidation(state, pytest, 'exit=0\n1 passed in 0.01s');
  assert.deepEqual(state.validationUnavailable, []);
});

test('an unavailable runner never erases an earlier source failure with the same command', () => {
  let state = observeValidation({}, pytest, 'exit=1\n1 failed');
  state = observeValidation(state, pytest, missing);
  state = observeValidation(state, unittest, unitPass);
  assert.equal(state.validationPassed, false); assert.equal(state.validationFailures.length, 1);
});

for (const [label, output] of [
  ['test import error', 'exit=1\nstdout:\n\nstderr:\nTraceback (most recent call last):\nModuleNotFoundError: No module named pytest\n'],
  ['application import error', 'exit=1\nstdout:\n\nstderr:\n/usr/bin/python: No module named application\n'],
  ['assertion with a missing-runner string', missing.replace('stdout:\n\n', 'stdout:\n1 failed\n')],
]) test(`${label} is not classified as runner startup failure`, () => {
  assert.equal(validationRunnerUnavailable(pytest, output), false);
  assert.equal(observeValidation({}, pytest, output).validationFailures.length, 1);
});

for (const output of ['exit=0\nRan 0 tests in 0.00s\n\nOK', 'exit=0\nno tests ran', 'exit=0\n# tests 0\n# pass 0', 'exit=0\nRan 1 test in 0.00s\n\nOK (skipped=1)']) {
  test(`zero-test success remains blocked: ${output.split('\n')[1]}`, () => {
    assert.equal(validationSucceeded(output), false);
    const state = observeValidation(observeValidation({}, pytest, missing), unittest, output);
    assert.equal(state.pendingValidation, true);
    assert.equal(state.validationUnavailable[0].alternativeCommand, undefined);
  });
}

test('lint, empty output and a different language cannot supersede a missing Python test runner', () => {
  for (const [command, output] of [['npm run lint', 'exit=0'], [unittest, 'exit=0'], ['node --test', 'exit=0\n# pass 1\n']]) {
    assert.equal(observeValidation(observeValidation({}, pytest, missing), command, output).pendingValidation, true);
  }
});

test('structured executable absence is environmental; a policy denial remains blocking', () => {
  const unavailable = Object.assign(new Error('absent'), { feedbackCode: 'EXECUTABLE_UNAVAILABLE', code: 'ENOENT' });
  const denied = Object.assign(new Error('denied'), { feedbackCode: 'COMMAND_POLICY_DENIED' });
  assert.equal(observeValidation({}, pytest, 'absent', true, unavailable).validationUnavailable.length, 1);
  const state = observeValidation(observeValidation({}, pytest, 'denied', true, denied), unittest, unitPass);
  assert.equal(state.pendingValidation, true); assert.equal(state.validationFailures.length, 1);
  const feedback = toolFailureFeedback({ output: missing, validation: true, runnerUnavailable: true });
  assert.equal(feedback.code, 'VALIDATION_UNAVAILABLE'); assert.match(feedback.next, /not prove equivalent coverage/);
});

test('a new runner failure invalidates the earlier alternative, without deleting its command history', () => {
  let state = observeValidation(observeValidation({}, pytest, missing), unittest, unitPass);
  state = observeValidation(state, pytest, missing);
  assert.equal(state.pendingValidation, true); assert.equal(state.validationUnavailable[0].alternativeCommand, undefined);
});

test('new source evidence invalidates alternative passes without clearing source failures or unavailable commands', () => {
  const state = observeValidation(observeValidation({}, pytest, missing), unittest, unitPass);
  const validationUnavailable = invalidateUnavailableValidation(state);
  assert.equal(validationUnavailable[0].command, pytest);
  assert.equal(validationUnavailable[0].alternativeCommand, undefined);
  assert.equal(observeValidation({ ...state, validationUnavailable }, unittest, 'exit=0').pendingValidation, true);
});

let id = 0;
const done = { content: [{ type: 'text', text: 'Finished.' }], stop_reason: 'end_turn' };
const calls = commands => ({ content: commands.map(command => ({ type: 'tool_use', id: `repair-${++id}`, name: 'run_tests', input: { command } })), stop_reason: 'tool_use' });
const adapter = steps => () => ({ complete: async () => steps.shift() || done });

test('scripted runner-startup fault and alternative pass survive resume, /new, compaction and GC with an explicit limitation', async () => fixture(async root => {
  const config = loadConfig({ workspace: root, runId: 'repair', sessionId: 'repair-session', memoryPolicy: 'contextos' }, {});
  const session = createAgentSession(config);
  // Only these tool observations are scripted; they measure state handling,
  // not provider tokens, framework equivalence or actual Python installation.
  session.tools = new WorkspaceTools({ workspace: root });
  session.tools.runTests = async ({ command }) => command === pytest ? missing : unitPass;
  let shown = '';
  const result = await runTask('Validate', config, { session, onText: s => { shown += s; }, adapterFactory: adapter([calls([pytest, unittest])]) });
  assert.equal(result.status, 'completed'); assert.equal(result.validationPassed, true);
  assert.match(shown, /Unavailable checks remain unverified/); assert.match(shown, /does not prove equivalent coverage/);
  assert.match(result.text, /Unavailable checks remain unverified/);
  assert.equal(result.validationUnavailable.length, 1);
  session.compaction = { firstKeptIndex: 2, summary: 'Checkpoint.' };
  assert.match(JSON.stringify(sessionContext(session)), /unavailableValidation/);
  await attachSessionJournal(session, config);
  try { assert.equal((await collectCompactedHistory(session, config)).status, 'collected'); }
  finally { await closeSessionJournal(session); }
  const restoredConfig = { ...config, sessionId: undefined, resume: 'repair-session', runId: 'restored' };
  const restored = createAgentSession(restoredConfig);
  await attachSessionJournal(restored, restoredConfig);
  try {
    assert.equal(restored.pendingValidation, false);
    assert.equal(restored.validationUnavailable[0].alternativeCommand, unittest);
  } finally { await closeSessionJournal(restored); }
  await resetConversation(restored, restoredConfig);
  assert.equal(restored.validationUnavailable.length, 1);
  const inspection = await inspectSession(restoredConfig, 'repair-session');
  assert.equal(inspection.validationUnavailable.length, 1);
  const changed = await runTask('Create a new file', restoredConfig, { session: restored, adapterFactory: adapter([
    { content: [{ type: 'tool_use', id: `repair-${++id}`, name: 'write_file', input: { path: 'new.txt', content: 'new source' } }], stop_reason: 'tool_use' },
  ]) });
  assert.equal(changed.status, 'needs_validation');
  assert.equal(changed.validationUnavailable[0].alternativeCommand, undefined);
}));

test('a runner startup failure alone cannot complete or lose its pending state after resume', async () => fixture(async root => {
  const config = loadConfig({ workspace: root, runId: 'missing', sessionId: 'missing-session', compaction: 'off' }, {});
  const session = createAgentSession(config);
  session.tools = new WorkspaceTools({ workspace: root }); session.tools.runTests = async () => missing;
  const result = await runTask('Validate', config, { session, adapterFactory: adapter([calls([pytest])]) });
  assert.equal(result.status, 'needs_validation'); assert.deepEqual(result.validationFailures, []);
  const next = { ...config, sessionId: undefined, resume: 'missing-session' }, restored = createAgentSession(next);
  await attachSessionJournal(restored, next);
  try { assert.equal(restored.pendingValidation, true); assert.equal(restored.validationUnavailable.length, 1); }
  finally { await closeSessionJournal(restored); }
}));

test('real-entry coverage guidance is generic and does not require hidden benchmark names', () => {
  const prompt = buildSystemPrompt([{ name: 'run_tests' }]);
  assert.match(prompt, /real entry point and requirement edge cases/);
  assert.doesNotMatch(prompt, /mnamer|Helm|tags|signup|fstring/);
});

test('file-scoped searches retain line cursors and evidence for exact source ranges', async () => fixture(async root => {
  await writeFile(path.join(root, 'a.txt'), 'needle one\nneedle two\n');
  await writeFile(path.join(root, 'b.txt'), 'needle other\n');
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  const first = await tools.searchCode({ query: 'needle', path: 'a.txt', maxResults: 1 });
  assert.match(first, /a.txt:1: needle one/); assert.doesNotMatch(first, /b.txt/);
  assert.match(first, /nextOffset=0; nextLine=2/);
  const next = await tools.searchCode({ query: 'needle', path: 'a.txt', offset: 0, startLine: 2 });
  assert.match(next, /a.txt:2: needle two/); assert.match(next, /complete=true/);
  assert.equal(tools.searchEvidence.size, 2);
  await assert.rejects(tools.listFiles({ path: 'a.txt' }), /directory/);
}));

test('file-scoped search cannot read secrets, agent/Git storage, escaping paths or symlinks', async () => fixture(async root => {
  for (const dir of ['.tea', '.git']) {
    await mkdir(path.join(root, dir)); await writeFile(path.join(root, dir, 'private.txt'), 'needle');
  }
  await writeFile(path.join(root, '.env'), 'needle');
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  for (const file of ['.env', '.tea/private.txt', '.git/private.txt', '../outside.txt']) {
    await assert.rejects(tools.searchCode({ query: 'needle', path: file }));
  }
  if (process.platform !== 'win32') {
    await symlink(path.join(root, '.env'), path.join(root, 'link.txt'));
    await assert.rejects(tools.searchCode({ query: 'needle', path: 'link.txt' }));
    await symlink(os.tmpdir(), path.join(root, 'escape'));
    await assert.rejects(tools.searchCode({ query: 'needle', path: 'escape' }));
    await writeFile(path.join(root, 'ordinary.txt'), 'needle');
    await symlink(path.join(root, 'ordinary.txt'), path.join(root, '.tea', 'alias.txt'));
    await assert.rejects(tools.searchCode({ query: 'needle', path: '.tea/alias.txt' }));
  }
}));

for (const mode of ['exit', 'timeout', 'abort']) test(`inherited pipes settle without waiting for an escaped descendant (${mode})`, { timeout: 10_000 }, async () => fixture(async root => {
  await writeFile(path.join(root, 'child.mjs'), 'setTimeout(()=>{},6000);\n');
  await writeFile(path.join(root, 'parent.mjs'), `import {spawn} from 'node:child_process';import{writeFileSync}from'node:fs';const c=spawn(process.execPath,['child.mjs'],{detached:true,stdio:['ignore','inherit','inherit'],windowsHide:true});writeFileSync('child.pid',String(c.pid));console.log('partial-output');c.unref();\n`);
  const controller = new AbortController();
  const tools = new WorkspaceTools({ workspace: root, maxCommandMs: mode === 'timeout' ? 1000 : 8000 });
  tools.signal = controller.signal; tools.approveCommand = () => true; await tools.init();
  let settled = false, timer;
  try {
    const task = tools.runShell({ command: 'node parent.mjs' }).then(value => ({ value }), error => ({ error })).then(result => { settled = true; return result; });
    if (mode === 'abort') timer = setTimeout(() => controller.abort(), 300);
    const result = await Promise.race([task, sleep(2500).then(() => ({ watchdog: true }))]);
    assert(settled, 'tool must settle before descendant cleanup');
    assert(result.error); assert.match(result.error.message, /partial-output/);
    assert(['EXECUTION_INCOMPLETE', 'EXECUTION_CANCELLED', 'EXECUTION_TRANSIENT'].includes(result.error.feedbackCode));
  } finally {
    clearTimeout(timer);
    let pid; try { pid = Number(await readFile(path.join(root, 'child.pid'), 'utf8')); } catch { /* startup failure */ }
    if (Number.isSafeInteger(pid) && pid > 1) try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}));

for (const mode of ['timeout', 'abort']) test(`a live process ignoring graceful signals still settles (${mode})`, { timeout: 10_000 }, async () => fixture(async root => {
  await writeFile(path.join(root, 'hang.mjs'), "process.on('SIGTERM',()=>{});console.log('running');setInterval(()=>{},1000);\n");
  const controller = new AbortController();
  const tools = new WorkspaceTools({ workspace: root, maxCommandMs: mode === 'timeout' ? 500 : 8000 });
  tools.signal = controller.signal; tools.approveCommand = () => true;
  const timer = mode === 'abort' ? setTimeout(() => controller.abort(), 500) : null;
  try { await assert.rejects(tools.runShell({ command: 'node hang.mjs' }), error => error.feedbackCode === (mode === 'abort' ? 'EXECUTION_CANCELLED' : 'EXECUTION_TRANSIENT')); }
  finally { clearTimeout(timer); }
}));
