import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runTask, createAgentSession, resetConversation } from '../src/agent.mjs';
import { loadConfig } from '../src/config.mjs';
import { attachSessionJournal, closeSessionJournal, inspectSession } from '../src/session-memory.mjs';
import { SessionJournal, workspaceIdentity, digest } from '../src/session-journal.mjs';
import { WorkspaceTools } from '../src/tools.mjs';

let serial = 0;
const done = { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' };
const calls = list => ({ content: list.map(call => ({ type: 'tool_use', id: `persist-${++serial}`, ...call })), stop_reason: 'tool_use' });
function factory(steps, captured = []) { return () => ({ complete: async request => { captured.push(structuredClone(request.messages)); return steps.shift() || done; } }); }
async function scenario(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-persist-'));
  try {
    await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
    await writeFile(path.join(root, 'value.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import {value} from './value.mjs'; test('value',()=>assert.equal(value,2));");
    const config = loadConfig({ workspace: root, sessionId: 'task', runId: 'first' }, {}); await fn(root, config);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const patch = { name: 'apply_patch', input: { path: 'value.mjs', search: 'value = 1', replace: 'value = 2' } };
const verify = { name: 'run_tests', input: { command: 'node --test value.test.mjs' } };
test('resume retains exact history and pending edits then discharges validation', async () => scenario(async (root, config) => {
  const first = await runTask('Fix value; retain requirement Ω', { ...config, maxToolCalls: 1 }, { adapterFactory: factory([calls([patch])]) });
  assert.equal(first.status, 'needs_validation');
  const resumedConfig = { ...config, sessionId: undefined, resume: 'task', runId: 'second' }, session = createAgentSession(resumedConfig), captured = [];
  const second = await runTask('Continue with tests', resumedConfig, { session, adapterFactory: factory([calls([verify]), done], captured) });
  assert.equal(second.status, 'completed'); assert.equal(second.validationPassed, true); assert.equal(session.pendingValidation, false);
  assert.match(JSON.stringify(captured[0]), /requirement Ω/);
  assert.match(await readFile(path.join(root, 'value.mjs'), 'utf8'), /value = 2/);
  const inspection = await inspectSession(resumedConfig, 'task'); assert.equal(inspection.pendingValidation, false);
}));
test('source changes between processes invalidate validation and old checkpoint', async () => scenario(async (root, config) => {
  await runTask('Fix', config, { adapterFactory: factory([calls([patch, verify]), done]) });
  await writeFile(path.join(root, 'value.mjs'), 'export const value = 9;');
  const next = { ...config, sessionId: undefined, resume: 'task', runId: 'changed' }, session = createAgentSession(next);
  await attachSessionJournal(session, next);
  try { assert.equal(session.pendingValidation, true); assert.equal(session.validationPassed, false); assert.equal(session.compaction, null); assert.match(session.resumeNotice, /workspace content/); }
  finally { await closeSessionJournal(session); }
}));
test('persistent /new clears history but preserves pending edits', async () => scenario(async (root, config) => {
  const session = createAgentSession(config);
  await runTask('Fix', { ...config, maxToolCalls: 1 }, { session, adapterFactory: factory([calls([patch])]) });
  await resetConversation(session, config); assert.deepEqual(session.messages, []); assert.equal(session.pendingValidation, true);
  const next = { ...config, sessionId: undefined, resume: 'task' }, restored = createAgentSession(next);
  await attachSessionJournal(restored, next);
  try { assert.deepEqual(restored.messages, []); assert.equal(restored.pendingValidation, true); }
  finally { await closeSessionJournal(restored); }
}));
test('unknown in-flight billing reserves once across repeated restarts', async () => scenario(async (root, config) => {
  const journal = await SessionJournal.open({ workspace: root, id: 'uncertain' });
  await journal.append('session_created', { identity: await workspaceIdentity(root), model: config.model,
    endpointSha256: digest(config.baseUrl), maxCostUsd: 1, maxInputTokens: 10000 });
  await journal.append('request_intent', { requestId: 'unknown', reservedUsd: 0.125, inputBound: 2000 }); await journal.close();
  for (let n = 0; n < 2; n++) {
    const next = { ...config, maxCostUsd: 2, maxInputTokens: 20000, sessionId: undefined, resume: 'uncertain' }, session = createAgentSession(next);
    await attachSessionJournal(session, next);
    try { assert.equal(session.restoredBudget.spentUsd, 0.125); assert.equal(session.restoredBudget.spentInputBound, 2000);
      assert.equal(session.restoredBudget.maxCostUsd, 1); assert.equal(session.restoredBudget.maxInputTokens, 10000); assert.equal(session.budgetUnknown, true); }
    finally { await closeSessionJournal(session); }
  }
}));
test('interrupted tool batches are paired with uncertainty without executing edits', async () => scenario(async (root, config) => {
  const journal = await SessionJournal.open({ workspace: root, id: 'interrupted' });
  await journal.append('session_created', { identity: await workspaceIdentity(root), model: config.model, endpointSha256: digest(config.baseUrl), maxCostUsd: 0 });
  await journal.append('message', { role: 'user', content: 'Fix' });
  await journal.append('message', { role: 'assistant', content: calls([patch]).content });
  await journal.close();
  const next = { ...config, sessionId: undefined, resume: 'interrupted' }, session = createAgentSession(next);
  await attachSessionJournal(session, next);
  try { assert.equal(session.messages.at(-1).content[0].is_error, true); assert.equal(session.pendingValidation, true);
    assert.match(await readFile(path.join(root, 'value.mjs'), 'utf8'), /value = 1/); }
  finally { await closeSessionJournal(session); }
}));
test('different models or endpoints cannot silently reuse a session', async () => scenario(async (root, config) => {
  await runTask('Inspect', config, { adapterFactory: factory([done]) });
  for (const changed of [{ model: 'another' }, { baseUrl: 'https://different.invalid' }]) {
    const next = { ...config, sessionId: undefined, resume: 'task', ...changed };
    await assert.rejects(attachSessionJournal(createAgentSession(next), next), /original workspace, model and endpoint/);
  }
}));
test('legacy mode remains in-memory and creates no session journal', async () => scenario(async (root, config) => {
  const result = await runTask('Inspect', { ...config, sessionId: undefined }, { adapterFactory: factory([done]) });
  assert.equal(result.sessionId, null);
  await assert.rejects(readFile(path.join(root, '.tea', 'sessions', 'task', 'journal.jsonl')), /ENOENT/);
}));
test('model tools cannot read or patch local session storage', async () => scenario(async (root, config) => {
  await runTask('Inspect', config, { adapterFactory: factory([done]) });
  const tools = new WorkspaceTools({ workspace: root }); await tools.init();
  await assert.rejects(tools.readFile({ path: '.tea/sessions/task/journal.jsonl' }), /storage/);
  await assert.rejects(tools.applyPatch({ path: '.tea/sessions/task/journal.jsonl', search: 'schema', replace: 'bad' }), /storage/);
}));
test('two actual Node processes continue the same editing task', async () => scenario(async (root, config) => {
  const agentUrl = new URL('../src/agent.mjs', import.meta.url).href;
  const configUrl = new URL('../src/config.mjs', import.meta.url).href;
  const script = `import {runTask} from ${JSON.stringify(agentUrl)}; import {loadConfig} from ${JSON.stringify(configUrl)};
    const resumed=process.argv[2]==='resume';
    const config=loadConfig({workspace:process.argv[1],runId:resumed?'child-two':'child-one',sessionId:resumed?undefined:'child',resume:resumed?'child':undefined},{});
    config.maxToolCalls=resumed?4:1;
    const call=resumed?{name:'run_tests',input:{command:'node --test value.test.mjs'}}:${JSON.stringify(patch)};
    const steps=[{content:[{type:'tool_use',id:'child-'+resumed,...call}],stop_reason:'tool_use'},{content:[{type:'text',text:'Done'}],stop_reason:'end_turn'}];
    const result=await runTask(resumed?'Continue':'Fix',config,{adapterFactory:()=>({complete:async()=>steps.shift()})});
    console.log(JSON.stringify({status:result.status,validationPassed:result.validationPassed}));`;
  const exec = promisify(execFile);
  const first = await exec(process.execPath, ['--input-type=module', '-e', script, root, 'create'], { windowsHide: true });
  assert.equal(JSON.parse(first.stdout).status, 'needs_validation');
  const second = await exec(process.execPath, ['--input-type=module', '-e', script, root, 'resume'], { windowsHide: true });
  assert.equal(JSON.parse(second.stdout).status, 'completed'); assert.equal(JSON.parse(second.stdout).validationPassed, true);
}));
test('native adapter persists actual counters and cannot increase the resumed cap', async () => scenario(async (root, config) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ...done, usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200 });
  const live = { ...config, apiKey: 'synthetic-test-key', maxCostUsd: 1, inputRateUsdPerMillion: 0.8,
    outputRateUsdPerMillion: 2.8, maxOutputTokens: 1200, maxRequestInputTokens: 30000, stream: false };
  try {
    await runTask('Inspect', live);
    const next = { ...live, sessionId: undefined, resume: 'task', runId: 'native-resume', maxCostUsd: 2 }, session = createAgentSession(next);
    await runTask('Continue', next, { session });
    assert.equal(session.adapter.config.maxCostUsd, 1); assert.equal(session.adapter.actualInputTokens, 20);
    assert.ok(Math.abs(session.adapter.spentUsd - 2 * (10 * 0.8 + 2 * 2.8) / 1e6) < 1e-12);
    const journal = await SessionJournal.open({ workspace: root, id: 'task', resume: true });
    try { assert.equal((await journal.events()).filter(event => event.kind === 'request_intent').length, 2); }
    finally { await journal.close(); }
  } finally { globalThis.fetch = original; }
}));
test('unknown native billing stops provider use after restart', async () => scenario(async (root, config) => {
  const original = globalThis.fetch; let submissions = 0;
  globalThis.fetch = async () => { submissions++; throw new Error('synthetic network interruption'); };
  const live = { ...config, apiKey: 'synthetic-test-key', maxCostUsd: 1, inputRateUsdPerMillion: 0.8,
    outputRateUsdPerMillion: 2.8, maxOutputTokens: 1200, maxRequestInputTokens: 30000, stream: false };
  try {
    assert.equal((await runTask('Inspect', live)).status, 'failed');
    const next = { ...live, sessionId: undefined, resume: 'task', runId: 'unknown-resume' };
    await assert.rejects(runTask('Continue', next), /unresolved billing/); assert.equal(submissions, 1);
  } finally { globalThis.fetch = original; }
}));
