import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { codingTasks } from '../benchmarks/tasks/coding-ability.mjs';
import { loadCliConfig, assertBenchmarkConfig } from '../src/config.mjs';
import { resolveUserEnvironment } from '../src/user-config.mjs';
import { prepareRevisionEngine } from '../src/comparison-revisions.mjs';
import { assertNoAncestorInstructions } from '../src/comparison-fixtures.mjs';
import { writeTree, command, acceptance, snapshot } from './coding-ability-harness.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), execute=promisify(execFile);
const hash=value=>createHash('sha256').update(value).digest('hex');
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const m=/^--(mode|run-id|baseline-ref|candidate-ref|phase)=(.+)$/.exec(arg);if(!m)throw Error('Invalid option');return[m[1],m[2]];}));
const mode=options.mode||'prepare',runId=options['run-id']||`coding-s6-${Date.now()}`,phase=options.phase||'screen';
if(!['screen','confirm'].includes(phase))throw Error('Invalid phase');
const repeats=phase==='screen'?2:3,suiteCapUsd=phase==='screen'?4:8;
const selectedTasks=phase==='screen'?codingTasks.filter(x=>['l1-narcissistic','l1-intervals','l2-ttl-cache'].includes(x.id)):codingTasks;
const planned=selectedTasks.length*repeats*2;
if(!['prepare','live'].includes(mode)||!/^[a-zA-Z0-9_-]+$/.test(runId))throw Error('Invalid mode/run ID');
const output=path.join(root,'benchmarks/results',runId);await mkdir(path.dirname(output),{recursive:true});await mkdir(output);
await mkdir(path.join(output,'engines'));
const engines={};
for(const arm of ['baseline','candidate'])engines[arm]=await prepareRevisionEngine({repository:root,
  ref:options[`${arm}-ref`]||(arm==='baseline'?'6a50dc5':'96d85a96f7acc2087c89cb5729990b908b568240'),directory:path.join(output,'engines',arm)});
const env=mode==='live'?resolveUserEnvironment():{};
const config=loadCliConfig({maxCostUsd:1,memoryPolicy:'contextos',maxRequestInputBytes:256000,contextWindowTokens:32768,contextReserveTokens:4096},
  {...env,TEA_CAPABILITY_FEEDBACK:'1',ANTHROPIC_MODEL:'glm-5.3-flash',TEA_THINKING_MODE:'enabled',TEA_REASONING_EFFORT:'low',TEA_MAX_OUTPUT_TOKENS:'4096',
    TEA_MAX_TOOL_CALLS:'24',TEA_REQUEST_TIMEOUT_MS:'90000',TEA_INPUT_PRICE_USD_PER_MTOK:'0.8',TEA_OUTPUT_PRICE_USD_PER_MTOK:'2.8',TEA_STREAM:'1'});
if(mode==='live')assertBenchmarkConfig(config);
const workspaceRoot=await realpath(await mkdtemp(path.join(os.tmpdir(),'tea-coding-s6-')));await assertNoAncestorInstructions(path.join(workspaceRoot,'probe'));
const manifest=hash(await readFile(path.join(root,'benchmarks/tasks/coding-ability.mjs')));
const report={schema:1,runId,mode,createdAt:new Date().toISOString(),engine:{baseline:engines.baseline.metadata,candidate:engines.candidate.metadata},
  harnessSha256:hash(await readFile(fileURLToPath(import.meta.url))),
  harnessNormalizedSha256:hash((await readFile(fileURLToPath(import.meta.url),'utf8')).replaceAll('\r\n','\n')),
  manifestSha256:manifest,phase,repeats,planned,taskIds:selectedTasks.map(x=>x.id),candidateFlag:{name:'versionedWrite',baseline:false,candidate:true},
  config:{model:config.model,thinkingMode:config.thinkingMode,effort:config.effort,maxOutputTokens:config.maxOutputTokens,
    contextWindowTokens:config.contextWindowTokens,contextReserveTokens:config.contextReserveTokens,maxRequestInputBytes:config.maxRequestInputBytes,
    memoryPolicy:config.memoryPolicy,historyStrategy:config.historyStrategy,contextStrategy:config.contextStrategy,capabilityFeedback:config.capabilityFeedback,enableFileCreation:config.enableFileCreation,commandTimeoutMs:120000,
    contextosTargetBytes:config.contextosTargetBytes,compaction:config.compaction,maxToolCalls:config.maxToolCalls,requestTimeoutMs:config.timeoutMs,
    taskTimeoutMs:600000,taskCapUsd:1,suiteCapUsd,endpointSha256:hash(config.baseUrl),inputRateUsdPerMillion:.8,outputRateUsdPerMillion:2.8},
  hypothesis:'Explicit version-checked full replacement reduces existing-file write refusals and edit reconstruction; fixed schema and capability overhead are measured',
  stoppingPolicy:'Unknown usage stops suite with task reservation retained; no paid retry or acceptance edits',
  gate:'All usage/coverage complete; candidate full acceptance and independent code behavior not lower overall or in any task family; all-attempt total tokens lower and at least one versioned replacement successful; confirm phase only after screen passes',
  scope:'Self-authored Node tasks; screen: three tasks twice per arm; confirm: eight tasks three times per arm, conditional on screen; no production/general superiority claim',
  rows:[],preflight:[],consumedUsd:0,stopReason:null,complete:false};
report.fixedDefinitions=[];
for(const discoveryWide of [false,true]) {
  const definitions={};
  for(const arm of ['baseline','candidate']) {
    const tools=new engines[arm].tools.WorkspaceTools({workspace:workspaceRoot});
    tools.discoveryWide=discoveryWide;tools.versionedWrite=arm==='candidate';
    definitions[arm]=tools.modelToolDefinitions({includeMemory:false});
  }
  const comparable=items=>items.map(({description,...item})=>{
    if(item.name!=='write_file')return item;
    const {expected_sha256,...properties}=item.input_schema.properties;
    return {...item,input_schema:{...item.input_schema,properties}};
  });
  const schemas=Object.fromEntries(Object.entries(definitions).map(([arm,items])=>[arm,hash(JSON.stringify(comparable(items)))]));
  if(schemas.baseline!==schemas.candidate)throw Error('S6 changed unrelated tool schemas');
  if(JSON.stringify(definitions.baseline.filter(x=>x.name!=='write_file'))!==JSON.stringify(definitions.candidate.filter(x=>x.name!=='write_file')))throw Error('S6 changed unrelated tool definitions');
  report.fixedDefinitions.push({discoveryWide,baselineSchemaSha256:schemas.baseline,candidateComparableSchemaSha256:schemas.candidate,
    baselineBytes:Buffer.byteLength(JSON.stringify(definitions.baseline)),candidateBytes:Buffer.byteLength(JSON.stringify(definitions.candidate)),
    unit:'serialized tool-definition UTF-8 bytes, not provider tokens'});
}
const save=()=>writeFile(path.join(output,'comparison.json'),JSON.stringify(report,null,2));await save();
// Freeze and check every task before any paid submission.
for(const fixture of codingTasks){
  const initial=path.join(workspaceRoot,`preflight-${fixture.id}`),reference=path.join(workspaceRoot,`reference-${fixture.id}`);
  await writeTree(initial,fixture.files);await writeTree(reference,{...fixture.files,...fixture.solution});
  const originalPublic=await command(initial,['--test','tests/public.test.mjs']),originalHidden=await acceptance(initial,fixture);
  const refPublic=await command(reference,['--test','tests/public.test.mjs']),refHidden=await acceptance(reference,fixture);
  const passed=originalPublic.passed&&!originalHidden.passed&&originalHidden.completed&&refPublic.passed&&refHidden.passed;
  report.preflight.push({id:fixture.id,passed,initialTreeSha256:hash(JSON.stringify(fixture.files)),promptSha256:hash(fixture.prompt),acceptanceSha256:hash(fixture.acceptance)});
  await save();if(!passed)throw Error(`Invalid fixture ${fixture.id}`);
}
if(mode==='live'&&phase==='confirm'){
  const prior=JSON.parse(await readFile(path.join(root,'benchmarks/results/coding-s6-screen-glm-20261016-v1/comparison.json'),'utf8'));
  if(!prior.gatePassed||prior.engine.candidate.commit!==engines.candidate.metadata.commit||prior.engine.baseline.commit!==engines.baseline.metadata.commit)throw Error('Confirmation requires passed frozen screening');
}
if(mode==='live')outer:for(let repeat=1;repeat<=repeats;repeat++)for(let index=0;index<selectedTasks.length;index++){
  const fixture=selectedTasks[index],order=(repeat+index)%2?['baseline','candidate']:['candidate','baseline'];
  for(const arm of order){
    if(report.consumedUsd+1>suiteCapUsd){report.stopReason='suite_budget_guard';break outer;}
    if(!await engines[arm].verify()||hash(await readFile(path.join(root,'benchmarks/tasks/coding-ability.mjs')))!==manifest)throw Error('Frozen source changed');
    const workspace=path.join(workspaceRoot,randomUUID());await writeTree(workspace,fixture.files);const initial=await snapshot(workspace);
    const id=`${fixture.id}-r${repeat}-${arm}`;
    await writeFile(path.join(output,`${id}-workspace.json`),JSON.stringify({workspace}));
    const row={id,taskId:fixture.id,title:fixture.title,level:fixture.level,repeat,arm,running:true,status:'running',accepted:false,usage:null};
    report.rows.push(row);report.consumedUsd+=1;await save();console.log(`START ${id}`);
    const started=Date.now();
    const runConfig={...config,workspace,runId:'agent',sessionId:undefined,resume:undefined,maxCostUsd:1,storeRaw:false,versionedWrite:arm==='candidate'};
    const session=engines[arm].engine.createAgentSession(runConfig);
    const telemetry={versionedWriteAttempts:0,versionedWriteSuccesses:0,versionedWriteErrors:0,commandTimeouts:0};
    try{
      const result=await engines[arm].engine.runTask(fixture.prompt,runConfig,
        {session,signal:AbortSignal.timeout(600000),onEvent:event=>{
          if(event.type!=='tool_end')return;
          console.log(`${id}: ${event.name} ${event.isError?'error':'done'}`);
          if(event.name==='write_file'&&event.input?.expected_sha256!==undefined){
            telemetry.versionedWriteAttempts++;
            if(event.isError)telemetry.versionedWriteErrors++;else telemetry.versionedWriteSuccesses++;
          }
          if(['run_tests','run_shell'].includes(event.name)&&/^Command timed out after \d+ ms\b/.test(event.output))telemetry.commandTimeouts++;
        }});
      Object.assign(row,telemetry);
      const summary=result.summary,complete=summary.providerUsageComplete===true;
      report.consumedUsd+=(complete&&Number.isFinite(summary.estimatedSpendUsd)?summary.estimatedSpendUsd:1)-1;
      Object.assign(row,{status:result.status,running:false,elapsedMs:Date.now()-started,validationPassed:result.validationPassed,
        validationAttempts:result.validationAttempts,toolCalls:result.toolCalls,usageComplete:complete,accountedUsd:summary.estimatedSpendUsd,
        usage:complete?{inputTokens:summary.inputTokens,outputTokens:summary.outputTokens,totalTokens:summary.totalActualTokens,
          cachedInputTokens:summary.cachedInputTokens,cacheCreationInputTokens:summary.cacheCreationInputTokens,requests:summary.requests,
          compactionRequests:summary.compactionRequests}:null});await save();
      const ledger=await readFile(path.join(result.runDirectory,'ledger.jsonl'),'utf8');
      const calls=ledger.trim().split('\n').map(JSON.parse).filter(x=>x.type==='tool_call');
      row.writeExistingErrors=calls.filter(x=>x.name==='write_file'&&x.error?.includes('File already exists')).length;
      row.toolErrors=calls.filter(x=>x.error).length;
      row.singleReadCalls=calls.filter(x=>x.name==='read_file').length;
      row.logicalReadAttempts=row.singleReadCalls;
      row.firstRequestInputTokens=ledger.trim().split('\n').map(JSON.parse).find(x=>x.type==='model_request')?.reportedInputTokens ?? null;
      const final=await snapshot(workspace),finalMap=new Map(final),initialMap=new Map(initial);
      row.changedFiles=final.filter(([name,value])=>initialMap.get(name)!==value).map(([name])=>name);
      row.deletedFiles=initial.filter(([name])=>!finalMap.has(name)).map(([name])=>name);
      row.protectedFilesUnchanged=initial.filter(([name])=>!name.startsWith('src/')).every(([name,value])=>finalMap.get(name)===value);
      row.allowedChanges=row.changedFiles.every(name=>name.startsWith('src/')||/^tests\/.+\.test\.mjs$/.test(name))&&row.deletedFiles.length===0;
      const publicAfter=await command(workspace,['--test','tests/public.test.mjs']);
      const testFiles=final.map(([name])=>name).filter(name=>/^tests\/.+\.test\.mjs$/.test(name));
      const allPublic=await command(workspace,['--test',...testFiles]),hidden=await acceptance(workspace,fixture);
      Object.assign(row,{publicPassed:publicAfter.passed,addedTestsPassed:allPublic.passed,hiddenPassed:hidden.passed,hiddenCompleted:hidden.completed,
        hiddenOutputSha256:hidden.outputSha256,failureDiagnostic:hidden.passed?null:hidden.diagnostic});
      row.functionalPass=publicAfter.passed&&hidden.passed&&row.protectedFilesUnchanged&&row.allowedChanges;
      row.codeBehaviorPass=publicAfter.passed&&hidden.passed&&allPublic.passed;
      row.accepted=row.functionalPass&&allPublic.passed&&result.status==='completed'&&result.validationPassed;
      await save();console.log(`FINISH ${id}: ${row.accepted?'PASS':'FAIL'} · ${row.usage?.totalTokens??'unknown'} tokens`);
      if(!complete){report.stopReason='unknown_usage_no_retry';break outer;}
    }catch(error){row.running=false;row.status='harness_error';row.error=String(error.message).replaceAll(workspace,'<workspace>').slice(0,400);
      report.stopReason='harness_error_task_reservation_retained';await save();break outer;}
  }
}
report.sourceUnchanged=await engines.baseline.verify()&&await engines.candidate.verify();
report.complete=mode==='prepare'||report.rows.length===planned&&!report.stopReason&&report.sourceUnchanged;
const aggregate=arm=>{
  const rows=report.rows.filter(x=>x.arm===arm);
  return {attempted:rows.length,accepted:rows.filter(x=>x.accepted).length,codeBehaviorPass:rows.filter(x=>x.codeBehaviorPass).length,
    tokens:rows.every(x=>x.usage)?rows.reduce((n,x)=>n+x.usage.totalTokens,0):null,
    replacements:rows.reduce((n,x)=>n+(x.versionedWriteSuccesses||0),0)};
};
report.totals={baseline:aggregate('baseline'),candidate:aggregate('candidate')};
report.qualityGatePassed=mode==='live'&&report.complete&&['accepted','codeBehaviorPass'].every(key=>
  report.totals.candidate[key]>=report.totals.baseline[key]&&selectedTasks.every(task=>
    report.rows.filter(x=>x.arm==='candidate'&&x.taskId===task.id&&x[key]).length>=report.rows.filter(x=>x.arm==='baseline'&&x.taskId===task.id&&x[key]).length));
report.gatePassed=report.qualityGatePassed&&report.totals.candidate.tokens<report.totals.baseline.tokens&&report.totals.candidate.replacements>0;
report.endedAt=new Date().toISOString();await save();console.log(JSON.stringify({runId,complete:report.complete,rows:report.rows.length,spent:report.consumedUsd,stopReason:report.stopReason}));
if(report.stopReason)process.exitCode=1;
