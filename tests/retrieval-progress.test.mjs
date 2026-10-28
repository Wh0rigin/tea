import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RetrievalProgress, RETRIEVAL_NOTICE } from '../src/retrieval-progress.mjs';
import { runTask, createAgentSession } from '../src/agent.mjs';
import { loadCliConfig } from '../src/config.mjs';
import { validToolProtocol } from '../src/context-assembler.mjs';
import { collectUserRequirements } from '../src/memory-gc.mjs';
const observe=(p,query='a',output='same')=>p.observe('search_code',{query},output);
test('three repeats trigger only after a genuinely observed first result',()=>{
 const p=new RetrievalProgress();p.beginBatch(null);
 for(let i=0;i<3;i++){observe(p);assert.equal(p.notice(),null);}
 observe(p);assert.equal(p.notice().noticeNumber,1);
 assert.match(RETRIEVAL_NOTICE,/does not prove source freshness/);
 assert.match(RETRIEVAL_NOTICE,/Re-read missing\/stale/);
});
test('new output or a new query breaks the consecutive-repeat streak',()=>{
 const p=new RetrievalProgress();observe(p);observe(p);observe(p);observe(p,'a','changed');assert.equal(p.notice(),null);
 observe(p,'b');assert.equal(p.repeated,0);
});
test('a multi-query loop is detected but a later novel batch result suppresses the hint',()=>{
 const p=new RetrievalProgress();for(const q of ['a','b','c','a','b','c'])observe(p,q);
 assert.equal(p.repeated,3);observe(p,'d');assert.equal(p.notice(),null);
 for(const q of ['a','b','c'])observe(p,q);assert(p.notice());
});
test('errors, writes, validation, shell and mapping operations invalidate tracking',()=>{
 for(const name of ['apply_patch','write_file','run_tests','run_shell','remember_term_mapping']){
  const p=new RetrievalProgress();observe(p);observe(p);observe(p);p.observe(name,{},'done');assert.equal(p.seen.size,0);observe(p);assert.equal(p.notice(),null);
 }
 const p=new RetrievalProgress();observe(p);observe(p);p.observe('read_file',{},'ENOENT',true);assert.equal(p.seen.size,0);
});
test('compaction invalidates earlier comparisons without replenishing the notice cap',()=>{
 const p=new RetrievalProgress();observe(p);observe(p);observe(p);observe(p);p.notice();p.beginBatch('new-checkpoint');assert.equal(p.seen.size,0);assert.equal(p.notices,1);observe(p);assert.equal(p.notice(),null);
});
test('at most two hints, with a twelve-retrieval cooldown',()=>{
 const p=new RetrievalProgress();let hints=[];
 for(let i=0;i<80;i++){observe(p);const n=p.notice();if(n)hints.push({i,n});}
 assert.equal(hints.length,2);assert(hints[1].i-hints[0].i>=12);
});
test('tracking has bounded memory, keeps hashes rather than source text, and canonicalizes object keys',()=>{
 const p=new RetrievalProgress();p.observe('search_code',{query:'a',path:'.'},'sensitive source');
 for(let i=0;i<3;i++)p.observe('search_code',{path:'.',query:'a'},'sensitive source');assert(p.notice());
 for(let i=0;i<100;i++)observe(p,String(i),'source '+i);
 assert.equal(p.seen.size,64);assert([...p.seen.keys()].every(k=>/^[a-f0-9]{64}$/.test(k)));assert([...p.seen.values()].every(k=>/^[a-f0-9]{64}$/.test(k)));
});
test('the option is default-off and introduces no priority1 recovery setting',()=>{
 const a=loadCliConfig({},{}),b=loadCliConfig({},{TEA_RETRIEVAL_PROGRESS_FEEDBACK:'1'});
 assert.equal(a.retrievalProgressFeedback,false);assert.equal(b.retrievalProgressFeedback,true);
 assert(b.configurationProfileOverrides.includes('retrievalProgressFeedback'));
 assert.equal(b.boundedContextRecovery,undefined);
 for(const k of ['contextWindowTokens','maxOutputTokens','compactionMaxPerTurn','contextosWorkingSetBytes'])assert.equal(a[k],b[k]);
});
async function fixture(memoryPolicy,pending=false){
 const root=await mkdtemp(path.join(os.tmpdir(),'tea-retrieval-feedback-'));
 try{
  const runs=[];
  if(pending)await writeFile(path.join(root,'unfinished.txt'),'pending edit');
  for(const enabled of [false,true]){
   const c=loadCliConfig({workspace:root,runId:enabled?'candidate':'baseline',retrievalProgressFeedback:enabled,memoryPolicy},{});
   const session=createAgentSession(c);if(pending){session.pendingValidation=true;session.changedFiles=['unfinished.txt'];}let calls=0;const requests=[],events=[];
   const result=await runTask('Inspect files. Do not edit.',c,{session,onEvent:e=>events.push(e),adapterFactory:()=>({complete:async req=>{
    requests.push(structuredClone(req));calls++;
    if(calls<=9)return {content:[{type:'tool_use',id:`list-${calls}`,name:'list_files',input:{}}],stop_reason:'tool_use'};
    return {content:[{type:'text',text:'Inspected.'}],stop_reason:'end_turn'};
   }})});
   const ledger=(await readFile(path.join(result.runDirectory,'ledger.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
   runs.push({result,session,requests,events,ledger,calls});
  }
  const [base,candidate]=runs;
  assert.equal(base.result.status,pending?'needs_validation':'completed');assert.equal(candidate.result.status,base.result.status);assert.equal(base.calls,pending?12:10);assert.equal(candidate.calls,base.calls);
  assert.equal(candidate.events.filter(e=>e.type==='tool_end').length,9);assert.equal(candidate.events.filter(e=>e.type==='retrieval_progress').length,1);
  assert.equal(base.events.filter(e=>e.type==='retrieval_progress').length,0);
  for(let i=0;i<4;i++)assert.deepEqual(candidate.requests[i],base.requests[i]);
  const actual=candidate.events.filter(e=>e.type==='tool_end').map(e=>e.output),original=base.events.filter(e=>e.type==='tool_end').map(e=>e.output);assert.deepEqual(actual,original);
  assert(validToolProtocol(candidate.session.messages));
  const blocks=candidate.session.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);
  assert.equal(blocks.filter(b=>b.type==='text'&&b.text===RETRIEVAL_NOTICE).length,1);
  assert(!collectUserRequirements(candidate.session.messages).some(m=>JSON.stringify(m).includes(RETRIEVAL_NOTICE)));
  assert(candidate.ledger.some(e=>e.type==='retrieval_progress'));
  assert.equal(candidate.result.changedFiles.length,pending?1:0);assert.equal(candidate.result.validationAttempts,0);if(pending)assert.equal(candidate.result.validationPassed,false);
 }finally{await rm(root,{recursive:true,force:true});}
}
for(const policy of ['full-history','contextos'])test(`scripted real tools retain all outputs and request count with ${policy}`,()=>fixture(policy));

test('feedback cannot clear pending validation or force an early final answer',()=>fixture('contextos',true));
