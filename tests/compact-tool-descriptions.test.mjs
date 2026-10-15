import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceTools } from '../src/tools.mjs';
import { loadConfig } from '../src/config.mjs';
import { createAgentSession, runTask } from '../src/agent.mjs';

const withoutDescriptions = definitions => definitions.map(({ description, ...rest }) => rest);
async function scenario(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tea-s3-')));
  try { await fn(root); }
  finally {
    const relative = path.relative(await realpath(os.tmpdir()), root);
    assert.ok(relative.startsWith('tea-s3-') && !relative.includes(path.sep));
    await rm(root, { recursive: true, force: true });
  }
}

test('compact descriptions preserve every schema and reduce both inventory variants without mutating shared definitions', () => {
  const tools = new WorkspaceTools({ workspace: '.' }), other = new WorkspaceTools({ workspace: '.' });
  for (const discoveryWide of [true, false]) for (const enableFileCreation of [true, false]) {
    tools.discoveryWide = discoveryWide; tools.enableFileCreation = enableFileCreation;
    tools.compactToolDescriptions = false;
    const before = structuredClone(tools.modelToolDefinitions());
    tools.compactToolDescriptions = true;
    const after = tools.modelToolDefinitions();
    assert.deepEqual(withoutDescriptions(after), withoutDescriptions(before));
    assert.ok(JSON.stringify(after).length < JSON.stringify(before).length);
    tools.compactToolDescriptions = false;
    assert.deepEqual(tools.modelToolDefinitions(), before);
  }
  assert.equal(other.compactToolDescriptions, undefined);
});

test('compact descriptions retain creation, permission, pagination and validation boundaries', () => {
  const tools = new WorkspaceTools({ workspace: '.' }); tools.compactToolDescriptions = true;
  const get = name => tools.modelToolDefinitions().find(t => t.name === name).description;
  assert.match(get('write_file'), /never overwrite/); assert.match(get('write_file'), /not shell/);
  assert.match(get('write_file'), /apply_patch/); assert.match(get('write_file'), /Validate/);
  assert.match(get('run_tests'), /Only validation/); assert.match(get('run_tests'), /Git diagnostics/);
  assert.match(get('run_shell'), /explicit approval/); assert.match(get('run_shell'), /destructive/);
  assert.match(get('list_files'), /secrets.*excluded/);
  assert.match(get('search_code'), /not exhaustive/); assert.match(get('search_code'), /nextLine/);
  tools.discoveryWide = false;
  assert.doesNotMatch(get('search_code'), /nextLine/);
  tools.searchCursorNeeded = true;
  assert.match(get('search_code'), /nextLine/);
});

test('dynamic vocabulary and ContextOS tools keep their original definitions', () => {
  const tools = new WorkspaceTools({ workspace: '.' });
  tools.unresolvedQueries.add('renew');
  tools.contextMemory = { evicted: new Set(['old']), definitions: [{ name: 'recall_context', description: 'exact retained guidance', input_schema: { type: 'object' } }] };
  const before = tools.modelToolDefinitions(); tools.compactToolDescriptions = true;
  const after = tools.modelToolDefinitions();
  for (const name of ['remember_term_mapping', 'recall_context']) assert.deepEqual(after.find(t => t.name === name), before.find(t => t.name === name));
});

test('agent applies compact descriptions per turn while preserving system, capabilities and historical messages', async () => scenario(async root => {
  await writeFile(path.join(root, 'a.mjs'), 'export const value = 1;');
  const config = { ...loadConfig({ workspace: root, runId: 'first' }, {}), capabilityFeedback: true };
  const session = createAgentSession(config), captured = [];
  const adapterFactory = () => ({ complete: async request => {
    captured.push(structuredClone(request));
    return { content: [{ type: 'text', text: 'Inspected.' }], stop_reason: 'end_turn' };
  } });
  await runTask('Inspect only', config, { session, adapterFactory });
  const history = structuredClone(session.messages), capabilities = structuredClone(session.capabilities);
  await runTask('Continue inspecting', { ...config, runId: 'second', compactToolDescriptions: true }, { session, adapterFactory });
  assert.equal(captured[0].system, captured[1].system);
  assert.deepEqual(session.messages.slice(0, history.length), history);
  assert.deepEqual(session.capabilities, capabilities);
  assert.equal((JSON.stringify(captured[1].messages).match(/Runtime capabilities v1-/g) || []).length, 1);
  assert.deepEqual(withoutDescriptions(captured[0].tools), withoutDescriptions(captured[1].tools));
  assert.ok(JSON.stringify(captured[1].tools).length < JSON.stringify(captured[0].tools).length);
  await runTask('Continue again', { ...config, runId: 'third' }, { session, adapterFactory });
  assert.deepEqual(captured[2].tools, captured[0].tools);
}));
