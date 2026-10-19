import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseCommand, assertCommandPolicy, isAllowedCommand, isValidationCommand, commandEnvironment, windowsNpmArguments } from '../src/commands.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { createDeepSweApproval } from '../scripts/lib/deepswe-policy.mjs';
import { runtimeCapabilities, capabilityNotice } from '../src/tool-feedback.mjs';

const exec = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(),'tea-commands-'));
  t.after(async()=>{ assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)); await rm(root,{recursive:true,force:true}); });
  const tools = new WorkspaceTools({workspace:root}); await tools.init(); return {root,tools};
}
test('direct argv parser handles both quote styles, empty arguments and Windows paths', () => {
  assert.deepEqual(parseCommand('python -m pytest "tests/a b.py"'),{executable:'python',args:['-m','pytest','tests/a b.py']});
  assert.deepEqual(parseCommand("git log --format='%H %s'"),{executable:'git',args:['log','--format=%H %s']});
  assert.deepEqual(parseCommand('node "C:\\some dir\\test.mjs" ""'),{executable:'node',args:['C:\\some dir\\test.mjs','']});
  assert.deepEqual(parseCommand('node -e "process.stdout.write(\\"ok\\")"'),{executable:'node',args:['-e','process.stdout.write("ok")']});
  for (const text of ['node "oops', '', '"" x']) assert.throws(()=>parseCommand(text),e=>e.feedbackCode==='INPUT_INVALID');
  for (const text of ['git status && git log','node -e "x;x"','node\n--test']) assert.throws(()=>parseCommand(text),/operators/);
});
test('destructive policy checks actual executable and Git operation, not literal format arguments', () => {
  for (const text of ['git log --format="%H %s"','node format.test.mjs','git commit -m "format changes"']) assert.doesNotThrow(()=>assertCommandPolicy(parseCommand(text)));
  for (const text of ['rm file','C:\\Windows\\format.exe D:','git --no-pager reset --hard','git -C somewhere clean -fd','git switch --discard-changes main','powershell -Command "Remove-Item file"']) assert.throws(()=>assertCommandPolicy(parseCommand(text)),/blocked/);
});
test('validation and diagnostic classification use parsed arguments and keep CLI separate', () => {
  for (const text of ['go test ./...','go vet ./...','go build ./cmd/...','python3 -m pytest -q','node --test "a b.test.mjs"']) assert.equal(isValidationCommand(text),true,text);
  for (const text of ['go test -list Test','go test -list=Test','python -m mnamer --daemon status','git branch --show-current','git log --oneline -3','git log --format="%H %s"','node --test "--help"']) assert.equal(isValidationCommand(text),false,text);
  for (const text of ['git branch --show-current','git log --oneline -3','git log --format="%H %s"','git status --porcelain','git diff --stat']) assert.equal(isAllowedCommand(text),true,text);
  for (const text of ['git branch feature','git branch -D feature','git diff --output=outside','git -C ../elsewhere status','git log --ext-diff','./node --test file']) assert.equal(isAllowedCommand(text),false,text);
});
test('command environment supplies cache/home without inheriting API credentials or arbitrary variables', () => {
  const result=commandEnvironment('/unused',{PATH:'tool-path',HOME:'/home/test',TMPDIR:'/tmp/test',ANTHROPIC_API_KEY:'must-not-inherit',GOCACHE:'/untrusted',TEA_SECRET:'hidden'});
  assert.equal(result.HOME,'/home/test');assert.equal(result.GOCACHE,path.join('/tmp/test','tea-go-cache'));
  assert.equal(result.ANTHROPIC_API_KEY,undefined);assert.equal(result.TEA_SECRET,undefined);assert.equal(result.PATH,'tool-path');
});
test('Windows npm bridge quotes spaces and rejects CMD expansion independently of direct commands', () => {
  assert.deepEqual(windowsNpmArguments(['test','--','a b']),['/d','/s','/c','npm test -- "a b"']);
  for(const x of ['%PATH%','!name!','a(b)','a"b','a&b'])assert.throws(()=>windowsNpmArguments(['test',x]),/CMD/);
});
test('quoted native test paths execute on Windows and POSIX without approval', async t => {
  const {root,tools}=await fixture(t);await writeFile(path.join(root,'a b.test.mjs'),"import test from 'node:test';test('quoted path',()=>{});\n");
  let approvals=0;tools.approveCommand=()=>{approvals++;return true;};
  assert.match(await tools.runTests({command:'node --test "a b.test.mjs"'}),/^exit=0/);assert.equal(approvals,0);
});
test('structured approval separates policy, user and malformed decisions and fails closed', async t => {
  const {tools}=await fixture(t);
  for(const [decision,code] of [[{decision:'deny',source:'policy',reason:'Not in project policy'},'COMMAND_POLICY_DENIED'],[{decision:'deny',source:'user',reason:'User refused'},'USER_APPROVAL_DENIED'],['yes','APPROVAL_INVALID'],[{decision:'allow',source:'unknown'},'APPROVAL_INVALID'],[undefined,'APPROVAL_INVALID']]) {
    tools.approveCommand=()=>decision;await assert.rejects(tools.runShell({command:'node --version'}),e=>e.feedbackCode===code);
  }
  tools.approveCommand=()=>false;assert.equal(await tools.runShell({command:'node --version'}),'Command not approved by approval handler.');
  tools.approveCommand=()=>{throw new Error('secret handler details');};await assert.rejects(tools.runShell({command:'node --version'}),e=>e.feedbackCode==='APPROVAL_HANDLER_FAILED'&&!e.message.includes('secret'));
  tools.approveCommand=()=>({decision:'allow',source:'policy'});assert.match(await tools.runShell({command:'node --version'}),/^exit=0/);
});
test('cancellation during approval prevents execution even when approval grants', async t => {
  const {tools}=await fixture(t);const c=new AbortController();tools.signal=c.signal;
  tools.approveCommand=()=>{c.abort();return {decision:'allow',source:'user'};};
  await assert.rejects(tools.runShell({command:'node --version'}),e=>e.name==='AbortError');
});
test('frozen benchmark policy supports explicit branch bases and declared CLI modules only', () => {
  const approve=createDeepSweApproval({cliModules:['mnamer']});
  for(const command of ['git checkout -b feature main','git switch -c feature main','git checkout -b feature','python -m mnamer --daemon status','go version','go env GOCACHE']) assert.equal(approve(command).decision,'allow',command);
  for(const command of ['git checkout -b feature other','git push origin main','git add -f .tea','python -m unknown','python -c anything','go env -w GOPROXY=elsewhere']) assert.equal(approve(command).decision,'deny',command);
  const capabilities=runtimeCapabilities({approveCommand:approve});assert.match(capabilityNotice(capabilities),/python -m mnamer ARGUMENTS/);
  assert.notEqual(capabilities.version,runtimeCapabilities({approveCommand:()=>true}).version);
  const a=runtimeCapabilities({approveCommand:createDeepSweApproval({cliModules:['a','b','c']})});
  const b=runtimeCapabilities({approveCommand:createDeepSweApproval({cliModules:['a','b','c','d']})});
  assert.notEqual(a.version,b.version,'Full policy changes are visible even when displayed examples are capped');
});
test('actual declared project CLI executes through the ordinary backend with no false validation credit', async t => {
  try {await exec('python',['--version'],{windowsHide:true,timeout:5000});}catch{t.skip('Python unavailable');return;}
  const {root,tools}=await fixture(t);await writeFile(path.join(root,'fixturecli.py'),'print("cli-ok")\n');tools.approveCommand=createDeepSweApproval({cliModules:['fixturecli']});
  const command='python -m fixturecli --daemon status';assert.match(await tools.runShell({command}),/cli-ok/);assert.equal(isValidationCommand(command),false);
});
test('actual Go tests use provisioned cache through ordinary run_tests when Go is installed', async t => {
  try{await exec('go',['version'],{windowsHide:true,timeout:5000});}catch{t.skip('Go unavailable');return;}
  const {root,tools}=await fixture(t);tools.maxCommandMs=120000;
  await writeFile(path.join(root,'go.mod'),'module tea-fixture\n\ngo 1.18\n');
  await writeFile(path.join(root,'value_test.go'),'package fixture\nimport "testing"\nfunc TestValue(t *testing.T) {}\n');
  assert.match(await tools.runTests({command:'go test ./...'}),/^exit=0/);
});
