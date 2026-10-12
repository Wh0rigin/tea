// A separate diagnostic cohort: shared scripted history, real provider recovery.
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadConfig, assertLiveConfig } from '../src/config.mjs';
import { prepareRevisionEngine } from '../src/comparison-revisions.mjs';
import { contextosFixture, contextosSeed, contextosAcceptance, CONTEXTOS_CASES } from '../src/contextos-benchmark.mjs';
import { cloneFixture, treeFingerprint, assertNoAncestorInstructions } from '../src/comparison-fixtures.mjs';
import { startComparisonGateway } from '../src/comparison-gateway.mjs';
import { attachSessionJournal, appendSessionMessage, closeSessionJournal } from '../src/session-memory.mjs';
import { createComparisonTurnAudit } from '../src/comparison-turn-audit.mjs';
import { createSourceCapture, createPackageScriptReader } from '../src/comparison-source-capture.mjs';
import { acceptanceDimensions } from '../src/comparison-validation.mjs';
import { validateRunId } from '../src/run-id.mjs';
import { redactText } from '../src/tools.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const options={};
for(let i=2;i<process.argv.length;i+=2){
  if(!['--mode','--run-id','--baseline-ref','--candidate-ref','--max-cost-usd','--repeat','--seed-file'].includes(process.argv[i])||!process.argv[i+1])throw new Error('Invalid recovery option');
  options[process.argv[i].slice(2)]=process.argv[i+1];
}
const mode=options.mode||'prepare',repeat=Number(options.repeat||6);
if(!['prepare','live','contract'].includes(mode)||!Number.isSafeInteger(repeat)||repeat<3||repeat>20)throw new Error('Invalid recovery controls');
if(!options['baseline-ref']||!options['candidate-ref'])throw new Error('Both frozen engine revisions required');
const runId=validateRunId(options['run-id']||`reference-recovery-${Date.now()}`),output=path.join(ROOT,'benchmarks/results',runId);
const config={...loadConfig({maxCostUsd:options['max-cost-usd'],memoryPolicy:'contextos',contextosTargetBytes:32000,compaction:'off',contextStrategy:'v1'}),comparisonMaxRequests:100,maxRequestInputTokens:160000};
if(config.storeRaw)throw new Error('Raw storage must stay disabled');
if(mode!=='prepare')assertLiveConfig(config);
if(mode==='contract'&&(!['127.0.0.1','localhost'].includes(new URL(config.baseUrl).hostname)||config.apiKey!=='loopback-only-no-real-key'))throw new Error('Contract requires loopback and dummy credential');
await mkdir(output,{recursive:false});
const workspaceRoot=await mkdtemp(path.join(os.tmpdir(),'tea-reference-recovery-'));
await assertNoAncestorInstructions(path.join(workspaceRoot,'probe'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const harnessFiles=['scripts/compare-reference-recovery.mjs','src/contextos-benchmark.mjs','src/comparison-fixtures.mjs','src/comparison-gateway.mjs','src/comparison-turn-audit.mjs','src/comparison-validation.mjs','src/session-memory.mjs'];
const fingerprint=async()=>sha(Buffer.concat(await Promise.all(harnessFiles.map(async f=>Buffer.concat([Buffer.from(f+'\0'),await readFile(path.join(ROOT,f)),Buffer.from('\0')])))));
const sourceSha256=await fingerprint(),engines={};
for(const role of ['baseline','candidate'])engines[role]=await prepareRevisionEngine({repository:ROOT,ref:options[role+'-ref'],directory:path.join(workspaceRoot,role+'-engine')});
const fixture=await contextosFixture(path.join(output,'base'),CONTEXTOS_CASES.find(c=>c.id==='historical-recall'));
if(mode==='live'&&!options['seed-file'])throw new Error('Paid recovery requires a previously frozen shared seed');
const seed=options['seed-file']?JSON.parse(await readFile(options['seed-file'],'utf8')):await contextosSeed(path.join(output,'base'),CONTEXTOS_CASES.find(c=>c.id==='historical-recall'),fixture.paths);
await writeFile(path.join(output,'seed.json'),JSON.stringify(seed,null,2)+'\n');
const {definition,identity}=fixture,seedSha256=sha(JSON.stringify(seed));
const expectedReceipt=seed.find(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='tool_result'&&b.content.includes('historical_receipt=')))?.content.find(b=>b.type==='tool_result').content.match(/historical_receipt=(\d+)/)?.[0];
if(!expectedReceipt)throw new Error('Missing actual historical observation');
const report={schemaVersion:1,runId,mode,usageSource:mode==='live'?'provider-wire':mode==='contract'?'scripted-loopback':'none',complete:false,workspaceRoot,
  benchmarkKind:'Self-authored seeded historical receipt diagnostic, separate from empty-start core cohort. Actual scripted past command and reads are unbilled; all provider recovery and repair requests count.',
  sourceSha256,sourceUnchanged:false,engines:Object.fromEntries(Object.entries(engines).map(([r,e])=>[r,{...e.metadata,sourceUnchanged:false}])),
  task:{taskId:'historical-recall',prompt:definition.prompt,initialSha256:identity.sha256,initialCommit:identity.commit,seedSha256,seedMessages:seed.length,seedOrigin:'shared actual scripted tool outputs; not model-generated'},
  profile:{model:config.model,thinkingMode:config.thinkingMode,effort:config.effort,maxOutputTokens:config.maxOutputTokens,api:'anthropic-messages',endpointSha256:sha(config.baseUrl),memoryPolicy:config.memoryPolicy,contextosTargetBytes:config.contextosTargetBytes,contextStrategy:config.contextStrategy,compaction:config.compaction,requestedCapabilityFeedback:Boolean(config.capabilityFeedback),maxTools:config.maxToolCalls,maxRequests:100,maxRequestBytes:160000,requestTimeoutMs:config.timeoutMs,turnTimeoutMs:180000,maxCostUsd:config.maxCostUsd,perRunCapUsd:1.4,inputRateUsdPerMillion:config.inputRateUsdPerMillion,outputRateUsdPerMillion:config.outputRateUsdPerMillion},
  repeat,runs:[],requests:[],paidProviderRequests:0,accountedUsd:0,haltedForUnknownUsageOrLimit:false};
const save=()=>writeFile(path.join(output,'comparison.json'),JSON.stringify(report,null,2)+'\n');
let gateway;
try{
  await save();
  if(mode!=='prepare'){
    gateway=await startComparisonGateway(config,{perCaseBudget:1.4,onRecord:async row=>{report.requests.push(row);report.paidProviderRequests=mode==='live'?report.requests.filter(q=>q.submitted).length:0;await save();}});
    outer:for(let repetition=1;repetition<=repeat;repetition++)for(const role of repetition%2?['baseline','candidate']:['candidate','baseline']){
      if(gateway.halted)break outer;
      if(await fingerprint()!==sourceSha256||!await engines[role].verify())throw new Error('Frozen recovery source changed');
      const caseId='historical-recall-r'+repetition,workspace=path.join(workspaceRoot,caseId,role);
      await mkdir(path.dirname(workspace),{recursive:true});await cloneFixture(path.join(output,'base'),workspace);await assertNoAncestorInstructions(workspace);
      if((await treeFingerprint(workspace)).sha256!==identity.sha256)throw new Error('Recovery initial snapshot differs');
      const turnConfig={...config,workspace,sessionId:'comparison',apiKey:gateway.token,baseUrl:`${gateway.baseUrl}/${role}/${caseId}`,maxCostUsd:1.4};
      const session=engines[role].engine.createAgentSession(turnConfig);
      await attachSessionJournal(session,turnConfig);for(const message of structuredClone(seed))await appendSessionMessage(session,message);await closeSessionJournal(session);
      const run={taskId:'historical-recall',caseId,agent:role,repetition,scale:'recovery-control',group:'seeded-recovery',initialSha256:identity.sha256,initialCommit:identity.commit,seedSha256,engineCommit:engines[role].metadata.commit,engineSha256:engines[role].metadata.sourceSha256,running:true,status:'failed',accepted:false,historyConstraintViolation:false,observedReceiptRetrieved:false,recoveryCalls:0,searchCalls:0,recallCalls:0,toolCalls:0,turns:[]};
      report.runs.push(run);await save();console.log(`Start ${caseId}/${role}`);
      const started=Date.now(),captureSources=createSourceCapture(workspace,[...definition.allowed,'package.json','tests/public.test.mjs']);
      const audit=createComparisonTurnAudit({agent:role,workspace,requiredPath:null,expectedOutput:null,readOnly:false,captureSources,getPackageScripts:createPackageScriptReader(workspace)});
      let result;
      try{
        result=await engines[role].engine.runTask(definition.prompt,{...turnConfig,runId:'recovery'},{session,signal:AbortSignal.timeout(180000),onEvent:event=>{
          audit.observe(event);
          if(event.type==='tool_end'&&['search_history','recall_context'].includes(event.name)&&!event.isError&&String(event.output).includes(expectedReceipt))run.observedReceiptRetrieved=true;
          if(event.type==='tool_start'){
            if(['search_history','recall_context'].includes(event.name)){run.recoveryCalls++;run[event.name==='search_history'?'searchCalls':'recallCalls']++;}
            if(['read_file','search_code','run_tests','run_shell'].includes(event.name)&&JSON.stringify(event.input).includes('receipt-old.test.mjs'))run.historyConstraintViolation=true;
          }
        }});
        run.status=result.status;run.toolCalls=result.toolCalls;
      }catch(error){run.error=redactText(String(error.message)).replaceAll(workspace,'[WORKSPACE]').slice(0,1000);}
      await gateway.waitForIdle();const requirements=audit.finish(),evaluation=await contextosAcceptance(workspace,definition,path.join(workspaceRoot,'acceptance',caseId,role));
      evaluation.nativeValidationPassed=Boolean(result?.validationPassed&&requirements.validatedAfterEdit);evaluation.readRequirementsPassed=requirements.passed;
      const rows=gateway.forCase(caseId,role).filter(q=>q.submitted),known=rows.length>0&&rows.every(q=>q.complete);
      run.turns=[{phase:1,status:run.status,requirements,nativeValidationPassed:evaluation.nativeValidationPassed,totalTokens:known?rows.reduce((s,q)=>s+q.totalTokens,0):null,context:session.memoryDiagnostics}];
      const quality=acceptanceDimensions({evaluation,turns:run.turns,plannedTurns:1,status:run.status,usageComplete:known});
      quality.dimensions.historicalObservationPreserved=!run.historyConstraintViolation;
      // The required value must be observed via retrieval, not guessed from fixture conventions.
      quality.dimensions.historicalRecoveryUsed=run.observedReceiptRetrieved;
      run.accepted=quality.accepted&&quality.dimensions.historicalObservationPreserved&&quality.dimensions.historicalRecoveryUsed;
      Object.assign(run,{running:false,qualityDimensions:quality.dimensions,acceptance:evaluation,elapsedMs:Date.now()-started,requests:rows.length,usageComplete:known,totalTokens:known?rows.reduce((s,q)=>s+q.totalTokens,0):null,inputTokens:known?rows.reduce((s,q)=>s+q.inputTokens,0):null,outputTokens:known?rows.reduce((s,q)=>s+q.outputTokens,0):null,accountedUsd:rows.reduce((s,q)=>s+(q.accountedUsd||0),0)});
      await save();console.log(`Finish ${caseId}/${role}: accepted=${run.accepted}, tokens=${run.totalTokens??'unknown'}`);
    }
  }
  report.complete=mode==='prepare'||report.runs.length===repeat*2&&!gateway.halted;
  report.accountedUsd=gateway?.accountedUsd??0;report.haltedForUnknownUsageOrLimit=gateway?.halted??false;
  report.sourceUnchanged=sourceSha256===await fingerprint();for(const role of ['baseline','candidate'])report.engines[role].sourceUnchanged=await engines[role].verify();
  await save();console.log(JSON.stringify({runId,complete:report.complete,runs:report.runs.length,paidRequests:report.paidProviderRequests,accountedUsd:report.accountedUsd}));
}catch(error){report.error=redactText(String(error.message));await save();throw error;}
finally{if(gateway)await gateway.close();}
