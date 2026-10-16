import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceTools } from '../src/tools.mjs';
import { replaceVersionedFile } from '../src/versioned-write.mjs';
import { runTask, createAgentSession, resetConversation } from '../src/agent.mjs';
import { loadCliConfig } from '../src/config.mjs';
import { runtimeCapabilities, capabilityNotice } from '../src/tool-feedback.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
async function temporary(fn) {
  const base = await fs.realpath(os.tmpdir()), root = await fs.realpath(await fs.mkdtemp(path.join(base, 'tea-s6-')));
  try { return await fn(root); } finally {
    const rel = path.relative(base, root); assert(rel.startsWith('tea-s6-') && !rel.includes(path.sep) && !path.isAbsolute(rel));
    await fs.rm(root, { recursive: true, force: true });
  }
}
async function setup(root, content = 'old\n') {
  await fs.writeFile(path.join(root, 'a.mjs'), content);
  const tools = new WorkspaceTools({ workspace: root }); await tools.init(); tools.versionedWrite = true;
  return tools;
}
async function read(tools, input = { path: 'a.mjs' }) {
  const output = await tools.readFile(input); tools.acknowledgeVersionedReads([{ content: output, is_error: false }]);
  return output.match(/sha256=([a-f0-9]{64})/)?.[1];
}
const replace = (tools, expected_sha256, content = 'new\n') => tools.writeFile({ path: 'a.mjs', content, expected_sha256 });

test('S6 remains off by default; default schemas and capability text are unchanged', async () => temporary(async root => {
  const tools = await setup(root); tools.versionedWrite = false;
  const original = JSON.stringify(tools.modelToolDefinitions());
  assert(!original.includes('expected_sha256'));
  await assert.rejects(replace(tools, hash('old\n')), /disabled/);
  await assert.rejects(tools.writeFile({ path: 'a.mjs', content: 'new' }), /already exists/);
  tools.versionedWrite = true; assert(JSON.stringify(tools.modelToolDefinitions()).includes('expected_sha256'));
  tools.versionedWrite = false; assert.equal(JSON.stringify(tools.modelToolDefinitions()), original);
  assert.equal(capabilityNotice(runtimeCapabilities({ fileCreation: true })), capabilityNotice(runtimeCapabilities({ fileCreation: true, versionedWrite: false })));
  assert(capabilityNotice(runtimeCapabilities({ fileCreation: true, versionedWrite: true })).includes('expected_sha256'));
}));

test('S6 supports empty, Chinese, CRLF, BOM and normal text without retaining file bodies', async () => temporary(async root => {
  for (const old of ['', '中文\r\n第二行\r\n', '\uFEFFold\n', 'old\n']) {
    const tools = await setup(root, old), receipt = await read(tools);
    assert.match(await replace(tools, receipt, '新的内容\n'), /Updated/);
    assert.equal(await fs.readFile(path.join(root, 'a.mjs'), 'utf8'), '新的内容\n');
    await assert.rejects(replace(tools, receipt), /No delivered/);
  }
}));

test('S6 refuses unread, partial, truncated and redacted sources', async () => temporary(async root => {
  let tools = await setup(root);
  await assert.rejects(replace(tools, hash('old\n')), /No delivered/);
  tools = await setup(root, 'one\ntwo\nthree');
  await assert.rejects(replace(tools, await read(tools, { path: 'a.mjs', startLine: 2 })), /No delivered/);
  tools = await setup(root, 'x'.repeat(15000));
  await assert.rejects(replace(tools, await read(tools)), /No delivered/);
  tools = await setup(root, 'const password = "example";\n');
  await assert.rejects(replace(tools, await read(tools)), /No delivered/);
}));

test('S6 only accepts acknowledged read results; cancellation does not publish authorization', async () => temporary(async root => {
  const tools = await setup(root), output = await tools.readFile({ path: 'a.mjs' }), receipt = hash('old\n');
  await assert.rejects(replace(tools, receipt), /No delivered/);
  tools.acknowledgeVersionedReads([{ content: output, is_error: true }]);
  await assert.rejects(replace(tools, receipt), /No delivered/);
  const controller = new AbortController(); tools.signal = controller.signal; controller.abort();
  tools.acknowledgeVersionedReads([{ content: output, is_error: false }]); tools.signal = undefined;
  await assert.rejects(replace(tools, receipt), /No delivered/);
  assert.equal(await fs.readFile(path.join(root, 'a.mjs'), 'utf8'), 'old\n');
}));

test('S6 rejects malformed or wrong hash, missing files and disabled creation', async () => temporary(async root => {
  const tools = await setup(root), receipt = await read(tools);
  await assert.rejects(replace(tools, 'short'), /full SHA/);
  await assert.rejects(replace(tools, '0'.repeat(64)), /No delivered/);
  await assert.rejects(tools.writeFile({ path: 'missing/child.mjs', content: '', expected_sha256: receipt }), /No delivered/);
  await assert.rejects(fs.stat(path.join(root, 'missing')), { code: 'ENOENT' });
  tools.enableFileCreation = false; await assert.rejects(replace(tools, receipt), /disabled/);
}));

test('S6 detects manual changes, deletion and replacement by a new inode', async () => temporary(async root => {
  let tools = await setup(root), receipt = await read(tools);
  await fs.writeFile(path.join(root, 'a.mjs'), 'user\n');
  await assert.rejects(replace(tools, receipt), /expired/); assert.equal(await fs.readFile(path.join(root, 'a.mjs'), 'utf8'), 'user\n');
  tools = await setup(root); receipt = await read(tools); await fs.unlink(path.join(root, 'a.mjs'));
  await assert.rejects(replace(tools, receipt), { code: 'ENOENT' });
  tools = await setup(root); receipt = await read(tools);
  await fs.writeFile(path.join(root, 'other'), 'old\n'); await fs.rename(path.join(root, 'other'), path.join(root, 'a.mjs'));
  await assert.rejects(replace(tools, receipt), /expired/);
}));

test('S6 keeps raw-byte identity even when BOM removal would leave the same displayed text', async () => temporary(async root => {
  const tools = await setup(root, '\uFEFFold\n'), receipt = await read(tools);
  await fs.writeFile(path.join(root, 'a.mjs'), 'old\n');
  await assert.rejects(replace(tools, receipt), /expired/);
}));

test('S6 refuses read-only files and preserves ordinary mode bits', async () => temporary(async root => {
  const filename = path.join(root, 'a.mjs');
  const tools = await setup(root); await fs.chmod(filename, 0o444);
  try { await assert.rejects(replace(tools, await read(tools)), /expired/); }
  finally { await fs.chmod(filename, 0o644); }
  await fs.chmod(filename, 0o744); const mode = (await fs.stat(filename)).mode & 0o777;
  await replace(tools, await read(tools)); assert.equal((await fs.stat(filename)).mode & 0o777, mode);
}));

test('S6 invalidates after patch, reset, GC-style evidence clear and fresh tools', async () => temporary(async root => {
  let tools = await setup(root), receipt = await read(tools);
  await tools.applyPatch({ path: 'a.mjs', search: 'old', replace: 'edited' });
  await assert.rejects(replace(tools, receipt), /No delivered/);
  tools = await setup(root); receipt = await read(tools); tools.presentedSource.clear();
  await assert.rejects(replace(tools, receipt), /No delivered/);
  tools = new WorkspaceTools({ workspace: root }); await tools.init(); tools.versionedWrite = true;
  await assert.rejects(replace(tools, receipt), /No delivered/);
  tools = await setup(root); receipt = await read(tools);
  const session = createAgentSession(loadCliConfig({ workspace: root }, {})); session.persistent = false; session.tools = tools; resetConversation(session);
  await assert.rejects(replace(tools, receipt), /No delivered/);
}));

test('S6 preserves create-only behavior and blocks sensitive or escaping paths', async () => temporary(async root => {
  const tools = await setup(root), receipt = await read(tools);
  await tools.writeFile({ path: 'sub/new.mjs', content: '' });
  await assert.rejects(replace(tools, undefined), /already exists/);
  for (const target of ['../outside', '.tea/file', '.git/config', '.env', 'credentials.json', 'file:stream']) {
    await assert.rejects(tools.writeFile({ path: target, content: '', expected_sha256: receipt }));
  }
}));

test('S6 rejects hardlinks and symlink parents', async () => temporary(async root => {
  const tools = await setup(root), receipt = await read(tools);
  await fs.link(path.join(root, 'a.mjs'), path.join(root, 'alias'));
  await assert.rejects(replace(tools, receipt), /expired/);
  await fs.mkdir(path.join(root, 'real'));
  await fs.writeFile(path.join(root, 'real', 'b.mjs'), 'old');
  await fs.symlink(path.join(root, 'real'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const output = await tools.readFile({ path: 'linked/b.mjs' }); tools.acknowledgeVersionedReads([{ content: output }]);
  await assert.rejects(tools.writeFile({ path: 'linked/b.mjs', content: 'new', expected_sha256: hash('old') }), /No delivered|expired/);
}));

test('S6 staging failures, cancellation and observed precommit edits preserve the target and clean temporary files', async () => temporary(async root => {
  const filename = path.join(root, 'a.mjs');
  for (const scenario of ['write-error', 'rename-error', 'cancel', 'edit']) {
    await fs.writeFile(filename, 'old'); const info = await fs.stat(filename);
    const controller = new AbortController(); let reads = 0;
    const io = { ...fs,
      open: async (...args) => {
        const handle = await fs.open(...args);
        if (scenario === 'write-error') return { chmod: (...x) => handle.chmod(...x), close: () => handle.close(), writeFile: async () => { throw Error('injected write failure'); } };
        return handle;
      },
      readFile: async (...args) => {
        if (++reads === 2 && scenario === 'edit') await fs.writeFile(filename, 'user');
        if (reads === 2 && scenario === 'cancel') controller.abort();
        return fs.readFile(...args);
      },
      rename: scenario === 'rename-error' ? async () => { throw Error('injected rename failure'); } : fs.rename,
    };
    await assert.rejects(replaceVersionedFile({ workspace: root, filename, evidence: { ...info, rawHash: hash('old') }, data: Buffer.from('new'), signal: controller.signal }, io));
    assert.equal(await fs.readFile(filename, 'utf8'), scenario === 'edit' ? 'user' : 'old');
    assert.deepEqual((await fs.readdir(root)).filter(x => x.startsWith('.tea-write-')), []);
  }
}));

test('S6 real agent replacement establishes pending validation; real tests are still required', async () => temporary(async root => {
  await fs.writeFile(path.join(root, 'a.mjs'), "export const value = 1;\n");
  await fs.writeFile(path.join(root, 'check.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import {value} from './a.mjs'; test('value',()=>assert.equal(value,2));\n");
  const config = { ...loadCliConfig({ workspace: root, runId: 's6-scripted' }, {}), versionedWrite: true };
  let step = 0, receipt;
  const result = await runTask('Update value to 2 and verify', config, { adapterFactory: () => ({ complete: async request => {
    if (step++ === 0) return { content: [{ type: 'tool_use', id: 'read', name: 'read_file', input: { path: 'a.mjs' } }], stop_reason: 'tool_use' };
    if (step === 2) {
      receipt = request.messages.at(-1).content[0].content.match(/sha256=([a-f0-9]{64})/)[1];
      return { content: [{ type: 'tool_use', id: 'write', name: 'write_file', input: { path: 'a.mjs', content: 'export const value = 2;\n', expected_sha256: receipt } }], stop_reason: 'tool_use' };
    }
    if (step === 3) return { content: [{ type: 'tool_use', id: 'test', name: 'run_tests', input: { command: 'node --test check.test.mjs' } }], stop_reason: 'tool_use' };
    return { content: [{ type: 'text', text: 'Verified.' }], stop_reason: 'end_turn' };
  } }) });
  assert.equal(result.status, 'completed'); assert.equal(result.validationPassed, true); assert.equal(result.validationAttempts, 1);
  assert.deepEqual(result.changedFiles, ['a.mjs']);
}));

test('S6 resumed sessions cannot authorize a replacement from persisted read caches alone', async () => temporary(async root => {
  await fs.writeFile(path.join(root, 'a.mjs'), 'old\n');
  const config = { ...loadCliConfig({ workspace: root, runId: 's6-before-resume' }, {}), versionedWrite: true };
  let step = 0;
  const first = await runTask('Read a.mjs', config, { adapterFactory: () => ({ complete: async () => ++step === 1
    ? { content: [{ type: 'tool_use', id: 'r', name: 'read_file', input: { path: 'a.mjs' } }], stop_reason: 'tool_use' }
    : { content: [{ type: 'text', text: 'Read.' }], stop_reason: 'end_turn' } }) });
  const resumed = { ...config, runId: 's6-after-resume', resume: first.sessionId };
  step = 0; let refused = false;
  await runTask('Attempt a versioned edit', resumed, { adapterFactory: () => ({ complete: async request => {
    if (++step === 1) return { content: [{ type: 'tool_use', id: 'w', name: 'write_file', input: { path: 'a.mjs', content: 'new\n', expected_sha256: hash('old\n') } }], stop_reason: 'tool_use' };
    refused = request.messages.at(-1).content.some(x => x.is_error && /No delivered/.test(x.content));
    return { content: [{ type: 'text', text: 'Must reread.' }], stop_reason: 'end_turn' };
  } }) });
  assert(refused); assert.equal(await fs.readFile(path.join(root, 'a.mjs'), 'utf8'), 'old\n');
}));
