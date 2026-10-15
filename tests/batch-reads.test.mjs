import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceTools, dispatchTool } from '../src/tools.mjs';
import { ContextMemory, validToolProtocol } from '../src/context-assembler.mjs';

async function scenario(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tea-batch-')));
  try {
    const tools = new WorkspaceTools({ workspace: root, batchReads: true });
    await tools.init(); await fn(root, tools);
  } finally {
    const rel = path.relative(await realpath(os.tmpdir()), root);
    assert.ok(rel.startsWith('tea-batch-') && !rel.includes(path.sep));
    await rm(root, { recursive: true, force: true });
  }
}

test('batch reads are opt-in and do not mutate shared schemas', async () => scenario(async (root, tools) => {
  const plain = new WorkspaceTools({ workspace: root });
  const before = JSON.stringify(plain.modelToolDefinitions());
  assert.ok(tools.modelToolDefinitions().some(t => t.name === 'read_files'));
  assert.equal(JSON.stringify(plain.modelToolDefinitions()), before);
  await assert.rejects(dispatchTool(plain, 'read_files', { files: [{ path: 'a' }] }), /disabled/);
}));

test('batch ranges, partial errors, redaction and independent version hashes', async () => scenario(async (root, tools) => {
  await writeFile(path.join(root, 'a.mjs'), 'one\n中文\nthree');
  await writeFile(path.join(root, 'b.mjs'), 'password=private-value');
  const { files } = JSON.parse(await tools.readFiles({ files: [
    { path: 'a.mjs', startLine: 2, endLine: 2 }, { path: 'missing' }, { path: 'b.mjs' }, { path: '../outside' },
  ] }));
  assert.match(files[0].output, /2: 中文/); assert.doesNotMatch(files[0].output, /three/);
  assert.match(files[0].sourceHash, /^[a-f0-9]{64}$/);
  assert.ok(files[1].error); assert.match(files[2].output, /REDACTED/);
  assert.doesNotMatch(JSON.stringify(files), /private-value/); assert.ok(files[3].error);
  const blocked = JSON.parse(await tools.readFiles({ files: [{ path: '.env' }] }));
  assert.ok(blocked.files[0].error);
}));

test('bounded partial batch output is never cached as a complete range', async () => scenario(async (root, tools) => {
  await writeFile(path.join(root, 'large.mjs'), 'const value = 1;\n'.repeat(1000));
  const result = JSON.parse(await tools.readFiles({ files: [{ path: 'large.mjs' }] }));
  assert.ok(result.files[0].output.length <= 2500);
  assert.match(result.files[0].output, /Only a prefix/); assert.equal(tools.readEvidence.size, 0);
  const full = await tools.readFile({ path: 'large.mjs', startLine: 200, endLine: 201 });
  assert.match(full, /200: const/);
}));

test('invalid batches reject before reading and cancellation propagates', async () => scenario(async (root, tools) => {
  for (const files of [[], Array(5).fill({ path: 'a' }), [{ path: 'a', startLine: 0 }], [{ path: 'a', startLine: 3, endLine: 2 }]]) {
    await assert.rejects(tools.readFiles({ files }), /files must|Invalid batch/);
  }
  assert.equal(tools.sourceEvidence.size, 0);
  tools.signal = AbortSignal.abort(new Error('cancelled'));
  await assert.rejects(tools.readFiles({ files: [{ path: 'a' }] }), /cancelled/);
}));

test('ContextOS rebuilds dependencies from persisted batch output and withholds stale source', async () => scenario(async (root, tools) => {
  await writeFile(path.join(root, 'a.mjs'), 'oldA'); await writeFile(path.join(root, 'b.mjs'), 'oldB');
  const output = await tools.readFiles({ files: [{ path: 'a.mjs' }, { path: 'b.mjs' }] });
  const messages = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'batch1', name: 'read_files', input: { files: [{ path: 'a.mjs' }, { path: 'b.mjs' }] } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'batch1', content: output }] },
  ];
  assert.equal(validToolProtocol(messages), true);
  const freshTools = new WorkspaceTools({ workspace: root, batchReads: true }); await freshTools.init();
  const memory = new ContextMemory(freshTools); memory.rebuild(messages);
  const unit = [...memory.units.values()][0]; assert.equal(unit.sourceDependencies.length, 2);
  assert.equal(await memory.freshness(unit), 'valid');
  assert.match(await memory.recall({ ref: unit.ref }), /oldA/);
  await writeFile(path.join(root, 'b.mjs'), 'newB');
  const recalled = await memory.recall({ ref: unit.ref });
  assert.match(recalled, /STALE/); assert.doesNotMatch(recalled, /oldA|oldB/);
}));
