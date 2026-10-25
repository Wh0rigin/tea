import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCliConfig } from '../src/config.mjs';
import { createAgentSession, runTask } from '../src/agent.mjs';
import { contextBudget } from '../src/context-budget.mjs';
import { ModelError } from '../src/model.mjs';
const summary = ['Goal','Constraints','Progress','Decisions','Next steps','Critical context'].map(h=>`## ${h}\nInspect current source; do not claim validation.`).join('\n');
const done = text=>({content:[{type:'text',text}],stop_reason:'end_turn'});
async function scenario({ enabled=true, reads=3, badRecovery=false, compaction='auto', pending=false, badRegular=false, memoryPolicy='full-history', unknownDuring=false }={}) {
 const root=await mkdtemp(path.join(os.tmpdir(),'tea-boundary-'));
 try {
  for(let i=1;i<=reads;i++)await writeFile(path.join(root,`source${i}.txt`),'source line abcdefghijklmnopqrstuvwxyz\n'.repeat(250));
  const c=loadCliConfig({workspace:root,configurationProfile:'pr16-quality',contextWindowTokens:18000,contextReserveTokens:1024,
   memoryPolicy,contextStrategy:'baseline',boundedContextRecovery:enabled},
   {TEA_MAX_OUTPUT_TOKENS:'1200',TEA_COMPACTION_MAX_PER_TURN:'1',TEA_COMPACTION_TRIGGER_RATIO:'0.01',TEA_COMPACTION_KEEP_RECENT_BYTES:'600',TEA_MEMORY_GC:'off',TEA_COMPACTION:compaction});
  const s=createAgentSession(c);s.messages=[{role:'user',content:'Keep requirements.'},{role:'assistant',content:'old source '.repeat(3000)},{role:'user',content:'Continue.'}];
  if(pending){s.pendingValidation=true;s.changedFiles=['source1.txt'];}
  const events=[];let tasks=0,summaries=0,blocked=0;
  const result=await runTask('Inspect the sources.',c,{session:s,onEvent:e=>events.push(e),adapterFactory:()=>({complete:async req=>{
   if(!req.tools.length){summaries++;return done(badRegular || badRecovery&&summaries>1?'Incomplete':summary);}
   const b=contextBudget(c,req);
   if(b.estimatedInputTokens>b.inputLimit){blocked++;throw new ModelError('Context boundary',undefined,{code:'MODEL_CONTEXT_LIMIT',submitted:false,budget:b});}
   tasks++;
   if(unknownDuring && tasks===2)s.budgetUnknown=true;
   if(tasks<=reads)return {content:[{type:'text',text:'observed context '.repeat(150)},{type:'tool_use',id:`read-${tasks}`,name:'read_file',input:{path:`source${tasks}.txt`}}],stop_reason:'tool_use'};
   return done('Inspected.');
  }})});
  const ledger=(await readFile(path.join(result.runDirectory,'ledger.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  return {result,events,ledger,tasks,summaries,blocked,c};
 } finally {await rm(root,{recursive:true,force:true});}
}
test('recovery is opt-in and leaves PR16 numeric settings intact',()=>{
 const a=loadCliConfig({configurationProfile:'pr16-quality'},{}),b=loadCliConfig({configurationProfile:'pr16-quality'},{TEA_BOUNDED_CONTEXT_RECOVERY:'1'});
 assert.equal(a.boundedContextRecovery,false);assert.equal(b.boundedContextRecovery,true);
 for(const k of ['maxOutputTokens','contextWindowTokens','contextReserveTokens','compactionMaxPerTurn','compactionReserveTokens'])assert.equal(a[k],b[k]);
 assert(b.configurationProfileOverrides.includes('boundedContextRecovery'));
});
test('scripted growing requests can recover once after regular cap',async()=>{
 const base=await scenario({enabled:false}),candidate=await scenario();
 assert.equal(base.result.error?.code,'MODEL_CONTEXT_LIMIT',JSON.stringify({status:base.result.status,tasks:base.tasks,events:base.events.filter(e=>e.type==='compaction_pressure')}));
 assert.equal(candidate.result.status,'completed');assert.equal(candidate.summaries,2);
 const recovery=candidate.events.filter(e=>e.type==='compaction_pressure'&&e.reason==='input-boundary');
 assert.equal(recovery.length,1);assert(recovery[0].requestBytesFreed>0);assert(recovery[0].estimatedTokensFreed>0);assert(recovery[0].fitsInputGuard);
 assert(candidate.ledger.some(e=>e.type==='compaction_pressure'&&e.reason==='input-boundary'));
});
test('rejected recovery is attempted once and never bypasses the guard',async()=>{
 const r=await scenario({badRecovery:true});assert.equal(r.summaries,2);assert.equal(r.blocked,1);assert.equal(r.result.status,'failed');assert.equal(r.result.error.code,'MODEL_CONTEXT_LIMIT');assert.equal(r.result.error.budget.emergencyCompactions,1);
});
test('continued growth cannot obtain a second emergency attempt',async()=>{
 const r=await scenario({reads:7});assert.equal(r.summaries,2);assert.equal(r.result.status,'failed');assert.equal(r.result.error.code,'MODEL_CONTEXT_LIMIT');assert.equal(r.events.filter(e=>e.type==='compaction_pressure'&&e.reason==='input-boundary').length,1);
});
test('compaction off does not enable emergency summaries',async()=>{
 const r=await scenario({compaction:'off'});assert.equal(r.summaries,0);assert.equal(r.result.status,'failed');
});
test('no-pressure task adds no emergency summary',async()=>{
 const r=await scenario({reads:0});assert.equal(r.summaries,1);assert.equal(r.result.status,'completed');assert(!r.events.some(e=>e.type==='compaction_pressure'&&e.reason==='input-boundary'));
});
test('recovery summary cannot clear unresolved validation',async()=>{
 const r=await scenario({pending:true});assert.equal(r.result.status,'needs_validation');assert.equal(r.result.validationPassed,false);assert(r.events.some(e=>e.type==='compaction_pressure'&&e.reason==='input-boundary'));
});


test('an unsuccessful regular summary does not trigger an extra paid recovery',async()=>{
 const r=await scenario({badRegular:true});assert.equal(r.summaries,1);assert.equal(r.result.status,'failed');assert(!r.events.some(e=>e.type==='compaction_pressure'&&e.reason==='input-boundary'));
});
test('ContextOS and GC assembly preserve bounded recovery and final guard',async()=>{
 const r=await scenario({reads:7,memoryPolicy:'contextos'});
 assert(r.events.filter(e=>e.type==='compaction_pressure'&&e.reason==='input-boundary').length<=1);
 assert(r.summaries<=2);assert(['completed','failed'].includes(r.result.status));
 if(r.result.status==='failed')assert.equal(r.result.error.code,'MODEL_CONTEXT_LIMIT');
});

test('unknown billing state never authorizes an additional summary',async()=>{
 const r=await scenario({unknownDuring:true});assert.equal(r.summaries,1);assert.equal(r.result.error.code,'MODEL_CONTEXT_LIMIT');assert(!r.events.some(e=>e.type==='compaction_pressure'&&e.reason==='input-boundary'));
});
