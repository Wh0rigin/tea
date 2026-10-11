import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertNoAncestorInstructions } from '../src/comparison-fixtures.mjs';
import { WireUsage, startComparisonGateway } from '../src/comparison-gateway.mjs';
import { analyzeComparison } from '../src/comparison-report.mjs';

const controls={model:'test-model',maxTokens:1200,thinking:{type:'adaptive'},outputConfig:{effort:'low'}};
const event=value=>`data: ${JSON.stringify(value)}\n\n`;
const stream=(complete=true)=>event({type:'message_start',message:{usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:20,cache_creation_input_tokens:10}}})
  +event({type:'content_block_delta',delta:{type:'text_delta',text:'中文🚀'}})
  +event({type:'message_delta',usage:{output_tokens:30}})+(complete?event({type:'message_stop'}):'');

test('wire meter counts all cache input and survives every UTF-8 byte boundary',()=>{
  const meter=new WireUsage();
  for(const byte of Buffer.from(stream()))meter.append(Uint8Array.of(byte));
  const result=meter.finish();
  assert.equal(result.complete,true);assert.equal(result.counts.inputTokens,130);assert.equal(result.counts.totalTokens,160);
});
test('wire meter requires stream completion and complete integer usage',()=>{
  for(const text of [stream(false),event({type:'message_start',message:{usage:{input_tokens:2}}})+event({type:'message_stop'}),event({type:'message_start',message:{usage:{input_tokens:2,output_tokens:-1}}})+event({type:'message_stop'})]) {
    const meter=new WireUsage();meter.append(Buffer.from(text));assert.equal(meter.finish().complete,false);
  }
});

async function localGateway(t,{complete=true,budget=1,onRecord}={}) {
  let calls=0,bodies=[];
  const upstream=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);bodies.push(JSON.parse(Buffer.concat(chunks)));calls++;
    response.writeHead(200,{'content-type':'text/event-stream'});response.end(stream(complete));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const config={model:'test-model',maxOutputTokens:1200,maxRequestInputTokens:10000,thinkingMode:'adaptive',effort:'low',
    inputRateUsdPerMillion:1,outputRateUsdPerMillion:1,maxCostUsd:budget,timeoutMs:1000,apiKey:'local-only',apiVersion:'2023-06-01',baseUrl:`http://127.0.0.1:${upstream.address().port}`};
  const gateway=await startComparisonGateway(config,{onRecord});
  t.after(async()=>{await gateway.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
  const request=async(agent='tea')=>{
    const response=await fetch(`${gateway.baseUrl}/${agent}/case-r1/v1/messages${agent==='pi'?'?beta=true':''}`,{method:'POST',headers:{'x-api-key':gateway.token,'content-type':'application/json'},
      body:JSON.stringify({model:'wrong-client-model',max_tokens:9,thinking:{type:'disabled'},temperature:.8,messages:[]})});
    const body=await response.text().catch(()=>'disconnected');await gateway.waitForIdle();return {status:response.status,body};
  };
  return {gateway,request,get calls(){return calls;},bodies};
}
test('gateway applies the same common controls and meters native clients identically',async t=>{
  const setup=await localGateway(t);
  assert.equal((await setup.request('tea')).status,200);assert.equal((await setup.request('pi')).status,200);
  assert.equal(setup.calls,2);
  assert.ok(setup.gateway.records.every(row=>JSON.stringify(row.normalizedControls)===JSON.stringify(controls)&&row.totalTokens===160));
  assert.ok(setup.bodies.every(body=>!Object.hasOwn(body,'temperature')));
});
test('gateway retains unknown-usage reservation and blocks subsequent submission',async t=>{
  const setup=await localGateway(t,{complete:false});await setup.request();
  assert.equal(setup.gateway.records[0].complete,false);assert.equal(setup.gateway.records[0].totalTokens,null);
  assert.equal(setup.gateway.records[0].reportedTokenLowerBound,160);assert.ok(setup.gateway.accountedUsd>.00016);
  assert.equal((await setup.request('pi')).status,429);assert.equal(setup.calls,1);
});
test('gateway rejects a reservation above its hard budget without contacting provider',async t=>{
  const setup=await localGateway(t,{budget:.00001});assert.equal((await setup.request()).status,400);
  assert.equal(setup.calls,0);assert.equal(setup.gateway.accountedUsd,0);
});
test('failed ledger checkpoint halts further requests',async t=>{
  const setup=await localGateway(t,{onRecord:async()=>{throw new Error('Disk failure');}});
  await setup.request();assert.equal(setup.gateway.halted,true);assert.equal((await setup.request('pi')).status,429);assert.equal(setup.calls,1);
});

function sample() {
  const runs=['tea','pi'].map(agent=>({caseId:'small-retry-r1',taskId:'small-retry',agent,initialSha256:'tree',initialCommit:'commit',requests:1,
    usageComplete:true,inputTokens:agent==='tea'?70:100,outputTokens:30,totalTokens:agent==='tea'?100:130,accepted:true}));
  return {mode:'live',usageSource:'provider-wire',sourceUnchanged:true,workspaceContextIsolated:true,repeat:1,
    commonProfile:{model:'test-model',thinkingMode:'adaptive',effort:'low',maxOutputTokens:1200},
    tasks:[{taskId:'small-retry',scale:'small',family:'retry',fileCount:12,lines:100,sha256:'tree',commit:'commit'}],runs,
    requests:runs.map(run=>({...run,submitted:true,complete:true,normalizedControls:controls}))};
}
test('paired report includes failed tasks in overall token comparison',()=>{
  const report=sample();report.runs[0].accepted=false;
  const analysis=analyzeComparison(report);assert.equal(analysis.validComparison,true);
  assert.ok(analysis.overall.allPairsTokenReductionPercent>23);assert.equal(analysis.overall.teaAccepted,0);
  assert.equal(analysis.overall.bothAcceptedTokenReductionPercent,null);
});
test('report withholds ratios for mismatched thinking or initial snapshots',()=>{
  for(const mutate of [report=>report.requests[0].normalizedControls={...controls,outputConfig:{effort:'high'}},report=>report.runs[0].initialSha256='other']) {
    const report=sample();mutate(report);const analysis=analyzeComparison(report);
    assert.equal(analysis.validComparison,false);assert.equal(analysis.overall.allPairsTokenReductionPercent,null);
  }
});
test('unknown usage is not zero and incomplete planned coverage has no overall ratio',()=>{
  const report=sample();report.runs[0].usageComplete=false;report.runs[0].totalTokens=null;report.requests[0].complete=false;
  const analysis=analyzeComparison(report);assert.equal(analysis.validComparison,true);assert.equal(analysis.overall.measuredPairs,0);
  assert.equal(analysis.overall.allPairsTokenReductionPercent,null);
});
test('offline scripted data and inconsistent sums cannot produce comparison ratios',()=>{
  for(const mutate of [report=>report.mode='prepare',report=>report.usageSource='scripted-loopback',report=>report.runs[0].totalTokens++]) {
    const report=sample();mutate(report);assert.equal(analyzeComparison(report).validComparison,false);
  }
});
test('ancestor instructions are rejected while fixture-local instructions remain native',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'tea-context-'));
  try {
    const workspace=path.join(root,'case');await mkdir(workspace);
    await writeFile(path.join(workspace,'AGENTS.md'),'fixture instructions');
    assert.equal(await assertNoAncestorInstructions(workspace),true);
    for(const name of ['AGENTS.md','CLAUDE.md','AGENTS.override.md']) {
      await writeFile(path.join(root,name),'unrelated instructions');
      await assert.rejects(assertNoAncestorInstructions(workspace),/ancestor context/);
      await rm(path.join(root,name));
    }
  } finally {await rm(root,{recursive:true,force:true});}
});
test('unisolated or invalidated pilot data cannot produce savings ratios',()=>{
  for(const mutate of [report=>delete report.workspaceContextIsolated,report=>report.invalidated='Parent instructions changed']) {
    const report=sample();mutate(report);assert.equal(analyzeComparison(report).validComparison,false);
  }
});
