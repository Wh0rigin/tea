import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCliConfig, loadConfig } from '../src/config.mjs';
import { contextBudget, fitOutputLimit, estimateContextTokens } from '../src/context-budget.mjs';
import { buildMessagesRequest, AnthropicMessagesAdapter } from '../src/model.mjs';
import { userConfigEnvironment } from '../src/user-config.mjs';
import { runTask } from '../src/agent.mjs';

const configured = (env = {}) => loadCliConfig({}, { TEA_CONTEXT_WINDOW_TOKENS: '216000', TEA_MAX_OUTPUT_TOKENS: '131072', ...env });

test('Pi policy reaches window minus reserve without reserving the full output cap', () => {
  const c = configured(), budget = contextBudget(c, { messages: [] });
  assert.equal(c.contextBudgetPolicy, 'pi');
  assert.equal(c.contextReserveTokens, 16384);
  assert.equal(budget.inputLimit, 199616); assert.equal(budget.triggerTokens, 199616);
  assert.equal(c.compactionKeepRecentTokens, 20000);
  assert.equal(c.maxToolCalls, null); assert.equal(c.compactionMaxPerTurn, null);
  assert.equal(loadConfig({}, {}).contextBudgetPolicy, 'reserved-output');
});

test('per-request output fits remaining estimated capacity and preserves explicit ceilings', () => {
  const c = configured(), request = { messages: [{ role: 'user', content: 'x'.repeat(400000) }] };
  const limit = fitOutputLimit(c, request);
  assert.ok(limit < 131072 && limit > 16384);
  assert.ok(limit + estimateContextTokens(request) <= c.contextWindowTokens);
  assert.equal(buildMessagesRequest(c, request).max_tokens, limit);
  assert.equal(fitOutputLimit(c, { ...request, maxTokens: 2000 }), 2000);
  assert.equal(fitOutputLimit(c, { messages: [] }), 131072);
});

test('explicit caps, legacy retention and user configuration remain available', () => {
  const c = configured({ TEA_MAX_TOOL_CALLS: '7', TEA_COMPACTION_MAX_PER_TURN: '3', TEA_COMPACTION_KEEP_RECENT_BYTES: '16000' });
  assert.equal(c.maxToolCalls, 7); assert.equal(c.compactionMaxPerTurn, 3);
  assert.equal(c.compactionKeepRecentTokens, undefined);
  const env = userConfigEnvironment({ contextBudgetPolicy: 'pi', compactionKeepRecentTokens: 20000, compactionReserveTokens: 16384 });
  assert.equal(env.TEA_COMPACTION_KEEP_RECENT_TOKENS, '20000');
  assert.equal(env.TEA_COMPACTION_RESERVE_TOKENS, '16384');
  assert.equal(loadCliConfig({}, {}).compactionKeepRecentTokens, 8192);
});

async function temporary(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-pi-budget-'));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('daily policy executes more than 24 tools without a default tool stop', () => temporary(async root => {
  let calls = 0;
  const config = loadCliConfig({ workspace: root }, {});
  const result = await runTask('Inspect the workspace.', config, { adapterFactory: () => ({ complete: async () => ++calls <= 26
    ? { content: [{ type: 'tool_use', id: `list-${calls}`, name: 'list_files', input: {} }], stop_reason: 'tool_use' }
    : { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' } }) });
  assert.equal(result.status, 'completed'); assert.equal(calls, 27);
}));

test('growing histories can compact successfully more than twice in one task', () => temporary(async root => {
  await writeFile(path.join(root, 'source.txt'), 'source line abcdefghijklmnopqrstuvwxyz\n'.repeat(350));
  const config = loadCliConfig({ workspace: root, contextBudgetPolicy: 'pi', contextWindowTokens: 12000,
    contextReserveTokens: 1024, compactionKeepRecentTokens: 500, contextStrategy: 'baseline', memoryPolicy: 'full-history' }, {});
  let taskCalls = 0, summaries = 0;
  const events = [];
  const summary = ['Goal', 'Constraints', 'Progress', 'Decisions', 'Next steps', 'Critical context'].map(h => `## ${h}\nContinue reading current source.`).join('\n');
  const result = await runTask('Inspect source.', config, { onEvent: e => events.push(e), adapterFactory: () => ({ complete: async request => {
    if (!request.tools.length) { summaries++; return { content: [{ type: 'text', text: summary }], stop_reason: 'end_turn' }; }
    taskCalls++;
    return taskCalls <= 8
      ? { content: [{ type: 'tool_use', id: `read-${taskCalls}`, name: 'read_file', input: { path: 'source.txt' } }], stop_reason: 'tool_use' }
      : { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' };
  } }) });
  assert.equal(result.status, 'completed');
  assert.ok(events.filter(e => e.type === 'compaction_end' && e.status === 'compacted').length >= 3);
  assert.ok(summaries >= 3);
}));


test('live adapter serializes the fitted ceiling and rejects invalid overrides before fetch', async () => {
  const config = { ...configured(), apiKey: 'test-only', stream: false };
  const messages = [{ role: 'user', content: 'x'.repeat(400000) }];
  const prior = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, fitOutputLimit(config, { messages, tools: [], system: '' }));
    assert.ok(body.max_tokens < 131072);
    return Response.json({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 1 } });
  };
  try {
    const adapter = new AnthropicMessagesAdapter(config);
    await assert.rejects(adapter.complete({ messages, maxTokens: Infinity }), /positive integer|cap/);
    assert.equal(calls, 0);
    await assert.rejects(adapter.complete({ messages: [{ role: 'user', content: 'x'.repeat(600000) }], system: '', tools: [] }), error => error.code === 'MODEL_CONTEXT_LIMIT' && error.submitted === false);
    assert.equal(calls, 0);
    await adapter.complete({ messages, system: '', tools: [] });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = prior; }
});
