const { WorkspaceTools } = await import(process.env.TEA_PIPE_REPRO_MODULE || '/opt/tea/src/tools.mjs');
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
const workspace=process.env.TEA_PIPE_REPRO_WORKSPACE || '/tmp/tea-pipe-repro';await mkdir(workspace,{recursive:true});
await writeFile(workspace+'/descendant.mjs','setTimeout(()=>{},5000);\n');
await writeFile(workspace+'/parent.mjs',`import {spawn} from 'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['descendant.mjs'],{stdio:['ignore','inherit','inherit'],detached:true,windowsHide:true});writeFileSync('descendant.pid',String(child.pid));child.unref();\n`);
const rows=[];
for(const mode of ['timeout','abort']){
 const controller=new AbortController();
 const tools=new WorkspaceTools({workspace,maxCommandMs:mode==='timeout'?300:10000});
 tools.signal=controller.signal;tools.approveCommand=()=>true;
 let settled=false;const started=Date.now();
 const task=tools.runShell({command:'node parent.mjs'}).then(value=>{settled=true;return{kind:'resolved',value};},error=>{settled=true;return{kind:'rejected',message:error.message};});
 const cancel=mode==='abort'?setTimeout(()=>controller.abort(),300):null;
 await sleep(1200);const pending=!settled;
 const pid=Number(await readFile(workspace+'/descendant.pid','utf8'));if(!Number.isSafeInteger(pid)||pid<=1)throw Error('Invalid fixture child PID');
 try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
 const final=await Promise.race([task,sleep(1000).then(()=>({kind:'still_pending'}))]);
 if(cancel)clearTimeout(cancel);
 rows.push({mode,configuredBoundMs:300,watchdogMs:1200,pendingAfterWatchdog:pending,settledOnlyAfterExplicitDescendantCleanup:pending&&final.kind!=='still_pending',elapsedMs:Date.now()-started,result:final.kind});
}
console.log(JSON.stringify({arm:process.argv[2],node:process.version,platform:process.platform,providerCalls:0,fixture:'Self-authored detached child retains stdout/stderr after parent exit',status:rows.every(row=>row.pendingAfterWatchdog)?'defect_reproduced':'not_reproduced',cases:rows}));
