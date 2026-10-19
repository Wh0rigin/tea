import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolveUserEnvironment} from '../src/user-config.mjs';
const root=path.resolve('.tea/evidence-causal'),hash=value=>createHash('sha256').update(value).digest('hex');
const protocol=JSON.parse(await readFile(path.join(root,'protocol.json'),'utf8'));
const live=process.argv.includes('--live'),scripted=process.argv.includes('--scripted-provider');
assert(!(live&&scripted));
const tagIndex=process.argv.indexOf('--tag'),tag=tagIndex<0?'':process.argv[tagIndex+1];
assert(!tag||scripted&&/^[a-zA-Z0-9-]+$/.test(tag));const suffix=tag?`-${tag}`:'';
const engines={};
for(const arm of ['baseline','candidate']){
 const src=path.join(root,arm,'src'),load=name=>import(pathToFileURL(path.join(src,name)).href);
 engines[arm]={...await load('tools.mjs'),...await load('context-assembler.mjs'),...await load('config.mjs'),...await load('model.mjs'),...await load('ledger.mjs')};
}
const dummy={ANTHROPIC_API_KEY:'offline-only',ANTHROPIC_BASE_URL:'http://no-provider'};
const env=live?resolveUserEnvironment():dummy;
const items=[];
for(const item of protocol.order){
 const fixture=protocol.cases.find(c=>c.repeat===item.repeat),id=`r${item.repeat}-${item.arm}`,engine=engines[item.arm];
 const workspace=path.join(root,'workspaces',id);await mkdir(workspace,{recursive:true});
 const config=engine.loadCliConfig({workspace,runId:'fixed-trace-provider'}, {...env,
  ANTHROPIC_MODEL:'glm-5.3-flash',TEA_THINKING_MODE:'enabled',TEA_REASONING_EFFORT:'low',TEA_STREAM:'1',TEA_MAX_OUTPUT_TOKENS:'4096',
  TEA_CONTEXT_WINDOW_TOKENS:'216000',TEA_CONTEXTOS_TARGET_BYTES:'32000',TEA_MAX_REQUEST_INPUT_TOKENS:'65536',TEA_REQUEST_TIMEOUT_MS:'300000',
  TEA_MAX_COST_USD:'1',TEA_INPUT_PRICE_USD_PER_MTOK:'0.8',TEA_OUTPUT_PRICE_USD_PER_MTOK:'2.8'});
 const tools=new engine.WorkspaceTools({workspace});await tools.init();const memory=new engine.ContextMemory(tools);
 const text=`export function scale(value) { return value * 2 + 3; }\n`+Array.from({length:135},(_,n)=>`export const filler_${String(n).padStart(3,'0')} = ${n}; // unrelated stable source detail`).join('\n');
 await writeFile(path.join(workspace,'calculator.mjs'),text);
 const goal='Use the CURRENT calculator.mjs after the recorded edit. Implement its exact inverse as export function inverseScale(value). Return only that function in JavaScript, with no other exports, prose or tool calls. The recorded tool operations were a controlled setup, not your own actions.';
 const messages=[{role:'user',content:goal}],state={pendingValidation:true,validationPassed:false,changedFiles:['calculator.mjs']};
 const system='Implement the user requested JavaScript function using the current source evidence. Historical stale source is not current evidence.';
 const definitions=tools.modelToolDefinitions({includeMemory:false});let count=0,plan;
 const call=async(name,input)=>{
  const id=`controlled-step-${++count}`,output=await tools[({read_file:'readFile',apply_patch:'applyPatch'})[name]](input);
  messages.push({role:'assistant',content:[{type:'tool_use',id,name,input}]},{role:'user',content:[{type:'tool_result',tool_use_id:id,content:output}]});
 };
 const assemble=async()=>plan=await memory.assemble({messages,canonical:messages,system,tools:definitions,config,state,goal});
 await call('read_file',{path:'calculator.mjs'});
 await call('apply_patch',{path:'calculator.mjs',search:'return value * 2 + 3;',replace:`return value * ${fixture.factor} + ${fixture.offset};`});
 await call('read_file',{path:'calculator.mjs'});await assemble();
 messages.push({role:'user',content:'The controlled setup is complete. Return only export function inverseScale(value), based on the current calculator.mjs. Do not call tools.'});await assemble();
 await call('read_file',{path:'calculator.mjs'});await assemble();
 await call('read_file',{path:'calculator.mjs'});await assemble();
 const outputs=messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(b=>b.type==='tool_result'):[]);
 const receipts=outputs.filter(b=>b.content.startsWith('Evidence unchanged;')).length;
 assert.equal(receipts,item.arm==='candidate'?2:0);assert(engine.validToolProtocol(plan.request.messages));
 assert.equal(plan.request.tools.length,definitions.length);
 // This experiment supplies observed setup results, not invented model turns or
 // thinking signatures. Autonomous native histories are measured by DeepSWE.
 const observed=plan.request.messages.map(message=>typeof message.content==='string'?message.content:message.content.map(block=>
  block.type==='tool_use'?`Recorded tool ${block.name}: ${JSON.stringify(block.input)}`:block.type==='tool_result'?`Recorded result ${block.tool_use_id}:\n${block.content}`:block.text||'').join('\n')).join('\n\n');
 const request={...plan.request,messages:[{role:'user',content:observed}]};
 items.push({...item,id,fixture,engine,config,workspace,projection:plan.request,request,receipts,requestBytes:Buffer.byteLength(JSON.stringify(engine.buildMessagesRequest(config,request)))});
}
for(const fixture of protocol.cases){
 const b=items.find(i=>i.repeat===fixture.repeat&&i.arm==='baseline'),c=items.find(i=>i.repeat===fixture.repeat&&i.arm==='candidate');
 assert.equal(b.request.system,c.request.system);assert.deepEqual(b.request.tools,c.request.tools);
 const bm=structuredClone(b.projection.messages),cm=structuredClone(c.projection.messages),changed=[];
 for(let n=0;n<bm.length;n++){
  if(JSON.stringify(bm[n])===JSON.stringify(cm[n]))continue;
  assert.equal(bm[n].role,'user');assert.equal(bm[n].content.length,1);assert.equal(cm[n].content.length,1);
  const br=bm[n].content[0],cr=cm[n].content[0];assert.equal(br.tool_use_id,cr.tool_use_id);
  assert(['controlled-step-4','controlled-step-5'].includes(br.tool_use_id));changed.push(br.tool_use_id);
  br.content='equivalent-read-result';cr.content='equivalent-read-result';
 }
 assert.deepEqual(changed,['controlled-step-4','controlled-step-5']);assert.deepEqual(bm,cm);
}
if(!live&&!scripted){
 await writeFile(path.join(root,'preflight.json'),JSON.stringify({status:'passed',providerCalls:0,requestDifferencesRestrictedToTwoReadResults:true,providerPackaging:'recorded projected observations in one user message',
  cases:items.map(i=>({id:i.id,requestBytes:i.requestBytes,receipts:i.receipts}))},null,2)+'\n');
 console.log('fixed-trace preflight passed; zero provider calls');process.exit(0);
}
if(live){
 assert.equal(protocol.scriptSha256,hash((await readFile(fileURLToPath(import.meta.url),'utf8')).replaceAll('\r\n','\n')));
 const main=JSON.parse(await readFile(path.join(root,'main-round-complete.json'),'utf8'));
 assert(main.status.startsWith('completed')&&(main.completed||main.runs||[]).length===8);
}
assert.equal(JSON.parse(await readFile(path.join(root,'preflight.json'),'utf8')).status,'passed');
const resultsFile=path.join(root,scripted?`scripted-results${suffix}.json`:'results.json');
try{await readFile(resultsFile);throw new Error('Refusing to overwrite fixed-trace results');}catch(e){if(e.code!=='ENOENT')throw e;}
const report={mode:scripted?'scripted-acceptance-preflight':protocol.mode,protocolSha256:hash(await readFile(path.join(root,'protocol.json'))),status:'running',providerCalls:0,runs:[]};
const save=()=>writeFile(resultsFile,JSON.stringify(report,null,2)+'\n');await save();
if(scripted){
 let index=0;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'http://no-provider/v1/messages');assert.equal(JSON.parse(options.body).stream,true);
  const f=items[index++].fixture,event=body=>`event: ${body.type}\ndata: ${JSON.stringify(body)}\n\n`;
  const text=`export function inverseScale(value) { return (value - ${f.offset}) / ${f.factor}; }`;
  return new Response(event({type:'message_start',message:{id:'synthetic',content:[],usage:{input_tokens:7,output_tokens:0}}})
   +event({type:'content_block_start',index:0,content_block:{type:'text',text}})+event({type:'content_block_stop',index:0})
   +event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:3}})+event({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}});
 };
}
function accept(response,fixture){
 const blocks=response.content||[];if(blocks.some(b=>b.type==='tool_use'))return false;
 let code=blocks.filter(b=>b.type==='text').map(b=>b.text||'').join('\n').trim().replace(/^```(?:javascript|js)?\s*\n?/i,'').replace(/\n?```$/,'');
 code=code.replace(/^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/,'');
 if(!/^export\s+(?:function\s+inverseScale\s*\(|(?:const|let|var)\s+inverseScale\s*=)/.test(code))return false;
 code=code.replace(/^export\s+/,'');const sandbox=Object.create(null);
 Object.defineProperty(sandbox,'__input',{value:0,writable:true,configurable:false});
 const context=vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:false}});
 try{
  vm.runInContext(code,context,{timeout:500});
  for(const x of [-29,-3.5,-1,0,0.25,1,2,7,33,91,1024]){
   sandbox.__input=x*fixture.factor+fixture.offset;
   const y=vm.runInContext('inverseScale(__input)',context,{timeout:100});
   if(typeof y!=='number'||!Number.isFinite(y)||Math.abs(y-x)>1e-9)return false;
  }
  return true;
 }catch{return false;}
}
for(const item of items){
 const ledger=new item.engine.TokenLedger({workspace:item.workspace,runId:scripted?`fixed-trace-scripted${suffix}`:'fixed-trace-provider',model:item.config.model});
 await ledger.init({runType:scripted?'scripted-fixed-trace':'controlled-fixed-trace',usageSource:scripted?'scripted':'provider'});
 const adapter=new item.engine.AnthropicMessagesAdapter(item.config);adapter.onRequest=row=>ledger.request(row);
 let response,error;
 try{response=await adapter.complete({...item.request,signal:AbortSignal.timeout(330000)});}catch(e){error=e;}
 const summary=await ledger.finish({status:error?'failed':'completed'});
 if(!scripted)report.providerCalls+=summary.requests;
 const accepted=Boolean(response&&accept(response,item.fixture));
 report.runs.push({repeat:item.repeat,arm:item.arm,accepted,providerUsageComplete:summary.providerUsageComplete,requests:summary.requests,
  inputTokensIncludingCache:summary.inputTokens,outputTokens:summary.outputTokens,totalTokens:summary.totalActualTokens,
  cacheReadTokens:summary.providerUsageComplete?summary.cachedInputTokens:null,cacheWriteTokens:summary.providerUsageComplete?summary.cacheCreationInputTokens:null,
  reportedTokenLowerBound:scripted?null:summary.reportedTotalTokens,reservationUsd:scripted||summary.providerUsageComplete?0:1,
  requestBytes:item.requestBytes,readReceipts:item.receipts,errorType:error?.name||null});
 await save();console.log(JSON.stringify(report.runs.at(-1)));
}
report.status=scripted?'scripted_preflight_passed':report.runs.every(r=>r.providerUsageComplete)?'completed':'completed_with_unknown_usage';
if(scripted)assert(report.runs.every(r=>r.accepted&&r.requests===1&&!r.providerUsageComplete));await save();
