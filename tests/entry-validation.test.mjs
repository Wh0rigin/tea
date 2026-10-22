import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { entryPointCrashed, entryPointNeedsValidation, observeEntryPoint, observeValidation } from '../src/validation.mjs';
import { buildSystemPrompt } from '../src/prompts.mjs';
import { TOOL_DEFINITIONS } from '../src/tools.mjs';
import { runTask, createAgentSession, resetConversation } from '../src/agent.mjs';
import { loadConfig } from '../src/config.mjs';
import { attachSessionJournal, closeSessionJournal } from '../src/session-memory.mjs';
import { sessionContext } from '../src/compaction.mjs';
import { collectCompactedHistory } from '../src/memory-gc.mjs';
import { memoryHandoff } from '../src/memory-handoff.mjs';

const pythonCrash = "exit=1\nstdout:\n\nstderr:\nTraceback (most recent call last):\n  File \"app.py\", line 2, in main\nKeyError: 'destination'\n";
const nodeCrash = 'exit=1\nstdout:\n\nstderr:\nTypeError: missing destination\n    at main (app.mjs:2:1)\n';
test('recognize direct Python module/script and Node entry crashes, including absolute executables', () => {
  for (const command of ['python -m project --watch /tmp', 'python3 app.py', '"C:\\Python\\python.exe" -m project', '/usr/bin/python3.12 app.py']) {
    assert.equal(entryPointCrashed(command, pythonCrash), true, command);
  }
  assert.equal(entryPointCrashed('node app.mjs', nodeCrash), true);
  assert.equal(entryPointCrashed('"C:\\Program Files\\nodejs\\node.exe" app.js', nodeCrash), true);
});

test('search misses, handled negative cases, inline probes and test wrappers create no entry obligation', () => {
  for (const [command, output] of [
    ['rg missing .', 'exit=1\nstdout:\n\nstderr:\n'],
    ['python app.py --invalid', 'exit=2\nstdout:\n\nstderr:\nusage: app.py\napp.py: error: unknown argument'],
    ['python -m pytest', pythonCrash], ['python -m unittest', pythonCrash],
    ['python -c probe', pythonCrash], ['node --test suite.mjs', nodeCrash],
    ['node -e probe', nodeCrash], ['git status', pythonCrash],
    ['python app.py', pythonCrash.replace('exit=1', 'exit=0')],
    ['python app.py', pythonCrash.replace('stderr:\n', 'stderr:\nnormal error\n').replace('Traceback (most recent call last):', 'expected traceback text')],
    ['python app.py', 'exit=1\nstdout:\nTraceback (most recent call last):\nKeyError: expected\nstderr:\n'],
  ]) assert.equal(entryPointCrashed(command, output), false, command);
});

test('narrow tests and changed CLI args cannot clear the failed entry command', () => {
  let state = observeEntryPoint({}, 'python -m project', pythonCrash);
  assert.equal(state.validationFailures[0].kind, 'entry_crash');
  state = observeValidation(state, 'python -m pytest tests/unit.py', 'exit=0\n1 passed');
  assert.equal(state.pendingValidation, true);
  assert.equal(entryPointNeedsValidation(state, 'python -m project --destination out', 'exit=0'), false);
  state = observeEntryPoint(state, 'python -m project', 'exit=0\nstdout:\nprocessed file\nstderr:\n');
  assert.equal(state.validationPassed, true);
  assert.deepEqual(state.validationFailures, []);
});

test('timeout or denied retry keeps the original runtime failure outstanding', () => {
  let state = observeEntryPoint({}, 'node app.mjs', nodeCrash);
  assert.equal(entryPointNeedsValidation(state, 'node app.mjs', 'Command timed out'), true);
  state = observeEntryPoint(state, 'node app.mjs', 'Command timed out', true);
  assert.equal(state.pendingValidation, true);
  assert.equal(state.validationFailures[0].kind, 'entry_crash');
});

test('anticipated negative probes are distinct from unexpected or already observed crashes', () => {
  assert.equal(entryPointNeedsValidation({}, 'node app.mjs', nodeCrash, 1), false);
  assert.equal(entryPointNeedsValidation({}, 'node app.mjs', nodeCrash, 2), true);
  const state = observeEntryPoint({}, 'node app.mjs', nodeCrash);
  assert.equal(entryPointNeedsValidation(state, 'node app.mjs', nodeCrash, 1), true);
  assert.equal(observeEntryPoint(state, 'node app.mjs', nodeCrash).pendingValidation, true);
});

test('guidance maps requirements to results without prescribing a benchmark solution', () => {
  const prompt = buildSystemPrompt(TOOL_DEFINITIONS);
  for (const phrase of ['requirement -> observable outcome -> check', 'defaults and interacting behaviors',
    'after the starter exits', 'stop and clean up', 'not just exit codes or status flags', 'change the invocation']) assert(prompt.includes(phrase));
  assert.doesNotMatch(prompt, /Mnamer|Helm|Popen|daemon=True/);
  assert.doesNotMatch(buildSystemPrompt([{ name: 'read_file' }]), /requirement ->|starter exits/);
});

async function temporary(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-entry-'));
  try { await fn(root); }
  finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('tea-entry-'));
    await rm(root, { recursive: true, force: true });
  }
}
let serial = 0;
const done = { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' };
const tool = (name, input) => ({ name, input });
const calls = list => ({ content: list.map(item => ({ type: 'tool_use', id: `entry-${++serial}`, ...item })), stop_reason: 'tool_use' });
const factory = (steps, captured = []) => () => ({ complete: async request => { captured.push(structuredClone(request)); return steps.shift() || done; } });
const quote = value => `"${value}"`;
const entry = tool('run_shell', { command: `${quote(process.execPath)} app.mjs` });
const narrow = tool('run_tests', { command: 'node --test unrelated.test.mjs' });
async function fixture(root) {
  await writeFile(path.join(root, 'app.mjs'), "throw new TypeError('missing destination');\n");
  await writeFile(path.join(root, 'unrelated.test.mjs'), "import test from 'node:test';test('unrelated',()=>{});\n");
  return loadConfig({ workspace: root, runId: 'entry', compaction: 'off' }, {});
}

test('real entry crash followed by a passing unrelated suite cannot finish', async () => temporary(async root => {
  const config = await fixture(root), captured = [];
  const result = await runTask('Fix the CLI', config, { approveCommand: () => true,
    adapterFactory: factory([calls([entry, narrow])], captured) });
  assert.equal(result.status, 'needs_validation');
  assert.equal(result.validationPassed, false);
  assert.equal(result.validationFailures[0].kind, 'entry_crash');
  assert.match(JSON.stringify(captured.at(-1).messages), /Rerun unresolved commands/);
  // Two existing bounded nudges, never an unbounded retry loop.
  assert.equal(captured.length, 4);
}));

test('source edits and other passing checks do not substitute for an entry retry', async () => temporary(async root => {
  const config = await fixture(root);
  const patch = tool('apply_patch', { path: 'app.mjs', search: "throw new TypeError('missing destination');", replace: "console.log('processed');" });
  const result = await runTask('Fix the CLI', config, { approveCommand: () => true,
    adapterFactory: factory([calls([entry]), calls([patch, narrow])]) });
  assert.equal(result.status, 'needs_validation');
  assert.equal(result.validationFailures.length, 1);
}));

test('fix plus the exact real entry retry can close the obligation', async () => temporary(async root => {
  const config = await fixture(root);
  const patch = tool('apply_patch', { path: 'app.mjs', search: "throw new TypeError('missing destination');", replace: "console.log('processed');" });
  const result = await runTask('Fix the CLI', config, { approveCommand: () => true,
    adapterFactory: factory([calls([entry]), calls([patch, narrow, entry])]) });
  assert.equal(result.status, 'completed');
  assert.equal(result.validationPassed, true);
  assert.deepEqual(result.validationFailures, []);
}));

test('entry obligation survives compaction, GC, disk resume and /new', async () => temporary(async root => {
  const config = { ...await fixture(root), sessionId: 'entry-gc', memoryGc: 'auto' };
  const session = createAgentSession(config);
  await runTask('Fix the CLI', config, { session, approveCommand: () => true, adapterFactory: factory([calls([entry, narrow])]) });
  session.compaction = { firstKeptIndex: 2, summary: 'Everything passed.' };
  assert.match(JSON.stringify(sessionContext(session)), /app.mjs/);
  await attachSessionJournal(session, config);
  try { assert.equal((await collectCompactedHistory(session, config)).status, 'collected'); }
  finally { await closeSessionJournal(session); }
  const next = { ...config, sessionId: undefined, resume: 'entry-gc', runId: 'entry-resumed' };
  const restored = createAgentSession(next);
  await runTask('Check again', next, { session: restored, adapterFactory: factory([calls([narrow])]) });
  assert.equal(restored.validationFailures[0].kind, 'entry_crash');
  assert.equal(restored.pendingValidation, true);
  const handoff = memoryHandoff(restored);
  assert.equal(handoff.validation.unresolvedCommands[0].kind, 'entry_crash');
  handoff.validation.unresolvedCommands.length = 0;
  assert.equal(restored.validationFailures.length, 1);
  await resetConversation(restored, next);
  assert.equal(restored.validationFailures[0].kind, 'entry_crash');
  assert.equal(restored.pendingValidation, true);
}));

test('normal successful checks require no extra model request', async () => temporary(async root => {
  const config = await fixture(root), captured = [];
  const result = await runTask('Run the suite', config, { adapterFactory: factory([calls([narrow])], captured) });
  assert.equal(result.status, 'completed');
  assert.equal(captured.length, 2);
}));

test('declared negative entry probe does not create a false completion block', async () => temporary(async root => {
  const config = await fixture(root);
  const negative = tool('run_shell', { ...entry.input, expected_exit_code: 1 });
  const result = await runTask('Check the expected exception', config, { approveCommand: () => true,
    adapterFactory: factory([calls([negative, narrow])]) });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.validationFailures, []);
}));

test('invalid negative expectation is rejected before approval or execution', async () => temporary(async root => {
  const config = await fixture(root), session = createAgentSession(config);
  let approvals = 0;
  const invalid = tool('run_shell', { ...entry.input, expected_exit_code: -1 });
  await runTask('Check', config, { session, approveCommand: () => { approvals++; return true; }, adapterFactory: factory([calls([invalid])]) });
  assert.equal(approvals, 0);
}));

test('real Python lifecycle fixture: exit zero and running flag do not prove continued work', async t => {
  const python = ['python', 'python3'].find(executable => spawnSync(executable, ['--version'], { windowsHide: true }).status === 0);
  if (!python) { t.skip('Python unavailable for real lifecycle fixture'); return; }
  await temporary(async root => {
    await writeFile(path.join(root, 'worker.py'), "import time,pathlib,sys\ntime.sleep(.2)\npathlib.Path(sys.argv[1]).write_text('processed')\n");
    await writeFile(path.join(root, 'bad.py'), "import threading,time,pathlib,json\ndef work():\n    time.sleep(.2)\n    pathlib.Path('bad-result').write_text('processed')\npathlib.Path('bad-state').write_text(json.dumps({'running': True}))\nthreading.Thread(target=work, daemon=True).start()\n");
    await writeFile(path.join(root, 'good.py'), "import subprocess,sys,pathlib,json\nsubprocess.Popen([sys.executable,'worker.py','good-result'],start_new_session=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\npathlib.Path('good-state').write_text(json.dumps({'running': True}))\n");
    for (const name of ['bad', 'good']) {
      const started = spawnSync(python, [`${name}.py`], { cwd: root, timeout: 5000, windowsHide: true });
      assert.equal(started.status, 0, String(started.stderr));
      assert.equal(JSON.parse(await readFile(path.join(root, `${name}-state`), 'utf8')).running, true);
    }
    const deadline = Date.now() + 5000;
    let result;
    while (Date.now() < deadline) {
      try { result = await readFile(path.join(root, 'good-result'), 'utf8'); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(result, 'processed');
    await assert.rejects(readFile(path.join(root, 'bad-result')), error => error.code === 'ENOENT');
    // Both starters satisfied weak assertions, but only one completed actual work.
    // This is a validation-design fixture, not evidence of autonomous coding gain.
  });
});
