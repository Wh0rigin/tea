import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCliConfig } from '../src/config.mjs';
import { userConfigEnvironment } from '../src/user-config.mjs';
import { runTask, createAgentSession } from '../src/agent.mjs';
import { requirementReviewMessage, requirementReviewOperation } from '../src/requirement-review.mjs';

const finish = { content: [{ type: 'text', text: 'Finished.' }], stop_reason: 'end_turn' };
let serial = 0;
const calls = (...actions) => ({ content: actions.map(action => ({ type: 'tool_use', id: `op-${++serial}`, ...action })), stop_reason: 'tool_use' });
const edit = { name: 'apply_patch', input: { path: 'app.mjs', search: '// original', replace: '// changed' } };
const check = { name: 'run_tests', input: { command: 'node --test unit.test.mjs' } };
const source = "import { writeFileSync } from 'node:fs';\nimport { pathToFileURL } from 'node:url';\n// original\nexport function save(target, text) { writeFileSync(target, text); }\nif (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) save(process.argv[2], 'saved');\n";

async function scenario(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-review-'));
  try {
    await writeFile(path.join(root, 'app.mjs'), source);
    await writeFile(path.join(root, 'unit.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import {save} from './app.mjs';import {readFileSync} from 'node:fs';test('save with an existing parent',()=>{save('unit-output.txt','saved');assert.equal(readFileSync('unit-output.txt','utf8'),'saved');});");
    const config = loadCliConfig({ workspace: root, compaction: 'off', requirementReview: true }, {});
    await callback(root, config);
  } finally {
    const relative = path.relative(os.tmpdir(), root);
    assert(relative.startsWith('tea-review-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    await rm(root, { recursive: true, force: true });
  }
}
function adapter(steps, requests) {
  return () => ({ async complete(request) {
    requests.push(structuredClone(request));
    const step = steps.shift();
    return typeof step === 'function' ? step(request) : step || finish;
  } });
}
const reviews = requests => requests.filter(r => String(r.messages.at(-1)?.content).startsWith('[requirement_review]'));

test('review is opt-in and exposes differences from the frozen quality baseline', () => {
  assert.equal(loadCliConfig({}, {}).requirementReview, false);
  const c = loadCliConfig({}, userConfigEnvironment({ requirementReview: true }));
  assert.equal(c.requirementReview, true);
  const baseline = loadCliConfig({}, {});
  for (const key of Object.keys(baseline).filter(k => !['requirementReview', 'configurationProfileOverrides', 'runId'].includes(k))) assert.deepEqual(c[key], baseline[key], key);
  assert(c.configurationProfileOverrides.includes('requirementReview'));
});

test('review runs once after a pass and records its actual trigger', async () => scenario(async (_, config) => {
  const requests = [], events = [];
  const result = await runTask('Implement saving results', config, {
    adapterFactory: adapter([calls(edit, check), finish, finish], requests), onEvent: e => events.push(e),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.validationPassed, true);
  assert.equal(reviews(requests).length, 1);
  assert.equal(result.contextDiagnostics.requirementReviewCount, 1);
  assert.equal(events.filter(e => e.type === 'requirement_review_requested').length, 1);
  const ledger = await readFile(path.join(result.runDirectory, 'ledger.jsonl'), 'utf8');
  assert.equal(ledger.split('\n').filter(l => l.includes('"type":"requirement_review_requested"')).length, 1);
  assert.match(reviews(requests)[0].messages.at(-1).content, /implementation helpers/);
}));

test('pending validation cannot suppress review and review cannot clear a failure', async () => scenario(async (_, config) => {
  const requests = [];
  const failed = { name: 'run_tests', input: { command: 'node --test missing.test.mjs' } };
  const result = await runTask('Save output', config, { adapterFactory: adapter([calls(edit, failed), finish, finish, finish], requests) });
  assert.equal(reviews(requests).length, 1);
  assert.match(reviews(requests)[0].messages.at(-1).content, /Validation pending: true/);
  assert.match(reviews(requests)[0].messages.at(-1).content, /missing.test.mjs/);
  assert.equal(result.status, 'needs_validation');
  assert.equal(result.validationPassed, false);
  assert.equal(result.validationFailures.length, 1);
  assert.equal(requests.length, 4); // Review replaces, rather than adds to, the first validation nudge.
}));

test('read-only followups and disabled mode add no review request', async () => scenario(async (_, config) => {
  const requests = [], session = createAgentSession(config);
  await runTask('Implement saving', config, { session, adapterFactory: adapter([calls(edit, check), finish, finish], requests) });
  const later = [];
  const result = await runTask('Explain what changed', { ...config, runId: 'followup' }, { session, adapterFactory: adapter([finish], later) });
  assert.equal(reviews(later).length, 0);
  assert.equal(result.contextDiagnostics.requirementReviewCount, 0);
  const disabled = [];
  await runTask('Change comment', { ...config, runId: 'disabled', requirementReview: false }, { adapterFactory: adapter([calls({ ...edit, input: { ...edit.input, search: '// changed', replace: '// original' } }, check), finish], disabled) });
  assert.equal(disabled.length, 2);
  assert.equal(reviews(disabled).length, 0);
}));

test('truncation and an exhausted tool allowance do not trigger review', async () => scenario(async (_, config) => {
  const truncated = [];
  const result = await runTask('Save output', config, { adapterFactory: adapter([calls(edit), { ...finish, stop_reason: 'max_tokens' }], truncated) });
  assert.equal(result.status, 'incomplete');
  assert.equal(reviews(truncated).length, 0);
  const exhausted = [];
  await runTask('Check results', { ...config, runId: 'exhausted', maxToolCalls: 2 }, { adapterFactory: adapter([calls({ ...edit, input: { ...edit.input, search: '// changed', replace: '// original' } }, check), finish], exhausted) });
  assert.equal(reviews(exhausted).length, 0);
}));

test('review prompt is bounded and does not convert claims into verification', () => {
  const text = requirementReviewMessage({ state: { pendingValidation: true }, operations: Array.from({ length: 100 }, () => ({ id: 'a'.repeat(1000), name: 'run_tests', subject: 'x'.repeat(10000) })), unresolved: Array(100).fill('x'.repeat(10000)), unavailable: 'x'.repeat(10000) });
  assert(text.length < 6500);
  const op = requirementReviewOperation({ id: 'i'.repeat(1000), name: 'n'.repeat(1000), input: { command: 'c'.repeat(10000) } }, true);
  assert.equal(op.id.length, 80); assert.equal(op.name.length, 32); assert.equal(op.subject.length, 180); assert.equal(op.isError, true);
  assert.match(text, /checklist alone does not establish coverage/);
  assert.match(text, /not proof of correct behavior/);
});

const integrationTest = `import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
test('real CLI produces a result inside a missing output directory',()=>{
 const temp=mkdtempSync(path.join(os.tmpdir(),'tea-observable-'));
 try {
  const entry=fileURLToPath(new URL('./app.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[entry,'nested/deeper/result.txt'],{cwd:temp,encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(path.join(temp,'nested/deeper/result.txt'),'utf8'),'saved');
 }finally{const rel=path.relative(os.tmpdir(),temp);assert(rel.startsWith('tea-observable-')&&!rel.includes(path.sep)&&!path.isAbsolute(rel));rmSync(temp,{recursive:true,force:true});}
});`;

test('scripted consumer demonstrates finding a masked defect, repairing it and revalidating', async () => scenario(async (root, config) => {
  const requests = [];
  const integration = { name: 'run_tests', input: { command: 'node --test observable.test.mjs' } };
  const repair = { name: 'apply_patch', input: { path: 'app.mjs', edits: [
    { search: "import { writeFileSync } from 'node:fs';", replace: "import { writeFileSync, mkdirSync } from 'node:fs';\nimport { dirname } from 'node:path';" },
    { search: 'writeFileSync(target, text);', replace: 'mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text);' },
  ] } };
  const result = await runTask('The CLI saves output at a user-selected path, creating needed parents.', config, {
    adapterFactory: adapter([
      calls(edit, check), finish,
      request => { assert.match(request.messages.at(-1).content, /test setup/); return calls({ name: 'write_file', input: { path: 'observable.test.mjs', content: integrationTest } }, integration); },
      calls(repair, integration, check), finish,
    ], requests),
  });
  assert.equal(reviews(requests).length, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.validationFailures.length, 0);
  assert.match(await readFile(path.join(root, 'app.mjs'), 'utf8'), /mkdirSync/);
  assert.equal(result.validationAttempts, 4);
  // These are actual child-process checks driven by scripted tool choices, not model accuracy evidence.
  const toolResults = requests.flatMap(r => r.messages.filter(m => m.role === 'user' && Array.isArray(m.content)).flatMap(m => m.content));
  assert(toolResults.some(t => t.type === 'tool_result' && t.is_error && String(t.content).includes('observable.test.mjs')));
}));


test('an edit made after review still needs fresh validation, without a review loop', async () => scenario(async (_, config) => {
  const requests = [];
  const extraEdit = { ...edit, input: { ...edit.input, search: '// changed', replace: '// reviewed' } };
  const result = await runTask('Save results', config, { adapterFactory: adapter([calls(edit, check), finish, calls(extraEdit), finish, finish, finish], requests) });
  assert.equal(reviews(requests).length, 1);
  assert.equal(result.status, 'needs_validation');
  assert.equal(result.validationPassed, false);
}));

test('persistent resume retains unresolved validation and still permits exactly one review', async () => scenario(async (_, config) => {
  const first = { ...config, sessionId: 'review-resume', runId: 'before-resume', maxToolCalls: 1 };
  await runTask('Save results', first, { adapterFactory: adapter([calls(edit)], []) });
  const requests = [];
  const result = await runTask('Continue the incomplete work', { ...config, resume: 'review-resume', runId: 'after-resume' }, {
    adapterFactory: adapter([finish, finish, finish], requests),
  });
  assert.equal(reviews(requests).length, 1);
  assert.equal(result.status, 'needs_validation');
  assert.equal(result.validationPassed, false);
}));

test('aborted turns and unknown billing never start review followups', async () => scenario(async (_, config) => {
  const session = createAgentSession(config), unknown = [];
  session.budgetUnknown = true; // Only an injected offline adapter may run in this state.
  const result = await runTask('Save results', config, { session, adapterFactory: adapter([calls(edit, check), finish], unknown) });
  assert.equal(result.contextDiagnostics.requirementReviewCount, 0);
  const controller = new AbortController(), requests = [];
  const aborted = await runTask('Change saving', { ...config, runId: 'aborted' }, {
    signal: controller.signal,
    adapterFactory: adapter([request => { controller.abort(); return finish; }], requests),
  });
  assert.equal(aborted.status, 'cancelled');
  assert.equal(reviews(requests).length, 0);
}));
