import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceTools } from '../src/tools.mjs';
import { toolFailureFeedback } from '../src/tool-feedback.mjs';
import { runTask } from '../src/agent.mjs';
import { loadCliConfig } from '../src/config.mjs';

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-edit-recovery-'));
  try {
    await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
    const tools = new WorkspaceTools({ workspace: root }); await tools.init();
    await fn(tools, root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('existing-file denial preserves file and current read evidence', async () => fixture(async (tools, root) => {
  await tools.readFile({ path: 'value.mjs' });
  const evidence = tools.presentedSource.get('value.mjs');
  await assert.rejects(tools.writeFile({ path: 'value.mjs', content: 'wrong' }), error => {
    assert.equal(error.feedbackCode, 'FILE_EXISTS');
    const feedback = toolFailureFeedback({ error });
    assert.equal(feedback.missingCapability, 'edit-existing-file');
    assert.equal(feedback.retryable, false);
    assert.match(feedback.next, /read only if/);
    return true;
  });
  assert.equal(tools.presentedSource.get('value.mjs'), evidence);
  assert.equal(await readFile(path.join(root, 'value.mjs'), 'utf8'), 'export const value = 1;\n');
  await tools.applyPatch({ path: 'value.mjs', search: 'value = 1', replace: 'value = 3' });
  assert.match(await readFile(path.join(root, 'value.mjs'), 'utf8'), /value = 3/);
}));

test('missing and ambiguous patch searches remain blocked with distinct recovery advice', async () => fixture(async (tools, root) => {
  await writeFile(path.join(root, 'value.mjs'), 'same\nsame\n');
  for (const [search, code] of [['absent', 'PATCH_NOT_FOUND'], ['same', 'PATCH_AMBIGUOUS']]) {
    await assert.rejects(tools.applyPatch({ path: 'value.mjs', search, replace: 'wrong' }), error => {
      assert.equal(error.feedbackCode, code);
      assert.equal(toolFailureFeedback({ error }).code, code);
      assert.equal(toolFailureFeedback({ error }).retryable, false);
      return true;
    });
  }
  assert.equal(await readFile(path.join(root, 'value.mjs'), 'utf8'), 'same\nsame\n');
}));

test('scripted agent recovers from FILE_EXISTS using prior read and actually validates', async () => fixture(async (_, root) => {
  const config = loadCliConfig({ workspace: root, runId: 'edit-recovery' }, {});
  const steps = [
    { name: 'read_file', input: { path: 'value.mjs' } },
    { name: 'write_file', input: { path: 'value.mjs', content: 'wrong' } },
    { name: 'apply_patch', input: { path: 'value.mjs', search: 'value = 1', replace: 'value = 3' } },
    { name: 'write_file', input: { path: 'value.test.mjs', content: "import test from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('value',()=>assert.equal(value,3));" } },
    { name: 'run_tests', input: { command: 'node --test value.test.mjs' } },
  ];
  let index = 0, sawFeedback = false;
  const result = await runTask('Set value to three and verify', config, { adapterFactory: () => ({ async complete(request) {
    if (index === 2) sawFeedback = request.messages.at(-1).content.some(block => block.is_error && block.content.includes('FILE_EXISTS'));
    const call = steps[index++];
    return call ? { content: [{ type: 'tool_use', id: 'x' + index, ...call }], stop_reason: 'tool_use' }
      : { content: [{ type: 'text', text: 'Verified.' }], stop_reason: 'end_turn' };
  } }) });
  assert(sawFeedback); assert.equal(result.status, 'completed'); assert(result.validationPassed);
  assert.equal(result.toolCalls, 5);
}));
