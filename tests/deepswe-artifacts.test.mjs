import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { exportDeepSweArtifact } from '../scripts/lib/deepswe-artifacts.mjs';
import { createDeepSweApproval } from '../scripts/lib/deepswe-policy.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { commandEnvironment } from '../src/commands.mjs';
const exec=promisify(execFile);
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'tea-artifact-'));const workspace=path.join(root,'workspace');await mkdir(workspace);
 t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
 const git=async(...args)=>(await exec('git',args,{cwd:workspace,encoding:'utf8',windowsHide:true})).stdout.trim();
 await git('init','-b','main');await git('config','user.name','TEA-Benchmark');await git('config','user.email','benchmark@localhost');await git('config','core.autocrlf','false');
 await writeFile(path.join(workspace,'source.txt'),'original\n');await git('add','.');await git('commit','-m','Base');const baseCommit=await git('rev-parse','HEAD');
 return{root,workspace,baseCommit,git};
}
test('complete source-edit validation commit export and independent patch replay excludes ignored state',async t=>{
 const f=await fixture(t);await appendFile(path.join(f.workspace,'.git/info/exclude'),'\n/.tea/\n');
 await mkdir(path.join(f.workspace,'.tea'));await writeFile(path.join(f.workspace,'.tea/private.json'),'private dummy state');
 const tools=new WorkspaceTools({workspace:f.workspace});await tools.init();tools.approveCommand=createDeepSweApproval();
 assert.match(await tools.runShell({command:'git checkout -b feature main'}),/^exit=0/);
 await tools.applyPatch({path:'source.txt',search:'original',replace:'changed'});
 await tools.writeFile({path:'added.test.mjs',content:"import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('value',()=>assert.equal(readFileSync('source.txt','utf8'),'changed\\n'));\n"});
 assert.match(await tools.runTests({command:'node --test added.test.mjs'}),/^exit=0/);
 const artifactDirectory=path.join(f.root,'artifacts');
 const cli=await exec('node',[fileURLToPath(new URL('../scripts/finalize-deepswe.mjs',import.meta.url)),'--workspace',f.workspace,'--base-commit',f.baseCommit,'--output',artifactDirectory],{env:commandEnvironment(f.workspace),windowsHide:true});
 const result=JSON.parse(cli.stdout);
 assert.deepEqual(result.changedFiles,['added.test.mjs','source.txt']);assert.equal(result.patchSha256,result.snapshotSha256);
 const patch=await readFile(path.join(artifactDirectory,'model.patch'),'utf8');assert.doesNotMatch(patch,/private dummy|private.json/);assert.match(await f.git('log','-1'),/Signed-off-by:/);
 const verifier=path.join(f.root,'verifier');await exec('git',['clone','--no-checkout','--quiet',f.workspace,verifier],{windowsHide:true});await exec('git',['config','core.autocrlf','false'],{cwd:verifier,windowsHide:true});await exec('git',['checkout',f.baseCommit],{cwd:verifier,windowsHide:true});
 await exec('git',['apply',path.join(artifactDirectory,'model.patch')],{cwd:verifier,windowsHide:true});
 assert.equal(await readFile(path.join(verifier,'source.txt'),'utf8'),'changed\n');
 const verify=await exec('node',['--test','added.test.mjs'],{cwd:verifier,env:commandEnvironment(verifier),windowsHide:true});assert.match(verify.stdout,/(?:pass|passed)\s+1/);
 await assert.rejects(exportDeepSweArtifact({...f,artifactDirectory}),e=>e.code==='EEXIST');
});
test('artifact export refuses missing ignore contract and tracked private state',async t=>{
 const f=await fixture(t);await assert.rejects(exportDeepSweArtifact({...f,artifactDirectory:path.join(f.root,'unignored')}),/must ignore/);
 await mkdir(path.join(f.workspace,'nested'));await assert.rejects(exportDeepSweArtifact({...f,workspace:path.join(f.workspace,'nested'),artifactDirectory:path.join(f.root,'nested-export')}),/repository root/);
 await assert.rejects(exportDeepSweArtifact({...f,artifactDirectory:path.join(f.workspace,'bad-artifacts')}),/outside/);
 await mkdir(path.join(f.workspace,'.tea'));await writeFile(path.join(f.workspace,'.tea/private'),'dummy');await f.git('add','.tea/private');
 await assert.rejects(exportDeepSweArtifact({...f,artifactDirectory:path.join(f.root,'tracked')}),/tracked private/);
});
test('candidate snapshot survives a commit failure for zero-model verification recovery',async t=>{
 const f=await fixture(t);await appendFile(path.join(f.workspace,'.git/info/exclude'),'\n/.tea/\n');await writeFile(path.join(f.workspace,'source.txt'),'changed\n');
 await f.git('config','user.name','');await f.git('config','user.email','');
 // Reject commits with an invalid signing program, independent of OS shell hooks.
 await f.git('config','commit.gpgsign','true');await f.git('config','gpg.program','tea-no-such-signing-program');
 const artifactDirectory=path.join(f.root,'failed');await assert.rejects(exportDeepSweArtifact({...f,artifactDirectory}));
 assert.match(await readFile(path.join(artifactDirectory,'working-tree.patch'),'utf8'),/\+changed/);
 assert.equal(await f.git('rev-parse','HEAD'),f.baseCommit);
});
