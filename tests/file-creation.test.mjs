import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WorkspaceTools } from '../src/tools.mjs';
import { loadConfig, loadCliConfig } from '../src/config.mjs';
import { runTask } from '../src/agent.mjs';
import { contextBudget, estimateContextTokens } from '../src/context-budget.mjs';

async function temporary(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-create-'));
  try { await callback(root); } finally {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
    assert.ok(relative.startsWith('tea-create-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    await rm(root, { recursive: true, force: true });
  }
}

test('native creation supports UTF-8, spaces and parents without overwriting', async () => temporary(async root => {
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  const input = { path: '中文 空间/nested/program.py', content: '# 水仙花数 🚀\nprint(153)\n' };
  assert.match(await tools.writeFile(input), /Created/);
  assert.equal(await readFile(path.join(root, input.path), 'utf8'), input.content);
  await assert.rejects(tools.writeFile({ ...input, content: 'replaced' }), /already exists/);
  assert.equal(await readFile(path.join(root, input.path), 'utf8'), input.content);
}));

test('creation rejects escapes, metadata, credentials and invalid text', async () => temporary(async root => {
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  for (const target of ['../outside.py', '.git/config', '.tea/state.json', '.env', 'credentials.json', 'file:stream']) {
    await assert.rejects(tools.writeFile({ path: target, content: 'blocked' }), undefined, target);
  }
  for (const content of ['\0', '\ud800', 'x'.repeat(160001)]) await assert.rejects(tools.writeFile({ path: 'invalid.py', content }));
  await symlink(root, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(tools.writeFile({ path: 'link/escape.py', content: 'blocked' }), /symlink/);
  const disabled = new WorkspaceTools({ workspace: root, enableFileCreation: false }); await disabled.init();
  assert.ok(!disabled.modelToolDefinitions().some(tool => tool.name === 'write_file'));
  await assert.rejects(disabled.writeFile({ path: 'disabled.py', content: '' }), /disabled|not enabled/i);
}));

test('daily defaults allow normal requests while explicit guards and SDK defaults remain configurable', () => {
  const config = loadCliConfig({}, {});
  assert.equal(config.maxRequestInputBytes, 2097152);
  assert.equal(config.contextWindowTokens, 32768);
  assert.equal(config.maxOutputTokens, 4096);
  assert.equal(config.contextosTargetBytes, 32000);
  assert.equal(config.maxCostUsd, null);
  assert.equal(config.capabilityFeedback, true);
  assert.equal(loadConfig({}, {}).maxRequestInputTokens, 12000);
  assert.equal(loadCliConfig({ maxRequestInputBytes: 24000 }, {}).maxRequestInputTokens, 24000);
  const large = loadCliConfig({}, { TEA_CONTEXT_WINDOW_TOKENS: '216000' });
  const budget = contextBudget(large, { messages: [] });
  assert.equal(budget.inputLimit, 207808); assert.equal(budget.triggerTokens, 166246);
  assert.equal(large.maxRequestInputBytes, config.maxRequestInputBytes);
  assert.throws(() => loadCliConfig({}, { TEA_CONTEXT_WINDOW_TOKENS: '8192' }), /larger than output/);
  assert.throws(() => loadCliConfig({}, { TEA_CONTEXT_WINDOW_TOKENS: '2.5' }), /safe integer/);
  const unicode = { messages: [{ role: 'user', content: '中文🚀'.repeat(100) }] };
  assert.ok(estimateContextTokens(unicode) > estimateContextTokens({ messages: [] }));
  assert.ok(Math.abs(estimateContextTokens(unicode, 2) - 2 * estimateContextTokens(unicode)) <= 1);
});

test('empty workspace completes native creation and actual Node validation without shell approval', async () => temporary(async root => {
  let serial = 0, approvals = 0;
  const calls = input => ({ content: input.map(call => ({ type: 'tool_use', id: `create-${++serial}`, ...call })), stop_reason: 'tool_use' });
  const program = 'export const isNarcissistic = n => Number.isInteger(n) && n >= 0 && [...String(n)].reduce((sum, d) => sum + Number(d) ** String(n).length, 0) === n;\n';
  const tests = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { isNarcissistic } from './numbers.mjs';\ntest('narcissistic numbers', () => { for (const n of [0, 1, 153, 370, 371, 407, 1634]) assert.equal(isNarcissistic(n), true); for (const n of [-1, 10, 152, 1.5]) assert.equal(isNarcissistic(n), false); });\n";
  const steps = [calls([{ name: 'write_file', input: { path: 'numbers.mjs', content: program } },
    { name: 'write_file', input: { path: 'numbers.test.mjs', content: tests } }]),
    calls([{ name: 'run_tests', input: { command: 'node --test numbers.test.mjs' } }])];
  const result = await runTask('Create and validate a narcissistic-number program', loadCliConfig({ workspace: root, runId: 'empty-create' }, {}), {
    approveCommand: async () => { approvals++; return true; },
    adapterFactory: () => ({ complete: async () => steps.shift() || { content: [{ type: 'text', text: 'Verified.' }], stop_reason: 'end_turn' } }),
  });
  assert.equal(result.status, 'completed'); assert.equal(result.validationPassed, true);
  assert.equal(result.validationAttempts, 1); assert.equal(approvals, 0);
  assert.equal(await readFile(path.join(root, 'numbers.mjs'), 'utf8'), program);
}));

test('missing executable has actionable feedback and approval wait has a separate timer', async () => temporary(async root => {
  const tools = new WorkspaceTools({ workspace: root }); tools.approveCommand = async () => {
    await new Promise(resolve => setTimeout(resolve, 90)); return true;
  }; await tools.init();
  await assert.rejects(tools.runShell({ command: 'tea-executable-that-does-not-exist --version' }), error =>
    error.code === 'ENOENT' && /write_file/.test(error.message));
  assert.ok(tools.lastCommandTiming.approvalMs >= 70);
  assert.ok(tools.lastCommandTiming.executionMs >= 0);
}));

test('native creation supports actual Python unittest validation when Python is installed', async t => {
  try { await promisify(execFile)('python', ['--version'], { timeout: 5000, windowsHide: true }); }
  catch { t.skip('Python executable unavailable on this host'); return; }
  await temporary(async root => {
    const tools = new WorkspaceTools({ workspace: root }); await tools.init();
    await tools.writeFile({ path: 'narcissistic.py', content: 'def is_narcissistic(n):\n    return isinstance(n, int) and n >= 0 and sum(int(d) ** len(str(n)) for d in str(n)) == n\n' });
    await tools.writeFile({ path: 'test_numbers.py', content: 'import unittest\nfrom narcissistic import is_narcissistic\nclass Numbers(unittest.TestCase):\n    def test_numbers(self):\n        for n in [0, 153, 370, 371, 407, 1634]:\n            self.assertTrue(is_narcissistic(n))\n        for n in [-1, 10, 152]:\n            self.assertFalse(is_narcissistic(n))\n' });
    const result = await tools.runTests({ command: 'python -m unittest test_numbers' });
    assert.match(result, /^exit=0/); assert.match(result, /Ran 1 test/);
  });
});
