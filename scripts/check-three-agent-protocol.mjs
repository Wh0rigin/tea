import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), execute=promisify(execFile);
const id=`three-contract-${Date.now()}`, counters=new Map(), controls=[];
const ev=x=>`event: ${x.type}\ndata: ${JSON.stringify(x)}\n\n`;
const server=createServer(async(req,res)=>{
  try {
    const chunks=[];for await(const c of req)chunks.push(c);const b=JSON.parse(Buffer.concat(chunks));
    assert.equal(req.headers['x-api-key'],'loopback-only-no-real-key');
    const agent=b.tools.some(t=>t.name==='read_file')?'tea':b.tools.some(t=>t.name==='Read')?'claude':'pi';
    const text=JSON.stringify(b), caseId=text.match(/small-(?:cache-key|retry-budget|unicode)-r\d+/)?.[0];
    assert.ok(caseId,'Native workspace identity missing');
    const family=caseId.includes('cache-key')?'cache-key':caseId.includes('retry-budget')?'retry-budget':'unicode';
    const entry=family==='unicode'?'src/services/text.mjs':`src/services/${family}.mjs`;
    const patches={ 'cache-key':{search:'return String(value);',replace:'return typeof value + ":" + String(value);'},
      'retry-budget':{search:'attempt < retries',replace:'attempt <= retries'},
      unicode:{search:'return text.slice(0,Math.max(0,limit));',replace:'return Array.from(text).slice(0,Math.max(0,limit)).join("");'} };
    const key=caseId+'/'+agent, n=counters.get(key)||0;counters.set(key,n+1);assert.ok(n<4);
    controls.push(JSON.stringify({model:b.model,max_tokens:b.max_tokens,thinking:b.thinking,output_config:b.output_config}));
    const call=(name,input,i)=>({type:'tool_use',id:key+'-'+n+'-'+i,name,input});
    const p=patches[family];
    const blocks=n===0?['AGENTS.md',entry,'tests/public.test.mjs'].map((file,i)=>call(agent==='tea'?'read_file':agent==='pi'?'read':'Read',agent==='claude'?{file_path:file}:{path:file},i))
      :n===1?[call(agent==='tea'?'apply_patch':agent==='pi'?'edit':'Edit',agent==='tea'?{path:entry,...p}:agent==='pi'?{path:entry,oldText:p.search,newText:p.replace}:{file_path:entry,old_string:p.search,new_string:p.replace},0)]
      :n===2?[call(agent==='tea'?'run_tests':agent==='claude'?'Bash':process.platform==='win32'?'powershell':'bash',
        {command:agent==='claude' ? caseId.endsWith('r1') ? 'cd . && node --test tests/public.test.mjs 2>&1'
          : caseId.endsWith('r2') ? 'cd -- "." && node --test tests/public.test.mjs' : 'node --test tests/public.test.mjs 2>&1'
          : 'node --test tests/public.test.mjs'},0)]
      :[{type:'text',text:'Verified.'}];
    let payload=ev({type:'message_start',message:{id:key+'-'+n,type:'message',role:'assistant',model:b.model,content:[],stop_reason:null,usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:20}}});
    for(let i=0;i<blocks.length;i++){const x=blocks[i];payload+=ev({type:'content_block_start',index:i,content_block:x.type==='tool_use'?{...x,input:{}}:{type:'text',text:''}});
      payload+=ev({type:'content_block_delta',index:i,delta:x.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(x.input)}:{type:'text_delta',text:x.text}})+ev({type:'content_block_stop',index:i});}
    payload+=ev({type:'message_delta',delta:{stop_reason:n<3?'tool_use':'end_turn'},usage:{output_tokens:20}})+ev({type:'message_stop'});
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(payload);
  }catch(e){res.writeHead(500);res.end('Local protocol assertion failed');}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
  const env={...process.env,ANTHROPIC_API_KEY:'loopback-only-no-real-key',ANTHROPIC_AUTH_TOKEN:'',ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,
    ANTHROPIC_MODEL:'glm-5.3-flash',TEA_THINKING_MODE:'enabled',TEA_REASONING_EFFORT:'low',TEA_MAX_OUTPUT_TOKENS:'4096',
    TEA_INPUT_PRICE_USD_PER_MTOK:'.8',TEA_OUTPUT_PRICE_USD_PER_MTOK:'2.8',TEA_STORE_RAW:'0',TEA_MAX_TOOL_CALLS:'24',TEA_STREAM:'1',TEA_CAPABILITY_FEEDBACK:'1'};
  await execute(process.execPath,['scripts/compare-three-agents.mjs','--mode','contract','--groups','fresh','--scales','small','--repeat','3','--run-id',id,'--max-cost-usd','1'],{cwd:ROOT,env,windowsHide:true,timeout:240000,maxBuffer:1_000_000});
  const directory=path.join(ROOT,'benchmarks/results',id),r=JSON.parse(await readFile(path.join(directory,'comparison.json'),'utf8'));
  assert.ok(r.complete && r.sourceUnchanged && r.piSourceUnchanged && r.claudeSourceUnchanged && r.engines.tea.sourceUnchanged);
  assert.equal(r.runs.length,27);assert.ok(r.runs.every(x=>x.accepted));assert.equal(r.requests.length,108);
  assert.ok(r.requests.every(q=>q.complete && q.totalTokens===140));assert.equal(r.paidProviderRequests,0);
  assert.equal(new Set(controls).size,1);assert.equal(r.analysis.teaVsPi.overall.allPairsTokenReductionPercent,null);
  assert.equal(r.analysis.teaVsClaude.overall.allPairsTokenReductionPercent,null);
  const record={runId:id,kind:'native three-agent streaming contract',acceptanceVersion:r.acceptanceVersion,claudeBashWrappersVerified:true,usageSource:'scripted-loopback',paidProviderRequests:0,accepted:27,runs:27,requests:108,commonControlsMatched:true,sourceStable:true,providerTokenBenefit:null};
  await writeFile(path.join(directory,'contract.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
