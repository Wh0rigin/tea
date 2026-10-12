import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceTools, TOOL_DEFINITIONS } from '../src/tools.mjs';

async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-batch-'));
  try {
    const tools = new WorkspaceTools({ workspace: root });
    await tools.init();
    const file = path.join(root, 'code.mjs');
    await writeFile(file, 'const left = 1;\r\nconst right = 2;\r\n');
    await callback(tools, file);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('batch matches original file, accepts reversed order, and preserves untouched CRLF', async () => {
  await fixture(async (tools, file) => {
    assert.equal(await tools.applyPatch({ path: 'code.mjs', edits: [
      { search: 'right = 2', replace: 'right = 4' },
      { search: 'left = 1', replace: 'left = 3' },
    ] }), 'Updated code.mjs (2 replacements)');
    assert.equal(await readFile(file, 'utf8'), 'const left = 3;\r\nconst right = 4;\r\n');
  });
});

for (const [name, edits] of [
  ['missing match', [{ search: 'left = 1', replace: 'left = 3' }, { search: 'missing', replace: '' }]],
  ['overlap', [{ search: 'left = 1', replace: 'left = 3' }, { search: 'left', replace: 'other' }]],
  ['duplicate region', [{ search: 'left', replace: 'a' }, { search: 'left', replace: 'b' }]],
  ['incremental match', [{ search: 'left = 1', replace: 'left = 3' }, { search: 'left = 3', replace: 'left = 4' }]],
]) test(`batch rejects ${name} without partial writes`, async () => {
  await fixture(async (tools, file) => {
    const original = await readFile(file);
    await assert.rejects(tools.applyPatch({ path: 'code.mjs', edits }), error => error.feedbackCode === 'SOURCE_MISMATCH');
    assert.deepEqual(await readFile(file), original);
  });
});

test('batch rejects invalid and mixed forms without writes', async () => {
  await fixture(async (tools, file) => {
    const original = await readFile(file);
    for (const input of [{ edits: [] }, { edits: null }, { edits: [{}] },
      { edits: [{ search: '', replace: '' }] }, { edits: Array(65).fill({ search: 'left', replace: '' }) },
      { edits: [{ search: 'left', replace: '' }], search: 'left', replace: '' }]) {
      await assert.rejects(tools.applyPatch({ path: 'code.mjs', ...input }), error => error.feedbackCode === 'INPUT_INVALID');
    }
    assert.deepEqual(await readFile(file), original);
  });
});

test('batch refuses ambiguous matches, including overlapping occurrences', async () => {
  await fixture(async (tools, file) => {
    await writeFile(file, 'aaa');
    await assert.rejects(tools.applyPatch({ path: 'code.mjs', edits: [{ search: 'aa', replace: 'b' }] }), /ambiguous/);
    assert.equal(await readFile(file, 'utf8'), 'aaa');
  });
});

test('single patch remains compatible and batch invalidates read evidence', async () => {
  await fixture(async (tools, file) => {
    await tools.readFile({ path: 'code.mjs' });
    assert.equal(await tools.applyPatch({ path: 'code.mjs', search: 'left = 1', replace: 'left = 3' }), 'Updated code.mjs');
    await tools.applyPatch({ path: 'code.mjs', edits: [{ search: 'right = 2', replace: 'right = 4' }] });
    assert.match(await tools.readFile({ path: 'code.mjs' }), /right = 4/);
    assert.match(await readFile(file, 'utf8'), /left = 3/);
  });
});

test('batch uses the same path restrictions and declares both input forms', async () => {
  await fixture(async tools => {
    await assert.rejects(tools.applyPatch({ path: '../outside', edits: [{ search: 'a', replace: 'b' }] }), /escapes/);
    await assert.rejects(tools.applyPatch({ path: '.env', edits: [{ search: 'a', replace: 'b' }] }), /environment/);
    const schema = TOOL_DEFINITIONS.find(tool => tool.name === 'apply_patch').input_schema;
    assert.deepEqual(schema.required, ['path']);
    assert.equal(schema.properties.edits.maxItems, 64);
  });
});
