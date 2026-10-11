import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeContextos, CONTEXTOS_CASES, orderedContextosCases, contextosReadAcceptance } from '../src/contextos-benchmark.mjs';
const run = (variant, tokens, accepted=true, known=true) => ({caseId:'case',repeat:1,variant,totalTokens:known?tokens:null,
  inputTokens:known?tokens-10:null,outputTokens:known?10:null,cacheInputTokens:0,accepted,usageComplete:known,conservativeSpendUsd:.1,elapsedMs:1,requests:[{}]});
test('ContextOS comparison counts failed paid runs and keeps acceptance-matched savings separate',()=>{
  const report=analyzeContextos([run('legacy',100),run('full',100),run('contextos',130,false)]);
  assert.equal(report.variants.contextos.allRunTokens,130);assert.equal(report.variants.contextos.accepted,0);
  assert.equal(report.cases.case.full.savingsPercent,null);assert.equal(report.cases.case.full.allKnownSavingsPercent,-30);
  assert.equal(report.cases.case.full.acceptanceDecline,true);assert.ok(Math.abs(report.conservativeSpendUsd-.3)<1e-9);
});
test('unknown ContextOS usage stays in spend and never becomes a zero-token gain',()=>{
  const report=analyzeContextos([run('full',100),run('contextos',0,false,false)]);
  assert.equal(report.cases.case.full.knownPairs,0);assert.equal(report.cases.case.full.savingsPercent,null);
  assert.equal(report.unknownRuns,1);assert.equal(report.conservativeSpendUsd,.2);
});
test('benchmark matrix declares real workflow, seeded stress and language/control coverage',()=>{
  assert.ok(CONTEXTOS_CASES.some(c=>c.rounds===30&&c.seed===0&&c.group==='model-target'));
  assert.ok(CONTEXTOS_CASES.some(c=>c.files===1200));assert.ok(CONTEXTOS_CASES.some(c=>c.resume));
  assert.deepEqual(new Set(CONTEXTOS_CASES.map(c=>c.language)),new Set(['JavaScript','TypeScript','Python']));
});

test('risk-first case order retains every case and cannot silently narrow the gate', () => {
  const order = ['crossfile-ts', ...CONTEXTOS_CASES.filter(item => item.id !== 'crossfile-ts').map(item => item.id)];
  const selected = orderedContextosCases(order.join(','));
  assert.equal(selected[0].id, 'crossfile-ts');
  assert.deepEqual(new Set(selected.map(item => item.id)), new Set(CONTEXTOS_CASES.map(item => item.id)));
  assert.equal(orderedContextosCases(), CONTEXTOS_CASES);
  for (const invalid of ['crossfile-ts', [...order.slice(1), 'short-js'].join(','), order.join(',') + ',unknown']) {
    assert.throws(() => orderedContextosCases(invalid), /complete matrix/);
  }
});

test('source-read acceptance requires a settled successful complete read of the current version', () => {
  const sha='a'.repeat(64),read={type:'tool_call',name:'read_file',outputSha256:sha};
  assert.equal(contextosReadAcceptance([read],sha).passed,true);
  for(const rows of [[],[{...read,type:'tool_start'}],[{...read,error:'failed'}],[{...read,name:'search_code'}],[{...read,outputSha256:'b'.repeat(64)}]]){
    assert.equal(contextosReadAcceptance(rows,sha).passed,false);
  }
  assert.throws(()=>contextosReadAcceptance([],null),/source-read evidence/);
});

test('inspection acceptance rejects edits, tests and shell execution despite a correct source read', () => {
  const sha='a'.repeat(64),read={type:'tool_call',name:'read_file',outputSha256:sha};
  assert.equal(contextosReadAcceptance([read,{type:'tool_call',name:'list_files'}],sha,true).passed,true);
  for(const name of ['apply_patch','run_tests','run_shell']){
    const rows=[read,{type:'tool_call',name}];
    assert.equal(contextosReadAcceptance(rows,sha,true).passed,false);
    assert.equal(contextosReadAcceptance(rows,sha,false).passed,true);
  }
});
