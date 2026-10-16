import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ToolContext, ToolSpec, ToolService } from '../src/tools/core.mjs';
import { WorkspaceTools, dispatchTool, TOOL_DEFINITIONS, TERM_MAPPING_TOOL } from '../src/tools.mjs';
import { ContextMemory } from '../src/context-assembler.mjs';

async function temporary(fn) {
  const base = await realpath(os.tmpdir()), root = await realpath(await mkdtemp(path.join(base, 'tea-tool-core-')));
  try { const tools = new WorkspaceTools({ workspace: root }); await tools.init(); await fn(tools, root); }
  finally {
    const rel = path.relative(base, root); assert(rel.startsWith('tea-tool-core-') && !rel.includes(path.sep) && !path.isAbsolute(rel));
    await rm(root, { recursive: true, force: true });
  }
}
const spec = (name, execute, extra = {}) => new ToolSpec({ name, definition: { name, input_schema: { type: 'object' } }, execute, ...extra });

test('tool core validates registration, rejects duplicate names and keeps specs immutable', () => {
  assert.throws(() => new ToolContext({}), /backend/);
  assert.throws(() => spec('bad name', () => {}), /name/);
  assert.throws(() => spec('x', undefined), /executor/);
  assert.throws(() => new ToolSpec({ name: 'x', definition: { name: 'wrong' }, execute() {} }), /definition/);
  assert.throws(() => spec('x', () => {}, { validatesSource: true }), /effects/);
  const context = new ToolContext({ backend: {} }), item = spec('read', () => 'ok');
  const service = new ToolService({ context, specs: [item] });
  assert.throws(() => service.register(item), /already registered/);
  assert.throws(() => service.register({ name: 'x' }), /ToolSpec/);
  assert.throws(() => { item.execute = () => 'changed'; }, TypeError);
  const names = service.registeredNames(); names.push('not_registered');
  assert.deepEqual(service.registeredNames(), ['read']); assert.equal(service.spec('read'), item);
});

test('ToolContext observes current signal, ledger, memory, workspace, approval and session', () => {
  const backend = { workspace: 'before', ledger: {}, contextMemory: {}, approveCommand: () => false };
  const context = new ToolContext({ backend });
  const controller = new AbortController(), session = {};
  Object.assign(backend, { workspace: 'after', signal: controller.signal, ledger: { current: true }, contextMemory: { current: true }, approveCommand: () => true });
  context.bindSession(session);
  assert.equal(context.workspace, 'after'); assert.equal(context.signal, controller.signal);
  assert.equal(context.ledger, backend.ledger); assert.equal(context.memory, backend.contextMemory);
  assert(context.approveCommand()); assert.equal(context.session, session);
  context.bindSession(null); assert.equal(context.session, null);
  assert.throws(() => context.bindSession(1), /session/);
});

test('ToolService preserves input/output and error identity; optional validation precedes execution', async () => {
  const input = { path: 'a' }, output = { text: 'ok' }, failure = Error('original'); let calls = 0;
  const service = new ToolService({ context: new ToolContext({ backend: {} }), specs: [spec('read', (context, value) => {
    assert.equal(value, input); calls++; return output;
  }, { validateInput: value => { if (value !== input) throw failure; } }), spec('fail', () => { throw failure; })] });
  assert.equal(await service.execute('read', input), output);
  await assert.rejects(service.execute('read', {}), error => error === failure);
  await assert.rejects(service.execute('fail', {}), error => error === failure);
  await assert.rejects(service.execute('missing', {}), /Unknown tool: missing/);
  assert.equal(calls, 1);
});

test('ToolService cancellation prevents execution and does not race unfinished operations', async () => {
  const controller = new AbortController(), backend = { signal: controller.signal }; let calls = 0;
  const service = new ToolService({ context: new ToolContext({ backend }), specs: [spec('write', () => { calls++; })] });
  controller.abort(); await assert.rejects(service.execute('write', {}), { name: 'AbortError' }); assert.equal(calls, 0);
  let release, finished = false, settled = false;
  const next = new AbortController(); backend.signal = next.signal;
  service.register(spec('slow', async () => { await new Promise(resolve => { release = resolve; }); finished = true; return 'done'; }));
  const running = service.execute('slow', {}).then(value => { settled = true; return value; });
  next.abort(); await Promise.resolve(); assert.equal(settled, false); assert.equal(finished, false);
  release(); assert.equal(await running, 'done'); assert(finished);
});

test('ToolService rechecks cancellation after asynchronous validation', async () => {
  const controller = new AbortController(); let called = false;
  const service = new ToolService({ context: new ToolContext({ backend: { signal: controller.signal } }), specs: [spec('write', () => { called = true; }, {
    validateInput: async () => { controller.abort(); },
  })] });
  await assert.rejects(service.execute('write', {}), { name: 'AbortError' }); assert.equal(called, false);
});

test('workspace registry covers every advertised tool and preserves definition selection', async () => temporary(async tools => {
  const service = tools.toolService; assert.equal(service, tools.toolService);
  assert.equal(service.context.backend, tools);
  assert.equal(service.registeredNames().length, 10);
  assert.deepEqual(tools.modelToolDefinitions(), TOOL_DEFINITIONS);
  tools.discoveryWide = false;
  assert(!tools.modelToolDefinitions().find(x => x.name === 'search_code').input_schema.properties.offset);
  tools.searchCursorNeeded = true;
  assert.deepEqual(tools.modelToolDefinitions(), TOOL_DEFINITIONS);
  tools.enableFileCreation = false;
  assert(!tools.modelToolDefinitions().some(x => x.name === 'write_file'));
  tools.unresolvedQueries.add('unknown');
  assert.deepEqual(tools.modelToolDefinitions().at(-1), TERM_MAPPING_TOOL);
  tools.contextMemory = new ContextMemory(tools); tools.contextMemory.evicted.add('ctx-missing');
  assert.deepEqual(tools.modelToolDefinitions().slice(-2), tools.contextMemory.definitions);
  assert(!tools.modelToolDefinitions({ includeMemory: false }).some(x => x.name === 'recall_context'));
  for (const definition of tools.modelToolDefinitions()) assert(service.spec(definition.name));
}));

test('workspace service preserves dispatch results, policies and live backend replacement', async () => temporary(async (tools, root) => {
  await writeFile(path.join(root, 'a.txt'), 'old\n');
  assert.match(await dispatchTool(tools, 'read_file', { path: 'a.txt' }), /1: old/);
  assert.equal(await tools.toolService.execute('apply_patch', { path: 'a.txt', search: 'old', replace: 'new' }), 'Updated a.txt');
  assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'new\n');
  await assert.rejects(dispatchTool(tools, 'write_file', { path: 'a.txt', content: 'overwrite' }), /already exists/);
  tools.enableFileCreation = false;
  await assert.rejects(dispatchTool(tools, 'write_file', { path: 'b.txt', content: '' }), /disabled/);
  await assert.rejects(dispatchTool(tools, 'read_file', { path: '../outside' }), /escapes/);
  await assert.rejects(dispatchTool(tools, 'run_shell', { command: 'echo hi | more' }), /operators/);
  const marker = {}; tools.readFile = value => { assert.equal(value, marker); return 'new executor'; };
  assert.equal(await dispatchTool(tools, 'read_file', marker), 'new executor');
}));

test('tool effects distinguish successful edits, genuine validation and diagnostics', async () => temporary(async tools => {
  const service = tools.toolService;
  assert.deepEqual(service.effects('apply_patch', {}), { mutatesWorkspace: true, validatesSource: false, commandTiming: false, phase: 'edit' });
  assert(service.effects('write_file', {}).mutatesWorkspace);
  assert(service.effects('run_tests', { command: 'node --test a.test.mjs' }).validatesSource);
  assert(service.effects('run_shell', { command: 'node --test a.test.mjs' }).validatesSource);
  for (const command of ['git status', 'node --test --help', 'node -e 1', 'npm test | more']) assert(!service.effects('run_shell', { command }).validatesSource);
  assert(!service.effects('read_file', { command: 'node --test' }).validatesSource);
  assert.deepEqual(service.effects('missing', {}), { mutatesWorkspace: false, validatesSource: false, commandTiming: false, phase: 'locate' });
}));

test('ContextOS registry dispatch observes replacement memory objects and missing-memory policy', async () => temporary(async tools => {
  await assert.rejects(dispatchTool(tools, 'recall_context', { ref: 'x' }), /unavailable/);
  const input = { ref: 'x' }; tools.contextMemory = { recall: value => { assert.equal(value, input); return 'first'; } };
  assert.equal(await dispatchTool(tools, 'recall_context', input), 'first');
  tools.contextMemory = { recall: () => 'second', search: () => 'search' };
  assert.equal(await dispatchTool(tools, 'recall_context', input), 'second');
  assert.equal(await dispatchTool(tools, 'search_history', { query: 'x' }), 'search');
  tools.contextMemory = null; await assert.rejects(dispatchTool(tools, 'search_history', {}), /unavailable/);
}));

test('generic registry supports dynamic definitions without serializing host context', () => {
  const backend = { show: false, ledger: { secret: 'host-only' } };
  const service = new ToolService({ context: new ToolContext({ backend }), specs: [spec('dynamic', () => '', {
    definition: context => context.backend.show ? { name: 'dynamic', input_schema: { type: 'object' } } : undefined,
  })] });
  assert.deepEqual(service.definitions(), []); backend.show = true;
  assert.equal(service.definitions()[0].name, 'dynamic'); assert(!JSON.stringify(service.definitions()).includes('host-only'));
});

test('definition selection only advertises registered specifications in selected order', () => {
  const context = new ToolContext({ backend: {} }); let names = ['second', 'first'];
  const service = new ToolService({ context, specs: [spec('first', () => ''), spec('second', () => '')], selectDefinitions: () => names });
  assert.deepEqual(service.definitions().map(x => x.name), ['second', 'first']);
  names = ['missing']; assert.throws(() => service.definitions(), /Unregistered/);
});
