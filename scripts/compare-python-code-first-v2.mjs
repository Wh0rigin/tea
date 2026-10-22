import { observeTransport } from './transport-observer.mjs';
import { mkdir, mkdtemp, readFile, writeFile, realpath, appendFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { retrievalTasks as codingTasks } from '../benchmarks/tasks/retrieval-code.mjs';
import { loadCliConfig, assertBenchmarkConfig } from '../src/config.mjs';
import { resolveUserEnvironment } from '../src/user-config.mjs';
import { prepareRevisionEngine } from '../src/comparison-revisions.mjs';
import { assertNoAncestorInstructions } from '../src/comparison-fixtures.mjs';
import { writeTree, command, acceptance, snapshot } from './coding-ability-harness.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), execute=promisify(execFile);
const hash=value=>createHash('sha256').update(value).digest('hex');
const pythonCommand=process.env.TEA_PYTHON_EXECUTABLE||'python';
const pythonDirectory=path.resolve(process.env.TEA_PYTHON_DEPS||'.tea/python-runtime');
process.env.TEA_PYTHON_DEPS=pythonDirectory;
const pythonIdentity=async()=>{
 const info=JSON.parse((await execute(pythonCommand,['-I','-S','-c','import sys,json;print(json.dumps({"executable":sys.executable,"version":sys.version}))'],{windowsHide:true})).stdout);
 return {version:info.version,binarySha256:hash(await readFile(info.executable)),restrictedPythonVersion:'8.5'};
};
const python=await pythonIdentity();
const priorInterruptedRun={runId:'python-code-first-screen-glm-20261017-v1',knownTokens:9647,knownControlSpendUsd:0.0097456,reason:'GBK/UTF-8 offline probe; stopped after settled baseline; no candidate started'};
async function dependencyDigest(){const files=[];async function walk(folder){for(const e of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(folder,e.name);if(e.isDirectory())await walk(file);else if(e.isFile())files.push([path.relative(pythonDirectory,file).replaceAll(path.sep,'/'),hash(await readFile(file))]);else throw Error('Dependency contains non-regular entry');}}await walk(pythonDirectory);files.push(['requirements-python-retrieval.txt',hash(await readFile(path.join(root,'requirements-python-retrieval.txt')))]);return hash(JSON.stringify(files));}
const dependencies=await dependencyDigest(),observerSha256=hash(await readFile(path.join(root,'scripts/transport-observer.mjs')));
const dependenciesUnchanged=async()=>dependencies===await dependencyDigest()&&JSON.stringify(python)===JSON.stringify(await pythonIdentity())&&observerSha256===hash(await readFile(path.join(root,'scripts/transport-observer.mjs')));
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const m=/^--(mode|run-id|baseline-ref|candidate-ref)=(.+)$/.exec(arg);if(!m)throw Error('Invalid option');return[m[1],m[2]];}));
const mode=options.mode||'prepare',runId=options['run-id']||`code-first-${Date.now()}`;
if(!['prepare','live'].includes(mode)||!/^[a-zA-Z0-9_-]+$/.test(runId))throw Error('Invalid mode/run ID');
const output=path.join(root,'benchmarks/results',runId);await mkdir(path.dirname(output),{recursive:true});await mkdir(output);
await mkdir(path.join(output,'engines'));
globalThis.fetch=observeTransport(globalThis.fetch,row=>appendFile(path.join(output,'transport.jsonl'),JSON.stringify(row)+'\n'));
const engines={};
for(const arm of ['baseline','candidate'])engines[arm]=await prepareRevisionEngine({repository:root,
  ref:options[`${arm}-ref`]||(arm==='baseline'?'b6f9395dde461a00bf80ef8aaeafc6f21cd1a8af':'b08e3b7'),directory:path.join(output,'engines',arm)});
const env=mode==='live'?resolveUserEnvironment():{};
const config=loadCliConfig({maxCostUsd:1,memoryPolicy:'contextos',maxRequestInputBytes:256000,contextWindowTokens:32768,contextReserveTokens:4096},
  {...env,TEA_CODE_FIRST:'0',TEA_RETRIEVAL_CODE:'0',TEA_CAPABILITY_FEEDBACK:'1',ANTHROPIC_MODEL:'glm-5.3-flash',TEA_THINKING_MODE:'enabled',TEA_REASONING_EFFORT:'low',TEA_MAX_OUTPUT_TOKENS:'4096',
    TEA_MAX_TOOL_CALLS:'24',TEA_REQUEST_TIMEOUT_MS:'90000',TEA_INPUT_PRICE_USD_PER_MTOK:'0.8',TEA_OUTPUT_PRICE_USD_PER_MTOK:'2.8',TEA_STREAM:'1'});
if(mode==='live')assertBenchmarkConfig(config);
const workspaceRoot=await realpath(await mkdtemp(path.join(os.tmpdir(),'tea-tool-core-live-')));await assertNoAncestorInstructions(path.join(workspaceRoot,'probe'));
const manifestDigest=async()=>hash(Buffer.concat(await Promise.all(['coding-ability.mjs','retrieval-code.mjs'].map(f=>readFile(path.join(root,'benchmarks/tasks',f))))));
const manifest=await manifestDigest();
const report={schema:1,runId,mode,createdAt:new Date().toISOString(),engine:{baseline:engines.baseline.metadata,candidate:engines.candidate.metadata},
  harnessSha256:hash(await readFile(fileURLToPath(import.meta.url))),
  harnessNormalizedSha256:hash((await readFile(fileURLToPath(import.meta.url),'utf8')).replaceAll('\r\n','\n')),
  manifestSha256:manifest,priorInterruptedRun,dependencySha256:dependencies,python,observerSha256,repeats:2,planned:12,candidateFlag:{name:'codeFirst',baseline:false,candidate:true},
  config:{stream:config.stream,model:config.model,thinkingMode:config.thinkingMode,effort:config.effort,maxOutputTokens:config.maxOutputTokens,
    contextWindowTokens:config.contextWindowTokens,contextReserveTokens:config.contextReserveTokens,maxRequestInputBytes:config.maxRequestInputBytes,
    memoryPolicy:config.memoryPolicy,historyStrategy:config.historyStrategy,contextStrategy:config.contextStrategy,capabilityFeedback:config.capabilityFeedback,enableFileCreation:config.enableFileCreation,commandTimeoutMs:120000,
    contextosTargetBytes:config.contextosTargetBytes,compaction:config.compaction,maxToolCalls:config.maxToolCalls,requestTimeoutMs:config.timeoutMs,
    taskTimeoutMs:600000,taskCapUsd:1,suiteCapUsd:3.99,endpointSha256:hash(config.baseUrl),inputRateUsdPerMillion:.8,outputRateUsdPerMillion:2.8},
  hypothesis:'Synchronous Python removes Promise/await output failures; measure quality, successful retrieval and all-attempt provider tokens including mode overhead versus normal tools',
  stoppingPolicy:'Unknown usage stops suite with task reservation retained; no paid retry or acceptance edits',
  gate:'All usage/coverage complete; candidate full acceptance and independent code behavior not lower overall or in any task family; all-attempt total tokens lower',
  scope:'Three previously used self-authored Node tasks, two repeats per arm; code-first mode versus normal tools; whole-mode screening including declarations/routing; not unseen or production evidence',
  rows:[],preflight:[],consumedUsd:0,stopReason:null,complete:false};
report.fixedDefinitions=[];
for(const discoveryWide of [false,true]) {
  const definitions={};
  for(const arm of ['baseline','candidate']) {
    const tools=new engines[arm].tools.WorkspaceTools({workspace:workspaceRoot,retrievalCode:arm==='candidate',codeFirst:arm==='candidate'});
    tools.discoveryWide=discoveryWide;
    definitions[arm]=tools.modelToolDefinitions({includeMemory:false});
  }
  const schemas=Object.fromEntries(Object.entries(definitions).map(([arm,items])=>[arm,hash(JSON.stringify(items.map(({description,...item})=>item)))]));
  if(!definitions.candidate.some(x=>x.name==='retrieve_code'))throw Error('Missing candidate tool');
  if(definitions.candidate.some(x=>['list_files','search_code','recall_context','search_history'].includes(x.name)))throw Error('Forced route exposes standalone retrieval');
  for(const name of ['apply_patch','write_file'])if(JSON.stringify(definitions.baseline.find(x=>x.name===name))!==JSON.stringify(definitions.candidate.find(x=>x.name===name)))throw Error('Edit tools changed');
  for(const name of ['read_file','run_tests','run_shell'])if(JSON.stringify(definitions.baseline.find(x=>x.name===name).input_schema)!==JSON.stringify(definitions.candidate.find(x=>x.name===name).input_schema))throw Error('Unexpected input schema change');
  report.fixedDefinitions.push({discoveryWide,schemaSha256:schemas.baseline,
    definitionsSha256:hash(JSON.stringify(definitions.baseline)),
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
if(mode==='live')outer:for(let repeat=1;repeat<=2;repeat++)for(let index=0;index<codingTasks.length;index++){
  const fixture=codingTasks[index],order=(repeat+index)%2?['baseline','candidate']:['candidate','baseline'];
  for(const arm of order){
    if(await readFile(path.join(output,'STOP_AFTER_CURRENT'),'utf8').then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;})){report.stopReason='operator_stop_after_current';break outer;}
    if(report.consumedUsd+1>3.99){report.stopReason='suite_budget_guard';break outer;}
    if(!await dependenciesUnchanged()||!await engines[arm].verify()||(await manifestDigest())!==manifest)throw Error('Frozen source changed');
    const workspace=path.join(workspaceRoot,randomUUID());await writeTree(workspace,fixture.files);const initial=await snapshot(workspace);
    const id=`${fixture.id}-r${repeat}-${arm}`;
    await writeFile(path.join(output,`${id}-workspace.json`),JSON.stringify({workspace}));
    const row={id,taskId:fixture.id,title:fixture.title,level:fixture.level,repeat,arm,running:true,status:'running',accepted:false,usage:null};
    report.rows.push(row);report.consumedUsd+=1;await save();console.log(`START ${id}`);
    const started=Date.now();
    const runConfig={...config,retrievalCode:arm==='candidate',codeFirst:arm==='candidate',workspace,runId:'agent',sessionId:undefined,resume:undefined,maxCostUsd:1,storeRaw:false};
    const session=engines[arm].engine.createAgentSession(runConfig);
    const telemetry={successfulEdits:0,validationToolResults:0,commandTimeouts:0};
    try{
      const result=await engines[arm].engine.runTask(fixture.prompt,runConfig,
        {session,signal:AbortSignal.timeout(600000),onEvent:event=>{
          if(event.type!=='tool_end')return;
          console.log(`${id}: ${event.name} ${event.isError?'error':'done'}`);
          if(!event.isError&&['apply_patch','write_file'].includes(event.name))telemetry.successfulEdits++;
          if(['run_tests','run_shell'].includes(event.name)&&engines[arm].tools.isValidationCommand(event.input?.command))telemetry.validationToolResults++;
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
      const entries=ledger.trim().split('\n').map(JSON.parse);
      row.retrievalCalls=calls.filter(x=>x.name==='retrieve_code').length;
      row.codeFirstRouteDenials=calls.filter(x=>x.error&&/Code-first|code-first|instructions-only|Use retrieve_code/.test(x.error)).length;
      row.retrievalErrors=calls.filter(x=>x.name==='retrieve_code'&&x.error).length;
      row.retrievalSuboperations=entries.filter(x=>x.type==='retrieval_operation'&&x.stage==='intent').length;
      row.retrievalSuccessfulOps=entries.filter(x=>x.type==='retrieval_operation'&&x.stage==='settled'&&!x.isError).length;
      row.outerToolCalls=calls.length;
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
report.dependenciesUnchanged=await dependenciesUnchanged();
report.sourceUnchanged=report.dependenciesUnchanged&&await engines.baseline.verify()&&await engines.candidate.verify()&&(await manifestDigest())===manifest;
report.harnessUnchanged=report.harnessSha256===hash(await readFile(fileURLToPath(import.meta.url)));
report.sourceUnchanged&&=report.harnessUnchanged;
report.complete=mode==='prepare'||report.rows.length===12&&!report.stopReason&&report.sourceUnchanged;
report.endedAt=new Date().toISOString();await save();console.log(JSON.stringify({runId,complete:report.complete,rows:report.rows.length,spent:report.consumedUsd,stopReason:report.stopReason}));
if(report.stopReason)process.exitCode=1;
