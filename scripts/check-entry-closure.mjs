// Deterministic behavior diagnostic. No provider calls or token savings claims.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const source = path.resolve(process.argv[2] || '.');
const { runTask } = await import(pathToFileURL(path.join(source, 'src/agent.mjs')));
const { loadConfig } = await import(pathToFileURL(path.join(source, 'src/config.mjs')));
const done = { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' };
let serial = 0;
const call = (name, input) => ({ name, input });
const calls = list => ({ content: list.map(item => ({ type: 'tool_use', id: `closure-${++serial}`, ...item })), stop_reason: 'tool_use' });
const entry = call('run_shell', { command: `"${process.execPath}" app.mjs` });
const suite = call('run_tests', { command: 'node --test unit.test.mjs' });
const patch = call('apply_patch', { path: 'app.mjs', search: "throw new TypeError('missing destination');", replace: "console.log('processed');" });
const cases = [
  ['crash_then_unrelated_pass', [calls([entry, suite])]],
  ['fix_without_entry_retest', [calls([entry]), calls([patch, suite])]],
  ['fix_and_entry_retest', [calls([entry]), calls([patch, suite, entry])]],
  ['normal_success', [calls([suite])]],
  ['handled_negative', [calls([call('run_shell', { command: `"${process.execPath}" negative.mjs` }), suite])]],
  ['declared_exception_probe', [calls([call('run_shell', { ...entry.input, expected_exit_code: 1 }), suite])]],
  ['cannot_relabel_observed_crash', [calls([entry]), calls([call('run_shell', { ...entry.input, expected_exit_code: 1 }), suite])]],
];
const results = [];
for (const [name, steps] of cases) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-closure-'));
  try {
    await writeFile(path.join(root, 'app.mjs'), "throw new TypeError('missing destination');\n");
    await writeFile(path.join(root, 'negative.mjs'), "console.error('usage: invalid argument');process.exit(2);\n");
    await writeFile(path.join(root, 'unit.test.mjs'), "import test from 'node:test';test('unrelated',()=>{});\n");
    let requests = 0;
    const config = loadConfig({ workspace: root, runId: name, compaction: 'off' }, {});
    const result = await runTask('Implement the requested behavior and verify it', config, {
      approveCommand: () => true,
      adapterFactory: () => ({ complete: async () => { requests++; return steps.shift() || done; } }),
    });
    results.push({ name, status: result.status, validationPassed: result.validationPassed,
      unresolved: result.validationFailures.length, modelRequests: requests, toolCalls: result.toolCalls });
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('tea-closure-'));
    await rm(root, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ mode: 'offline-scripted', providerCalls: 0, results }, null, 2));
