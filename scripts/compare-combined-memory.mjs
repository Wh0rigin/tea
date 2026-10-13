import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, assertLiveConfig } from '../src/config.mjs';
import { runTask, createAgentSession } from '../src/agent.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { ContextMemory } from '../src/context-assembler.mjs';
import { AnthropicMessagesAdapter, ModelError, buildMessagesRequest } from '../src/model.mjs';
import { requestBytes } from '../src/compaction.mjs';
import { runtimeCapabilities, capabilityNotice } from '../src/tool-feedback.mjs';
import { attachSessionJournal, appendSessionMessage, persistRuntimeState, closeSessionJournal } from '../src/session-memory.mjs';
import { prepareFixture, cloneFixture, taskDefinitions, treeFingerprint, assertNoAncestorInstructions } from '../src/comparison-fixtures.mjs';
import { hiddenAcceptance } from '../src/runtime-benchmark.mjs';
import { createComparisonTurnAudit } from '../src/comparison-turn-audit.mjs';
import { createSourceCapture, createPackageScriptReader } from '../src/comparison-source-capture.mjs';

const exec=promisify(execFile),ROOT=process.cwd(),mode=process.argv[2],output=path.resolve(process.argv[3]||'');
if(!['prepare','live'].includes(mode)||!process.argv[3])throw new Error('Use prepare|live OUTPUT_DIRECTORY');
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const git=async(args,cwd=ROOT)=>(await exec('git',args,{cwd,windowsHide:true})).stdout.trim();
const sourceFiles=[...(await readdir('src')).filter(f=>f.endsWith('.mjs')).sort().map(f=>'src/'+f),'package.json','scripts/compare-combined-memory.mjs','scripts/check-combined-memory.mjs','docs/COMBINED_MEMORY_EXPERIMENT.md'];
const snapshot=async()=>hash(await Promise.all(sourceFiles.map(async file=>({path:file,sha256:hash(await readFile(file))}))));
const variants=[{id:'full_off',memoryPolicy:'full-history',compaction:'off'},{id:'full_auto',memoryPolicy:'full-history',compaction:'auto'},{id:'contextos_off',memoryPolicy:'contextos',compaction:'off'},{id:'contextos_auto',memoryPolicy:'contextos',compaction:'auto'}];
const baseConfig=loadConfig({memoryPolicy:'full-history',compaction:'off',compactionKeepRecentBytes:24000,contextosTargetBytes:32000});
if(baseConfig.storeRaw||baseConfig.maxRequestInputTokens!==80000||baseConfig.compactionTriggerRatio!==.8||baseConfig.maxToolCalls!==24||baseConfig.timeoutMs!==180000||baseConfig.maxOutputTokens!==4096||!baseConfig.capabilityFeedback)throw new Error('Common controls must match frozen protocol');
const system=(await readFile('src/agent.mjs','utf8')).match(/const SYSTEM_PROMPT = `([^`]+)`;/)[1];
const profile={model:baseConfig.model,thinkingMode:baseConfig.thinkingMode,effort:baseConfig.effort,taskMaxOutputTokens:4096,summaryMaxOutputTokens:1200,requestGuardBytes:80000,triggerRatio:.8,keepRecentBytes:24000,contextosTargetBytes:32000,contextStrategy:baseConfig.contextStrategy,capabilityFeedback:true,maxToolsPerTurn:24,maxRequestsPerRun:24,requestTimeoutMs:180000,turnTimeoutMs:300000,sharedGuardUsd:8,perRunGuardUsd:.6,inputRateUsdPerMillion:baseConfig.inputRateUsdPerMillion,outputRateUsdPerMillion:baseConfig.outputRateUsdPerMillion,endpointSha256:hash(baseConfig.baseUrl),stream:baseConfig.stream};
async function evaluate(workspace,definition){
 const publicPassed=await exec(process.execPath,['--test','tests/public.test.mjs'],{cwd:workspace,windowsHide:true,timeout:20000}).then(()=>true,()=>false);
 const hidden=await hiddenAcceptance(workspace,{entry:definition.entry,hiddenTest:`import test from 'node:test';import assert from 'node:assert/strict';import {${definition.export}} from './candidate.mjs';test('independent acceptance',async()=>{${definition.hidden}});`});
 const changed=(await git(['diff','--name-only','HEAD'],workspace)).split(/\r?\n/).filter(Boolean);
 const untracked=(await git(['ls-files','--others','--exclude-standard'],workspace)).split(/\r?\n/).filter(x=>x&&!x.startsWith('.tea/'));
 const scopePassed=changed.every(x=>x===definition.entry)&&!untracked.length;
 return{publicPassed,hiddenPassed:hidden.passed,hiddenCompleted:hidden.completed,scopePassed,changed,passed:publicPassed&&hidden.passed&&hidden.completed&&scopePassed};
}
if(mode==='prepare'){
 await mkdir(output,{recursive:false});
 const workspaceRoot=await mkdtemp(path.join(os.tmpdir(),'tea-combined-memory-'));await assertNoAncestorInstructions(workspaceRoot);
 const definitions=taskDefinitions(),cases=[];
 for(const [id,taskId,shape] of [['short','small-cache-key','empty'],['protected','medium-retry-budget','protected'],['evictable','large-unicode','inventory']]){
  const definition=definitions.find(d=>d.taskId===taskId),base=path.join(workspaceRoot,id+'-base');await prepareFixture(base,definition);
  if(shape==='protected'){
   await writeFile(path.join(base,'README.md'),'# Historical inspection record\nobserved_marker=997\n'+('Background project documentation detail.\n'.repeat(100)));
   await git(['add','README.md'],base);await git(['-c','user.name=TEA benchmark','-c','user.email=benchmark@example.invalid','-c','commit.gpgsign=false','commit','-q','-m','Freeze protected history fixture'],base);
  }
  const initial=await evaluate(base,definition);if(!initial.publicPassed||initial.hiddenPassed||!initial.hiddenCompleted||!initial.scopePassed)throw new Error('Initial fixture invalid');
  const tools=new WorkspaceTools({workspace:base,deduplicateReads:false});await tools.init();
  const seed=[];let serial=0;
  const add=async(name,input)=>{const content=name==='read_file'?await tools.readFile(input):await tools.listFiles(input),id=`seed-${++serial}`;seed.push({role:'assistant',content:[{type:'tool_use',id,name,input}]},{role:'user',content:[{type:'tool_result',tool_use_id:id,content}]});};
  const prompt=definition.prompt,notice=capabilityNotice(runtimeCapabilities({stdinIsTTY:false,stdoutIsTTY:false}));
  const canonical=()=>[...seed,{role:'user',content:prompt+'\n\n'+notice}];
  if(shape!=='empty'){
   seed.push({role:'user',content:'Inspect the project without editing during this inspection. Preserve its API, tests and instructions.'});
   await add('read_file',{path:'AGENTS.md'});
   if(shape==='inventory')await add('read_file',{path:'README.md'});
   let round=0;
   while(requestBytes(baseConfig,{system,tools:tools.modelToolDefinitions({includeMemory:false}),messages:canonical()})<64800){
    if(++round>32)throw new Error('Seed setup exceeded fixed read limit');
    await add(shape==='protected'?'read_file':'list_files',shape==='protected'?{path:'README.md'}:{maxFiles:100,offset:((round-1)%6)*100});
   }
   seed.push({role:'assistant',content:[{type:'text',text:'Read-only inspection complete; no files modified.'}]});
  }
  const initialProjectedBytes={};
  for(const variant of variants){
   const config={...baseConfig,...variant,workspace:base};let request={system,tools:tools.modelToolDefinitions({includeMemory:false}),messages:canonical()};
   if(variant.memoryPolicy==='contextos')request=(await new ContextMemory(tools).assemble({messages:canonical(),canonical:canonical(),system,tools:request.tools,config,state:{pendingValidation:false,validationPassed:false,changedFiles:[]},goal:prompt,commit:false})).request;
   initialProjectedBytes[variant.id]=requestBytes(config,request);
   if(initialProjectedBytes[variant.id]>=80000)throw new Error('Prepared request exceeds wire guard');
  }
  if(shape==='protected'&&initialProjectedBytes.contextos_auto<64000)throw new Error('Protected combined arm would not trigger');
  if(shape==='inventory'&&initialProjectedBytes.contextos_auto>=64000)throw new Error('Evictable combined arm would trigger unexpectedly');
  const seedFile=path.join(output,id+'-seed.json');await writeFile(seedFile,JSON.stringify(seed));
  cases.push({id,taskId,shape,base,prompt,promptSha256:hash(prompt),seedFile,seedSha256:hash(seed),seedBytes:Buffer.byteLength(JSON.stringify(seed)),seedMessages:seed.length,initialIdentity:{commit:await git(['rev-parse','HEAD'],base),...await treeFingerprint(base)},initialProjectedBytes});
 }
 const plan={schemaVersion:1,state:'prepared before paid calls',engineCommit:await git(['rev-parse','HEAD']),sourceSha256:await snapshot(),profile,variants,cases,repeat:4,plannedRuns:48,workspaceRoot,order:cases.flatMap(c=>Array.from({length:4},(_,r)=>({caseId:c.id,repeat:r+1,variants:variants.map((_,i)=>variants[(i+r)%4].id)})))};
 await writeFile(path.join(output,'plan.json'),JSON.stringify(plan,null,2));console.log(JSON.stringify({state:plan.state,plannedRuns:48,paidRequestsAdded:0,cases:cases.map(c=>({id:c.id,seedBytes:c.seedBytes,initialProjectedBytes:c.initialProjectedBytes}))}));
}else{
 assertLiveConfig(baseConfig);
 const plan=JSON.parse(await readFile(path.join(output,'plan.json'),'utf8'));
 if(plan.state!=='prepared before paid calls'||plan.engineCommit!==await git(['rev-parse','HEAD'])||plan.sourceSha256!==await snapshot()||JSON.stringify(plan.profile)!==JSON.stringify(profile))throw new Error('Frozen preparation changed or already started');
 plan.state='live started';await writeFile(path.join(output,'plan.json'),JSON.stringify(plan,null,2));
 const report={schemaVersion:1,state:'live started',complete:false,engineCommit:plan.engineCommit,sourceSha256:plan.sourceSha256,profile,plannedRuns:48,runs:[],conservativeSpentOrReservedUsd:0,haltReason:null};
 const save=async()=>writeFile(path.join(output,'comparison.json'),JSON.stringify(report,null,2));await save();
 outer:for(const block of plan.order){
  const item=plan.cases.find(c=>c.id===block.caseId),definition=taskDefinitions().find(d=>d.taskId===item.taskId);
  for(const id of block.variants){
   if(report.conservativeSpentOrReservedUsd+.6>8){report.haltReason='shared guard cannot reserve next run';break outer;}
   if(plan.sourceSha256!==await snapshot())throw new Error('Source changed during experiment');
   const variant=variants.find(v=>v.id===id),workspace=path.join(plan.workspaceRoot,`${item.id}-r${block.repeat}-${id}`);await cloneFixture(item.base,workspace);
   const identity=await treeFingerprint(workspace);if(identity.sha256!==item.initialIdentity.sha256)throw new Error('Initial contents mismatch');
   const seed=JSON.parse(await readFile(item.seedFile,'utf8'));if(hash(seed)!==item.seedSha256)throw new Error('Seed changed');
   const config={...baseConfig,...variant,workspace,maxCostUsd:.6,sessionId:'combined',runId:'repair'};
   const session=createAgentSession(config);await attachSessionJournal(session,config);
   for(const message of seed)await appendSessionMessage(session,message);await persistRuntimeState(session);await closeSessionJournal(session);
   const adapter=new AnthropicMessagesAdapter(config),complete=adapter.complete.bind(adapter);let attempts=0;
   adapter.complete=async request=>{
    if(++attempts>24)throw new ModelError('Experiment provider request limit reached');
    const payload=buildMessagesRequest(config,request);
    await session.journal.append('combination_native_request',{purpose:request.tools.length?'task':'compaction',payload,sha256:hash(payload),wireBytes:Buffer.byteLength(JSON.stringify(payload))});
    return complete(request);
   };
   session.adapter=adapter;session.offline=false;
   const expectedTools=new WorkspaceTools({workspace});await expectedTools.init();const expectedOutput=await expectedTools.readFile({path:definition.entry});
   const captureSources=createSourceCapture(workspace,['package.json','AGENTS.md','README.md',definition.entry,'tests/public.test.mjs']);
   const observer=createComparisonTurnAudit({agent:'tea',workspace,requiredPath:definition.entry,expectedOutput,captureSources,getPackageScripts:createPackageScriptReader(workspace)});
   const run={caseId:item.id,taskId:item.taskId,repeat:block.repeat,variant:id,workspace,initialSha256:identity.sha256,seedSha256:item.seedSha256,running:true};report.runs.push(run);await save();
   console.log(JSON.stringify({starting:`${item.id}/r${block.repeat}/${id}`,completedRuns:report.runs.length-1}));
   const started=Date.now();let result=null,error=null;
   try{result=await runTask(item.prompt,config,{session,signal:AbortSignal.timeout(300000),onEvent:observer.observe});}catch(e){error=e.message;}
   const requirements=observer.finish(),evaluation=await evaluate(workspace,definition);
   const events=result?(await readFile(path.join(result.runDirectory,'ledger.jsonl'),'utf8')).trim().split('\n').map(JSON.parse):[];
   const rows=events.filter(e=>e.type==='model_request').map(({purpose,usage,usageComplete,usageStatus,estimatedUsd,costBasis,requestSha256,responseSha256,stopReason})=>({purpose,usage,usageComplete,usageStatus,estimatedUsd,costBasis,requestSha256,responseSha256,stopReason}));
   const usageComplete=Boolean(result&&rows.length&&rows.every(q=>q.usageComplete)&&result.summary.ledgerIntegrity);
   const totals=result?.summary;
   Object.assign(run,{running:false,status:result?.status||'failed',error,accepted:Boolean(evaluation.passed&&requirements.passed&&requirements.validatedAfterEdit&&result?.status==='completed'&&usageComplete),acceptance:evaluation,requirements,usageComplete,inputTokens:usageComplete?totals.inputTokens:null,outputTokens:usageComplete?totals.outputTokens:null,totalTokens:usageComplete?totals.inputTokens+totals.outputTokens:null,summaryRequests:rows.filter(q=>q.purpose==='compaction').length,summaryTokens:usageComplete?totals.compactionInputTokens+totals.compactionOutputTokens:null,compactionCount:session.compactionCount,elapsedMs:Date.now()-started,conservativeSpentOrReservedUsd:adapter.spentUsd,requests:rows});
   report.conservativeSpentOrReservedUsd+=adapter.spentUsd;await save();console.log(JSON.stringify({finished:`${item.id}/r${block.repeat}/${id}`,accepted:run.accepted,totalTokens:run.totalTokens,summaryRequests:run.summaryRequests,compactions:run.compactionCount}));
   if(!usageComplete||session.budgetUnknown){report.haltReason='unknown or unrecorded provider usage; reservation retained';break outer;}
  }
 }
 report.complete=!report.haltReason&&report.runs.length===48;report.state=report.complete?'complete':'halted';report.sourceAfterSha256=await snapshot();report.sourceUnchanged=report.sourceSha256===report.sourceAfterSha256;await save();
 plan.state=report.state;await writeFile(path.join(output,'plan.json'),JSON.stringify(plan,null,2));console.log(JSON.stringify({state:report.state,runs:report.runs.length,conservativeSpentOrReservedUsd:report.conservativeSpentOrReservedUsd,haltReason:report.haltReason}));
}
