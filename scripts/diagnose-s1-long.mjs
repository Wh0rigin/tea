import {readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SessionJournal,digest} from '../src/session-journal.mjs';
import {ContextMemory} from '../src/context-assembler.mjs';
import {WorkspaceTools} from '../src/tools.mjs';
import {loadConfig} from '../src/config.mjs';
import {buildMessagesRequest} from '../src/model.mjs';
const runId='small-task-s1-protected-glm-20261012-1791784495519984400';
const report=JSON.parse(await readFile(`benchmarks/results/${runId}/comparison.json`,'utf8'));
if(!report.complete||report.runs.some(r=>r.running)||report.runs.filter(r=>r.taskId==='long-30').length!==6)throw new Error('Expected six closed frozen long-session runs');
const system=(await readFile('src/agent.mjs','utf8')).match(/const SYSTEM_PROMPT = `([^`]+)`;/)[1];
const prompts=report.tasks.find(t=>t.taskId==='long-30').prompts;
const config=loadConfig({memoryPolicy:'contextos'},{ANTHROPIC_MODEL:'glm-5.3-flash',TEA_THINKING_MODE:'enabled',TEA_REASONING_EFFORT:'low',TEA_MAX_OUTPUT_TOKENS:'4096',TEA_STREAM:'1',TEA_MAX_REQUEST_INPUT_TOKENS:'160000',TEA_CONTEXTOS_TARGET_BYTES:'32000'});
const size=x=>Buffer.byteLength(typeof x==='string'?x:JSON.stringify(x));
const byteHash=x=>createHash('sha256').update(x).digest('hex');
const add=(o,k,n)=>o[k]=(o[k]||0)+n;
const runs=[];
for(const run of report.runs.filter(r=>r.taskId==='long-30')){
 const workspace=path.join(report.workspaceRoot,run.caseId,run.agent),journal=new SessionJournal(path.join(workspace,'.tea/sessions/comparison'),'comparison');
 try{await access(journal.lockPath);throw new Error('Active journal');}catch(e){if(e.code!=='ENOENT')throw e;}
 const before=await readFile(journal.logPath);journal.key=await readFile(journal.keyPath);
 const messages=[],requests=[],toolCounts={},failureCodes={},responseShapes=[];
 const tools=new WorkspaceTools({workspace});
 const memory=new ContextMemory(tools);let phase=0,state={pendingValidation:false,validationPassed:false,changedFiles:[]},previous=null,seq=0,pending=null,assemblyDiagnostics=null,toolFailures=0,denials=0,auxiliaryUserMessages=0;
 // Read recorded freshness decisions instead of evaluating historical sources against today's final edited workspace.
 memory.freshness=async unit=>unit.validity=assemblyDiagnostics.units.find(u=>u.ref===unit.ref)?.validity||unit.validity;
 const wire=report.requests.filter(q=>q.caseId===run.caseId&&q.agent===run.agent&&q.submitted);
 for(const line of before.toString().trim().split('\n')){
  const row=JSON.parse(line),{sha256,...body}=row;
  if(row.seq!==++seq||row.previous!==previous||digest(body)!==sha256)throw new Error('Journal chain');previous=sha256;
  const value=await journal.get(row.artifact);
  if(row.kind==='message'){
   messages.push(value);
   if(value.role==='user'&&typeof value.content==='string'){
    if(value.content.startsWith(prompts[phase]||'\0'))phase++;else auxiliaryUserMessages++;
   }
   if(value.role==='assistant')responseShapes.push({phase,tools:value.content.filter(b=>b.type==='tool_use').map(b=>b.name),types:value.content.map(b=>b.type),serializedBytes:size(value.content),textBytes:value.content.filter(b=>b.type==='text').reduce((a,b)=>a+size(b.text),0),thinkingBytes:value.content.filter(b=>b.type==='thinking').reduce((a,b)=>a+size(b.thinking||''),0)});
  }
  if(row.kind==='runtime_state'){
   state=value;
   for(const key of ['readEvidence','sourceEvidence','searchEvidence','sessionTerms'])if(state.tools?.[key])tools[key]=new Map(state.tools[key]);
   tools.unresolvedQueries=new Set(state.tools?.unresolvedQueries||[]);
  }
  if(row.kind==='tool_completed'){
   add(toolCounts,value.name,1);if(value.feedback)add(failureCodes,value.feedback.code,1);
   if(value.isError||(/^exit=(?!0\b)/.test(value.output)&&['run_tests','run_shell'].includes(value.name)))toolFailures++;
   if(/^(?:Command denied by user\.|Unlisted shell commands require|Shell operators and multiline commands are blocked|CMD metacharacters are not allowed|Only the documented test|Destructive commands)/.test(value.output))denials++;
  }
  if(row.kind==='memory_assembly'){
   assemblyDiagnostics=value;
   const plan=await memory.assemble({messages,canonical:messages,system,tools:tools.modelToolDefinitions({includeMemory:false}),config,state,goal:prompts[phase-1]});
   const payload=buildMessagesRequest(config,plan.request),serialized=JSON.stringify(payload);
   const components={system:size(payload.system),tools:size(payload.tools),userText:0,capabilityNotice:0,assistantText:0,assistantThinking:0,assistantOther:0,toolResult:0,runtimeAnchor:0,referenceDirectory:0,otherBlock:0,structure:0};
   let notices=0,without=structuredClone(payload);
   for(const message of payload.messages){
    if(typeof message.content==='string'){
     let text=message.content,marker=text.indexOf('\n\nRuntime capabilities v1-');
     if(marker>=0){add(components,'capabilityNotice',size(JSON.stringify(text.slice(marker)))-2);notices++;text=text.slice(0,marker);}
     add(components,text.startsWith('Historical tool rounds are archived')?'referenceDirectory':text.startsWith('Runtime working memory.')?'runtimeAnchor':'userText',size(JSON.stringify(text))-2);
    }else for(const b of message.content){
     let key=b.type==='tool_result'?'toolResult':b.type==='thinking'?'assistantThinking':message.role==='assistant'?(b.type==='text'?'assistantText':'assistantOther'):b.type==='text'&&b.text.startsWith('Runtime working memory.')?'runtimeAnchor':'otherBlock';
     add(components,key,size(b));
    }
   }
   for(const message of without.messages)if(typeof message.content==='string'){
    const marker=message.content.indexOf('\n\nRuntime capabilities v1-');if(marker>=0)message.content=message.content.slice(0,marker);
   }
   components.structure=size(serialized)-Object.values(components).reduce((a,b)=>a+b,0);
   const normalized=structuredClone(without);
   for(const message of normalized.messages)if(typeof message.content==='string')message.content=message.content.replaceAll(workspace,'[workspace]');
   pending={phase,requestIndex:requests.length+1,reconstructedSha256:digest(serialized),reconstructedBytes:size(serialized),recordedSentBytes:value.sentWireBytes,firstRequestWithoutNoticeAndWorkspaceHash:requests.length===0?digest(normalized):null,components,noticeOccurrences:notices,noticeRemovalWireBytes:size(serialized)-size(JSON.stringify(without)),evictedUnits:value.evictedUnits,coldRounds:value.coldRounds,staleUnits:value.staleUnits,activeGoalAnchored:value.activeGoalAnchored,fallback:value.fallback};
  }
  if(row.kind==='request_settled'){
   if(!pending)throw new Error('No pending assembly');const q=wire[requests.length];
   pending.exactRequestHashMatch=pending.reconstructedSha256===value.requestSha256&&value.requestSha256===q.requestSha256;
   pending.inputTokens=q.inputTokens;pending.outputTokens=q.outputTokens;pending.totalTokens=q.totalTokens;
   pending.cacheReadInputTokens=q.usage.cache_read_input_tokens||0;pending.rawInputTokens=q.usage.input_tokens;
   requests.push(pending);pending=null;
  }
 }
 journal.key.fill(0);
 if(byteHash(before)!==byteHash(await readFile(journal.logPath)))throw new Error('Journal changed');
 const phases=run.turns.map(t=>{const rows=requests.filter(q=>q.phase===t.phase),sum=k=>rows.reduce((a,b)=>a+(b[k]||0),0);return {phase:t.phase,requests:rows.length,inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),totalTokens:sum('totalTokens'),wireBytes:sum('reconstructedBytes'),noticeRemovalWireBytes:sum('noticeRemovalWireBytes'),cacheReadInputTokens:sum('cacheReadInputTokens'),firstEviction:rows.some(q=>q.evictedUnits>0),components:Object.fromEntries(Object.keys(rows[0].components).map(k=>[k,rows.reduce((a,b)=>a+b.components[k],0)]))};});
 if(requests.length!==run.requests||phases.some(p=>p.totalTokens!==run.turns[p.phase-1].totalTokens))throw new Error('Request/phase totals');
 runs.push({caseId:run.caseId,agent:run.agent,totalTokens:run.totalTokens,inputTokens:run.inputTokens,outputTokens:run.outputTokens,requestCount:run.requests,toolCalls:run.toolCalls,accepted:run.accepted,recoveryCalls:run.recoveryCalls,compactions:run.compactions,toolFailures,denials,auxiliaryUserMessages,journalSha256:byteHash(before),journalUnchanged:true,exactRequestHashMatches:requests.filter(q=>q.exactRequestHashMatch).length,toolCounts,failureCodes,phases,requests,responseShapes});
 if(!requests.every(q=>q.exactRequestHashMatch&&q.reconstructedBytes===q.recordedSentBytes))throw new Error('Request reconstruction differs from paid records');
 console.log(JSON.stringify({caseId:run.caseId,agent:run.agent,requests:requests.length,exactHashMatches:requests.filter(q=>q.exactRequestHashMatch).length,toolCounts,failureCodes}));
}
const result={schemaVersion:1,kind:'read-only S1 long-session diagnosis',runId,paidRequestsAdded:0,engines:report.engines,freshnessBasis:'Recorded assembly decisions; final workspace is not substituted for historical source versions',noticeCounterfactual:'Remove notice from reconstructed serialized request only, keep recorded context choices and model replies; byte measurement only',runs};
await writeFile('.tea/s1-long-diagnosis.json',JSON.stringify(result,null,2)+'\n');
