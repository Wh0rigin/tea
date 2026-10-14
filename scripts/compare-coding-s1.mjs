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
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const m=/^--(mode|run-id|baseline-ref|candidate-ref)=(.+)$/.exec(arg);if(!m)throw Error('Invalid option');return[m[1],m[2]];}));
const mode=options.mode||'prepare',runId=options['run-id']||`coding-s1-${Date.now()}`;
if(!['prepare','live'].includes(mode)||!/^[a-zA-Z0-9_-]+$/.test(runId))throw Error('Invalid mode/run ID');
const output=path.join(root,'benchmarks/results',runId);await mkdir(path.dirname(output),{recursive:true});await mkdir(output);
await mkdir(path.join(output,'engines'));
const engines={};
for(const arm of ['baseline','candidate'])engines[arm]=await prepareRevisionEngine({repository:root,
  ref:options[`${arm}-ref`]||(arm==='baseline'?'4ac8d9224f21ca330016c83aee72eff5e6a25f34':'e0787b1'),directory:path.join(output,'engines',arm)});
const env=mode==='live'?resolveUserEnvironment():{};
const config=loadCliConfig({maxCostUsd:1,maxRequestInputBytes:256000,contextWindowTokens:32768,contextReserveTokens:4096},
  {...env,ANTHROPIC_MODEL:'glm-5.3-flash',TEA_THINKING_MODE:'enabled',TEA_REASONING_EFFORT:'low',TEA_MAX_OUTPUT_TOKENS:'4096',
    TEA_MAX_TOOL_CALLS:'24',TEA_REQUEST_TIMEOUT_MS:'90000',TEA_INPUT_PRICE_USD_PER_MTOK:'0.8',TEA_OUTPUT_PRICE_USD_PER_MTOK:'2.8',TEA_STREAM:'1'});
if(mode==='live')assertBenchmarkConfig(config);
const workspaceRoot=await realpath(await mkdtemp(path.join(os.tmpdir(),'tea-coding-s1-')));await assertNoAncestorInstructions(path.join(workspaceRoot,'probe'));
const manifest=hash(await readFile(path.join(root,'benchmarks/tasks/coding-ability.mjs')));
const report={schema:1,runId,mode,createdAt:new Date().toISOString(),engine:{baseline:engines.baseline.metadata,candidate:engines.candidate.metadata},
  harnessSha256:hash(await readFile(fileURLToPath(import.meta.url))),manifestSha256:manifest,repeats:3,planned:48,
  config:{model:config.model,thinkingMode:config.thinkingMode,effort:config.effort,maxOutputTokens:config.maxOutputTokens,
    contextWindowTokens:config.contextWindowTokens,contextReserveTokens:config.contextReserveTokens,maxRequestInputBytes:config.maxRequestInputBytes,
    contextosTargetBytes:config.contextosTargetBytes,compaction:config.compaction,maxToolCalls:config.maxToolCalls,requestTimeoutMs:config.timeoutMs,
    taskTimeoutMs:600000,taskCapUsd:1,suiteCapUsd:8,endpointSha256:hash(config.baseUrl),inputRateUsdPerMillion:.8,outputRateUsdPerMillion:2.8},
  hypothesis:'Existing-file edit guidance reduces create-over-existing failures without weakening overwrite protection or validation',
  stoppingPolicy:'Unknown usage stops suite with task reservation retained; no paid retry or acceptance edits',
  gate:'All usage/coverage complete; candidate acceptance not lower overall or in any task family; all-attempt total tokens lower',
  scope:'Eight self-authored Node tasks, three attempts per arm; alternating first arm; no production/general superiority claim',
  rows:[],preflight:[],consumedUsd:0,stopReason:null,complete:false};
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
if(mode==='live')outer:for(let repeat=1;repeat<=3;repeat++)for(let index=0;index<codingTasks.length;index++){
  const fixture=codingTasks[index],order=(repeat+index)%2?['baseline','candidate']:['candidate','baseline'];
  for(const arm of order){
    if(report.consumedUsd+1>8){report.stopReason='suite_budget_guard';break outer;}
    if(!await engines[arm].verify()||hash(await readFile(path.join(root,'benchmarks/tasks/coding-ability.mjs')))!==manifest)throw Error('Frozen source changed');
    const workspace=path.join(workspaceRoot,randomUUID());await writeTree(workspace,fixture.files);const initial=await snapshot(workspace);
    const id=`${fixture.id}-r${repeat}-${arm}`;
    const row={id,taskId:fixture.id,title:fixture.title,level:fixture.level,repeat,arm,running:true,status:'running',accepted:false,usage:null};
    report.rows.push(row);report.consumedUsd+=1;await save();console.log(`START ${id}`);
    const started=Date.now();
    try{
      const result=await engines[arm].engine.runTask(fixture.prompt,{...config,workspace,runId:'agent',sessionId:undefined,resume:undefined,
        maxCostUsd:1,storeRaw:false,editGuidance:arm==='candidate'},
        {signal:AbortSignal.timeout(600000),onEvent:event=>{if(event.type==='tool_end')console.log(`${id}: ${event.name} ${event.isError?'error':'done'}`);}});
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
      row.accepted=row.functionalPass&&allPublic.passed&&result.status==='completed'&&result.validationPassed;
      await save();console.log(`FINISH ${id}: ${row.accepted?'PASS':'FAIL'} · ${row.usage?.totalTokens??'unknown'} tokens`);
      if(!complete){report.stopReason='unknown_usage_no_retry';break outer;}
    }catch(error){row.running=false;row.status='harness_error';row.error=String(error.message).replaceAll(workspace,'<workspace>').slice(0,400);
      report.stopReason='harness_error_task_reservation_retained';await save();break outer;}
  }
}
report.sourceUnchanged=await engines.baseline.verify()&&await engines.candidate.verify();
report.complete=mode==='prepare'||report.rows.length===48&&!report.stopReason&&report.sourceUnchanged;
report.endedAt=new Date().toISOString();await save();console.log(JSON.stringify({runId,complete:report.complete,rows:report.rows.length,spent:report.consumedUsd,stopReason:report.stopReason}));
if(report.stopReason)process.exitCode=1;
