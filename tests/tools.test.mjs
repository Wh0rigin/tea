import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isValidationCommand, WorkspaceTools } from '../src/tools.mjs';

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
    const listing = await tools.listFiles();
    assert.match(listing, /^Scoped listing: \.; offset=0; 1 paths\./);
    assert.equal(listing.split('\n').slice(1).join('\n'), 'src.js');
    assert.match(await tools.searchCode({ query: 'target' }), /src\.js:1/);
    await assert.rejects(tools.readFile({ path: '.env' }), /credential|allowlist|regular text file/);
    await assert.rejects(tools.readFile({ path: 'credentials.json' }), /credential/);
  });
});

test('shows task-ranked initial inventory while keeping the full listing available on demand', async () => {
  await workspaceCase(async (root, tools) => {
    await mkdir(path.join(root, 'archive'), { recursive: true });
    await mkdir(path.join(root, 'src'), { recursive: true });
    for (let index = 0; index < 60; index += 1) await writeFile(path.join(root, 'archive', `record-${String(index).padStart(3, '0')}.txt`), 'old\n');
    await writeFile(path.join(root, 'src', 'retry_limit.ts'), 'export const retryLimit = 3;\n');
    await tools.init();
    const inventory = await tools.initialInventory({ task: 'Update the retry limit configuration', strategy: 'v1-inventory', limit: 8 });
    assert.equal(inventory.totalFiles, 61);
    assert.ok(inventory.selectedFiles.includes('src/retry_limit.ts'));
    assert.match(inventory.text, /partial/);
    assert.match(await tools.listFiles({ maxFiles: 100 }), /src\/retry_limit\.ts/);
    assert.match(await tools.listFiles({ maxFiles: 10, offset: 60 }), /src\/retry_limit\.ts/);
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

test('deduplicates unchanged evidence and refreshes its reference after a source edit', async () => {
  await workspaceCase(async (root, tools) => {
    await tools.init();
    const filename = path.join(root, 'session.js');
    await writeFile(filename, 'export const state = "ready";\nexport const retry = 2;\n');
    const first = await tools.readFile({ path: 'session.js' });
    const repeated = await tools.readFile({ path: 'session.js' });
    assert.match(first, /evidence ref=session\.js#L1-L3@/);
    assert.match(repeated, /Evidence unchanged/);
    assert.doesNotMatch(repeated, /export const state/);

    await tools.applyPatch({ path: 'session.js', search: '"ready"', replace: '"expired"' });
    const refreshed = await tools.readFile({ path: 'session.js' });
    assert.match(refreshed, /export const state = "expired"/);
    assert.doesNotMatch(refreshed, /Evidence unchanged/);
    assert.match(await tools.readFile({ path: 'session.js' }), /Evidence unchanged/);

    await tools.applyPatch({ path: 'session.js', search: '"expired"', replace: '"ready"' });
    const restored = await tools.readFile({ path: 'session.js' });
    assert.equal(restored, first);
    assert.doesNotMatch(restored, /Evidence unchanged/);
    assert.match(await tools.readFile({ path: 'session.js' }), /Evidence unchanged/);
  });
});

test('does not claim that truncated requested ranges are fully available in history', async () => {
  await workspaceCase(async (root, tools) => {
    const lines = Array.from({ length: 400 }, (_, index) => `const field${index} = '${'x'.repeat(50)}';`);
    lines.push('const HIDDEN_TAIL = true;');
    await writeFile(path.join(root, 'large.js'), `${lines.join('\n')}\n`);
    await tools.init();
    const first = await tools.readFile({ path: 'large.js' });
    const repeated = await tools.readFile({ path: 'large.js' });
    assert.match(first, /\[truncated;/);
    assert.match(first, /Only a prefix of the requested lines is shown/);
    assert.match(first, /Use smaller startLine\/endLine ranges/);
    assert.doesNotMatch(first, /HIDDEN_TAIL/);
    assert.ok(first.length <= 14_000);
    assert.equal(repeated, first);
    assert.doesNotMatch(repeated, /Evidence unchanged|Original lines remain in history/);
    assert.equal(tools.readEvidence.size, 0);

    const tail = await tools.readFile({ path: 'large.js', startLine: 401, endLine: 401 });
    assert.match(tail, /401: const HIDDEN_TAIL = true/);
    assert.doesNotMatch(tail, /truncated|Only a prefix/);
    const repeatedTail = await tools.readFile({ path: 'large.js', startLine: 401, endLine: 401 });
    assert.match(repeatedTail, /Evidence unchanged; ref=large\.js#L401-L401@/);
  });
});

test('clears a previously cached range when its replacement becomes too large to return completely', async () => {
  await workspaceCase(async (root, tools) => {
    const filename = path.join(root, 'changing.js');
    await writeFile(filename, 'const state = 1;');
    await tools.init();
    const original = await tools.readFile({ path: 'changing.js', startLine: 1, endLine: 1 });
    assert.match(await tools.readFile({ path: 'changing.js', startLine: 1, endLine: 1 }), /Evidence unchanged/);
    await writeFile(filename, `const state = '${'x'.repeat(15_000)}';`);
    const changed = await tools.readFile({ path: 'changing.js', startLine: 1, endLine: 1 });
    assert.match(changed, /Only a prefix/);
    assert.equal(tools.readEvidence.size, 0);
    assert.equal(await tools.readFile({ path: 'changing.js', startLine: 1, endLine: 1 }), changed);
    await writeFile(filename, 'const state = 1;');
    assert.equal(await tools.readFile({ path: 'changing.js', startLine: 1, endLine: 1 }), original);
    assert.match(await tools.readFile({ path: 'changing.js', startLine: 1, endLine: 1 }), /Evidence unchanged/);
  });
});

test('can disable evidence de-duplication for strategy comparisons', async () => {
  await workspaceCase(async (root) => {
    const tools = new WorkspaceTools({ workspace: root, deduplicateReads: false });
    await tools.init();
    await writeFile(path.join(root, 'same.js'), 'export const status = "ready";\n');
    const first = await tools.readFile({ path: 'same.js' });
    const second = await tools.readFile({ path: 'same.js' });
    assert.match(first, /export const status/);
    assert.match(second, /export const status/);
  });
});

test('repeated evidence references never increase tiny-file output', async () => {
  await workspaceCase(async (root, tools) => {
    await writeFile(path.join(root, 'tiny.js'), 'x');
    await tools.init();
    const first = await tools.readFile({ path: 'tiny.js' });
    const repeated = await tools.readFile({ path: 'tiny.js' });
    assert.ok(repeated.length <= first.length);
    assert.match(repeated, /ref=tiny\.js#L1-L1@[a-f0-9]{16}/);
    assert.doesNotMatch(repeated, /[a-f0-9]{64}/);
  });
});

test('blocks shell operators, destructive actions, and unapproved noninteractive commands', async () => {
  await workspaceCase(async (root, tools) => {
    await tools.init();
    await assert.rejects(tools.runShell({ command: 'git status; echo secret' }), /operators/);
    await assert.rejects(tools.runShell({ command: 'git reset --hard' }), /blocked/);
  });
});

test('distinguishes actual validation from Git diagnostics and help or collection flags', () => {
  for (const command of ['node --test', 'node --test selected.test.mjs', 'npm test', 'npm run typecheck', 'python -m unittest -v', 'pytest -v', 'pytest -p no:cacheprovider']) {
    assert.equal(isValidationCommand(command), true, command);
  }
  for (const command of ['git status', 'git diff --check', 'git log -3 --oneline', 'node --test --help', 'node --test -v', 'node --test --eval anything', 'pytest --collect-only', 'python -m pytest --fixtures', 'npm test -- --version', 'node --test\nanything', undefined]) {
    assert.equal(isValidationCommand(command), false, String(command));
  }
});

test('validation classification uses the same whitespace tokenization as command execution', () => {
  for (const whitespace of [' ', '  ', '\t', '\v', '\f', '\u00a0']) {
    assert.equal(isValidationCommand(`node${whitespace}--test${whitespace}selected.test.mjs`), true);
    for (const flag of ['-v', '-e', '-p', '--version', '--help']) {
      const command = ` \tnode${whitespace}--test${whitespace}${flag}\t `;
      assert.equal(isValidationCommand(command), false, JSON.stringify(command));
    }
  }
  for (const command of ['node\n--test', 'node\r--test', 'node --test\n-v', 'node --test\r\nselected.test.mjs']) {
    assert.equal(isValidationCommand(command), false, JSON.stringify(command));
  }
});

test('large successful test output completes and keeps its final summary in a smaller budget', async () => {
  await workspaceCase(async (root, tools) => {
    await writeFile(path.join(root, 'verbose.test.mjs'), `import test from 'node:test';\nconsole.log('HEAD_SUCCESS');\nprocess.stdout.write('verbose test evidence\\n'.repeat(10_000));\nconsole.error('password=private-value');\ntest('TAIL_SUCCESS', () => {});\n`);
    await tools.init();
    const output = await tools.runTests({ command: 'node --test --test-reporter=tap verbose.test.mjs' });
    assert.match(output, /^exit=0\n/);
    assert.match(output, /HEAD_SUCCESS/);
    assert.match(output, /TAIL_SUCCESS/);
    assert.match(output, /# pass 1/);
    assert.match(output, /chars omitted; stream sha256=/);
    assert.doesNotMatch(output, /private-value/);
    assert.ok(output.length < 4_500, `Successful output contained ${output.length} chars`);
  });
});

test('large failing test output completes and retains its assertion and tail summary', async () => {
  await workspaceCase(async (root, tools) => {
    await writeFile(path.join(root, 'failure.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nconsole.log('HEAD_FAILURE');\nprocess.stdout.write('verbose test evidence\\n'.repeat(10_000));\ntest('TAIL_FAILURE', () => assert.equal('actual', 'expected'));\n`);
    await tools.init();
    const output = await tools.runTests({ command: 'node --test --test-reporter=tap failure.test.mjs' });
    assert.match(output, /^exit=1\n/);
    assert.match(output, /HEAD_FAILURE/);
    assert.match(output, /TAIL_FAILURE/);
    assert.match(output, /ERR_ASSERTION/);
    assert.match(output, /# fail 1/);
    assert.ok(output.length < 13_500, `Failing output contained ${output.length} chars`);
  });
});

test('test timeout remains enforced when command output is bounded', async () => {
  await workspaceCase(async (root) => {
    const tools = new WorkspaceTools({ workspace: root, maxCommandMs: 500 });
    await writeFile(path.join(root, 'hang.test.mjs'), 'setInterval(() => {}, 1000);\n');
    await tools.init();
    await assert.rejects(tools.runTests({ command: 'node --test hang.test.mjs' }), /timed out after 500 ms/);
  });
});
