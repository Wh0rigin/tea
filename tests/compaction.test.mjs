import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compactConversation, prepareCompaction, requestBytes, sessionContext } from '../src/compaction.mjs';
import { compactAgentSession, createAgentSession, resetConversation, runTask } from '../src/agent.mjs';
import { loadConfig, loadCliConfig } from '../src/config.mjs';
import { AnthropicMessagesAdapter, buildMessagesRequest } from '../src/model.mjs';
import { TokenLedger } from '../src/ledger.mjs';
import { contextBudget } from '../src/context-budget.mjs';
import { ModelError } from '../src/model.mjs';

const headings = ['Goal', 'Constraints', 'Progress', 'Decisions', 'Next steps', 'Critical context'];
const summary = headings.map(h => `## ${h}\nKeep the API; read source and verify outstanding edits.`).join('\n');

test('summary planning respects Token capacity even when the wire guard is large', () => {
  const s = session(); s.messages[0].content = 'x'.repeat(30000);
  const plan = prepareCompaction(s, cfg({ maxRequestInputTokens: 2097152, contextWindowTokens: 8192,
    contextReserveTokens: 4096, compactionKeepRecentBytes: 600 }));
  assert.equal(plan.status, 'unavailable');
});
const done = (text = summary) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const cfg = overrides => ({ ...loadConfig({}, {}), maxRequestInputTokens: 64000, maxOutputTokens: 4096,
  compactionKeepRecentBytes: 600, stream: false, ...overrides });
function history() {
  return [{ role: 'user', content: 'Preserve the API and run tests. ' + 'old requirement '.repeat(100) },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'private thought', signature: 'signed' },
      { type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: 'value.mjs' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'old source '.repeat(1500) }] },
    { role: 'assistant', content: 'Continue carefully. ' + 'recent '.repeat(100) }];
}
function session() { return { messages: history(), compaction: null, compactionCount: 0, pendingValidation: true,
  validationPassed: false, validationAttempts: 2, changedFiles: ['value.mjs'], tools: {
    readEvidence: new Map([['read', 1]]), presentedSource: new Map([['source', 1]]), sessionTerms: new Map([['alias', 'real']]) } }; }
async function compact(s, config = cfg(), overrides = {}) {
  const events = [], requests = [];
  const outcome = await compactConversation(s, config, { system: 'coding', tools: [],
    adapter: { complete: async request => { requests.push(request); return done(); } },
    ledger: { event: async event => events.push(event) }, ...overrides });
  return { outcome, events, requests };
}
async function temporary(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-compaction-test-'));
  try { await callback(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function fakeFetch(fetch, callback) {
  const prior = globalThis.fetch; globalThis.fetch = fetch;
  try { await callback(); } finally { globalThis.fetch = prior; }
}
const liveConfig = overrides => cfg({ apiKey: 'test-only', baseUrl: 'https://unused.invalid', model: 'test',
  maxCostUsd: 1, inputRateUsdPerMillion: 1, outputRateUsdPerMillion: 1, thinkingMode: 'enabled',
  timeoutMs: 1000, ...overrides });

test('short histories do not submit a summary request', async () => {
  for (const messages of [[], [{ role: 'user', content: 'small' }],
    [{ role: 'user', content: 'small' }, { role: 'assistant', content: 'small' }]]) {
    const { requests, outcome } = await compact({ messages });
    assert.equal(requests.length, 0); assert.equal(outcome.status, 'not_needed');
  }
});

test('automatic compaction skips a nonreducing preview before calling the model', async () => {
  const { outcome, requests } = await compact(session(), cfg(), {
    reason: 'threshold', measureContext: async () => 1000,
  });
  assert.equal(outcome.status, 'not_needed'); assert.equal(requests.length, 0);
});
test('commits a smaller checkpoint without rewriting messages or retained thinking', async () => {
  const s = session();
  s.messages.at(-1).content = [{ type: 'thinking', thinking: 'retained thought', signature: 'recent-signature' },
    { type: 'text', text: 'recent '.repeat(150) }];
  const originals = [...s.messages], snapshot = structuredClone(s.messages);
  const { outcome, events, requests } = await compact(s);
  assert.equal(outcome.status, 'compacted'); assert.ok(outcome.afterBytes < outcome.beforeBytes);
  assert.deepEqual(s.messages, snapshot); originals.forEach((m, i) => assert.equal(s.messages[i], m));
  assert.equal(s.compaction.firstKeptIndex, 3); assert.equal(s.compactionCount, 1);
  assert.equal(sessionContext(s)[1], originals[3]);
  assert.equal(sessionContext(s)[1].content[0].signature, 'recent-signature');
  assert.equal(s.tools.readEvidence.size, 0); assert.equal(s.tools.presentedSource.size, 0);
  assert.equal(s.tools.sessionTerms.get('alias'), 'real'); assert.equal(s.pendingValidation, true);
  assert.equal(s.validationPassed, false); assert.equal(s.validationAttempts, 2);
  assert.deepEqual(s.changedFiles, ['value.mjs']);
  assert.match(requests[0].messages[0].content, /historical tool details omitted/);
  assert.doesNotMatch(requests[0].messages[0].content, /private thought|signed/);
  assert.equal(requests[0].maxTokens, 1200); assert.deepEqual(requests[0].tools, []);
  assert.equal(events[0].type, 'conversation_compaction'); assert.equal(events[0].summary, undefined);
  assert.deepEqual(s.compaction.attemptedReadFiles, ['value.mjs']);
});
test('latest covered user request is pinned verbatim with authoritative validation state', async () => {
  const s = session(); await compact(s);
  const context = sessionContext(s);
  assert.ok(context[0].content.includes(s.messages[0].content));
  assert.match(context[0].content, /"pendingValidation":true/);
  assert.match(context[0].content, /not current source or test evidence/);
  s.messages.push({ role: 'user', content: 'New exact requirement: 中文 🚀' });
  const updated = sessionContext(s);
  assert.doesNotMatch(updated[0].content, /Latest user request/);
  assert.equal(updated.at(-1), s.messages.at(-1));
});
test('tool batches remain indivisible across the retention boundary', async () => {
  const s = session();
  s.messages.pop();
  s.messages.splice(1, 0, { role: 'user', content: 'Current request must remain verbatim.' });
  const plan = prepareCompaction(s, cfg({ compactionKeepRecentBytes: 2000 }));
  assert.equal(plan.status, 'prepared'); assert.equal(plan.firstKeptIndex, 2);
  const { outcome } = await compact(s, cfg({ compactionKeepRecentBytes: 2000 }));
  assert.equal(outcome.status, 'compacted');
  assert.equal(sessionContext(s)[1], s.messages[2]); assert.equal(sessionContext(s)[2], s.messages[3]);
});
test('an oversized older batch does not force itself into the recent byte budget', async () => {
  const s = session(); s.messages.push({ role: 'user', content: 'Now repair the code and run tests.' });
  const config = cfg({ compactionKeepRecentBytes: 2000 });
  const plan = prepareCompaction(s, config);
  assert.equal(plan.status, 'prepared'); assert.equal(plan.firstKeptIndex, 3);
  const { outcome } = await compact(s, config);
  assert.equal(outcome.status, 'compacted'); assert.equal(sessionContext(s)[1], s.messages[3]);
  assert.equal(sessionContext(s)[2], s.messages[4]);
  assert.ok(Buffer.byteLength(JSON.stringify(s.messages.slice(plan.firstKeptIndex)), 'utf8') < 2000);
});
const malformed = {
  orphan: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'absent', content: 'no' }] }],
  unfinished: history().slice(0, 2),
  mismatched: history().map((m, i) => i === 2 ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'wrong', content: 'no' }] } : m),
  duplicate: [...history(), ...history().slice(1, 3)],
  duplicateResults: history().map((m, i) => i === 2 ? { ...m, content: [...m.content, ...m.content] } : m),
};
for (const [name, messages] of Object.entries(malformed)) test(`refuses ${name} tool history before any model call`, async () => {
  const { requests, outcome } = await compact({ messages });
  assert.equal(outcome.status, 'unavailable'); assert.equal(requests.length, 0);
});
test('repeated checkpoints integrate previous summary and only summarize newly covered history', async () => {
  const s = session(); await compact(s); const previous = s.compaction;
  s.messages.push({ role: 'user', content: 'NEW ONLY '.repeat(400) }, { role: 'assistant', content: 'tail '.repeat(150) });
  const { outcome, requests } = await compact(s);
  assert.equal(outcome.status, 'compacted'); assert.ok(s.compaction.firstKeptIndex > previous.firstKeptIndex);
  assert.equal(s.compaction.previousId, previous.id); assert.equal(s.compaction.coveredFrom, previous.firstKeptIndex);
  assert.ok(requests[0].messages[0].content.includes(previous.summary));
  assert.doesNotMatch(requests[0].messages[0].content, /old source|old requirement/);
  assert.match(requests[0].messages[0].content, /NEW ONLY/);
  assert.deepEqual(s.compaction.attemptedReadFiles, ['value.mjs']);
});
test('a limited summary request covers a complete partial prefix within the actual byte guard', () => {
  const s = session(); s.messages.splice(3, 0, { role: 'user', content: 'new large requirement '.repeat(400) });
  const config = cfg({ maxRequestInputTokens: 6000 }); const plan = prepareCompaction(s, config);
  assert.equal(plan.status, 'prepared'); assert.equal(plan.partial, true);
  assert.equal(plan.firstKeptIndex, 3); assert.ok(requestBytes(config, plan.request) <= 6000);
});
test('oversized ordinary user requirements are never truncated to fit', async () => {
  const s = session(); s.messages[0].content = 'Exact requirement 🚀 '.repeat(10000);
  const { outcome, requests } = await compact(s, cfg({ maxRequestInputTokens: 4000 }));
  assert.equal(outcome.status, 'unavailable'); assert.equal(requests.length, 0); assert.equal(s.compaction, null);
});
test('historical Unicode tool excerpts contain no broken UTF-8 characters', () => {
  const s = session();
  for (const text of ['🚀中文'.repeat(3000), '🚀'.repeat(3000) + 'x']) {
    s.messages[2].content[0].content = text;
    const plan = prepareCompaction(s, cfg());
    assert.equal(plan.status, 'prepared'); assert.doesNotMatch(plan.request.messages[0].content, /\uFFFD/);
  }
  // A valid literal replacement character is source data, not a broken boundary.
  s.messages[2].content[0].content = 'A'.repeat(997) + '\uFFFD' + 'B'.repeat(3000);
  assert.ok(prepareCompaction(s, cfg()).request.messages[0].content.includes('A'.repeat(997) + '\uFFFD'));
});
const invalid = {
  empty: done(''), missing: done(summary.replace('## Constraints', '## Other')),
  duplicate: done(summary + '\n## Goal\nDuplicate.'),
  unordered: done(headings.slice().reverse().map(h => `## ${h}\nBody`).join('\n')),
  emptySection: done(summary.replace('## Goal\nKeep the API; read source and verify outstanding edits.', '## Goal')),
  truncated: { ...done(), stop_reason: 'max_tokens' },
  toolUse: { ...done(), content: [...done().content, { type: 'tool_use', id: 'bad', name: 'read_file', input: {} }] },
};
for (const [name, response] of Object.entries(invalid)) test(`rejects ${name} summary without committing or clearing source evidence`, async () => {
  const s = session(); let called = 0;
  const { outcome, events } = await compact(s, cfg(), { adapter: { complete: async () => { called++; return response; } } });
  assert.equal(called, name === 'truncated' ? 2 : 1); assert.equal(outcome.status, 'unchanged'); assert.equal(s.compaction, null);
  assert.equal(s.tools.readEvidence.size, 1); assert.equal(events[0].type, 'compaction_rejected');
});

test('CLI summary budget leaves text room and a truncated checkpoint has one bounded repair', async () => {
  const defaults = loadCliConfig({}, { TEA_THINKING_MODE: 'enabled' });
  assert.equal(defaults.compactionMaxOutputTokens, 2048);
  assert.equal(defaults.compactionThinkingBudgetTokens, 1024);
  const s = session(); let calls = 0; const requests = [];
  const { outcome, events } = await compact(s, cfg({ thinkingMode: 'enabled', compactionMaxOutputTokens: 2048 }), {
    adapter: { complete: async request => {
      calls++; requests.push(request);
      return calls === 1 ? { ...done('partial'), stop_reason: 'max_tokens' } : done();
    } },
  });
  assert.equal(outcome.status, 'compacted'); assert.equal(calls, 2);
  assert.deepEqual(requests.map(r => [r.maxTokens, r.thinkingBudgetTokens]), [[2048, 1024], [4096, 1024]]);
  assert.equal(events.find(e => e.type === 'compaction_rejected').code, 'SUMMARY_TRUNCATED');
  assert.equal(events.filter(e => e.type === 'compaction_repair').length, 1);
});

test('summary planning rejects invalid independent budgets', () => {
  for (const env of [{ TEA_COMPACTION_MAX_OUTPUT_TOKENS: '0' },
    { TEA_COMPACTION_MAX_OUTPUT_TOKENS: '4097', TEA_MAX_OUTPUT_TOKENS: '4096' },
    { TEA_COMPACTION_THINKING_BUDGET_TOKENS: '1023' },
    { TEA_THINKING_MODE: 'enabled', TEA_COMPACTION_MAX_OUTPUT_TOKENS: '1024' }]) {
    assert.throws(() => loadConfig({}, env));
  }
});

test('unknown summary transport does not enter the checkpoint repair path', async () => {
  let calls = 0;
  const s = session();
  await assert.rejects(compact(s, cfg(), { adapter: { complete: async () => {
    calls++; throw new Error('unknown billed request');
  } } }), /unknown billed request/);
  assert.equal(calls, 1); assert.equal(s.compaction, null);
});
test('rejects a checkpoint that enlarges the actual projected coding request', async () => {
  const s = session();
  const { outcome } = await compact(s, cfg(), { measureContext: context => context === s.messages ? 100 : 200 });
  assert.equal(outcome.status, 'unchanged'); assert.equal(s.compaction, null);
});
test('ledger failure prevents checkpoint commit', async () => {
  const s = session();
  await assert.rejects(compact(s, cfg(), { ledger: { event: async () => { throw new Error('disk full'); } } }), /disk full/);
  assert.equal(s.compaction, null); assert.equal(s.tools.readEvidence.size, 1);
});
test('interruption after provider response prevents commit', async () => {
  const s = session(), controller = new AbortController();
  await assert.rejects(compact(s, cfg(), { signal: controller.signal,
    adapter: { complete: async () => { controller.abort(); return done(); } } }), /abort/i);
  assert.equal(s.compaction, null); assert.equal(s.tools.readEvidence.size, 1);
});
test('a completed ledger commit remains adopted when interruption arrives during its write', async () => {
  const s = session(), controller = new AbortController();
  const { outcome } = await compact(s, cfg(), { signal: controller.signal,
    ledger: { event: async () => { controller.abort(); } } });
  assert.equal(outcome.status, 'compacted'); assert.equal(s.compactionCount, 1);
  assert.equal(s.tools.readEvidence.size, 0);
});
test('request byte measurement includes exact provider controls', () => {
  const config = liveConfig(), request = { system: 's', tools: [], messages: history(), maxTokens: 1200 };
  assert.equal(requestBytes(config, request), Buffer.byteLength(JSON.stringify(buildMessagesRequest(config, request)), 'utf8'));
});
test('default configuration enables automatic compaction and rejects invalid limits', () => {
  assert.equal(loadConfig({}, {}).compaction, 'auto');
  for (const env of [{ TEA_COMPACTION: 'bad' }, { TEA_COMPACTION_TRIGGER_RATIO: '1' },
    { TEA_COMPACTION_KEEP_RECENT_BYTES: '0.5' }, { TEA_COMPACTION_MAX_PER_TURN: '9' }]) {
    assert.throws(() => loadConfig({}, env));
  }
});
test('provider ledger includes summary cache tokens and avoids doubling reasoning output', async () => temporary(async root => {
  const ledger = new TokenLedger({ workspace: root, runId: 'known', model: 'test' }); await ledger.init();
  await ledger.request({ requestId: 's', payload: {}, purpose: 'compaction', usage: {
    input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 7, reasoning_tokens: 4 } });
  await ledger.request({ requestId: 't', payload: {}, usage: { input_tokens: 3, output_tokens: 2 } });
  const result = await ledger.finish({ status: 'completed' });
  assert.equal(result.totalActualTokens, 47); assert.equal(result.compactionInputTokens, 35);
  assert.equal(result.compactionOutputTokens, 7); assert.equal(result.compactionRequests, 1);
}));
test('unknown summary usage remains null and preserves reported lower bounds', async () => temporary(async root => {
  const ledger = new TokenLedger({ workspace: root, runId: 'unknown', model: 'test' }); await ledger.init();
  await ledger.request({ requestId: 's', payload: {}, purpose: 'compaction', usage: { input_tokens: 10 } });
  const result = await ledger.finish({ status: 'failed' });
  assert.equal(result.totalActualTokens, null); assert.equal(result.compactionInputTokens, null);
  assert.equal(result.reportedCompactionInputTokens, 10); assert.equal(result.compactionUsageComplete, false);
}));
test('scripted summary usage cannot be presented as actual provider savings', async () => temporary(async root => {
  const ledger = new TokenLedger({ workspace: root, runId: 'scripted', model: 'test' }); await ledger.init({ usageSource: 'scripted' });
  await ledger.request({ requestId: 's', payload: {}, purpose: 'compaction', usage: { input_tokens: 10, output_tokens: 7 } });
  const result = await ledger.finish({ status: 'completed' });
  assert.equal(result.compactionInputTokens, null); assert.equal(result.totalActualTokens, null);
}));
test('rejected provider summary is still billed through the shared adapter and ledger', async () => temporary(async root => {
  const config = liveConfig(), s = session();
  const ledger = new TokenLedger({ workspace: root, runId: 'rejected', model: 'test' }); await ledger.init();
  await fakeFetch(async () => Response.json({ ...done('invalid'), usage: { input_tokens: 100, output_tokens: 20 } }), async () => {
    const adapter = new AnthropicMessagesAdapter(config); adapter.onRequest = e => ledger.request({ ...e, purpose: 'compaction' });
    const { outcome } = await compact(s, config, { adapter, ledger });
    assert.equal(outcome.status, 'unchanged'); assert.equal(adapter.spentUsd, 0.00012);
    const result = await ledger.finish({ status: outcome.status }); assert.equal(result.totalActualTokens, 120);
    assert.equal(result.compactionRequests, 1); assert.equal(result.compactionOutputTokens, 20);
  });
}));

test('a provider truncation repair accounts for both requests through the same ledger and cap', async () => temporary(async root => {
  const config = liveConfig({ compactionMaxOutputTokens: 2048 });
  const ledger = new TokenLedger({ workspace: root, runId: 'repair-billed', model: 'test' }); await ledger.init();
  let calls = 0;
  await fakeFetch(async () => Response.json(++calls === 1
    ? { ...done('partial'), stop_reason: 'max_tokens', usage: { input_tokens: 100, output_tokens: 2048 } }
    : { ...done(), usage: { input_tokens: 100, output_tokens: 200 } }), async () => {
    const adapter = new AnthropicMessagesAdapter(config); adapter.onRequest = e => ledger.request({ ...e, purpose: 'compaction' });
    const { outcome } = await compact(session(), config, { adapter, ledger });
    const result = await ledger.finish({ status: outcome.status });
    assert.equal(outcome.status, 'compacted'); assert.equal(calls, 2);
    assert.equal(result.compactionRequests, 2); assert.equal(result.totalActualTokens, 2448);
    assert.equal(result.providerUsageComplete, true); assert.ok(adapter.spentUsd < config.maxCostUsd);
  });
}));
test('summary and task share the hard budget; refused subsequent request has no network call', async () => {
  const config = liveConfig({ maxRequestInputTokens: 20000, maxCostUsd: 0.0415 }); let calls = 0;
  await fakeFetch(async () => { calls++; return Response.json({ ...done(), usage: { input_tokens: 1000, output_tokens: 1000 } }); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config); await compact(session(), config, { adapter });
    await assert.rejects(adapter.complete({ system: 'coding', tools: [], messages: history() }), /hard cost budget/);
    assert.equal(calls, 1); assert.equal(adapter.spentUsd, 0.002);
  });
});
test('unknown summary billing retains the reservation and prevents a silent retry', async () => {
  const config = liveConfig({ maxRequestInputTokens: 20000, maxCostUsd: 0.06 }); let calls = 0;
  await fakeFetch(async () => { calls++; throw new Error('transport lost'); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config), s = session();
    await assert.rejects(compact(s, config, { adapter }), /transport lost/);
    assert.equal(s.compaction, null); assert.ok(adapter.spentUsd >= 0.0412 - 1e-12);
    await assert.rejects(adapter.complete({ system: 'coding', tools: [], messages: history() }), /hard cost budget/);
    assert.equal(calls, 1);
  });
});
test('pre-cancelled real adapter does not submit or reserve a request', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await fakeFetch(async () => { calls++; throw new Error('unexpected'); }, async () => {
    const adapter = new AnthropicMessagesAdapter(liveConfig());
    await assert.rejects(compact(session(), liveConfig(), { adapter, signal: controller.signal }), /abort/i);
    assert.equal(calls, 0); assert.equal(adapter.spentUsd, 0);
  });
});
test('manual compaction keeps validation pending and /new keeps spending and outstanding edits', async () => temporary(async root => {
  const config = cfg({ workspace: root, runId: 'manual' }), s = createAgentSession(config);
  s.messages = history(); s.pendingValidation = true; s.changedFiles = ['value.mjs'];
  const adapter = { spentUsd: 0.25, complete: async () => done() };
  const result = await compactAgentSession(config, { session: s, adapterFactory: () => adapter });
  assert.equal(result.status, 'compacted'); assert.equal(result.validationPassed, false);
  assert.equal(s.pendingValidation, true); assert.equal(s.running, false);
  await resetConversation(s, config); assert.equal(s.messages.length, 0); assert.equal(s.compaction, null);
  assert.equal(s.adapter.spentUsd, 0.25); assert.equal(s.pendingValidation, true); assert.deepEqual(s.changedFiles, ['value.mjs']);
  s.running = true; assert.throws(() => resetConversation(s), /Stop/);
  await assert.rejects(compactAgentSession(config, { session: s }), /running turn/);
}));
test('automatic compaction is bounded across a task and never turns a summary into validation proof', async () => temporary(async root => {
  await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
  const config = cfg({ workspace: root, runId: 'auto', compaction: 'auto', compactionTriggerRatio: 0.01, compactionMaxPerTurn: 1 });
  const s = createAgentSession(config); s.messages = history(); s.pendingValidation = true; s.changedFiles = ['value.mjs'];
  let summaries = 0, tasks = 0;
  const result = await runTask('Continue and verify', config, { session: s, adapterFactory: () => ({ complete: async request => {
    if (!request.tools.length) { summaries++; return done(); } tasks++; return done('Finished.');
  } }) });
  assert.equal(summaries, 1); assert.equal(tasks, 3); assert.equal(result.status, 'needs_validation');
  assert.equal(result.validationPassed, false); assert.equal(s.pendingValidation, true);
}));

test('a nonreducing automatic summary is not retried after more tools in the same turn', async () => temporary(async root => {
  await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
  const config = cfg({ workspace: root, runId: 'backoff', compaction: 'auto', memoryGc: 'off',
    compactionTriggerRatio: 0.01, compactionMaxPerTurn: 8 });
  const s = createAgentSession(config); s.messages = history();
  let summaries = 0, tasks = 0;
  const result = await runTask('Inspect source', config, { session: s, adapterFactory: () => ({ complete: async request => {
    if (!request.tools.length) { summaries++; return done(headings.map(h => `## ${h}\n${'large summary '.repeat(600)}`).join('\n')); }
    tasks++;
    if (tasks <= 3) return { content: [{ type: 'tool_use', id: `backoff-${tasks}`, name: 'read_file', input: { path: 'value.mjs' } }], stop_reason: 'tool_use' };
    return done('Inspected.');
  } }) });
  assert.equal(result.status, 'completed'); assert.equal(summaries, 1);
  assert.equal(s.compactionCount, 0); assert.ok(s.autoCompactionBackoff.requestBytes > 0);
}));

test('failed automatic summary may recover after enough new history grows past cooldown', async () => temporary(async root => {
  await writeFile(path.join(root, 'big.mjs'), `export const text = "${'x'.repeat(18000)}";\n`);
  const config = cfg({ workspace: root, runId: 'cooldown-growth', compaction: 'auto', memoryGc: 'off',
    compactionTriggerRatio: 0.01, compactionMaxPerTurn: 2 });
  const s = createAgentSession(config); s.messages = history();
  let summaries = 0, tasks = 0;
  const result = await runTask('Inspect source', config, { session: s, adapterFactory: () => ({ complete: async request => {
    if (!request.tools.length) return ++summaries === 1 ? done('missing headings') : done();
    if (++tasks === 1) return { content: [{ type: 'tool_use', id: 'grow', name: 'read_file', input: { path: 'big.mjs' } }], stop_reason: 'tool_use' };
    return done('Inspected.');
  } }) });
  assert.equal(result.status, 'completed'); assert.equal(summaries, 2);
  assert.equal(s.compactionCount, 1);
}));

for (const recover of [true, false]) test(`hard context limit has one emergency attempt (${recover ? 'recovers' : 'stops with diagnostics'})`, async () => temporary(async root => {
  const config = cfg({ workspace: root, runId: `emergency-${recover}`, compaction: 'auto', memoryGc: 'off',
    contextWindowTokens: 12000, contextReserveTokens: 1024, compactionMaxPerTurn: 1 });
  const s = createAgentSession(config); s.messages = history();
  s.autoCompactionBackoff = { requestBytes: 1000000, residentBytes: 1000000 };
  let summaries = 0; const events = [];
  const result = await runTask('Inspect source', config, { session: s, onEvent: e => events.push(e),
    adapterFactory: () => ({ complete: async request => {
      if (!request.tools.length) { summaries++; return recover ? done() : done('invalid checkpoint'); }
      const budget = contextBudget(config, request);
      if (budget.estimatedInputTokens > budget.inputLimit) throw new ModelError('Local context limit', undefined,
        { code: 'MODEL_CONTEXT_LIMIT', submitted: false });
      return done('Inspected.');
    } }) });
  assert.equal(summaries, 1);
  assert.equal(events.filter(e => e.type === 'compaction_start' && e.reason === 'emergency').length, 1);
  assert.equal(result.status, recover ? 'completed' : 'failed');
  if (!recover) {
    assert.equal(result.error.code, 'MODEL_CONTEXT_LIMIT');
    assert.equal(result.error.budget.emergencyCompactions, 1);
  }
}));

test('unknown summary usage stops a transient session without emergency or silent retry', async () => temporary(async root => {
  const config = cfg({ workspace: root, runId: 'unknown-recovery', compaction: 'auto', compactionTriggerRatio: 0.01 });
  const s = createAgentSession(config); s.messages = history(); let calls = 0;
  const result = await runTask('Inspect source', config, { session: s, adapterFactory: () => ({ complete: async function () {
    calls++;
    await this.onRequest({ requestId: 'unknown', payload: {}, usage: {}, usageStatus: 'unknown', error: 'transport lost' });
    throw new ModelError('transport lost', undefined, { submitted: true });
  } }) });
  assert.equal(result.status, 'failed'); assert.equal(calls, 1); assert.equal(s.budgetUnknown, true);
  assert.equal(result.summary.unknownUsageRequests, 1);
}));
test('fresh reads after compaction return real source and actual tests can discharge pending validation', async () => temporary(async root => {
  await writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'value.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import {value} from './value.mjs'; test('value',()=>assert.equal(value,2));\n");
  const config = cfg({ workspace: root, runId: 'fresh', compaction: 'auto', compactionTriggerRatio: 0.2 });
  const s = createAgentSession(config); s.messages = history(); let task = 0;
  const calls = input => ({ content: input.map((call, i) => ({ type: 'tool_use', id: `call-${task}-${i}`, ...call })), stop_reason: 'tool_use' });
  const result = await runTask('Repair value', config, { session: s, adapterFactory: () => ({ complete: async request => {
    if (!request.tools.length) return done();
    task++;
    if (task === 1) return calls([{ name: 'read_file', input: { path: 'value.mjs' } }]);
    if (task === 2) {
      assert.match(JSON.stringify(request.messages.at(-1)), /export const value = 1/);
      return calls([{ name: 'apply_patch', input: { path: 'value.mjs', search: 'value = 1', replace: 'value = 2' } },
        { name: 'run_tests', input: { command: 'node --test value.test.mjs' } }]);
    }
    return done('Verified.');
  } }) });
  assert.equal(result.status, 'completed'); assert.equal(result.validationPassed, true);
  assert.equal(s.compactionCount, 1); assert.match(await readFile(path.join(root, 'value.mjs'), 'utf8'), /value = 2/);
}));
