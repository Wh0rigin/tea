import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeThreeComparison } from '../src/comparison-three-report.mjs';
function sample() {
  const totals={tea:80,pi:120,claude:150};
  const normalizedControls={model:'test',maxTokens:4096,thinking:{type:'enabled',budget_tokens:4095},outputConfig:{effort:'low'}};
  const runs=Object.entries(totals).map(([agent,totalTokens])=>({agent,taskId:'small-one',caseId:'small-one-r1',initialCommit:'fixture',initialSha256:'tree',requests:1,usageComplete:true,inputTokens:totalTokens-20,outputTokens:20,totalTokens,accepted:true}));
  return {mode:'live',usageSource:'provider-wire',sourceUnchanged:true,piSourceUnchanged:true,claudeSourceUnchanged:true,engines:{tea:{sourceUnchanged:true}},workspaceContextIsolated:true,repeat:1,
    commonProfile:{model:'test',maxOutputTokens:4096,thinkingMode:'enabled',effort:'low'},tasks:[{taskId:'small-one',scale:'small',family:'one',commit:'fixture',sha256:'tree'}],runs,
    requests:runs.map(r=>({...r,submitted:true,complete:true,normalizedControls}))};
}
test('three-agent accounting compares newly measured arms against the same TEA cases',()=>{
  const x=analyzeThreeComparison(sample());
  assert.equal(x.teaVsPi.validComparison,true);assert.equal(x.teaVsClaude.validComparison,true);
  assert.ok(Math.abs(x.teaVsPi.overall.allPairsTokenReductionPercent-100/3)<1e-9);
  assert.ok(Math.abs(x.teaVsClaude.overall.allPairsTokenReductionPercent-(1-80/150)*100)<1e-9);
});
test('three-agent ratios withhold unknown work and count unaccepted tasks',()=>{
  const r=sample();r.runs[2].accepted=false;
  let x=analyzeThreeComparison(r);assert.equal(x.teaVsClaude.overall.piAccepted,0);assert.equal(x.teaVsClaude.overall.bothAcceptedTokenReductionPercent,null);
  r.runs[2].usageComplete=false;r.runs[2].totalTokens=null;r.requests[2].complete=false;
  x=analyzeThreeComparison(r);assert.equal(x.teaVsClaude.overall.allPairsTokenReductionPercent,null);assert.ok(x.teaVsPi.overall.allPairsTokenReductionPercent>0);
});
test('changed frozen TEA source and scripted usage invalidate both comparisons',()=>{
  for(const mutate of [r=>r.engines.tea.sourceUnchanged=false,r=>{r.mode='contract';r.usageSource='scripted-loopback';}]) {
    const r=sample();mutate(r);const x=analyzeThreeComparison(r);
    assert.equal(x.teaVsPi.overall.allPairsTokenReductionPercent,null);assert.equal(x.teaVsClaude.overall.allPairsTokenReductionPercent,null);
  }
});
