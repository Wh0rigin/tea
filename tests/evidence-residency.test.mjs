import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContextMemory, validToolProtocol } from '../src/context-assembler.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { loadConfig } from '../src/config.mjs';
import { createAgentSession, runTask } from '../src/agent.mjs';

const pair = (id, name, input, output) => [
  { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] },
];
const recent = () => [...pair('list1', 'list_files', {}, 'first'), ...pair('list2', 'list_files', {}, 'second')];
const source = version => Array.from({ length: 80 }, (_, i) => `export const value${i} = '${version}-中文-${i}';`).join('\n');

async function scenario(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-resident-evidence-'));
  try {
    const tools = new WorkspaceTools({ workspace: root }); await tools.init();
    const config = { ...loadConfig({ workspace: root, memoryPolicy: 'contextos' }, {}), contextosTargetBytes: 4000 };
    const memory = new ContextMemory(tools);
    const assemble = (canonical, extra = {}) => memory.assemble({ messages: canonical, canonical,
      system: 'fixed', tools: tools.modelToolDefinitions({ includeMemory: false }), config,
      state: { pendingValidation: false, validationPassed: false, changedFiles: [] }, ...extra });
    await fn({ root, tools, memory, config, assemble });
  } finally { await rm(root, { recursive: true, force: true }); }
}

for (const mutation of ['manual', 'agent']) test(`stale ${mutation} version does not invalidate a newer resident version`, async () => scenario(async ({ root, tools, assemble }) => {
  await writeFile(path.join(root, 'module.mjs'), source('old'));
  const old = await tools.readFile({ path: './module.mjs' });
  if (mutation === 'manual') await writeFile(path.join(root, 'module.mjs'), source('new'));
  else await tools.applyPatch({ path: 'module.mjs', search: source('old'), replace: source('new') });
  const current = await tools.readFile({ path: 'module.mjs' });
  const messages = [{ role: 'user', content: 'Inspect modules' }, ...pair('old', 'read_file', { path: './module.mjs' }, old),
    ...recent(), ...pair('current', 'read_file', { path: 'module.mjs' }, current)];
  const plan = await assemble(messages);
  assert.equal(plan.diagnostics.staleUnits, 1);
  assert.match(JSON.stringify(plan.request.messages), /new-中文-0/);
  assert.doesNotMatch(JSON.stringify(plan.request.messages), /old-中文-0/);
  assert.equal(tools.readEvidence.size, 1);
  assert.equal(tools.presentedSource.get('module.mjs').lines.get(1), "export const value0 = 'new-中文-0';");
  assert.match(await tools.readFile({ path: 'module.mjs' }), /^Evidence unchanged;/);
  assert.equal(validToolProtocol(plan.request.messages), true);
}));

test('only the resident line range survives when another range is absent from the actual request', async () => scenario(async ({ root, tools, assemble }) => {
  await writeFile(path.join(root, 'module.mjs'), source('current'));
  const older = pair('older', 'read_file', { path: 'module.mjs', startLine: 1, endLine: 20 },
    await tools.readFile({ path: 'module.mjs', startLine: 1, endLine: 20 }));
  const newer = pair('newer', 'read_file', { path: 'module.mjs', startLine: 41, endLine: 60 },
    await tools.readFile({ path: 'module.mjs', startLine: 41, endLine: 60 }));
  const canonical = [{ role: 'user', content: 'Inspect' }, ...older, ...recent(), ...newer];
  await assemble(canonical, { messages: [canonical[0], ...newer] });
  assert.deepEqual([...tools.readEvidence.keys()], ['module.mjs:41-60']);
  assert.deepEqual([...tools.presentedSource.get('module.mjs').lines.keys()], Array.from({ length: 20 }, (_, i) => i + 41));
  assert.match(await tools.readFile({ path: 'module.mjs', startLine: 41, endLine: 60 }), /^Evidence unchanged;/);
  assert.doesNotMatch(await tools.readFile({ path: 'module.mjs', startLine: 1, endLine: 20 }), /^Evidence unchanged;/);
}));

test('an unchanged receipt alone cannot stand in for missing source lines', async () => scenario(async ({ root, tools, assemble }) => {
  await writeFile(path.join(root, 'module.mjs'), source('current'));
  const full = pair('full', 'read_file', { path: 'module.mjs' }, await tools.readFile({ path: 'module.mjs' }));
  const receipt = pair('receipt', 'read_file', { path: 'module.mjs' }, await tools.readFile({ path: 'module.mjs' }));
  assert.match(receipt[1].content[0].content, /^Evidence unchanged;/);
  const canonical = [{ role: 'user', content: 'Inspect' }, ...full, ...receipt];
  await assemble(canonical, { messages: [canonical[0], ...receipt] });
  assert.equal(tools.readEvidence.size, 0);
  assert.equal(tools.presentedSource.size, 0);
  assert.match(await tools.readFile({ path: 'module.mjs' }), /1: export const value0/);
}));

test('resident complete ranges and their receipt remain reusable across repeated assembly', async () => scenario(async ({ root, tools, assemble }) => {
  await writeFile(path.join(root, 'module.mjs'), source('current'));
  const messages = [{ role: 'user', content: 'Inspect module.mjs' }];
  for (const [startLine, endLine] of [[1, 20], [41, 60]]) messages.push(...pair(`range${startLine}`, 'read_file',
    { path: 'module.mjs', startLine, endLine }, await tools.readFile({ path: 'module.mjs', startLine, endLine })));
  messages.push(...pair('receipt', 'read_file', { path: 'module.mjs', startLine: 1, endLine: 20 },
    await tools.readFile({ path: 'module.mjs', startLine: 1, endLine: 20 })));
  const original = structuredClone(messages);
  for (let i = 0; i < 3; i++) await assemble(messages);
  assert.equal(tools.readEvidence.size, 2);
  assert.equal(tools.presentedSource.get('module.mjs').lines.size, 40);
  assert.deepEqual(messages, original);
  assert.match(await tools.readFile({ path: 'module.mjs', startLine: 1, endLine: 20 }), /^Evidence unchanged;/);
}));

test('evicted complete source is read in full again even if a receipt remains', async () => scenario(async ({ root, tools, assemble }) => {
  await writeFile(path.join(root, 'module.mjs'), source('current'));
  const messages = [{ role: 'user', content: 'Inspect all' },
    ...pair('full', 'read_file', { path: 'module.mjs' }, await tools.readFile({ path: 'module.mjs' })),
    ...pair('receipt', 'read_file', { path: 'module.mjs' }, await tools.readFile({ path: 'module.mjs' })), ...recent()];
  const plan = await assemble(messages);
  assert.equal(plan.diagnostics.units.find(unit => unit.path === 'module.mjs').decision, 'reference');
  assert.equal(tools.readEvidence.size, 0);
  assert.equal(tools.presentedSource.size, 0);
  assert.doesNotMatch(await tools.readFile({ path: 'module.mjs' }), /^Evidence unchanged;/);
}));

test('preview assembly leaves both evidence maps untouched', async () => scenario(async ({ root, tools, assemble }) => {
  await writeFile(path.join(root, 'module.mjs'), source('current'));
  const messages = [{ role: 'user', content: 'Inspect' }, ...pair('full', 'read_file', { path: 'module.mjs' },
    await tools.readFile({ path: 'module.mjs' })), ...recent()];
  const before = structuredClone({ read: tools.readEvidence, presented: tools.presentedSource });
  await assemble(messages, { messages: [messages[0]], commit: false });
  assert.deepEqual(tools.readEvidence, before.read);
  assert.deepEqual(tools.presentedSource, before.presented);
}));

test('manual mutation still invalidates a resident range and every older receipt', async () => scenario(async ({ root, tools, assemble }) => {
  await writeFile(path.join(root, 'module.mjs'), source('old'));
  const messages = [{ role: 'user', content: 'Inspect module.mjs' },
    ...pair('full', 'read_file', { path: 'module.mjs' }, await tools.readFile({ path: 'module.mjs' })),
    ...pair('receipt', 'read_file', { path: 'module.mjs' }, await tools.readFile({ path: 'module.mjs' }))];
  await writeFile(path.join(root, 'module.mjs'), source('new'));
  const plan = await assemble(messages);
  assert.equal(plan.diagnostics.staleUnits, 2);
  assert.equal(tools.readEvidence.size, 0);
  assert.equal(tools.presentedSource.size, 0);
  assert.doesNotMatch(JSON.stringify(plan.request.messages), /old-中文-0|Evidence unchanged;/);
  assert.match(await tools.readFile({ path: 'module.mjs' }), /new-中文-0/);
}));

test('UTF-8 BOM, CRLF, Unicode and canonical path aliases keep exact resident evidence', async () => scenario(async ({ root, tools, assemble }) => {
  await writeFile(path.join(root, '模块.mjs'), '\ufeff' + source('🚀').replaceAll('\n', '\r\n'));
  const messages = [{ role: 'user', content: 'Inspect' }, ...pair('unicode', 'read_file', { path: './模块.mjs', startLine: 2, endLine: 12 },
    await tools.readFile({ path: './模块.mjs', startLine: 2, endLine: 12 }))];
  await assemble(messages);
  assert.equal(tools.readEvidence.size, 1);
  assert.equal(tools.presentedSource.get('模块.mjs').lines.get(2), "export const value1 = '🚀-中文-1';");
  assert.match(await tools.readFile({ path: '模块.mjs', startLine: 2, endLine: 12 }), /^Evidence unchanged;/);
}));

test('truncated output never preserves a previously complete line using its partial text', async () => scenario(async ({ root, tools, assemble }) => {
  await writeFile(path.join(root, 'module.mjs'), Array.from({ length: 400 }, (_, i) => `const field${i} = '${'x'.repeat(80)}';`).join('\n'));
  const exact = pair('line', 'read_file', { path: 'module.mjs', startLine: 1, endLine: 1 },
    await tools.readFile({ path: 'module.mjs', startLine: 1, endLine: 1 }));
  const truncated = pair('truncated', 'read_file', { path: 'module.mjs' }, await tools.readFile({ path: 'module.mjs' }));
  assert.match(truncated[1].content[0].content, /Only a prefix/);
  const canonical = [{ role: 'user', content: 'Inspect module.mjs' }, ...exact, ...truncated];
  await assemble(canonical, { messages: [canonical[0], ...truncated] });
  assert.equal(tools.readEvidence.size, 0);
  assert.doesNotMatch(await tools.readFile({ path: 'module.mjs', startLine: 1, endLine: 1 }), /^Evidence unchanged;/);
}));

test('a projection rejected for overhead retains the full-source cache of the fallback request', async () => scenario(async ({ root, tools, config, assemble }) => {
  await writeFile(path.join(root, 'small.mjs'), '// visible source\n'.repeat(20));
  const messages = [{ role: 'user', content: 'Inspect' }, ...pair('small', 'read_file', { path: 'small.mjs' },
    await tools.readFile({ path: 'small.mjs' })), ...recent()];
  const plan = await assemble(messages, { config: { ...config, contextosTargetBytes: 1 } });
  assert.equal(plan.diagnostics.fallback, 'no-net-wire-reduction');
  assert.equal(tools.readEvidence.size, 1);
  assert.match(await tools.readFile({ path: 'small.mjs' }), /^Evidence unchanged;/);
}));

test('an older read absent from canonical history cannot leave a usable source cache', async () => scenario(async ({ root, tools, assemble }) => {
  await writeFile(path.join(root, 'module.mjs'), source('current'));
  await tools.readFile({ path: 'module.mjs' });
  await assemble([{ role: 'user', content: 'Continue after a checkpoint' }]);
  assert.equal(tools.readEvidence.size, 0);
  assert.equal(tools.presentedSource.size, 0);
  assert.doesNotMatch(await tools.readFile({ path: 'module.mjs' }), /^Evidence unchanged;/);
}));

test('ordinary agent loop reuses resident edited source and still validates the real file', async () => scenario(async ({ root, config }) => {
  await writeFile(path.join(root, 'module.mjs'), source('old'));
  await writeFile(path.join(root, 'module.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import {value0} from './module.mjs'; test('updated',()=>assert.equal(value0,'new-中文-0'));\n");
  const session = createAgentSession(config), steps = [
    ['read_file', { path: 'module.mjs' }],
    ['apply_patch', { path: 'module.mjs', search: "value0 = 'old-中文-0'", replace: "value0 = 'new-中文-0'" }],
    ['read_file', { path: 'module.mjs' }],
    ['read_file', { path: 'module.mjs' }],
    ['read_file', { path: 'module.mjs' }],
    ['run_tests', { command: 'node --test module.test.mjs' }],
  ];
  const reads = [], operations = []; let index = 0;
  // This adapter scripts task calls only. Automatic summary requests are
  // exercised separately; they must not consume the scripted validation call.
  const result = await runTask('Update value0 and validate it', { ...config, compaction: 'off' }, { session,
    adapterFactory: () => ({ complete: async () => {
      const step = steps[index++];
      return step ? { content: [{ type: 'tool_use', id: `step-${index}`, name: step[0], input: step[1] }], stop_reason: 'tool_use' }
        : { content: [{ type: 'text', text: 'Validated.' }], stop_reason: 'end_turn' };
    } }), onEvent: event => { if (event.type === 'tool_end') {
      operations.push({ name: event.name, isError: event.isError, output: event.output });
      if (event.name === 'read_file') reads.push(event.output);
    } } });
  assert.equal(result.status, 'completed', JSON.stringify(operations.filter(event => event.name !== 'read_file')));
  assert.equal(result.validationPassed, true);
  assert.equal(reads.length, 4);
  assert.match(reads[1], /new-中文-0/);
  assert.match(reads[2], /^Evidence unchanged;/);
  assert.match(reads[3], /^Evidence unchanged;/);
}));
