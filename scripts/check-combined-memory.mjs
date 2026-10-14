import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runTask, createAgentSession } from '../src/agent.mjs';
import { loadConfig } from '../src/config.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { ContextMemory, validToolProtocol } from '../src/context-assembler.mjs';
import { requestBytes } from '../src/compaction.mjs';
import { attachSessionJournal, appendSessionMessage, persistRuntimeState, closeSessionJournal } from '../src/session-memory.mjs';
import { attachContextArchive } from '../src/memory-gc.mjs';

const output=path.resolve(process.argv[2]||`benchmarks/results/combined-memory-contract-${Date.now()}`);
await mkdir(output,{recursive:false});
const root=await mkdtemp(path.join(os.tmpdir(),'tea-combined-contract-'));
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const summary=['Goal','Constraints','Progress','Decisions','Next steps','Critical context'].map(h=>`## ${h}\nHistorical inspection complete. Tests passed according to this inferred summary; inspect current source.`).join('\n');
const checks=[],runs=[];
function check(name,passed,detail){checks.push({name,passed,detail});}
for(const [policy,compaction] of [['full-history','off'],['full-history','auto'],['contextos','off'],['contextos','auto']]){
 const variant=`${policy}-${compaction}`,workspace=path.join(root,variant);await mkdir(workspace);
 await writeFile(path.join(workspace,'README.md'),'observed_marker=997\n'+('Historical project documentation detail.\n'.repeat(300)));
 await writeFile(path.join(workspace,'AGENTS.md'),'Modify value.mjs only; run node --test value.test.mjs.\n');
 await writeFile(path.join(workspace,'value.mjs'),'export const value = 1;\n');
 await writeFile(path.join(workspace,'value.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('value',()=>assert.equal(value,2));\n");
 const config={...loadConfig({workspace,memoryPolicy:policy,compaction,sessionId:'combined-contract'},{}),maxCostUsd:1,maxRequestInputTokens:80000,contextosTargetBytes:32000,compactionKeepRecentBytes:8000,maxOutputTokens:4096,compactionTriggerRatio:.8};
 const tools=new WorkspaceTools({workspace,deduplicateReads:false});await tools.init();
 const seed=[{role:'user',content:'Inspect README without editing; preserve original requirements.'}];
 let serial=0;
 do{
  const id=`seed-${++serial}`,input={path:'README.md',...(serial>1?{startLine:2}:{})},result=await tools.readFile(input);
  seed.push({role:'assistant',content:[{type:'tool_use',id,name:'read_file',input}]},{role:'user',content:[{type:'tool_result',tool_use_id:id,content:result}]});
 }while(requestBytes(config,{system:'coding',tools:tools.modelToolDefinitions({includeMemory:false}),messages:seed})<65600);
 seed.push({role:'assistant',content:[{type:'text',text:'Read-only inspection complete.'}]});
 const seedHash=hash(seed),session=createAgentSession(config);session.tools=tools;
 await attachSessionJournal(session,config);for(const message of seed)await appendSessionMessage(session,message);
 session.pendingValidation=true;session.validationPassed=false;session.changedFiles=['value.mjs'];
 await persistRuntimeState(session);await closeSessionJournal(session);
 let taskRequests=0,summaryRequests=0,searchAdvertised=null,firstTaskPending=null,nudges=0;
 const result=await runTask('Change value to 2 and run the real test.',config,{session,adapterFactory:()=>({complete:async request=>{
  if(!request.tools.length){summaryRequests++;return{content:[{type:'text',text:summary}],stop_reason:'end_turn'};}
  taskRequests++;if(taskRequests===1){searchAdvertised=request.tools.some(t=>t.name==='search_history');firstTaskPending=request.messages.some(m=>typeof m.content==='string'&&m.content.includes('"pendingValidation":true'));}
  if(taskRequests===1)return{content:[{type:'text',text:'Finished.'}],stop_reason:'end_turn'};
  const instructions=taskRequests===2?[['read_file',{path:'value.mjs'}],['read_file',{path:'AGENTS.md'}]]:taskRequests===3?[['apply_patch',{path:'value.mjs',search:'value = 1',replace:'value = 2'}]]:taskRequests===4?[['run_tests',{command:'node --test value.test.mjs'}]]:[];
  if(!instructions.length)return{content:[{type:'text',text:'Verified.'}],stop_reason:'end_turn'};
  return{content:instructions.map(([name,input],i)=>({type:'tool_use',id:`task-${taskRequests}-${i}`,name,input})),stop_reason:'tool_use'};
 }})});
 nudges=session.messages.filter(m=>typeof m.content==='string'&&m.content.includes('Runtime validation is pending')).length;
 await attachSessionJournal(session,config);
 if(policy==='contextos')attachContextArchive(session,config);
 const gcRow=session.journal.rows.findLast(row=>row.kind==='memory_gc_checkpoint');
 const gcCheckpoint=gcRow ? await session.journal.get(gcRow.artifact) : null;
 const originals=gcCheckpoint ? await Promise.all([...gcCheckpoint.coveredArtifacts,...gcCheckpoint.suffixArtifacts].map(ref=>session.journal.get(ref))) : session.messages;
 const canonicalPreserved=hash(originals.slice(0,seed.length))===seedHash;
 check(`${variant}: canonical seed durably preserved`,canonicalPreserved);
 check(`${variant}: actual validation required and completed`,result.status==='completed'&&result.validationPassed&&nudges===1);
 check(`${variant}: expected summary activation`,summaryRequests===(compaction==='auto'?1:0));
 let recovery=null;
 if(policy==='contextos'){
  const memory=session.contextMemory;memory.rebuild(session.messages);
  const unit=[...memory.units.values()].find(u=>u.name==='read_file'&&u.path==='README.md')
   || JSON.parse(await memory.search({query:'observed_marker=997'})).find(u=>u.path==='README.md');
  const originalRecovered=(await memory.recall({ref:unit.ref})).includes('observed_marker=997');
  check(`${variant}: original indexed source remains recoverable internally`,originalRecovered);
  if(compaction==='auto'){
   check('combined auto: history search advertised after checkpoint',searchAdvertised===true,'Compatibility expectation; a false result records the conditional retrieval-entry gap, not a harness error.');
   check('combined auto: authoritative pending state overrides summary',firstTaskPending===true);
   await writeFile(path.join(workspace,'README.md'),'current_marker=1001\n');
   const stale=await memory.recall({ref:unit.ref});
   check('combined auto: stale source withheld',stale.startsWith('STALE')&&!stale.includes('observed_marker=997'));
   // Restore the file before resuming; external changes intentionally invalidate checkpoints.
   await writeFile(path.join(workspace,'README.md'),'observed_marker=997\n'+('Historical project documentation detail.\n'.repeat(300)));
   await persistRuntimeState(session);await closeSessionJournal(session);
   const resumed=createAgentSession({...config,resume:'combined-contract'});
   const resumedResult=await runTask('Confirm current status.',{...config,resume:'combined-contract',runId:'resume-check'},{session:resumed,adapterFactory:()=>({complete:async()=>({content:[{type:'text',text:'Status confirmed.'}],stop_reason:'end_turn'})})});
   check('combined auto: checkpoint survives unchanged-workspace resume',resumed.compaction?.id===session.compaction?.id&&resumed.messages.length===session.messages.length+2&&resumedResult.status==='completed');
  }
  recovery={originalRecovered,searchAdvertised};
 }
 await closeSessionJournal(session);
 runs.push({variant,taskRequests,summaryRequests,canonicalPreserved,actualValidationPassed:result.validationPassed,validationNudges:nudges,compactionCount:session.compactionCount,recovery});
}
const report={kind:'scripted native combination checks; no provider token claim',profile:{requestGuardBytes:80000,triggerRatio:.8,keepRecentBytes:8000,contextosTargetBytes:32000},paidRequestsAdded:0,runs,checks,passed:checks.filter(c=>c.passed).length,total:checks.length,combinationFullyCompatible:checks.every(c=>c.passed)};
await writeFile(path.join(output,'contract.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
assert.ok(checks.filter(c=>c.name!=='combined auto: history search advertised after checkpoint').every(c=>c.passed),'Unexpected integration regression');
