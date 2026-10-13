import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceTools } from '../src/tools.mjs';
import { ContextMemory } from '../src/context-assembler.mjs';
import { digest } from '../src/session-journal.mjs';
import { loadConfig } from '../src/config.mjs';
import { createAgentSession, runTask, resetConversation } from '../src/agent.mjs';

async function scenario(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-evidence-'));
  try {
    const tools = new WorkspaceTools({ workspace: root }); await tools.init();
    await fn(root, tools);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const pair = (id, output) => [
  { role: 'assistant', content: [{ type: 'tool_use', id, name: 'read_file', input: { path: 'value.mjs' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] },
];

test('compact evidence removes exactly the redundant full hash and preserves source lines', async () => scenario(async (root, tools) => {
  const source = 'export const value = 1;\n';
  await writeFile(path.join(root, 'value.mjs'), source);
  const output = await tools.readFile({ path: 'value.mjs' });
  const hash = digest(source), ref = `value.mjs#L1-L2@${hash.slice(0, 16)}`;
  const legacy = `[evidence ref=${ref} sha256=${hash}]\n1: export const value = 1;\n2: `;
  assert.equal(output, legacy.replace(` sha256=${hash}`, ''));
  assert.equal(Buffer.byteLength(legacy) - Buffer.byteLength(output), 72);
  assert.deepEqual(tools.sourceEvidence.get(digest(output)), { path: 'value.mjs', sourceHash: hash });
  const repeat = await tools.readFile({ path: 'value.mjs' });
  assert.equal(repeat, output, 'A tiny source stays shorter than the unchanged-reference notice');
  assert.equal(tools.readEvidence.get('value.mjs:1-2'), hash);
}));

test('compact range headers preserve Unicode, redaction and complete range evidence', async () => scenario(async (root, tools) => {
  await writeFile(path.join(root, '模块.py'), 'first\n变量 = "🚀"\npassword = "hidden"\nlast\n');
  const output = await tools.readFile({ path: '模块.py', startLine: 2, endLine: 3 });
  assert.match(output, /^\[evidence ref=模块\.py#L2-L3@[a-f0-9]{16}\]\n2: 变量 = "🚀"\n3: /);
  assert.doesNotMatch(output, /hidden|first|last|sha256=/);
  assert.equal(tools.sourceEvidence.get(digest(output)).sourceHash.length, 64);
  assert.equal(await tools.readFile({ path: '模块.py', startLine: 2, endLine: 3 }), output);
}));

test('compact truncated reads remain incomplete and are never deduplicated', async () => scenario(async (root, tools) => {
  await writeFile(path.join(root, 'value.mjs'), '// detail\n'.repeat(2200));
  const output = await tools.readFile({ path: 'value.mjs' });
  assert.match(output, /Only a prefix/); assert.equal(tools.readEvidence.size, 0);
  assert.equal(await tools.readFile({ path: 'value.mjs' }), output);
  assert.ok(output.length <= 14000);
}));

test('full source identities survive more than 128 distinct compact read results', async () => scenario(async (root, tools) => {
  const source = Array.from({ length: 150 }, (_, n) => `export const value${n} = ${n};`).join('\n');
  await writeFile(path.join(root, 'value.mjs'), source);
  const messages = [];
  for (let n = 1; n <= 150; n++) messages.push(...pair(`read-${n}`, await tools.readFile({ path: 'value.mjs', startLine: n, endLine: n })));
  assert.equal(tools.sourceEvidence.size, 150);
  const memory = new ContextMemory(tools); memory.rebuild(messages);
  assert.equal(memory.units.size, 150);
  for (const unit of memory.units.values()) {
    assert.equal(unit.sourceHash, digest(source)); assert.equal(await memory.freshness(unit), 'valid');
  }
  await writeFile(path.join(root, 'value.mjs'), source + '\n// changed');
  assert.equal(await memory.freshness(memory.units.values().next().value), 'stale');
}));

test('short displayed prefixes never replace full-hash freshness validation', async () => scenario(async (root, tools) => {
  const source = 'export const value = 1;\n'; await writeFile(path.join(root, 'value.mjs'), source);
  const output = await tools.readFile({ path: 'value.mjs' });
  const hash = digest(source), replacement = hash.slice(0, 16) + (hash[16] === 'a' ? 'b' : 'a') + hash.slice(17);
  tools.sourceEvidence.get(digest(output)).sourceHash = replacement;
  const memory = new ContextMemory(tools); memory.rebuild(pair('read', output));
  assert.equal(await memory.freshness(memory.units.values().next().value), 'stale');
}));

test('missing compact evidence sidecars fail closed instead of trusting the displayed prefix', async () => scenario(async (root, tools) => {
  await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
  const output = await tools.readFile({ path: 'value.mjs' }); tools.sourceEvidence.clear();
  const memory = new ContextMemory(tools); memory.rebuild(pair('read', output));
  const unit = memory.units.values().next().value;
  assert.equal(await memory.freshness(unit), 'stale');
  assert.doesNotMatch(await memory.recall({ ref: unit.ref }), /export const value/);
}));

test('legacy full-hash headers still rebuild and invalidate without a sidecar', async () => scenario(async (root, tools) => {
  const source = 'export const value = 1;\n'; await writeFile(path.join(root, 'value.mjs'), source);
  const hash = digest(source), output = `[evidence ref=value.mjs#L1-L2@${hash.slice(0, 16)} sha256=${hash}]\n1: export const value = 1;\n2: `;
  const memory = new ContextMemory(tools); memory.rebuild(pair('legacy', output));
  const unit = memory.units.values().next().value;
  assert.equal(unit.sourceHash, hash); assert.equal(await memory.freshness(unit), 'valid');
  await writeFile(path.join(root, 'value.mjs'), 'export const value = 2;');
  assert.equal(await memory.freshness(unit), 'stale');
}));

test('compact full-hash sidecars and finding versions survive persistent resume beyond 128 reads', async () => scenario(async (root) => {
  const source = Array.from({ length: 130 }, (_, n) => `export const value${n} = ${n};`).join('\n');
  await writeFile(path.join(root, 'value.mjs'), source);
  const config = { ...loadConfig({ workspace: root, sessionId: 'metadata', memoryPolicy: 'contextos', runId: 'first' }, {}),
    maxToolCalls: 150, contextosTargetBytes: 1000000 };
  const session = createAgentSession(config), calls = Array.from({ length: 130 }, (_, n) => ({
    type: 'tool_use', id: `read-${n}`, name: 'read_file', input: { path: 'value.mjs', startLine: n + 1, endLine: n + 1 },
  }));
  let stage = 0;
  const done = { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' };
  const result = await runTask('Read source only', config, { session, adapterFactory: () => ({ complete: async () => stage++ === 0
    ? { content: calls, stop_reason: 'tool_use' } : done }) });
  assert.equal(result.status, 'completed'); assert.equal(session.tools.sourceEvidence.size, 130);
  assert.ok(session.taskState.confirmed_findings.every(finding => finding.fileVersion === digest(source)));
  const next = { ...config, sessionId: undefined, resume: 'metadata', runId: 'second' }, restored = createAgentSession(next);
  await runTask('Continue read-only', next, { session: restored, adapterFactory: () => ({ complete: async () => done }) });
  assert.deepEqual([...restored.tools.sourceEvidence], [...session.tools.sourceEvidence]);
  for (const unit of restored.contextMemory.units.values()) {
    if (unit.name === 'read_file') assert.equal(unit.sourceHash, digest(source));
  }
  await resetConversation(restored, next);
  assert.equal(restored.tools.sourceEvidence.size, 0); assert.equal(restored.messages.length, 0);
}));
