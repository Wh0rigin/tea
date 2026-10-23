import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicMessagesAdapter } from '../src/model.mjs';
import { loadCliConfig, loadPr16BenchmarkConfig } from '../src/config.mjs';
import { userConfigEnvironment } from '../src/user-config.mjs';

const event = (type, value) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const failedStream = () => new Response(event('message_start', { message: { usage: { input_tokens: 0, output_tokens: 0 } } }) + event('error', { error: { message: 'Internal Network Failure' } }));
const success = () => new Response(event('message_start', { message: { content: [], usage: { input_tokens: 10, output_tokens: 0 } } }) + event('content_block_start', { index: 0, content_block: { type: 'text', text: 'done' } }) + event('content_block_stop', { index: 0 }) + event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }) + event('message_stop', {}));
const config = (extra = {}) => ({ ...loadCliConfig({}, {}), contextWindowTokens: undefined, maxRequestInputTokens: 20000, maxOutputTokens: 1200, maxCostUsd: null, apiKey: 'test-only', baseUrl: 'https://unused.invalid', ...extra });
const request = { system: 'test', messages: [{ role: 'user', content: 'hello' }], tools: [] };
async function withFetch(fetcher, callback) { const previous = globalThis.fetch; globalThis.fetch = fetcher; try { await callback(); } finally { globalThis.fetch = previous; } }
const instant = { waitForRetry: async () => {} };

test('defaults to five retries; historical benchmark reconstruction keeps retries off', () => {
  assert.equal(loadCliConfig({}, {}).internalNetworkRetries, 5);
  assert.equal(loadPr16BenchmarkConfig().internalNetworkRetries, 0);
  assert.equal(loadCliConfig({}, userConfigEnvironment({ internalNetworkRetries: 0 })).internalNetworkRetries, 0);
  for (const value of [-1, 1.5, 6, NaN]) assert.throws(() => loadCliConfig({ internalNetworkRetries: value }, {}), /retries/);
});

test('five retries after the initial failure, identical payloads, distinct request IDs and retained reservations', async () => {
  let calls = 0; const payloads = [], rows = [], retries = [], waits = [];
  await withFetch(async (_, options) => { calls++; payloads.push(options.body); return failedStream(); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config({ inputRateUsdPerMillion: 1, outputRateUsdPerMillion: 1, maxCostUsd: 10 }), { waitForRetry: async ms => waits.push(ms) });
    adapter.onRequest = async e => rows.push(e); adapter.onRetry = async e => retries.push(e);
    await assert.rejects(adapter.complete(request), e => e.code === 'MODEL_INTERNAL_NETWORK_FAILURE');
    assert.equal(calls, 6); assert.equal(rows.length, 6); assert.equal(retries.length, 5);
    assert.equal(new Set(payloads).size, 1); assert.equal(new Set(rows.map(r => r.requestId)).size, 6);
    assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000]);
    assert(rows.every(r => r.usageStatus !== 'complete' && r.costBasis === 'full-preflight-reservation'));
    assert(Math.abs(adapter.spentUsd - rows.reduce((s, r) => s + r.estimatedUsd, 0)) < 1e-10);
  });
});

test('a successful retry returns only its response and retains failed-attempt accounting', async () => {
  let calls = 0; const rows = [];
  await withFetch(async () => ++calls === 1 ? failedStream() : success(), async () => {
    const adapter = new AnthropicMessagesAdapter(config(), instant); adapter.onRequest = async e => rows.push(e);
    const result = await adapter.complete(request);
    assert.equal(result.content[0].text, 'done'); assert.equal(calls, 2);
    assert.equal(rows[0].usageStatus, 'partial'); assert.equal(rows[1].usageStatus, 'complete');
    assert.deepEqual(rows[1].recoveredRequestIds, [rows[0].requestId]);
    assert.equal(rows[1].retryAttempt, 1);
  });
});

test('disable flag, authentication errors, other SSE errors and plain truncated streams are not retried', async () => {
  for (const [overrides, response, pattern] of [
    [{ internalNetworkRetries: 0 }, failedStream, /Internal Network Failure/],
    [{}, () => new Response(JSON.stringify({ error: { message: 'Internal Network Failure' } }), { status: 401 }), /HTTP 401/],
    [{}, () => new Response(event('error', { error: { message: 'Other failure' } })), /Other failure/],
    [{}, () => new Response(event('message_start', { message: { usage: { input_tokens: 1 } } })), /message_stop/],
  ]) {
    let calls = 0;
    await withFetch(async () => { calls++; return response(); }, async () => {
      await assert.rejects(new AnthropicMessagesAdapter(config(overrides), instant).complete(request), pattern); assert.equal(calls, 1);
    });
  }
});

test('explicit internal network errors in HTTP5xx and JSON success envelopes are supported', async () => {
  for (const response of [
    () => new Response(JSON.stringify({ error: { message: 'Internal Network Failure' } }), { status: 503 }),
    () => new Response(JSON.stringify({ error: { message: 'Internal Network Failure' } })),
  ]) {
    let calls = 0;
    await withFetch(async () => ++calls === 1 ? response() : new Response(JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 1 } })), async () => {
      await new AnthropicMessagesAdapter(config({ stream: false }), instant).complete(request); assert.equal(calls, 2);
    });
  }
});

test('abort during backoff prevents a new submission and the concurrency lock covers waiting', async () => {
  const controller = new AbortController(); let entered, release; const waiting = new Promise(r => { entered = r; });
  let calls = 0;
  await withFetch(async () => { calls++; return failedStream(); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config(), { waitForRetry: async (_, signal) => { entered(); await new Promise(r => { release = r; }); signal.throwIfAborted(); } });
    const pending = adapter.complete({ ...request, signal: controller.signal }); await waiting;
    await assert.rejects(adapter.complete(request), /Concurrent requests/);
    controller.abort(); release(); await assert.rejects(pending, /abort/i); assert.equal(calls, 1);
    assert.equal(adapter.completionInFlight, false);
  });
});

test('retained reservation can stop retries before the sixth attempt when an explicit cap is exhausted', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return failedStream(); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config({ maxCostUsd: 0.05, inputRateUsdPerMillion: 1, outputRateUsdPerMillion: 1 }), instant);
    await assert.rejects(adapter.complete(request), e => e.code === 'MODEL_COST_LIMIT'); assert.equal(calls, 1);
  });
});

test('callback failures cannot cause another network request', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return failedStream(); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config(), instant); adapter.onRetry = async () => { throw new Error('journal unavailable'); };
    await assert.rejects(adapter.complete(request), /journal unavailable/); assert.equal(calls, 1);
  });
});
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runTask, createAgentSession } from '../src/agent.mjs';
import { attachSessionJournal, closeSessionJournal } from '../src/session-memory.mjs';

const toolReply = (name, input, id) => new Response(event('message_start', { message: { usage: { input_tokens: 10, output_tokens: 0 } } }) + event('content_block_start', { index: 0, content_block: { type: 'tool_use', id, name, input } }) + event('content_block_stop', { index: 0 }) + event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } }) + event('message_stop', {}));
async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-retry-'));
  try { await callback(root); }
  finally { const relative = path.relative(os.tmpdir(), root); assert(relative.startsWith('tea-retry-') && !relative.includes(path.sep) && !path.isAbsolute(relative)); await rm(root, { recursive: true, force: true }); }
}

test('agent continues after recovery, never executes failed-stream tools, and journals unknown usage honestly', async () => fixture(async root => {
  await writeFile(path.join(root, 'output.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('saved',()=>assert.equal(readFileSync('good.txt','utf8'),'saved'));\n");
  const cfg = config({ workspace: root, sessionId: 'recover', runId: 'first', compaction: 'off' });
  const session = createAgentSession(cfg), events = []; let calls = 0;
  await withFetch(async () => {
    calls++;
    if (calls === 1) return new Response(event('message_start', { message: { usage: { input_tokens: 0, output_tokens: 0 } } }) + event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'never-execute', name: 'write_file', input: { path: 'bad.txt', content: 'discarded' } } }) + event('error', { error: { message: 'Internal Network Failure' } }));
    if (calls === 2) return toolReply('write_file', { path: 'good.txt', content: 'saved' }, 'write');
    if (calls === 3) return toolReply('run_tests', { command: 'node --test output.test.mjs' }, 'verify');
    return success();
  }, async () => {
    const result = await runTask('Save and validate a result', cfg, { session, adapterFactory: c => new AnthropicMessagesAdapter(c, instant), onEvent: e => events.push(e) });
    assert.equal(result.status, 'completed'); assert.equal(result.validationPassed, true); assert.equal(calls, 4);
    assert.equal(result.summary.usageComplete, false); assert.equal(result.summary.requests, 4);
    assert.equal(result.summary.totalActualTokens, null); assert.equal(session.budgetUnknown, false);
    await assert.rejects(access(path.join(root, 'bad.txt'))); assert.equal(await readFile(path.join(root, 'good.txt'), 'utf8'), 'saved');
    assert.equal(events.filter(e => e.type === 'model_retry').length, 1);
    const rows = (await readFile(path.join(result.runDirectory, 'ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).filter(e => e.type === 'model_request');
    assert.equal(rows[0].usageComplete, false); assert.deepEqual(rows[1].recoveredRequestIds, [rows[0].requestId]);
  });
  const resume = { ...cfg, sessionId: undefined, resume: 'recover', runId: 'restore' }, restored = createAgentSession(resume);
  await attachSessionJournal(restored, resume);
  try { assert.equal(restored.budgetUnknown, false); assert.equal(restored.restoredBudget.costKnown, false); }
  finally { await closeSessionJournal(restored); }
}));

test('six failures leave a durable recovery block; resume cannot restart the retry allowance', async () => fixture(async root => {
  const cfg = config({ workspace: root, sessionId: 'failed', runId: 'failed-turn', compaction: 'off' }); let calls = 0;
  await withFetch(async () => { calls++; return failedStream(); }, async () => {
    const result = await runTask('Explain the project', cfg, { adapterFactory: c => new AnthropicMessagesAdapter(c, instant) });
    assert.equal(result.status, 'failed'); assert.equal(calls, 6); assert.equal(result.summary.requests, 6);
    const resumedConfig = { ...cfg, sessionId: undefined, resume: 'failed', runId: 'must-not-submit' };
    await assert.rejects(runTask('Continue', resumedConfig), /unresolved billing/); assert.equal(calls, 6);
  });
}));
