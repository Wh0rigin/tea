import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCliConfig } from '../src/config.mjs';
import { contextBudget, fitOutputLimit, estimateContextTokens } from '../src/context-budget.mjs';
import { buildMessagesRequest } from '../src/model.mjs';
const env = { TEA_CONTEXT_WINDOW_TOKENS: '216000', TEA_MAX_OUTPUT_TOKENS: '131072' };
test('isolated output fitting preserves the old compression schedule and remains opt-in', () => {
 const baseline = loadCliConfig({ contextBudgetPolicy: 'reserved-output' }, env), candidate = loadCliConfig({ contextBudgetPolicy: 'reserved-output' }, { ...env, TEA_FIT_OUTPUT_BUDGET: '1' });
 const request = { messages: [{ role: 'user', content: 'x'.repeat(300000) }] };
 assert.equal(baseline.fitOutputBudget, false);
 assert.equal(contextBudget(baseline, request).triggerTokens, 64665);
 assert.equal(contextBudget(candidate, request).triggerTokens, 64665);
 assert.equal(contextBudget(candidate, request).inputLimit, 211904);
 const output = fitOutputLimit(candidate, request);
 assert.ok(output < 131072);
 assert.ok(output + estimateContextTokens(request) + candidate.contextReserveTokens <= 216000);
 assert.equal(buildMessagesRequest(candidate, request).max_tokens, output);
 assert.equal(candidate.compactionMaxPerTurn, 2);
 assert.equal(candidate.compactionKeepRecentBytes, 16000);
 assert.equal(candidate.contextReserveTokens, 4096);
 assert.equal(buildMessagesRequest(baseline, request).max_tokens, 131072);
});

test('all representative legacy-admissible task and summary requests are byte-identical', () => {
 const baseline = loadCliConfig({ contextBudgetPolicy: 'reserved-output' }, env), candidate = loadCliConfig({ contextBudgetPolicy: 'reserved-output' }, { ...env, TEA_FIT_OUTPUT_BUDGET: '1' });
 let checked = 0;
 for (const maxTokens of [131072, 13107]) for (const size of [0, 1000, 10000, 80000, 180000, 200000, 300000, 450000]) {
  const request = { system: 'system', tools: [], messages: [{ role: 'user', content: 'x'.repeat(size) }], maxTokens };
  const old = contextBudget(baseline, request);
  if (old.estimatedInputTokens <= old.inputLimit) {
   assert.equal(JSON.stringify(buildMessagesRequest(baseline, request)), JSON.stringify(buildMessagesRequest(candidate, request)));
   checked++;
  }
 }
 assert.ok(checked >= 10);
});

test('Pi defaults take precedence over the isolated legacy fitting flag', () => {
 const baseline = loadCliConfig({}, env);
 const candidate = loadCliConfig({}, { ...env, TEA_FIT_OUTPUT_BUDGET: '1' });
 const request = { messages: [{ role: 'user', content: 'x'.repeat(450000) }] };
 assert.equal(candidate.contextBudgetPolicy, 'pi');
 assert.equal(contextBudget(candidate, request).triggerTokens, 199616);
 assert.deepEqual(contextBudget(candidate, request), contextBudget(baseline, request));
 assert.equal(fitOutputLimit(candidate, request), fitOutputLimit(baseline, request));
 assert.equal(JSON.stringify(buildMessagesRequest(candidate, request)), JSON.stringify(buildMessagesRequest(baseline, request)));
 assert.equal(candidate.contextReserveTokens, 16384);
 assert.equal(candidate.compactionKeepRecentTokens, 20000);
 assert.equal(candidate.compactionMaxPerTurn, null);
 assert.equal(candidate.maxToolCalls, null);
});
