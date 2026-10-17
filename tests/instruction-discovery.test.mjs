import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceTools } from '../src/tools.mjs';

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-instructions-'));
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'other'));
    await writeFile(path.join(root, 'src/a.mjs'), 'export const a = 1;');
    const tools = new WorkspaceTools({ workspace: root });
    await tools.init();
    await fn(tools, root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('initial inventory discovers root rules independently of ranking', async () => fixture(async (tools, root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'Preserve tests.');
  const inventory = await tools.initialInventory({ task: 'a', limit: 1 });
  assert.match(inventory.text, /Applicable workspace instructions: \["AGENTS.md"\]/);
  assert(!inventory.text.includes('Preserve tests.'));
}));

test('source reads discover only applicable ancestors in outer-first order', async () => fixture(async (tools, root) => {
  for (const file of ['AGENTS.md', 'src/AGENTS.md', 'other/AGENTS.md']) await writeFile(path.join(root, file), 'Rules.');
  const output = await tools.readFile({ path: 'src/a.mjs' });
  assert.match(output, /\["AGENTS.md","src\/AGENTS.md"\]/);
  assert(!output.includes('other/AGENTS.md'));
}));

test('fully read fresh rules stop reminders and manual edits reactivate them', async () => fixture(async (tools, root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'One.\nTwo.');
  await tools.readFile({ path: 'AGENTS.md', endLine: 1 });
  assert.match(await tools.readFile({ path: 'src/a.mjs' }), /Applicable workspace instructions/);
  await tools.readFile({ path: 'AGENTS.md', startLine: 2 });
  assert(! (await tools.readFile({ path: 'src/a.mjs' })).includes('Applicable workspace instructions'));
  await writeFile(path.join(root, 'AGENTS.md'), 'Changed.');
  assert.match(await tools.readFile({ path: 'src/a.mjs' }), /Applicable workspace instructions/);
}));

test('no instruction files leaves ordinary source evidence unchanged', async () => fixture(async tools => {
  const output = await tools.readFile({ path: 'src/../src/a.mjs' });
  assert(!output.includes('Applicable workspace instructions'));
  assert.match(output, /1: export const a = 1;/);
  assert.equal(await tools.instructionNotice(['missing/deep/new.mjs']), '');
}));
