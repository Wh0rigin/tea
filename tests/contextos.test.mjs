import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContextMemory, validToolProtocol, utf8Page } from '../src/context-assembler.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { loadConfig } from '../src/config.mjs';
import { runTask, createAgentSession } from '../src/agent.mjs';

async function scenario(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-contextos-'));
  try {
    const tools = new WorkspaceTools({ workspace: root }); await tools.init();
    const config = loadConfig({ workspace: root, memoryPolicy: 'contextos' }, { TEA_MAX_REQUEST_INPUT_TOKENS: '80000' });
    await fn(root, tools, { ...config, contextosTargetBytes: 4000 }, new ContextMemory(tools));
  } finally { await rm(root, { recursive: true, force: true }); }
}
const pair = (id, name, input, output, is_error = false) => [
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'retain exact thought', signature: 'sig-'+id }, { type: 'tool_use', id, name, input }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output, is_error }] },
];
const history = () => [{ role: 'user', content: 'Exact user Ω constraints: do not change compatibility.' },
  ...pair('old', 'list_files', { path: '.', maxFiles: 250 }, 'irrelevant/file.mjs\n'.repeat(900)),
  ...pair('recent1', 'list_files', { path: 'src' }, 'src/current.mjs'), ...pair('recent2', 'search_code', { query: 'active' }, 'active: present'),
  { role: 'user', content: 'Latest user requirement 🧪 stays verbatim.' }];
const assemble = (memory, messages, config, extra = {}) => memory.assemble({ messages, canonical: messages, system: 'fixed system', tools: memory.tools.modelToolDefinitions({ includeMemory: false }), config, state: { pendingValidation: true, validationPassed: false, changedFiles: [] }, ...extra });

test('working set preserves requirements, exact signatures and tool pairing', async () => scenario(async (root, tools, config, memory) => {
  const messages = history(), original = structuredClone(messages), plan = await assemble(memory, messages, config);
  assert.ok(plan.diagnostics.sentWireBytes < plan.diagnostics.fullWireBytes); assert.equal(plan.diagnostics.evictedUnits, 1);
  assert.deepEqual(messages, original); assert.equal(plan.request.messages[0], messages[0]); assert.equal(plan.request.messages.at(-1), messages.at(-1));
  assert.equal(plan.request.messages[1], messages[1]); assert.equal(validToolProtocol(plan.request.messages), true);
  assert.match(plan.request.messages[2].content[0].content, /ContextOS/); assert.match(plan.request.system, /pending=true/);
}));
test('short requests add neither memory schemas nor extra guidance', async () => scenario(async (root, tools, config, memory) => {
  const messages = [{ role: 'user', content: 'Short task' }], definitions = tools.modelToolDefinitions();
  const plan = await assemble(memory, messages, config);
  assert.equal(plan.diagnostics.evictedUnits, 0); assert.deepEqual(plan.request.tools, definitions); assert.equal(plan.request.system, 'fixed system');
}));
test('failure logs and mutation receipts remain resident', async () => scenario(async (root, tools, config, memory) => {
  const messages = history(); messages.splice(1, 0,
    ...pair('fail', 'run_tests', { command: 'node --test broken.test.mjs' }, 'exit=1\ncritical failure\n' + 'trace\n'.repeat(1800)),
    ...pair('patch', 'apply_patch', { path: 'a.mjs', search: 'old', replace: 'new' }, 'Updated a.mjs'),
    ...pair('error', 'read_file', { path: 'missing' }, 'ENOENT ' + 'e'.repeat(1000), true));
  const plan = await assemble(memory, messages, config);
  assert.match(JSON.stringify(plan.request.messages), /critical failure/); assert.match(JSON.stringify(plan.request.messages), /Updated a.mjs/); assert.match(JSON.stringify(plan.request.messages), /ENOENT/);
}));
test('evicted source can be recovered, then expires on edit without returning old lines', async () => scenario(async (root, tools, config, memory) => {
  await writeFile(path.join(root, 'old.mjs'), 'export const rememberedValue = 17;\n' + '// context detail\n'.repeat(300));
  const output = await tools.readFile({ path: 'old.mjs' }), messages = history(); messages.splice(1, 2, ...pair('old', 'read_file', { path: 'old.mjs' }, output));
  const plan = await assemble(memory, messages, config), unit = plan.diagnostics.units.find(unit => unit.path === 'old.mjs');
  assert.equal(unit.decision, 'reference'); assert.equal(tools.readEvidence.size, 0);
  assert.match(await memory.recall({ ref: unit.ref }), /rememberedValue = 17/);
  await writeFile(path.join(root, 'old.mjs'), 'export const rememberedValue = 99;');
  const recalled = await memory.recall({ ref: unit.ref }); assert.match(recalled, /STALE/); assert.doesNotMatch(recalled, /rememberedValue = 17/);
  const changed = await assemble(memory, messages, config); assert.equal(changed.diagnostics.staleUnits, 1); assert.doesNotMatch(JSON.stringify(changed.request), /rememberedValue = 17/);
}));
test('active source, AGENTS and README are pinned, but stale recent source is withheld', async () => scenario(async (root, tools, config, memory) => {
  for (const filename of ['AGENTS.md', 'README.md', 'active.mjs']) await writeFile(path.join(root, filename), 'important '+filename+'\n'+'detail\n'.repeat(500));
  const messages = [{ role: 'user', content: 'Use active.mjs' }];
  for (const filename of ['AGENTS.md', 'README.md', 'active.mjs']) messages.push(...pair(filename, 'read_file', { path: filename }, await tools.readFile({ path: filename })));
  messages.push(...pair('r1', 'list_files', {}, 'r1'), ...pair('r2', 'list_files', {}, 'r2'));
  const plan = await assemble(memory, messages, config, { goal: 'Repair active.mjs' }); assert.equal(plan.diagnostics.evictedUnits, 0);
  await writeFile(path.join(root, 'active.mjs'), 'changed');
  const stale = await assemble(memory, messages, config, { goal: 'Repair active.mjs' }); assert.match(JSON.stringify(stale.request), /STALE historical source/); assert.doesNotMatch(JSON.stringify(stale.request), /important active.mjs/);
}));
test('search distinguishes observed source from inferred notes and handles Unicode names', async () => scenario(async (root, tools, config, memory) => {
  await writeFile(path.join(root, '模块.py'), 'def 计数(值):\n    return 值 + 1\n');
  const messages = [{ role: 'user', content: 'Task' }, ...pair('source', 'read_file', { path: '模块.py' }, await tools.readFile({ path: '模块.py' })),
    { role: 'assistant', content: [{ type: 'text', text: 'I infer 计数 may be the root cause; not verified.' }] }];
  memory.rebuild(messages);
  const results = JSON.parse(await memory.search({ query: '计数' }));
  assert.equal(results.length, 2); assert.ok(results.some(row => row.provenance === 'observed')); assert.ok(results.some(row => row.provenance === 'inferred'));
  await writeFile(path.join(root, '模块.py'), 'def other(): pass');
  const stale = JSON.parse(await memory.search({ query: '模块.py' })); assert.equal(stale[0].validity, 'stale'); assert.doesNotMatch(stale[0].preview, /计数/);
}));
test('UTF-8 paging preserves astral and literal replacement characters', () => {
  const text = '🚀中文\uFFFD'.repeat(1000); let offset = 0, restored = '';
  while (offset < Buffer.byteLength(text)) { const page = utf8Page(text, offset, 257); restored += page.text; assert.ok(page.nextOffset > offset); offset = page.nextOffset; }
  assert.equal(restored, text);
});
test('unknown references and invalid retrieval bounds fail without file execution', async () => scenario(async (root, tools, config, memory) => {
  memory.rebuild(history()); await assert.rejects(memory.recall({ ref: '../escape' }), /Unknown/);
  for (const args of [{ offset: -1 }, { offset: 1.5 }, { maxBytes: 1 }, { maxBytes: 100000 }]) await assert.rejects(memory.recall({ ref: 'unknown', ...args }), /bounds/);
  for (const query of ['', 'x'.repeat(201)]) await assert.rejects(memory.search({ query }), /query/);
}));
for (const language of ['mjs', 'ts', 'py', 'java']) test(`source identity and references are language-neutral for ${language}`, async () => scenario(async (root, tools, config, memory) => {
  const filename = 'module.'+language, source = 'observedName_模块\n'+ 'language independent source\n'.repeat(250);
  await writeFile(path.join(root, filename), source);
  const messages = history(); messages.splice(1, 2, ...pair('old', 'read_file', { path: filename }, await tools.readFile({ path: filename })));
  const plan = await assemble(memory, messages, config), unit = plan.diagnostics.units.find(unit => unit.path === filename);
  assert.equal(unit.validity, 'valid'); assert.match(await memory.recall({ ref: unit.ref }), /observedName_模块/);
}));
test('30 and 50 turn replay preserve complete protocol and explicit negative/zero controls', async () => scenario(async (root, tools, config, memory) => {
  for (const turns of [30, 50]) {
    const messages = [{ role: 'user', content: 'Never break API compatibility' }];
    for (let n=0;n<turns;n++) { messages.push(...pair('turn-'+n, 'list_files', { offset: n*10 }, 'snapshot data\n'.repeat(300))); messages.push({ role: 'user', content: 'Continue inspection '+n }); }
    const plan = await assemble(memory, messages, config); assert.ok(plan.diagnostics.sentWireBytes < plan.diagnostics.fullWireBytes*.5); assert.equal(validToolProtocol(plan.request.messages), true);
    assert.equal(plan.request.messages.filter(message=>typeof message.content==='string').length, turns+1);
  }
}));
test('non-reducing small replacements fall back to the original request', async () => scenario(async (root, tools, config, memory) => {
  const messages = history(); messages[2].content[0].content = 'tiny';
  const plan = await assemble(memory, messages, { ...config, contextosTargetBytes: 1 });
  assert.equal(plan.diagnostics.evictedUnits, 0); assert.equal(plan.request.system, 'fixed system');
}));
test('summary sizing observation does not evict source caches', async () => scenario(async (root, tools, config, memory) => {
  await writeFile(path.join(root, 'old.mjs'), '// observation\n'.repeat(300));
  const messages = history(); messages.splice(1,2,...pair('old','read_file',{path:'old.mjs'},await tools.readFile({path:'old.mjs'})));
  await assemble(memory, messages, config, { commit: false }); assert.equal(memory.evicted.size, 0); assert.equal(tools.readEvidence.size, 1);
}));
for (const mutate of [m=>m.splice(1,1),m=>m[2].content[0].tool_use_id='wrong',m=>m[1].role='user',m=>m.splice(2,1),m=>m[2].content.push({...m[2].content[0]})]) test('malformed tool protocol is detected before selection', () => {
  const messages = history(); mutate(messages); assert.equal(validToolProtocol(messages), false);
});
test('real agent loop recalls old evidence after process resume and performs actual validation', async () => scenario(async (root, tools, config, memory) => {
  await writeFile(path.join(root,'old.mjs'),'export const marker = 17;\n'+'// historical useful source\n'.repeat(250));
  await writeFile(path.join(root,'value.mjs'),'export const value = 1;\n');
  await writeFile(path.join(root,'value.test.mjs'),"import test from 'node:test'; import assert from 'node:assert/strict'; import {value} from './value.mjs'; test('value',()=>assert.equal(value,17));");
  const firstConfig={...config,sessionId:'memory',runId:'memory-first'}, session=createAgentSession(firstConfig);
  // Seed via the actual read-only agent loop, not by mutating a persisted journal.
  let n=0;
  const call=(id,name,input)=>({content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use'});
  await runTask('Inspect modules; do not edit',firstConfig,{session,adapterFactory:()=>({complete:async()=>[
    call('first-read','read_file',{path:'old.mjs'}),call('list1','list_files',{}),call('list2','list_files',{}),call('list3','list_files',{}),{content:[{type:'text',text:'Inspection complete'}],stop_reason:'end_turn'}][n++]})});
  const resumed={...config,sessionId:undefined,resume:'memory',runId:'memory-second'}, restored=createAgentSession(resumed);
  let stage=0;
  const result=await runTask('Set value to the earlier module marker; validate it',resumed,{session:restored,adapterFactory:()=>({complete:async request=>{
    if(stage++===0){ const ref=JSON.stringify(request.messages).match(/ref=(ctx-[a-f0-9]{20})/)[1];return call('recall','recall_context',{ref}); }
    if(stage===2){ assert.match(JSON.stringify(request.messages.at(-1)),/marker = 17/); return call('edit','apply_patch',{path:'value.mjs',search:'value = 1',replace:'value = 17'}); }
    if(stage===3)return call('verify','run_tests',{command:'node --test value.test.mjs'});
    return {content:[{type:'text',text:'Done'}],stop_reason:'end_turn'};
  }})});
  assert.equal(result.status,'completed'); assert.equal(result.validationPassed,true); assert.equal(restored.contextMemory.recalls,1);
  assert.match(await readFile(path.join(root,'value.mjs'),'utf8'),/value = 17/);
}));
test('unchanged source references and path aliases also expire on source mutation', async () => scenario(async (root,tools,config,memory)=>{
  await writeFile(path.join(root,'code.mjs'),'export const sourceValue = 1;\n'+'// source detail\n'.repeat(300));
  const first=await tools.readFile({path:'./code.mjs'}), second=await tools.readFile({path:'code.mjs'});
  assert.match(second,/Evidence unchanged/);
  const messages=history(); messages.splice(1,2,...pair('alias','read_file',{path:'./code.mjs'},first),...pair('cache','read_file',{path:'code.mjs'},second));
  const plan=await assemble(memory,messages,config); assert.equal(tools.readEvidence.size,0);
  await writeFile(path.join(root,'code.mjs'),'export const sourceValue = 2;');
  const stale=await assemble(memory,messages,config); assert.equal(stale.diagnostics.staleUnits,2);
  assert.doesNotMatch(JSON.stringify(stale.request),/sourceValue = 1|Evidence unchanged/);
}));
