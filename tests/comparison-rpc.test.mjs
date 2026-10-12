import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPiComparisonSession } from '../src/comparison-pi-rpc.mjs';
import { createComparisonTurnAudit } from '../src/comparison-turn-audit.mjs';

test('Pi RPC waits for settled, preserves Unicode JSONL and reuses the conversation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-rpc-test-')), cli = path.join(root, 'fake.mjs');
  await writeFile(cli, `import readline from 'node:readline';
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');let n=0;
for await(const line of readline.createInterface({input:process.stdin})){const c=JSON.parse(line);
emit({type:'response',id:c.id,success:true,data:{}});
if(c.type==='prompt'){n++;emit({type:'tool_execution_start',toolCallId:'r',toolName:'read',args:{path:'source.mjs'}});
emit({type:'tool_execution_end',toolCallId:'r',result:{content:[{type:'text',text:'中文\\u2028source'}]},isError:false});
emit({type:'message_end',message:{role:'assistant',stopReason:'stop'}});emit({type:'agent_end'});
await new Promise(r=>setTimeout(r,30));emit({type:'agent_settled',turn:n});}}`);
  const session = await createPiComparisonSession({ piCli: cli, workspace: root, agentDir: path.join(root, 'config'), baseUrl: 'http://127.0.0.1', token: 'dummy',
    config: { model: 'fake', effort: 'low', maxOutputTokens: 2048, inputRateUsdPerMillion: 1, outputRateUsdPerMillion: 1, piAutoCompaction: true }, timeoutMs: 2000 });
  for (let n = 1; n <= 2; n++) {
    const events = [], audit = createComparisonTurnAudit({ agent: 'pi', workspace: root, requiredPath: 'source.mjs', expectedOutput: '中文\u2028source', readOnly: true });
    const result = await session.prompt('inspect', { onEvent: e => { events.push(e); audit.observe(e); } });
    assert.equal(result.status, 'completed'); assert.equal(result.toolCalls, 1);
    assert.equal(events.at(-1).type, 'agent_settled'); assert.equal(events.at(-1).turn, n); assert.ok(audit.finish().passed);
  }
  const closed = await session.close(); assert.match(closed.stdoutSha256, /^[a-f0-9]{64}$/); assert.deepEqual(await session.close(), closed);
  assert.equal(JSON.parse(await readFile(path.join(root, 'config', 'settings.json'))).compaction.enabled, true);
});

test('shared turn audit rejects partial reads, mutations and failed validation', () => {
  const root = path.resolve('fixture');
  const audit = createComparisonTurnAudit({ agent: 'tea', workspace: root, requiredPath: 'src/a.mjs', expectedOutput: 'complete', readOnly: true });
  const observe = event => { audit.observe({ ...event, type: 'tool_start' }); audit.observe(event); };
  observe({ type: 'tool_end', name: 'read_file', input: { path: 'src/a.mjs' }, output: 'partial', isError: false });
  assert.equal(audit.finish().passed, false);
  observe({ type: 'tool_end', name: 'read_file', input: { path: path.join(root, 'src/a.mjs') }, output: 'complete', isError: false });
  assert.equal(audit.finish().passed, true);
  observe({ type: 'tool_end', name: 'run_tests', input: { command: 'node --test tests/public.test.mjs' }, output: 'exit=0\n# tests 1\n# pass 1\n# fail 0', isError: false });
  assert.equal(audit.finish().passed, false); assert.equal(audit.finish().validatedAfterEdit, true);
  observe({ type: 'tool_end', name: 'apply_patch', input: { path: 'src/a.mjs' }, output: 'edited', isError: false });
  assert.equal(audit.finish().validatedAfterEdit, false);
  observe({ type: 'tool_end', name: 'run_tests', input: { command: 'node --test tests/public.test.mjs' }, output: 'exit=1', isError: true });
  assert.equal(audit.finish().validatedAfterEdit, false);
});

test('Pi RPC rejection/exit is a failed turn without automatic resubmission', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-rpc-fail-')), cli = path.join(root, 'fake.mjs');
  await writeFile(cli, `import readline from 'node:readline';for await(const l of readline.createInterface({input:process.stdin})){const c=JSON.parse(l);if(c.type==='prompt')process.exit(2);process.stdout.write(JSON.stringify({type:'response',id:c.id,success:true})+'\\n');}`);
  const session = await createPiComparisonSession({ piCli: cli, workspace: root, agentDir: path.join(root, 'config'), baseUrl: 'http://127.0.0.1', token: 'dummy',
    config: { model: 'fake', effort: 'low', maxOutputTokens: 2048, inputRateUsdPerMillion: 1, outputRateUsdPerMillion: 1 }, timeoutMs: 2000 });
  await assert.rejects(session.prompt('fail'), /exited before completion/); await session.close();
});
