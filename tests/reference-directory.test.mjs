import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ContextMemory, validToolProtocol } from '../src/context-assembler.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { loadConfig } from '../src/config.mjs';
import { createAgentSession } from '../src/agent.mjs';
import { attachSessionJournal, appendSessionMessage, closeSessionJournal } from '../src/session-memory.mjs';

const pair=(id,name,input,output,signed=false)=>[
  {role:'assistant',content:[...(signed?[{type:'thinking',thinking:'Exact thought',signature:'signature-'+id}]:[]),{type:'tool_use',id,name,input}]},
  {role:'user',content:[{type:'tool_result',tool_use_id:id,content:output}]},
];
const history=(count=40,signed=false)=>[{role:'user',content:'Keep the API and original requirements Ω'},
  ...Array.from({length:count},(_,i)=>pair('old-'+i,'list_files',{path:'folder-'+i},('unique_record_'+i+' multilingual 记录 🚀\n').repeat(80),signed)).flat(),
  ...pair('recent-1','list_files',{},'recent'),...pair('recent-2','list_files',{},'recent')];
async function scenario(fn){
  const root=await mkdtemp(path.join(os.tmpdir(),'tea-ref-directory-'));
  try{
    const tools=new WorkspaceTools({workspace:root});await tools.init();
    const config={...loadConfig({workspace:root,memoryPolicy:'contextos'},{}),contextosTargetBytes:4000};
    await fn({root,tools,config,memory:new ContextMemory(tools)});
  }finally{await rm(root,{recursive:true,force:true});}
}
const assemble=(memory,messages,config)=>memory.assemble({messages,canonical:messages,system:'fixed',tools:memory.tools.modelToolDefinitions({includeMemory:false}),config,state:{changedFiles:[],pendingValidation:true,validationPassed:false},goal:'Continue the task'});
const directory=plan=>plan.request.messages.find(m=>typeof m.content==='string'&&m.content.startsWith('Historical tool rounds are archived'))?.content;

test('only eight recent references are shown while all canonical content survives',async()=>scenario(async({memory,config})=>{
  const messages=history(),original=structuredClone(messages),plan=await assemble(memory,messages,config);
  assert.equal(plan.diagnostics.referenceDirectoryEntries,40);assert.equal(plan.diagnostics.referenceDirectoryShown,8);assert.equal(plan.diagnostics.referenceDirectoryOmitted,32);
  assert.equal(plan.diagnostics.coldRounds,40);assert.equal(validToolProtocol(plan.request.messages),true);assert.deepEqual(messages,original);
  const refs=JSON.parse(directory(plan).split('References: ')[1]);assert.equal(refs.length,8);
  assert.deepEqual(refs.map(r=>memory.units.get(r.ref).callId),Array.from({length:8},(_,i)=>'old-'+(32+i)));
  assert.match(directory(plan),/search_history/);assert.ok(plan.request.messages.includes(messages[0]));
}));
test('an omitted arbitrary historical record remains searchable and exactly recoverable',async()=>scenario(async({memory,config})=>{
  const messages=history(50),plan=await assemble(memory,messages,config);
  const unit=[...memory.units.values()].find(u=>u.callId==='old-0');assert.ok(!directory(plan).includes(unit.ref));
  const rows=JSON.parse(await memory.search({query:'unique_record_0 multilingual 记录'}));assert.ok(rows.some(r=>r.ref===unit.ref&&r.provenance==='observed'));
  const recalled=await memory.recall({ref:unit.ref,maxBytes:8000});assert.ok(recalled.endsWith(unit.output));assert.equal(memory.units.size,52);
}));
test('directories of at most eight preserve the original wording and entries',async()=>scenario(async({memory,config})=>{
  for(const n of [1,8]){
    const plan=await assemble(memory,history(n),config);
    assert.equal(plan.diagnostics.referenceDirectoryShown,n);assert.equal(plan.diagnostics.referenceDirectoryOmitted,0);
    assert.match(directory(plan),/^Historical tool rounds are archived, not executed again\. Recover exact content with these references: /);
  }
}));
test('signed assistant blocks remain byte-identical and cannot be removed by directory limits',async()=>scenario(async({memory,config})=>{
  const messages=history(40,true),plan=await assemble(memory,messages,config);
  assert.equal(plan.diagnostics.coldRounds,0);assert.equal(plan.diagnostics.referenceDirectoryEntries,0);
  for(const message of messages.filter(m=>m.role==='assistant'))assert.ok(plan.request.messages.includes(message));
  assert.equal(validToolProtocol(plan.request.messages),true);
}));
test('no eviction leaves native request messages, system and tool schemas unchanged',async()=>scenario(async({memory,config})=>{
  const messages=history(1),plan=await assemble(memory,messages,{...config,contextosTargetBytes:1000000});
  assert.deepEqual(plan.request.messages,messages);assert.equal(plan.request.system,'fixed');
  assert.deepEqual(plan.request.tools,memory.tools.modelToolDefinitions({includeMemory:false}));assert.equal(plan.diagnostics.referenceDirectoryOmitted,0);
}));
test('omitted multilingual source references retain freshness checks',async()=>scenario(async({root,tools,memory,config})=>{
  const file='模块.py';await writeFile(path.join(root,file),'original_计数 = 17\n'+'# old source\n'.repeat(300));
  const messages=history(40);messages.splice(1,0,...pair('source','read_file',{path:file},await tools.readFile({path:file})));
  const plan=await assemble(memory,messages,config),unit=[...memory.units.values()].find(u=>u.callId==='source');assert.ok(!directory(plan).includes(unit.ref));
  assert.match(await memory.recall({ref:unit.ref}),/original_计数/);
  await writeFile(path.join(root,file),'current_计数 = 19');
  assert.doesNotMatch(await memory.recall({ref:unit.ref}),/original_计数/);
  assert.equal(JSON.parse(await memory.search({query:file}))[0].validity,'stale');
}));
test('native journal resume reconstructs omitted references without lossy persistence',async()=>scenario(async({root,config})=>{
  config={...config,sessionId:'references'};const messages=history(40),session=createAgentSession(config);
  await attachSessionJournal(session,config);for(const message of messages)await appendSessionMessage(session,message);await closeSessionJournal(session);
  const resumedConfig={...config,sessionId:undefined,resume:'references'},restored=createAgentSession(resumedConfig);
  await attachSessionJournal(restored,resumedConfig);
  try{
    assert.deepEqual(restored.messages,messages);const tools=new WorkspaceTools({workspace:root});await tools.init();const memory=new ContextMemory(tools);
    const plan=await assemble(memory,restored.messages,resumedConfig);assert.equal(plan.diagnostics.referenceDirectoryOmitted,32);
    const row=JSON.parse(await memory.search({query:'unique_record_0'}))[0];assert.ok(!directory(plan).includes(row.ref));assert.match(await memory.recall({ref:row.ref}),/unique_record_0/);
  }finally{await closeSessionJournal(restored);}
}));
