import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../src/config.mjs';
import { createAgentSession, runTask, compactAgentSession, resetConversation } from '../src/agent.mjs';
import { attachSessionJournal, closeSessionJournal, appendSessionMessage, persistRuntimeState } from '../src/session-memory.mjs';
import { ContextMemory, validToolProtocol } from '../src/context-assembler.mjs';
import { ContextArchive } from '../src/context-archive.mjs';
import { attachContextArchive, collectCompactedHistory, residentHistoryBytes } from '../src/memory-gc.mjs';
import { SessionJournal } from '../src/session-journal.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { sessionContext } from '../src/compaction.mjs';

const done = text => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const summary = ['Goal','Constraints','Progress','Decisions','Next steps','Critical context']
  .map(h => `## ${h}\nKeep scope and verify current code.`).join('\n');
async function scenario(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(),'tea-gc-'));
  const config = { ...loadConfig({ workspace:root, sessionId:'gc', memoryPolicy:'contextos' }, {}),
    maxRequestInputTokens:100000, contextosTargetBytes:15000, compactionKeepRecentBytes:600,
    maxOutputTokens:4096, runId:'gc', memoryCacheBytes:1500 };
  try { await writeFile(path.join(root,'value.mjs'),'export const marker = 17;\n'+'// detail\n'.repeat(2000)); await fn(root,config); }
  finally { await rm(root,{recursive:true,force:true}); }
}
async function seed(config) {
  const session = createAgentSession(config);
  await attachSessionJournal(session,config);
  session.tools = new WorkspaceTools({ workspace:config.workspace }); await session.tools.init();
  session.contextMemory = new ContextMemory(session.tools); session.tools.contextMemory=session.contextMemory;
  attachContextArchive(session,config);
  await appendSessionMessage(session,{ role:'user', content:'Keep exact constraint Ω; modify only value.mjs.' });
  const output = await session.tools.readFile({path:'value.mjs'});
  await appendSessionMessage(session,{role:'assistant',content:[{type:'tool_use',id:'old-read',name:'read_file',input:{path:'value.mjs'}}]});
  await appendSessionMessage(session,{role:'user',content:[{type:'tool_result',tool_use_id:'old-read',content:output}]});
  await appendSessionMessage(session,{role:'assistant',content:[{type:'thinking',thinking:'retained',signature:'signature-kept'},{type:'text',text:'continue'}]});
  session.contextMemory.rebuild(session.messages);
  const ref=[...session.contextMemory.units.values()].find(u=>u.name==='read_file').ref;
  session.pendingValidation=true;session.changedFiles=['value.mjs'];
  session.compaction={id:'checkpoint',summary,firstKeptIndex:3};
  await persistRuntimeState(session);
  return {session,ref,output};
}

test('committed GC releases old bodies, preserves requirements/signatures and lazily recalls exact output',()=>scenario(async(root,config)=>{
  const {session,ref,output}=await seed(config);const before=residentHistoryBytes(session);
  const result=await collectCompactedHistory(session,config);
  assert.equal(result.status,'collected');assert.ok(result.afterBytes<before*.15);
  assert.equal(session.messages.length,1);assert.equal(session.messages[0].content[0].signature,'signature-kept');
  assert.equal(session.pendingValidation,true);assert.equal(session.validationPassed,false);
  assert.deepEqual(session.changedFiles,['value.mjs']);assert.equal(session.contextMemory.units.has(ref),false);
  assert.equal(session.contextArchive.cachedBytes,0);
  assert.match(JSON.stringify(sessionContext(session)),/Keep exact constraint Ω/);
  assert.match(await session.contextMemory.recall({ref,maxBytes:8000}),/marker = 17/);
  assert.ok(session.contextArchive.cachedBytes<=config.memoryCacheBytes);
  assert.equal((await session.contextArchive.get(ref)).output,output);
  await closeSessionJournal(session);
}));

test('cold history survives restart without reloading full transcript and stays searchable after summary',()=>scenario(async(root,config)=>{
  const {session,ref}=await seed(config);await collectCompactedHistory(session,config);await persistRuntimeState(session);await closeSessionJournal(session);
  const next={...config,sessionId:undefined,resume:'gc'},restored=createAgentSession(next);
  await attachSessionJournal(restored,next);
  assert.equal(restored.messages.length,1);assert.equal(restored.pendingValidation,true);assert.equal(restored.compaction.firstKeptIndex,0);
  restored.tools=new WorkspaceTools({workspace:root});await restored.tools.init();
  restored.contextMemory=new ContextMemory(restored.tools);attachContextArchive(restored,next);restored.contextMemory.rebuild(restored.messages);
  const rows=JSON.parse(await restored.contextMemory.search({query:'marker'}));assert.ok(rows.some(r=>r.ref===ref));
  assert.match(await restored.contextMemory.recall({ref}),/marker = 17/);
  const plan=await restored.contextMemory.assemble({messages:sessionContext(restored),canonical:restored.messages,
    system:'coding',tools:[],config:next,state:restored,goal:'Continue'});
  assert.ok(plan.request.tools.some(t=>t.name==='search_history'));assert.equal(validToolProtocol(plan.request.messages),true);
  await closeSessionJournal(restored);
}));

test('hand edits expire cold source and dependencies of retained recall results',()=>scenario(async(root,config)=>{
  const {session,ref}=await seed(config);await collectCompactedHistory(session,config);
  const output=await session.contextMemory.recall({ref});
  session.messages.push({role:'assistant',content:[{type:'tool_use',id:'recovered',name:'recall_context',input:{ref}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'recovered',content:output}]});
  session.contextMemory.rebuild(session.messages);
  await writeFile(path.join(root,'value.mjs'),'export const marker = 99;\n');
  assert.match(await session.contextMemory.recall({ref}),/STALE/);
  const plan=await session.contextMemory.assemble({messages:session.messages,canonical:session.messages,system:'coding',tools:[],config,state:session});
  assert.doesNotMatch(JSON.stringify(plan.request.messages),/marker = 17/);
  await closeSessionJournal(session);
}));

test('orphan collection retains committed and nested artifacts, honours grace and can reopen',()=>scenario(async(root,config)=>{
  const {session,ref}=await seed(config);await collectCompactedHistory(session,config);
  const orphan=await session.journal.put({unused:'interrupted precommit'});
  const recent=await session.journal.put({unused:'too new'});
  const filename=path.join(session.journal.artifacts,orphan+'.bin');await utimes(filename,new Date(0),new Date(0));
  const result=await session.journal.collectOrphans();assert.equal(result.deleted,1);
  await assert.rejects(readFile(filename),/ENOENT/);assert.ok(await readFile(path.join(session.journal.artifacts,recent+'.bin')));
  assert.match(await session.contextMemory.recall({ref}),/marker = 17/);
  await closeSessionJournal(session);
  const reopened=await SessionJournal.open({workspace:root,id:'gc',resume:true});await reopened.close();
}));

test('uncommitted GC cannot release history or clear pending edits',()=>scenario(async(root,config)=>{
  const {session}=await seed(config),original=structuredClone(session.messages);
  const append=session.journal.append.bind(session.journal);
  session.journal.append=(kind,value)=>kind==='memory_gc_checkpoint'?Promise.reject(new Error('commit failed')):append(kind,value);
  await assert.rejects(collectCompactedHistory(session,config),/commit failed/);
  assert.deepEqual(session.messages,original);assert.equal(session.pendingValidation,true);
  await closeSessionJournal(session);
}));

test('GC and reset retain unknown billing reservation and reset hides prior archive epoch',()=>scenario(async(root,config)=>{
  const {session,ref}=await seed(config);
  await session.journal.append('request_intent',{requestId:'unknown',reservedUsd:.125,inputBound:2000});
  await collectCompactedHistory(session,config);await persistRuntimeState(session);await closeSessionJournal(session);
  const next={...config,sessionId:undefined,resume:'gc'},restored=createAgentSession(next);await attachSessionJournal(restored,next);
  assert.equal(restored.budgetUnknown,true);assert.equal(restored.restoredBudget.spentUsd,.125);await closeSessionJournal(restored);
  await assert.rejects(runTask('Continue',{...next,apiKey:'never-submit',maxCostUsd:1,
    inputRateUsdPerMillion:1,outputRateUsdPerMillion:1},{session:restored}),/unresolved billing/);
  await resetConversation(restored,next);assert.equal(restored.pendingValidation,true);
  await attachSessionJournal(restored,next);restored.tools=new WorkspaceTools({workspace:root});await restored.tools.init();
  restored.contextMemory=new ContextMemory(restored.tools);attachContextArchive(restored,next);
  assert.equal(restored.contextArchive.count,0);await assert.rejects(restored.contextMemory.recall({ref}),/Unknown/);
  await closeSessionJournal(restored);
}));

test('default auto mode actually summarizes and collects covered messages',()=>scenario(async(root,config)=>{
  const {session}=await seed(config);session.compaction=null;await closeSessionJournal(session);
  const result=await compactAgentSession({...config,runId:'manual-gc'},{session,adapterFactory:()=>({complete:async()=>done(summary)})});
  assert.equal(result.status,'compacted');assert.ok(session.archivedMessageCount>0);assert.equal(session.compaction.firstKeptIndex,0);
  assert.equal(session.pendingValidation,true);
}));

test('storage quota refuses new data before deleting existing history',()=>scenario(async(root,config)=>{
  const journal=await SessionJournal.open({workspace:root,id:'quota',maxStorageBytes:300});
  const ref=await journal.put({small:'kept'});await assert.rejects(journal.put({big:'X'.repeat(1000)}),/storage limit/);
  assert.deepEqual(await journal.get(ref),{small:'kept'});await journal.close();
}));

test('crash after checkpoint commit restores authoritative in-turn validation and full-history opt out',()=>scenario(async(root,config)=>{
  const {session}=await seed(config);session.pendingValidation=false;
  await collectCompactedHistory(session,config,{pendingValidation:true,validationPassed:false,validationAttempts:4,changedFiles:['value.mjs']});
  await closeSessionJournal(session);
  const next={...config,sessionId:undefined,resume:'gc'},restored=createAgentSession(next);
  await attachSessionJournal(restored,next);assert.equal(restored.pendingValidation,true);assert.equal(restored.validationAttempts,4);
  assert.equal(restored.restoredTools,null);await closeSessionJournal(restored);
  const full={...next,memoryGc:'off',memoryPolicy:'full-history',compaction:'off'},original=createAgentSession(full);
  await attachSessionJournal(original,full);assert.equal(original.messages.length,4);assert.equal(original.compaction,null);
  assert.equal(original.pendingValidation,true);assert.equal(original.validationAttempts,4);await closeSessionJournal(original);
}));

test('memory pressure stops rather than growing or sending without a successful checkpoint',()=>scenario(async(root,config)=>{
  const session=createAgentSession(config);let calls=0;
  const result=await runTask('X'.repeat(1000),{...config,memoryGcMaxResidentBytes:100,runId:'pressure'},
    {session,adapterFactory:()=>({complete:async()=>{calls++;return done('no');}})});
  assert.equal(result.status,'memory_limit_reached');assert.equal(calls,0);
}));

test('resident memory pressure triggers automatic summary below the wire threshold',()=>scenario(async(root,config)=>{
  const {session}=await seed(config);session.compaction=null;session.pendingValidation=false;await closeSessionJournal(session);
  let summaries=0,requests=0;
  const result=await runTask('Continue without edits',{...config,memoryGcMaxResidentBytes:2000,runId:'auto-pressure'},
    {session,adapterFactory:()=>({complete:async request=>{
      if(!request.tools.length){summaries++;return done(summary);}requests++;return done('Inspected.');
    }})});
  assert.equal(result.status,'completed');assert.equal(summaries,1);assert.equal(requests,1);
  assert.ok(residentHistoryBytes(session)<2000);assert.ok(session.archivedMessageCount>0);
}));

test('cold payload LRU and metadata caches stay within configured bounds',()=>scenario(async(root)=>{
  const journal=await SessionJournal.open({workspace:root,id:'cache'}),archive=new ContextArchive(journal,{cacheBytes:700,metadataEntries:2});
  for(let i=0;i<5;i++)await archive.store({ref:'note-'+String(i).padStart(20,'0'),provenance:'inferred',kind:'decision',output:'x'.repeat(220)});
  for(let i=0;i<5;i++)await archive.get('note-'+String(i).padStart(20,'0'));
  assert.ok(archive.cachedBytes<=700);assert.equal(archive.metadata.size,2);assert.ok(archive.cache.size<5);
  archive.sweepCache();assert.equal(archive.cachedBytes,0);assert.equal(archive.cache.size,0);
  await journal.close();
}));

test('corrupt nested archived evidence prevents recovery before provider use',()=>scenario(async(root,config)=>{
  const {session}=await seed(config);await collectCompactedHistory(session,config);
  const row=session.journal.rows.find(r=>r.kind==='context_archive'),entry=await session.journal.get(row.artifact);
  const filename=path.join(session.journal.artifacts,entry.artifact+'.bin');await closeSessionJournal(session);
  await writeFile(filename,'corrupt');
  await assert.rejects(SessionJournal.open({workspace:root,id:'gc',resume:true}),/schema|artifact|authentication/i);
}));

test('observed project rules remain anchored after GC and manual changes invalidate them',()=>scenario(async(root,config)=>{
  const {session}=await seed(config);
  await writeFile(path.join(root,'AGENTS.md'),'Modify value.mjs only; keep protected_rule_123.\n');
  const output=await session.tools.readFile({path:'AGENTS.md'});
  session.messages.splice(3,0,{role:'assistant',content:[{type:'tool_use',id:'rules',name:'read_file',input:{path:'AGENTS.md'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'rules',content:output}]});
  session.compaction.firstKeptIndex=5;
  await collectCompactedHistory(session,config);
  const assemble=()=>session.contextMemory.assemble({messages:sessionContext(session),canonical:session.messages,system:'coding',tools:[],config,state:session,goal:'Continue'});
  assert.match(JSON.stringify((await assemble()).request.messages),/protected_rule_123/);
  await writeFile(path.join(root,'AGENTS.md'),'new_rule_456\n');
  assert.doesNotMatch(JSON.stringify((await assemble()).request.messages),/protected_rule_123/);
  await closeSessionJournal(session);
}));

test('a separate Node process resumes collected history and recalls the cold source',()=>scenario(async(root,config)=>{
  const {session,ref}=await seed(config);await collectCompactedHistory(session,config);await persistRuntimeState(session);await closeSessionJournal(session);
  const modules=['agent','session-memory','tools','context-assembler','memory-gc'].map(name=>JSON.stringify(new URL('../src/'+name+'.mjs',import.meta.url).href));
  const code=`import {createAgentSession} from ${modules[0]};
    import {attachSessionJournal,closeSessionJournal} from ${modules[1]};
    import {WorkspaceTools} from ${modules[2]};import {ContextMemory} from ${modules[3]};
    import {attachContextArchive} from ${modules[4]};
    const config=JSON.parse(process.argv[1]),session=createAgentSession(config);await attachSessionJournal(session,config);
    try{session.tools=new WorkspaceTools({workspace:config.workspace});await session.tools.init();session.contextMemory=new ContextMemory(session.tools);
      attachContextArchive(session,config);session.contextMemory.rebuild(session.messages);
      const output=await session.contextMemory.recall({ref:process.argv[2]});
      console.log(JSON.stringify({recovered:output.includes('marker = 17'),residentMessages:session.messages.length,pendingValidation:session.pendingValidation}));
    }finally{await closeSessionJournal(session);}`;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',code,
    JSON.stringify({...config,sessionId:undefined,resume:'gc'}),ref],{windowsHide:true,timeout:30000});
  assert.deepEqual(JSON.parse(stdout),{recovered:true,residentMessages:1,pendingValidation:true});
}));
