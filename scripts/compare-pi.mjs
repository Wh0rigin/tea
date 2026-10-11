import { mkdir, mkdtemp, readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, assertLiveConfig } from '../src/config.mjs';
import { runTask } from '../src/agent.mjs';
import { hiddenAcceptance } from '../src/runtime-benchmark.mjs';
import { validateRunId } from '../src/run-id.mjs';
import { taskDefinitions, prepareFixture, cloneFixture, treeFingerprint, assertNoAncestorInstructions } from '../src/comparison-fixtures.mjs';
import { startComparisonGateway } from '../src/comparison-gateway.mjs';
import { runPiTask } from '../src/comparison-pi.mjs';
import { analyzeComparison, writeComparisonReport } from '../src/comparison-report.mjs';
import { redactText } from '../src/tools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
const options = {};
for (let index=2;index<process.argv.length;index++) {
  const name=process.argv[index];
  if (!['--mode','--run-id','--repeat','--max-cost-usd','--pi-package','--scales','--timeout-ms'].includes(name) || !process.argv[index+1]) throw new Error(`Unknown or incomplete option: ${name}`);
  options[name.slice(2)]=process.argv[++index];
}
const mode=options.mode||'prepare';
if (!['prepare','live'].includes(mode)) throw new Error('Mode must be prepare or live');
const repeat=Number(options.repeat||1);
if (!Number.isSafeInteger(repeat)||repeat<1||repeat>10) throw new Error('Repeat must be 1 through 10');
const timeoutMs=Number(options['timeout-ms']||300000);
if (!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>3600000) throw new Error('Invalid task timeout');
const runId=validateRunId(options['run-id']||`pi-comparison-${new Date().toISOString().replaceAll(':','-')}`);
const output=path.join(ROOT,'benchmarks','results',runId);
const piRoot=path.resolve(options['pi-package']||path.join(os.homedir(),'AppData','Roaming','npm','node_modules','@earendil-works','pi-coding-agent'));
const piPackage=JSON.parse(await readFile(path.join(piRoot,'package.json'),'utf8'));
const piCli=path.join(piRoot,'dist','bundle','cli.js');
const piBinaryHash=createHash('sha256').update(await readFile(piCli)).digest('hex');
const config=loadConfig({ maxCostUsd:options['max-cost-usd'] });
// One shared input guard; users can override it explicitly through the environment.
config.maxRequestInputTokens=Number(process.env.TEA_MAX_REQUEST_INPUT_TOKENS||64000);
config.comparisonMaxRequests=24;
if (mode==='live') {
  assertLiveConfig(config);
  if(config.thinkingMode==='enabled'&&config.maxOutputTokens<=1024) throw new Error('Enabled thinking requires an output limit above 1024');
}
const wanted=options.scales?.split(',')||['small','medium','large'];
if (wanted.some(scale=>!['small','medium','large'].includes(scale))) throw new Error('Unknown project scale');
const definitions=taskDefinitions().filter(task=>wanted.includes(task.scale));
const perCaseBudget=config.maxCostUsd/(definitions.length*repeat*2);
if(mode==='live') {
  const reserve=(config.maxRequestInputTokens*Math.max(config.inputRateUsdPerMillion,config.cacheCreationRateUsdPerMillion??config.inputRateUsdPerMillion*2)+config.maxOutputTokens*config.outputRateUsdPerMillion)/1_000_000;
  if(!Number.isFinite(reserve)||reserve<=0||perCaseBudget<reserve) throw new Error(`Each agent/task needs at least one request reservation ($${reserve.toFixed(6)}); increase the total budget or reduce the chosen suite/input/output limits`);
}
await mkdir(path.dirname(output),{recursive:true});
await mkdir(output);
const workspaceRoot=mode==='live'?await mkdtemp(path.join(os.tmpdir(),'tea-pi-workspaces-')):null;
if(workspaceRoot)await assertNoAncestorInstructions(path.join(workspaceRoot,'probe'));
const snapshot=async()=>{
  const hash=createHash('sha256');
  for (const folder of ['src','scripts']) for (const name of (await readdir(path.join(ROOT,folder))).filter(name=>name.endsWith('.mjs')).sort()) {
    hash.update(`${folder}/${name}\0`); hash.update(await readFile(path.join(ROOT,folder,name))); hash.update('\0');
  }
  return hash.digest('hex');
};
const sourceHash=await snapshot();
const report={schemaVersion:1,mode,runId,startedAt:new Date().toISOString(),usageSource:mode==='live'?'provider-wire':'none',
  benchmarkKind:'self-authored JavaScript repository-size experiment; not real-world holdout',
  teaSourceSha256:sourceHash,pi:{name:piPackage.name,version:piPackage.version,cliSha256:piBinaryHash},
  commonProfile:{model:config.model,thinkingMode:config.thinkingMode,effort:config.effort,maxOutputTokens:config.maxOutputTokens,maxRequestInputBound:config.maxRequestInputTokens,
    totalBudgetUsd:mode==='live'?config.maxCostUsd:null,inputRateUsdPerMillion:config.inputRateUsdPerMillion??null,outputRateUsdPerMillion:config.outputRateUsdPerMillion??null,maxRequestsPerAgentTask:config.comparisonMaxRequests,
    api:'anthropic-messages',apiVersion:config.apiVersion,endpointSha256:createHash('sha256').update(config.baseUrl).digest('hex'),rateBasis:process.env.TEA_COMPARISON_RATE_BASIS||'user-supplied'},
  profileNote:'Gateway normalizes model, thinking, effort and output limit. Native agent prompts/tools differ. Cache controls are retained and all cache input counts are included.',
  piProfile:'Native read/edit/write plus platform shell; no extensions/skills/templates; no auto-compaction or automatic retry; fresh isolated config and no persisted session.',
  workspaceContextIsolated:mode==='live',workspaceRoot,
  tasks:[],runs:[],requests:[],repeat,complete:false};
const save=async()=>writeFile(path.join(output,'comparison.json'),JSON.stringify(report,null,2)+'\n','utf8');
async function acceptance(workspace,definition) {
  const publicRun=await exec(process.execPath,['--test','tests/public.test.mjs'],{cwd:workspace,windowsHide:true,timeout:10000}).then(result=>({passed:true,outputSha256:createHash('sha256').update(result.stdout+result.stderr).digest('hex')}),error=>({passed:false,error:redactText(String(error.message)).slice(0,300)}));
  const hiddenTest=`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {${definition.export}} from './candidate.mjs';\ntest('independent acceptance',async()=>{\n${definition.hidden}});\n`;
  const hidden=await hiddenAcceptance(workspace,{entry:definition.entry,hiddenTest});
  const changed=(await exec('git',['diff','--name-only','HEAD'],{cwd:workspace,windowsHide:true})).stdout.trim().split(/\r?\n/).filter(Boolean);
  const untracked=(await exec('git',['ls-files','--others','--exclude-standard'],{cwd:workspace,windowsHide:true})).stdout.trim().split(/\r?\n/).filter(name=>name&&!name.startsWith('.tea/'));
  const scopePassed=changed.every(name=>name===definition.entry)&&untracked.length===0;
  return {public:publicRun,hidden,scopePassed,passed:publicRun.passed&&hidden.passed&&scopePassed};
}

let gateway;
try {
  for (const definition of definitions) {
    const base=path.join(output,'bases',definition.taskId);
    const pinned=await prepareFixture(base,definition);
    const baseline=await acceptance(base,definition);
    if (!baseline.public.passed || baseline.hidden.passed || !baseline.hidden.completed || !baseline.scopePassed) throw new Error(`Invalid initial fixture ${definition.taskId}`);
    report.tasks.push({taskId:definition.taskId,scale:definition.scale,family:definition.name,prompt:definition.prompt,entry:definition.entry,...pinned,initialPublicPassed:true,initialHiddenPassed:false});
    console.log(`Prepared ${definition.taskId}: ${pinned.fileCount} files, ${pinned.lines} lines, ${pinned.commit.slice(0,12)}`);
    await save();
  }
  if (mode==='prepare') {
    report.complete=true;report.providerTokens=null;report.endedAt=new Date().toISOString();
    report.teaSourceAfterSha256=await snapshot();report.sourceUnchanged=sourceHash===report.teaSourceAfterSha256;
    report.analysis=analyzeComparison(report);await save();await writeComparisonReport(report,output);
    console.log(`Prepared only; no model calls. ${output}`);
  }
  else {
    report.perAgentTaskBudgetUsd=perCaseBudget;
    gateway=await startComparisonGateway(config,{perCaseBudget,onRecord:async row=>{report.requests.push(row);await appendFile(path.join(output,'wire-usage.jsonl'),JSON.stringify(row)+'\n','utf8');await save();}});
    outer: for (let repetition=0;repetition<repeat;repetition++) for (let taskIndex=0;taskIndex<definitions.length;taskIndex++) {
      const definition=definitions[taskIndex];
      const task=report.tasks[taskIndex];
      const caseId=`${definition.taskId}-r${repetition+1}`;
      const order=(taskIndex+repetition)%2?['pi','tea']:['tea','pi'];
      for (const agent of order) {
        if(gateway.halted)break outer;
        if(await snapshot()!==sourceHash)throw new Error('TEA source changed during comparison');
        const workspace=path.join(workspaceRoot,caseId,agent);
        await mkdir(path.dirname(workspace),{recursive:true});
        await cloneFixture(path.join(output,'bases',definition.taskId),workspace);
        await assertNoAncestorInstructions(workspace);
        const fingerprint=await treeFingerprint(workspace);
        if(fingerprint.sha256!==task.sha256)throw new Error('Initial agent workspaces differ');
        console.log(`Running ${caseId}/${agent} with ${config.model} ${config.thinkingMode}/${config.effort}`);
        const started=Date.now();
        const baseUrl=`${gateway.baseUrl}/${agent}/${caseId}`;
        let result;
        try {
          if(agent==='tea') {
            const controller=new AbortController();
            const timer=setTimeout(()=>controller.abort(new Error('Benchmark task timeout')),timeoutMs);
            try { const tea=await runTask(definition.prompt,{...config,workspace,runId:caseId,apiKey:gateway.token,baseUrl,storeRaw:false,maxCostUsd:config.maxCostUsd}, {signal:controller.signal});result={status:tea.status,toolCalls:tea.toolCalls,validationPassed:tea.validationPassed,ledgerIntegrity:tea.summary.ledgerIntegrity}; }
            finally {clearTimeout(timer);}
          } else {
            const agentDir=path.join(output,'pi-config',caseId);
            result=await runPiTask({piCli,workspace,agentDir,baseUrl,token:gateway.token,config,prompt:definition.prompt,timeoutMs});
          }
        } catch(error) {result={status:'failed',error:redactText(String(error.message)).slice(0,1000)};}
        const evaluation=await acceptance(workspace,definition);
        await gateway.waitForIdle();
        const rows=gateway.forCase(caseId,agent);
        const submitted=rows.filter(row=>row.submitted);
        const complete=submitted.length>0&&submitted.every(row=>row.complete);
        report.runs.push({taskId:definition.taskId,caseId,agent,repetition:repetition+1,scale:definition.scale,initialSha256:fingerprint.sha256,initialCommit:task.commit,
          ...result,accepted:evaluation.passed&&result.status==='completed',acceptance:evaluation,elapsedMs:Date.now()-started,requests:submitted.length,
          usageComplete:complete,totalTokens:complete?submitted.reduce((sum,row)=>sum+row.totalTokens,0):null,
          inputTokens:complete?submitted.reduce((sum,row)=>sum+row.inputTokens,0):null,outputTokens:complete?submitted.reduce((sum,row)=>sum+row.outputTokens,0):null,
          reportedTokenLowerBound:submitted.reduce((sum,row)=>sum+(row.totalTokens??row.reportedTokenLowerBound??0),0),accountedUsd:submitted.reduce((sum,row)=>sum+(row.accountedUsd||0),0),guards:rows.filter(row=>row.guard).map(row=>row.guard)});
        await save();
        console.log(`Finished ${caseId}/${agent}: accepted=${report.runs.at(-1).accepted}, provider tokens=${report.runs.at(-1).totalTokens??'unknown'}`);
      }
    }
    report.complete=report.runs.length===definitions.length*repeat*2&&!gateway.halted;
    report.accountedUsd=gateway.accountedUsd;
    report.haltedForUnknownUsageOrLimit=gateway.halted;
    report.teaSourceAfterSha256=await snapshot();
    report.sourceUnchanged=sourceHash===report.teaSourceAfterSha256;
    report.endedAt=new Date().toISOString();
    report.analysis=analyzeComparison(report);
    await save();
    await writeComparisonReport(report,output);
    if(report.analysis.validComparison && report.analysis.pairs.some(pair=>pair.tea?.usageComplete||pair.pi?.usageComplete)) {
      try {
        const plotted=await exec(process.env.TEA_PYTHON||'python',[path.join(ROOT,'scripts','plot-pi.py'),path.join(output,'comparison.json')],{windowsHide:true,timeout:60000});
        report.charts=['tea-vs-pi.png','tea-vs-pi.svg'];
        console.log(plotted.stdout.trim());
      } catch(error) {report.chartError=redactText(String(error.message)).slice(0,500);console.log('Token data saved; chart export failed. Run scripts/chart-pi.mjs after configuring Python/matplotlib.');}
      await save();
    }
    console.log(`Comparison saved: ${output}`);
  }
} catch(error) {report.error=redactText(String(error.message));await save();throw error;}
finally {if(gateway)await gateway.close();}
