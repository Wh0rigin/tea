import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceTools } from '../src/tools.mjs';

async function workspaceCase(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-tools-'));
  try { await callback(root, new WorkspaceTools({ workspace: root })); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('lists and searches workspace text files while omitting environment files and dependencies', async () => {
  await workspaceCase(async (root, tools) => {
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'src.js'), 'const target = 42;\n');
    await writeFile(path.join(root, '.env'), 'SECRET=not-for-tools\n');
    await writeFile(path.join(root, 'credentials.json'), '{"password":"hidden-value"}\n');
    await writeFile(path.join(root, 'node_modules', 'hidden.js'), 'target\n');
    await tools.init();
    assert.equal(await tools.listFiles(), 'src.js');
    assert.match(await tools.searchCode({ query: 'target' }), /src\.js:1/);
    await assert.rejects(tools.readFile({ path: '.env' }), /credential|allowlist|regular text file/);
    await assert.rejects(tools.readFile({ path: 'credentials.json' }), /credential/);
  });
});

test('redacts credential-shaped values from ordinary source text before returning them to the model', async () => {
  await workspaceCase(async (root, tools) => {
    const credential = `sk-${'A'.repeat(28)}`;
    await writeFile(path.join(root, 'client.js'), `const api_key = '${credential}';\n`);
    await tools.init();
    assert.doesNotMatch(await tools.readFile({ path: 'client.js' }), /sk-A{12}/);
    assert.doesNotMatch(await tools.searchCode({ query: 'api_key' }), /sk-A{12}/);
  });
});

test('prevents traversal and symlink escape from the workspace', async () => {
  await workspaceCase(async (root, tools) => {
    await tools.init();
    await assert.rejects(tools.resolveFile('../outside.txt', { mustExist: false }), /escapes/);
    const outside = await mkdtemp(path.join(os.tmpdir(), 'tea-outside-'));
    try {
      await writeFile(path.join(outside, 'file.txt'), 'outside');
      await symlink(outside, path.join(root, 'link'), 'junction').catch(() => {});
      if (await readFile(path.join(root, 'link', 'file.txt'), 'utf8').then(() => true).catch(() => false)) {
        await assert.rejects(tools.readFile({ path: 'link/file.txt' }), /escapes/);
      }
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

test('patches one unique exact span and refuses ambiguous edits', async () => {
  await workspaceCase(async (root, tools) => {
    await tools.init();
    const filename = path.join(root, 'src.js');
    await writeFile(filename, 'const a = 1;\nconst b = 2;\n');
    assert.equal(await tools.applyPatch({ path: 'src.js', search: 'const a = 1;', replace: 'const a = 3;' }), 'Updated src.js');
    assert.equal(await readFile(filename, 'utf8'), 'const a = 3;\nconst b = 2;\n');
    await writeFile(filename, 'x = x\n');
    await assert.rejects(tools.applyPatch({ path: 'src.js', search: 'x', replace: 'y' }), /ambiguous/);
    await assert.rejects(tools.applyPatch({ path: '.env', search: 'x', replace: 'y' }), /not found|workspace|environment/i);
  });
});

test('blocks shell operators, destructive actions, and unapproved noninteractive commands', async () => {
  await workspaceCase(async (root, tools) => {
    await tools.init();
    await assert.rejects(tools.runShell({ command: 'git status; echo secret' }), /operators/);
    await assert.rejects(tools.runShell({ command: 'git reset --hard' }), /blocked/);
  });
});
