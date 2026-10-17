import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {WorkspaceTools} from '../src/tools.mjs';
import {ContextMemory} from '../src/context-assembler.mjs';
import {loadCliConfig} from '../src/config.mjs';
import {createAgentSession,runTask} from '../src/agent.mjs';
import {commitRetrieval} from '../src/retrieval-code.mjs';
import {runtimeCapabilities,capabilityNotice} from '../src/tool-feedback.mjs';

async function fixture(fn){
  const base=await realpath(os.tmpdir()),root=await realpath(await mkdtemp(path.join(base,'tea-code-first-')));
  try{
    await writeFile(path.join(root,'AGENTS.md'),'Preserve user changes; validate edits.');
    await writeFile(path.join(root,'source.mjs'),'export const retry=3;\n');
    const tools=new WorkspaceTools({workspace:root,codeFirst:true});await tools.init();await fn(root,tools);
  }finally{const rel=path.relative(base,root);assert(rel.startsWith('tea-code-first-')&&!rel.includes(path.sep));await rm(root,{recursive:true,force:true});}
}

test('code-first replaces discovery schemas, retains instruction reader and ordinary edit/validation',async()=>fixture(async(root,tools)=>{
  const names=tools.modelToolDefinitions().map(x=>x.name);
  assert(!names.includes('list_files'));assert(!names.includes('search_code'));assert(names.includes('retrieve_code'));
  for(const name of ['read_file','apply_patch','write_file','run_tests'])assert(names.includes(name));
  assert.match(tools.modelToolDefinitions().find(x=>x.name==='read_file').description,/instructions only/);
  assert.equal(loadCliConfig({},{TEA_CODE_FIRST:'1'}).retrievalCode,true);
  assert.equal(loadCliConfig({},{}).codeFirst,false);
  const capabilities=runtimeCapabilities({codeFirst:true});
  assert.notEqual(capabilities.version,runtimeCapabilities({codeFirst:false}).version);
  assert.match(capabilityNotice(capabilities),/No arbitrary command approval/);
}));

test('unadvertised source retrieval is rejected even through direct service dispatch',async()=>fixture(async(root,tools)=>{
  for(const [name,input] of [['list_files',{}],['search_code',{query:'retry'}],['read_file',{path:'source.mjs'}],
    ['search_history',{query:'retry'}],['recall_context',{ref:'any'}]])await assert.rejects(tools.toolService.execute(name,input),/retrieve_code/);
  assert.match(await tools.toolService.execute('read_file',{path:'AGENTS.md'}),/Preserve user changes/);
  assert(tools.presentedSource.has('AGENTS.md'));assert(!tools.presentedSource.has('source.mjs'));
}));

test('composed reads still work behind the forced route and establish delivered source evidence',async()=>fixture(async(root,tools)=>{
  const output=await tools.toolService.execute('retrieve_code',{code:'const s=await search({query:"retry"}); for(const h of take(s.items,1)){emit(await readHit(h));}'});
  assert.match(output,/export const retry=3/);assert.equal(tools.retrievalSubcalls,2);
  assert(commitRetrieval(tools,output));
  await tools.toolService.execute('apply_patch',{path:'source.mjs',search:'retry=3',replace:'retry=4'});
  assert.match(await readFile(path.join(root,'source.mjs'),'utf8'),/retry=4/);
}));

test('mode cannot use approved arbitrary commands or git diagnostics as a retrieval fallback',async()=>fixture(async(root,tools)=>{
  let approvals=0;tools.approveCommand=()=>{approvals++;return true;};
  for(const name of ['run_tests','run_shell'])for(const command of ['git status --short','python -c print(1)','powershell Get-Content source.mjs'])
    await assert.rejects(tools.toolService.execute(name,{command}),/validation commands only/);
  assert.equal(approvals,0);
  await writeFile(path.join(root,'check.test.mjs'),"import test from 'node:test';test('ok',()=>{});\n");
  assert.match(await tools.toolService.execute('run_tests',{command:'node --test check.test.mjs'}),/^exit=0/);
}));

test('ContextOS eviction never reintroduces hidden standalone retrieval tools',async()=>fixture(async(root,tools)=>{
  const memory=new ContextMemory(tools);tools.contextMemory=memory;
  const pair=(id,output)=>[{role:'assistant',content:[{type:'tool_use',id,name:'list_files',input:{}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:id,content:output}]}];
  const messages=[{role:'user',content:'Inspect source'},...pair('old','irrelevant/file.mjs\n'.repeat(900)),...pair('recent','source.mjs'),...pair('last','source.mjs')];
  const config={...loadCliConfig({workspace:root,memoryPolicy:'contextos',codeFirst:true},{}),contextosTargetBytes:4000};
  const result=await memory.assemble({messages,canonical:messages,system:'system',tools:tools.modelToolDefinitions({includeMemory:false}),config,state:{pendingValidation:false,validationPassed:false,changedFiles:[]}});
  assert(result.diagnostics.evictedUnits>0);
  const names=result.request.tools.map(x=>x.name);
  assert(!names.includes('recall_context'));assert(!names.includes('search_history'));assert(!names.includes('list_files'));
  assert.match(result.request.system,/retrieve_code with recall/);
}));

test('code-first edits still require and pass actual validation with no extra planning request',async()=>fixture(async(root)=>{
  const config=loadCliConfig({workspace:root,memoryPolicy:'contextos',codeFirst:true},{}),session=createAgentSession(config);let n=0;
  const actions=[
    {name:'read_file',input:{path:'AGENTS.md'}},
    {name:'retrieve_code',input:{code:'emit(await read({path:"source.mjs"}));'}},
    {name:'apply_patch',input:{path:'source.mjs',search:'retry=3',replace:'retry=4'}},
    {name:'write_file',input:{path:'check.test.mjs',content:"import test from 'node:test';import assert from 'node:assert/strict';import {retry} from './source.mjs';test('value',()=>assert.equal(retry,4));\n"}},
    {name:'run_tests',input:{command:'node --test check.test.mjs'}},
  ];
  const result=await runTask('Change retry to 4 and validate',config,{session,adapterFactory:()=>({spentUsd:0,async complete(request){
    assert.match(request.system,/Code-first retrieval mode/);
    assert(!request.tools.some(x=>x.name==='search_code'));
    const action=actions[n++];return action?{content:[{type:'tool_use',id:'x'+n,...action}],stop_reason:'tool_use'}:{content:[{type:'text',text:'Changed and tested.'}],stop_reason:'end_turn'};
  }})});
  assert.equal(result.status,'completed');assert.equal(result.validationPassed,true);assert.equal(n,6);
  assert.equal(session.pendingValidation,false);
}));

test('a live session cannot toggle code-first semantics',async()=>fixture(async(root)=>{
  const config=loadCliConfig({workspace:root,codeFirst:true},{}),session=createAgentSession(config);
  const adapterFactory=()=>({spentUsd:0,async complete(){return {content:[{type:'text',text:'done'}],stop_reason:'end_turn'};}});
  await runTask('Inspect',config,{session,adapterFactory});
  await assert.rejects(runTask('Again',{...config,codeFirst:false,runId:'second-run'},{session,adapterFactory}),/cannot change retrieval/);
}));
