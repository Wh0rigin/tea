import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { createAgentSession, compactAgentSession } from '../src/agent.mjs';
import { attachSessionJournal, appendSessionMessage, closeSessionJournal } from '../src/session-memory.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { ContextMemory } from '../src/context-assembler.mjs';
import { residentHistoryBytes } from '../src/memory-gc.mjs';
import assert from 'node:assert/strict';

const output=path.resolve(process.argv[2] || `.tea/gc-check-${Date.now()}`);
await mkdir(output,{recursive:false});
const results=[];
const summary=['Goal','Constraints','Progress','Decisions','Next steps','Critical context']
  .map(h=>`## ${h}\nPreserve public behavior and validate changes.`).join('\n');
for(const rounds of [12,36,72])for(let repetition=1;repetition<=3;repetition++)for(const memoryGc of ['off','auto']){
  const root=await mkdtemp(path.join(os.tmpdir(),'tea-gc-check-'));
  try{
    await writeFile(path.join(root,'README.md'),'marker=17\n'+'Reference documentation detail.\n'.repeat(240));
    const config={...loadConfig({workspace:root,sessionId:'gc',memoryPolicy:'contextos',memoryGc},{}),
      runId:'check',maxRequestInputTokens:256000,maxOutputTokens:4096,compactionKeepRecentBytes:1000,contextosTargetBytes:15000};
    const session=createAgentSession(config),tools=new WorkspaceTools({workspace:root,deduplicateReads:false});await tools.init();session.tools=tools;
    session.contextMemory=new ContextMemory(tools);await attachSessionJournal(session,config);
    await appendSessionMessage(session,{role:'user',content:'Keep the public API; validate all modifications.'});
    for(let i=0;i<rounds;i++){
      const result=await tools.readFile({path:'README.md'});
      await appendSessionMessage(session,{role:'assistant',content:[{type:'thinking',thinking:'inspect',signature:'fixed-signature'},
        {type:'tool_use',id:'r'+i,name:'read_file',input:{path:'README.md'}}]});
      await appendSessionMessage(session,{role:'user',content:[{type:'tool_result',tool_use_id:'r'+i,content:result}]});
    }
    await appendSessionMessage(session,{role:'assistant',content:'Continue the same task.'});
    await closeSessionJournal(session);
    const before=residentHistoryBytes(session);let summaryCalls=0;
    const outcome=await compactAgentSession(config,{session,adapterFactory:()=>({complete:async()=>{
      summaryCalls++;return{content:[{type:'text',text:summary}],stop_reason:'end_turn'};
    }})});
    assert.equal(outcome.status,'compacted');assert.equal(summaryCalls,1);
    results.push({rounds,repetition,memoryGc,summaryCalls,beforeResidentSerializedBytes:before,
      afterResidentSerializedBytes:residentHistoryBytes(session),residentMessageCount:session.messages.length,
      archivedMessages:session.archivedMessageCount||0,checkpointCommitted:outcome.status==='compacted',
      providerTokens:null,processRssReduction:null});
  }finally{await rm(root,{recursive:true,force:true});}
}
const pairs=[];
for(const rounds of [12,36,72])for(let repetition=1;repetition<=3;repetition++){
  const base=results.find(r=>r.rounds===rounds&&r.repetition===repetition&&r.memoryGc==='off');
  const candidate=results.find(r=>r.rounds===rounds&&r.repetition===repetition&&r.memoryGc==='auto');
  pairs.push({rounds,repetition,reductionPercent:(1-candidate.afterResidentSerializedBytes/base.afterResidentSerializedBytes)*100});
}
const report={kind:'deterministic cold-history GC checks; not provider tokens or measured heap',paidProviderRequests:0,
  runs:results.length,checksPassed:results.length,pairs,results};
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({runs:results.length,paidProviderRequests:0,means:[12,36,72].map(rounds=>({rounds,
  residentSerializedHistoryReductionPercent:pairs.filter(p=>p.rounds===rounds).reduce((sum,p)=>sum+p.reductionPercent,0)/3}))}));
