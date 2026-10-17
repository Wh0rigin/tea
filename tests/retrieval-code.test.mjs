import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceTools } from '../src/tools.mjs';
import { parseRetrieval, commitRetrieval } from '../src/retrieval-code.mjs';
import { ContextMemory } from '../src/context-assembler.mjs';
import { loadCliConfig } from '../src/config.mjs';
import { createAgentSession, runTask } from '../src/agent.mjs';

async function fixture(fn) {
  const base=await realpath(os.tmpdir()),root=await realpath(await mkdtemp(path.join(base,'tea-retrieval-')));
  try {
    await mkdir(path.join(root,'src')); await writeFile(path.join(root,'src/a.mjs'),'export const retry = 3;\nexport const other = 4;\n');
    const tools=new WorkspaceTools({workspace:root,retrievalCode:true});await tools.init(); await fn(tools,root);
  } finally { const rel=path.relative(base,root);assert(rel.startsWith('tea-retrieval-')&&!rel.includes(path.sep));await rm(root,{recursive:true,force:true}); }
}
const execute=(t,code)=>t.toolService.execute('retrieve_code',{code});

test('retrieval is opt-in and disabled model definitions remain identical',async()=>fixture(async(t,root)=>{
  const off=new WorkspaceTools({workspace:root});
  assert(!off.modelToolDefinitions().some(x=>x.name==='retrieve_code'));
  assert(t.modelToolDefinitions().some(x=>x.name==='retrieve_code'));
  assert.deepEqual(t.modelToolDefinitions().filter(x=>x.name!=='retrieve_code'),off.modelToolDefinitions());
  assert.equal(loadCliConfig({},{}).retrievalCode,false);
  assert.equal(loadCliConfig({},{TEA_RETRIEVAL_CODE:'1'}).retrievalCode,true);
}));

test('dependent search, fallback branch and range read execute without model round trips',async()=>fixture(async t=>{
  const output=await execute(t,'let s=await search({query:"missing",path:"src"}); if(empty(s.items)){s=await search({query:"retry",path:"src"});} for(const h of take(s.items,1)){emit(await readHit(h));}');
  assert.match(output,/1: export const retry/);assert.equal(t.retrievalSubcalls,3);
  assert.equal(t.presentedSource.size,0);assert.equal(t.sourceEvidence.size,0);
  assert(commitRetrieval(t,output));assert(t.presentedSource.get('src/a.mjs').lines.has(1));
  assert.equal(t.readEvidence.size,0); // No undelivered-history dedup receipts.
}));

test('unemitted reads including same-file ranges never become presented evidence',async()=>fixture(async t=>{
  const output=await execute(t,'const a=await read({path:"src/a.mjs",startLine:1,endLine:1}); const b=await read({path:"src/a.mjs",startLine:2,endLine:2}); emit(a);');
  commitRetrieval(t,output);const lines=t.presentedSource.get('src/a.mjs').lines;
  assert(lines.has(1));assert(!lines.has(2));
  assert.match(await t.readFile({path:'src/a.mjs',startLine:2,endLine:2}),/2: export const other/);
}));

test('whole program failure and missing emit discard staged evidence',async()=>fixture(async t=>{
  await assert.rejects(execute(t,'const x=await read({path:"src/a.mjs"}); emit(x); emit(x.text);'),/own data/);
  assert.equal(t.pendingRetrieval,null);assert.equal(t.presentedSource.size,0);
  await assert.rejects(execute(t,'const x=await read({path:"src/a.mjs"});'),/Use emit/);
  assert.equal(t.presentedSource.size,0);
}));

test('abort after a read cannot poison delivery or dedup caches',async()=>fixture(async t=>{
  const controller=new AbortController();let finished=false;t.signal=controller.signal;t.retrievalObserver=e=>{if(e.stage==='settled'){finished=true;controller.abort();}};
  await assert.rejects(execute(t,'const x=await read({path:"src/a.mjs"}); emit(x);'),{name:'AbortError'});
  assert.equal(t.pendingRetrieval,null);assert.equal(t.presentedSource.size,0);assert.equal(t.readEvidence.size,0);
  assert(finished);
  t.signal=undefined;assert.match(await t.readFile({path:'src/a.mjs'}),/export const retry/);
}));

test('restricted syntax cannot access imports, host functions, prototypes or writes',async()=>fixture(async t=>{
  for(const code of ['process.exit();','emit(globalThis);','emit({a:1}.constructor);','emit({__proto__:1});',
    'import("node:fs");','while(true){}','await write({path:"src/a.mjs"});','emit(read.constructor);',
    'const x = ()=>1;','for(const x of [1]){emit(x.toString());}']) {
    await assert.rejects(execute(t,code),undefined,code);
  }
  assert.equal(await readFile(path.join(t.workspace,'src/a.mjs'),'utf8'),'export const retry = 3;\nexport const other = 4;\n');
}));

test('existing path and secret guards apply to composed reads and searches',async()=>fixture(async(t,root)=>{
  await writeFile(path.join(root,'.env'),'PASSWORD=secret');
  await writeFile(path.join(root,'AGENTS.md'),'Keep rule identity.');
  for(const code of ['emit(await read({path:"../outside"}));','emit(await read({path:".env"}));','emit(await list({path:".tea"}));'])await assert.rejects(execute(t,code));
  const output=await execute(t,'const s=await search({query:"export",path:"src"}); emit(s);');
  assert.match(output,/Filters\/depth\/size/);assert.match(output,/"sourceHash"/);
  await assert.rejects(execute(t,'emit(await read({path:"src/../AGENTS.md"}));'),/ordinary read_file/);
}));

test('operation and output limits do not commit partial evidence',async()=>fixture(async t=>{
  t.retrievalRemaining=1;
  await assert.rejects(execute(t,'const s=await search({query:"retry"}); emit(await readHit(s.items[0]));'),/operation limit/);
  assert.equal(t.retrievalSubcalls,1);assert.equal(t.presentedSource.size,0);
  t.retrievalRemaining=8;
  await assert.rejects(execute(t,'for(const x of [1,2,3,4,5,6,7,8]){emit(await read({path:"src/a.mjs"}));}'),/four evidence/);
  assert.equal(t.presentedSource.size,0);
  await assert.rejects(execute(t,'for(const x of [1,2,3,4,5,6,7,8,9]){emit(x);}'),/at most 8/);
}));

test('parser rejects deep nesting before any IO',()=>{
  assert.throws(()=>parseRetrieval('emit('+ '['.repeat(30)+'1'+']'.repeat(30)+');'),/nesting/);
  assert.throws(()=>parseRetrieval('if(true){'.repeat(20)+'emit(1);'+'}'.repeat(20)),/nesting/);
});

test('aggregate ContextOS references invalidate after an external edit and cannot recall stale source',async()=>fixture(async(t,root)=>{
  const output=await execute(t,'const s=await search({query:"retry"}); emit(await readHit(s.items[0]));');commitRetrieval(t,output);
  const memory=new ContextMemory(t);memory.rebuild([
    {role:'assistant',content:[{type:'tool_use',id:'x',name:'retrieve_code',input:{code:'test'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'x',content:output}]},
  ]);
  const unit=[...memory.units.values()][0];assert.equal(await memory.freshness(unit),'valid');
  await writeFile(path.join(root,'src/a.mjs'),'export const retry = 100;\n');assert.equal(await memory.freshness(unit),'stale');
  const recalled=await memory.recall({ref:unit.ref});assert.match(recalled,/STALE/);assert(!recalled.includes('export const retry'));
}));

test('ContextOS history search and recall are available without marking hidden reads as delivered',async()=>fixture(async t=>{
  const text=await t.readFile({path:'src/a.mjs'}),memory=new ContextMemory(t);
  memory.rebuild([{role:'assistant',content:[{type:'tool_use',id:'r',name:'read_file',input:{path:'src/a.mjs'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'r',content:text}]}]);t.contextMemory=memory;
  const output=await execute(t,'const h=await history({query:"retry"}); for(const x of take(h.items,1)){emit(await recall({ref:x.ref}));}');
  assert.match(output,/export const retry/);assert(commitRetrieval(t,output));
}));

test('agent accounts for child calls and commits evidence only with outer results',async()=>fixture(async(_,root)=>{
  const config=loadCliConfig({workspace:root,memoryPolicy:'contextos',retrievalCode:true},{TEA_MAX_TOOL_CALLS:'4'}),session=createAgentSession(config);
  let requests=0;
  const result=await runTask('Inspect source, no edits',config,{session,adapterFactory:()=>({spentUsd:0,
    async complete(){requests++;return requests===1?{content:[{type:'tool_use',id:'a',name:'retrieve_code',input:{code:'emit(await read({path:"src/a.mjs",startLine:1,endLine:1}));'}},
      {type:'tool_use',id:'b',name:'retrieve_code',input:{code:'emit(await read({path:"src/a.mjs",startLine:2,endLine:2}));'}}],stop_reason:'tool_use'}:{content:[{type:'text',text:'Inspected.'}],stop_reason:'end_turn'};}})});
  assert.equal(result.status,'completed');assert.equal(result.toolCalls,2);
  assert.equal(session.tools.presentedSource.get('src/a.mjs').lines.size,2);
  assert.equal(session.tools.sourceEvidence.size,2);
}));

test('missing delivery metadata is fail-closed for ContextOS after an interrupted commit',async()=>fixture(async t=>{
  const memory=new ContextMemory(t);memory.rebuild([
    {role:'assistant',content:[{type:'tool_use',id:'x',name:'retrieve_code',input:{code:'unknown'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'x',content:'[evidence ref=old sha256='+'a'.repeat(64)+']\n1: old source'}]},
  ]);
  const unit=[...memory.units.values()][0];assert.equal(await memory.freshness(unit),'stale');
  assert(!((await memory.recall({ref:unit.ref})).includes('1: old source')));
}));

test('output limit and repeated aliases remain bounded',async()=>fixture(async t=>{
  await assert.rejects(execute(t,'let x=[1];'+ 'x=[x,x];'.repeat(18)+'emit(x);'),/limit/);
  const s='x'.repeat(5500);await assert.rejects(execute(t,'const x="'+s+'";emit([x,x]);'),/10KB/);
  assert.equal(t.pendingRetrieval,null);
}));

test('child operation attempts consume the existing agent limit without bypass',async()=>fixture(async(_,root)=>{
  const config=loadCliConfig({workspace:root,retrievalCode:true},{TEA_MAX_TOOL_CALLS:'2'}),session=createAgentSession(config);
  const result=await runTask('Inspect',config,{session,adapterFactory:()=>({spentUsd:0,async complete(){return {
    content:[{type:'tool_use',id:'only',name:'retrieve_code',input:{code:'const s=await search({query:"retry"});emit(await readHit(s.items[0]));emit(await read({path:"src/a.mjs"}));'}}],stop_reason:'tool_use'};}})});
  // Existing Agent counter also counts the next denied outer attempt; no third child executes.
  assert.equal(result.toolCalls,3);assert.equal(result.status,'tool_limit_reached');
  assert.equal(session.tools.retrievalSubcalls,2);
  assert.equal(session.tools.presentedSource.size,0);
}));

test('aggregate evidence metadata survives encrypted resume and still checks external edits',async()=>fixture(async(_,root)=>{
  const config=loadCliConfig({workspace:root,retrievalCode:true,memoryPolicy:'contextos',sessionId:'retrieval-resume'},{});
  const session=createAgentSession(config);let n=0;
  await runTask('Read',config,{session,adapterFactory:()=>({spentUsd:0,async complete(){return ++n===1?{
    content:[{type:'tool_use',id:'r',name:'retrieve_code',input:{code:'emit(await read({path:"src/a.mjs"}));'}}],stop_reason:'tool_use'}:{content:[{type:'text',text:'Read.'}],stop_reason:'end_turn'};}})});
  const next={...config,sessionId:undefined,resume:'retrieval-resume',runId:'resume-check'},restored=createAgentSession(next);
  await runTask('Continue',next,{session:restored,adapterFactory:()=>({spentUsd:0,async complete(){return {content:[{type:'text',text:'Continued.'}],stop_reason:'end_turn'};}})});
  restored.contextMemory.rebuild(restored.messages);
  const unit=[...restored.contextMemory.units.values()].find(x=>x.name==='retrieve_code');assert(unit);
  assert.equal(await restored.contextMemory.freshness(unit),'valid');
  await writeFile(path.join(root,'src/a.mjs'),'export const retry=9;\n');assert.equal(await restored.contextMemory.freshness(unit),'stale');
}));
