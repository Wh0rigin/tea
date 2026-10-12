import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),execute=promisify(execFile);
const baseline=process.argv[2],candidate=process.argv[3];
if(!baseline||!candidate)throw new Error('Pass frozen baseline and candidate revisions');
const runId='reference-recovery-contract-'+Date.now(),controls=new Set();
let requestOrdinal=0;
let initialBaselineEntries=null,initialCandidateEntries=null;
const event=value=>`data: ${JSON.stringify(value)}\n\n`;
const server=createServer(async(request,response)=>{
  try{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString());assert.equal(request.headers['x-api-key'],'loopback-only-no-real-key');
    controls.add(JSON.stringify({model:body.model,thinking:body.thinking,effort:body.output_config,output:body.max_tokens}));
    // Seeded sessions deliberately have no first-turn workspace banner. The
    // serial six-request protocol has a fixed alternating arm schedule.
    const ordinal=requestOrdinal++,runIndex=Math.floor(ordinal/6),round=ordinal%6;
    const role=['baseline','candidate','candidate','baseline','baseline','candidate'][runIndex],caseId='historical-recall-r'+(Math.floor(runIndex/2)+1);assert.ok(role);
    const call=(name,input,n=0)=>({type:'tool_use',id:`recovery-${caseId}-${round}-${n}`,name,input});
    let blocks;
    if(round===0){
      const directory=body.messages.find(m=>typeof m.content==='string'&&m.content.startsWith('Historical tool rounds are archived')).content;
      const rows=JSON.parse(directory.slice(directory.indexOf('[')));assert.ok(rows.length>0);
      if(role==='baseline'){initialBaselineEntries=rows.length;assert.ok(rows.length>8);assert.ok(rows.some(r=>r.tool==='run_tests'));}
      else{initialCandidateEntries=rows.length;assert.equal(rows.length,8);assert.ok(!rows.some(r=>r.tool==='run_tests'));assert.match(directory,/search_history/);}
      blocks=[call('search_history',{query:'historical_receipt'})];
    }else if(round===1){
      const rows=JSON.parse(body.messages.at(-1).content.find(b=>b.type==='tool_result').content);assert.ok(rows[0].ref);
      blocks=[call('recall_context',{ref:rows[0].ref,maxBytes:8000})];
    }else if(round===2){
      assert.match(body.messages.at(-1).content.find(b=>b.type==='tool_result').content,/historical_receipt=997/);
      blocks=['AGENTS.md','src/services/cache-key.mjs','tests/public.test.mjs'].map((p,n)=>call('read_file',{path:p},n));
    }else if(round===3)blocks=[call('apply_patch',{path:'src/services/cache-key.mjs',search:'receipt = 0',replace:'receipt = 997'})];
    else if(round===4)blocks=[call('run_tests',{command:'node --test tests/public.test.mjs'})];
    else if(round===5)blocks=[{type:'text',text:'Recovered historical receipt 997; public tests passed.'}];
    else throw new Error('Unexpected contract round');
    let payload=event({type:'message_start',message:{id:'contract-'+round,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:20}}});
    for(let n=0;n<blocks.length;n++){
      const b=blocks[n];payload+=event({type:'content_block_start',index:n,content_block:b.type==='tool_use'?{...b,input:{}}:{type:'text',text:''}});
      payload+=event({type:'content_block_delta',index:n,delta:b.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(b.input)}:{type:'text_delta',text:b.text}});
      payload+=event({type:'content_block_stop',index:n});
    }
    payload+=event({type:'message_delta',delta:{stop_reason:round<5?'tool_use':'end_turn'},usage:{output_tokens:20}})+event({type:'message_stop'});
    response.writeHead(200,{'content-type':'text/event-stream'});response.end(payload);
  }catch(error){console.error('Contract assertion:',error.message);response.writeHead(500);response.end(error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const env={...process.env,ANTHROPIC_API_KEY:'loopback-only-no-real-key',ANTHROPIC_AUTH_TOKEN:'',ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_MODEL:'glm-5.3-flash',TEA_THINKING_MODE:'enabled',TEA_REASONING_EFFORT:'low',TEA_MAX_OUTPUT_TOKENS:'4096',TEA_MAX_TOOL_CALLS:'24',TEA_CAPABILITY_FEEDBACK:'1',TEA_INPUT_PRICE_USD_PER_MTOK:'.8',TEA_OUTPUT_PRICE_USD_PER_MTOK:'2.8',TEA_STORE_RAW:'0',TEA_STREAM:'1'};
  await execute(process.execPath,['scripts/compare-reference-recovery.mjs','--mode','contract','--baseline-ref',baseline,'--candidate-ref',candidate,'--repeat','3','--run-id',runId,'--max-cost-usd','1'],{cwd:root,env,windowsHide:true,timeout:180000,maxBuffer:1000000});
  const report=JSON.parse(await readFile(path.join(root,'benchmarks/results',runId,'comparison.json'),'utf8'));
  assert.equal(report.complete,true);assert.equal(report.runs.length,6);assert.ok(report.runs.every(r=>r.accepted&&r.observedReceiptRetrieved));assert.equal(report.requests.filter(q=>q.submitted).length,36);assert.equal(report.paidProviderRequests,0);
  assert.equal(controls.size,1);assert.ok(report.sourceUnchanged&&Object.values(report.engines).every(e=>e.sourceUnchanged));
  const evidence={runId,usageSource:'scripted-loopback',paidProviderRequests:0,providerTokenImprovement:null,runs:6,accepted:6,requests:36,commonControlsMatched:true,initialBaselineEntries,initialCandidateEntries,allSourcesStable:true};
  await writeFile(path.join(root,'benchmarks/results',runId,'contract.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
