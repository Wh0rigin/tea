import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { runTask } from '../src/agent.mjs';
import { taskDefinitions, prepareFixture, cloneFixture, treeFingerprint } from '../src/comparison-fixtures.mjs';
import { startComparisonGateway } from '../src/comparison-gateway.mjs';
import { runPiTask } from '../src/comparison-pi.mjs';

// Deterministic loopback contract check. Scripted responses and token values are
// never passed to the comparison report or chart as provider measurements.
const exec = promisify(execFile);
const output = await mkdtemp(path.join(os.tmpdir(), 'tea-pi-contract-'));
const definition = taskDefinitions().find(task => task.taskId === 'small-retry-budget');
const pinned = await prepareFixture(path.join(output,'base'),definition);
const counters = {tea:0,pi:0};
const upstreamBodies = [];
const event = data => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
const provider = createServer(async (request,response) => {
  try {
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    upstreamBodies.push(body);
    assert.equal(request.headers['x-api-key'],'loopback-only-no-real-key');
    const agent=body.tools.some(tool=>tool.name==='read_file')?'tea':'pi';
    const round=counters[agent]++;
    const call=(name,input,id)=>({type:'tool_use',id:`${agent}-${round}-${id}`,name,input});
    const blocks=round===0 ? [call(agent==='tea'?'read_file':'read',{path:'AGENTS.md'},0),call(agent==='tea'?'read_file':'read',{path:definition.entry},1)]
      : round===1 ? [call(agent==='tea'?'apply_patch':'edit',agent==='tea'
        ? {path:definition.entry,search:'attempt < retries',replace:'attempt <= retries'}
        : {path:definition.entry,oldText:'attempt < retries',newText:'attempt <= retries'},0)]
      : round===2 ? [call(agent==='tea'?'run_tests':process.platform==='win32'?'powershell':'bash',{command:'node --test tests/public.test.mjs'},0)]
      : [{type:'text',text:'Verified — 中文 Unicode \u2028 parsing.'}];
    if(round>3)throw new Error('Unexpected extra loopback request');
    const stop=blocks[0].type==='tool_use'?'tool_use':'end_turn';
    let payload=event({type:'message_start',message:{id:`contract-${agent}-${round}`,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,
      usage:{input_tokens:100+round,output_tokens:0,cache_read_input_tokens:20,cache_creation_input_tokens:10}}});
    blocks.forEach((block,index)=>{
      if(block.type==='tool_use') {
        payload+=event({type:'content_block_start',index,content_block:{...block,input:{}}});
        payload+=event({type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
      } else {
        payload+=event({type:'content_block_start',index,content_block:{type:'text',text:''}});
        payload+=event({type:'content_block_delta',index,delta:{type:'text_delta',text:block.text}});
      }
      payload+=event({type:'content_block_stop',index});
    });
    payload+=event({type:'message_delta',delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:30}});
    payload+=event({type:'message_stop'});
    response.writeHead(200,{'content-type':'text/event-stream'});
    const bytes=Buffer.from(payload);
    // Byte-sized chunks exercise multi-byte characters and SSE boundaries.
    for(let offset=0;offset<bytes.length;offset+=7)response.write(bytes.subarray(offset,offset+7));
    response.end();
  } catch(error) {response.writeHead(500);response.end(String(error.message));}
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const config=loadConfig({workspace:output,runId:'contract',maxCostUsd:10},{
  ANTHROPIC_API_KEY:'loopback-only-no-real-key',ANTHROPIC_BASE_URL:`http://127.0.0.1:${provider.address().port}`,
  ANTHROPIC_MODEL:'contract-model',TEA_INPUT_PRICE_USD_PER_MTOK:'1',TEA_OUTPUT_PRICE_USD_PER_MTOK:'1',
  TEA_MAX_REQUEST_INPUT_TOKENS:'64000',TEA_MAX_OUTPUT_TOKENS:'2048',TEA_REASONING_EFFORT:'low',TEA_THINKING_MODE:'adaptive',
});
const gateway=await startComparisonGateway(config);
const results=[];
try {
  for(const agent of ['tea','pi']) {
    const workspace=path.join(output,agent);
    await cloneFixture(path.join(output,'base'),workspace);
    assert.equal((await treeFingerprint(workspace)).sha256,pinned.sha256);
    const baseUrl=`${gateway.baseUrl}/${agent}/contract`;
    const result=agent==='tea' ? await runTask(definition.prompt,{...config,workspace,apiKey:gateway.token,baseUrl})
      : await runPiTask({piCli:path.join(os.homedir(),'AppData','Roaming','npm','node_modules','@earendil-works','pi-coding-agent','dist','bundle','cli.js'),
        workspace,agentDir:path.join(output,'pi-config'),baseUrl,token:gateway.token,config,prompt:definition.prompt,timeoutMs:60000});
    await gateway.waitForIdle();
    const rows=gateway.forCase('contract',agent);
    console.log(`${agent}: ${result.status}; ${rows.length} loopback requests`);
    assert.equal(result.status,'completed',JSON.stringify(result));
    assert.equal(rows.length,4);
    assert.ok(rows.every(row=>row.complete));
    assert.equal(rows.reduce((sum,row)=>sum+row.totalTokens,0),646);
    await exec(process.execPath,['--test','tests/public.test.mjs'],{cwd:workspace,windowsHide:true,timeout:10000});
    const fixed=await import(`file:///${workspace.replaceAll('\\','/')}/${definition.entry}`);
    assert.equal(await fixed.retry(async()=>9,0),9);
    results.push({agent,status:result.status,requests:rows.length,completed:true});
  }
  const controls=upstreamBodies.map(body=>JSON.stringify({model:body.model,max_tokens:body.max_tokens,thinking:body.thinking,output_config:body.output_config}));
  assert.equal(new Set(controls).size,1);
  assert.ok(!gateway.halted);
  await writeFile(path.join(output,'contract.json'),JSON.stringify({usageSource:'scripted-loopback',paidProviderRequests:0,
    note:'Protocol validation only. These token counts are scripted and are not TEA/Pi performance evidence.',results,commonControlsMatched:true},null,2));
  console.log(`Contract check passed; no paid provider calls. ${output}`);
} finally {
  await gateway.close();
  provider.closeAllConnections();
  await new Promise(resolve=>provider.close(resolve));
}
