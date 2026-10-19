import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicMessagesAdapter, ModelError } from '../src/model.mjs';

function event(type, value) { return `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`; }

test('Token window blocks before submission independently of bytes and calibrates cached input', async () => {
  const previousFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn',
    usage: { input_tokens: 1000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1000, output_tokens: 1 } }), { status: 200 }); };
  try {
    const adapter = new AnthropicMessagesAdapter({ apiKey: 'test-only', baseUrl: 'https://unused.invalid', model: 'test',
      apiVersion: '2023-06-01', maxOutputTokens: 1200, maxRequestInputTokens: 2097152, maxCostUsd: null,
      contextWindowTokens: 10000, contextReserveTokens: 1000, compactionTriggerRatio: 0.8,
      thinkingMode: 'adaptive', effort: 'low', stream: false, timeoutMs: 1000 });
    await assert.rejects(adapter.complete({ messages: [{ role: 'user', content: 'x'.repeat(50000) }] }), /model context budget/);
    assert.equal(calls, 0);
    await adapter.complete({ messages: [{ role: 'user', content: 'small' }] });
    assert.equal(calls, 1); assert.equal(adapter.actualInputTokens, 4000);
    assert.ok(adapter.contextTokenScale > 1);
  } finally { globalThis.fetch = previousFetch; }
});

test('parses streamed tool calls, usage, and the message_stop terminal event', async () => {
  const previousFetch = globalThis.fetch;
  const stream = [
    event('message_start', { type: 'message_start', message: { id: 'msg_test', role: 'assistant', model: 'glm-test', content: [], usage: { input_tokens: 23 } } }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'read_file', input: {} } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"src.js"}' } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } }),
    event('message_stop', { type: 'message_stop' }),
  ].join('');
  globalThis.fetch = async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  try {
    const adapter = new AnthropicMessagesAdapter({
      apiKey: 'test-only', baseUrl: 'https://unused.invalid', model: 'glm-test', apiVersion: '2023-06-01',
      maxOutputTokens: 500, maxRequestInputTokens: 20_000, maxCostUsd: 1,
      inputRateUsdPerMillion: 1, outputRateUsdPerMillion: 1, timeoutMs: 1000,
      effort: 'low', thinkingMode: 'adaptive', stream: true,
    });
    const result = await adapter.complete({ system: 'test', messages: [{ role: 'user', content: 'read this' }], tools: [] });
    assert.equal(result.stop_reason, 'tool_use');
    assert.deepEqual(result.content[0].input, { path: 'src.js' });
    assert.equal(result.usage.input_tokens, 23);
    assert.equal(result.usage.output_tokens, 12);
  } finally { globalThis.fetch = previousFetch; }
});

test('rejects a stream that lacks an explicit terminal event', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(event('message_start', { type: 'message_start', message: { content: [], usage: {} } }), { status: 200 });
  try {
    const adapter = new AnthropicMessagesAdapter({
      apiKey: 'test-only', baseUrl: 'https://unused.invalid', model: 'glm-test', apiVersion: '2023-06-01',
      maxOutputTokens: 500, maxRequestInputTokens: 20_000, maxCostUsd: 1,
      inputRateUsdPerMillion: 1, outputRateUsdPerMillion: 1, timeoutMs: 1000,
      effort: 'low', thinkingMode: 'adaptive', stream: true,
    });
    await assert.rejects(adapter.complete({ system: 'test', messages: [{ role: 'user', content: 'read this' }], tools: [] }), /message_stop/);
  } finally { globalThis.fetch = previousFetch; }
});

test('preflights the configured worst-case request cost before network access', async () => {
  const previousFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not be called'); };
  try {
    const adapter = new AnthropicMessagesAdapter({
      apiKey: 'test-only', baseUrl: 'https://unused.invalid', model: 'glm-test', apiVersion: '2023-06-01',
      maxOutputTokens: 1000, maxRequestInputTokens: 10000, maxCostUsd: 0.0001,
      inputRateUsdPerMillion: 1, outputRateUsdPerMillion: 1, timeoutMs: 1000,
      effort: 'low', thinkingMode: 'adaptive', stream: false,
    });
    await assert.rejects(adapter.complete({ system: 'test', messages: [{ role: 'user', content: 'small' }], tools: [] }), /hard cost budget/);
    assert.equal(called, false);
  } finally { globalThis.fetch = previousFetch; }
});

function config(overrides = {}) {
  return {
    apiKey: 'test-only', baseUrl: 'https://unused.invalid', model: 'glm-test', apiVersion: '2023-06-01',
    maxOutputTokens: 500, maxRequestInputTokens: 20_000, maxCostUsd: 1,
    inputRateUsdPerMillion: 1, outputRateUsdPerMillion: 1, timeoutMs: 1000,
    effort: 'low', thinkingMode: 'adaptive', stream: false, ...overrides,
  };
}
const request = { system: 'test', messages: [{ role: 'user', content: 'read this' }], tools: [] };
async function withFetch(fakeFetch, callback) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try { await callback(); } finally { globalThis.fetch = previousFetch; }
}
function jsonResponse(usage) {
  return Response.json({ content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage });
}

test('manual thinking budget follows each request output cap and leaves final-response room', async () => {
  const bodies = [];
  await withFetch(async (_url, options) => { bodies.push(JSON.parse(options.body)); return jsonResponse({ input_tokens: 3, output_tokens: 2 }); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config({ thinkingMode: 'enabled', maxOutputTokens: 12000 }));
    await adapter.complete({ ...request, maxTokens: 1100 });
    await adapter.complete({ ...request, maxTokens: 1025 });
    await adapter.complete(request);
    assert.deepEqual(bodies.map(body => [body.max_tokens, body.thinking.budget_tokens]), [[1100, 1099], [1025, 1024], [12000, 8000]]);
    assert.equal(adapter.config.maxOutputTokens, 12000);
    assert.equal(adapter.config.effort, 'low');
  });
});

test('summary thinking overrides reserve text space without changing the coding budget', async () => {
  const bodies = [];
  await withFetch(async (_url, options) => { bodies.push(JSON.parse(options.body)); return jsonResponse({ input_tokens: 3, output_tokens: 2 }); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config({ thinkingMode: 'enabled', maxOutputTokens: 4096 }));
    await adapter.complete({ ...request, maxTokens: 2048, thinkingBudgetTokens: 1024 });
    await adapter.complete(request);
    assert.deepEqual(bodies.map(b => [b.max_tokens, b.thinking.budget_tokens]), [[2048, 1024], [4096, 4095]]);
    for (const thinkingBudgetTokens of [0, 1023, 2048, 1024.5, '1024']) {
      await assert.rejects(adapter.complete({ ...request, maxTokens: 2048, thinkingBudgetTokens }), /thinking budget/);
    }
    assert.equal(bodies.length, 2);
  });
});

test('invalid output overrides and unsupported thinking are blocked without a request or reservation', async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; throw new Error('must not call'); }, async () => {
    for (const maxTokens of [0, null, -1, NaN, Infinity, 1.2, '100', 501]) {
      const adapter = new AnthropicMessagesAdapter(config());
      await assert.rejects(adapter.complete({ ...request, maxTokens }), /positive integer|configured.*cap/);
      assert.equal(adapter.spentUsd, 0);
      assert.equal(adapter.spentInputBound, 0);
    }
    for (const maxTokens of [1, 500, 1024]) {
      const adapter = new AnthropicMessagesAdapter(config({ thinkingMode: 'enabled', maxOutputTokens: 1200 }));
      await assert.rejects(adapter.complete({ ...request, maxTokens }), /greater than 1024/);
      assert.equal(adapter.spentUsd, 0);
    }
    await assert.rejects(new AnthropicMessagesAdapter(config({ thinkingMode: 'off' })).complete(request), /thinking mode/);
    await assert.rejects(new AnthropicMessagesAdapter(config({ effort: 'off' })).complete(request), /reasoning effort/);
    assert.equal(calls, 0);
  });
});

test('dynamic output limit still reserves its full possible cost before network access', async () => {
  await withFetch(async () => { throw new Error('must not call'); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config({ maxOutputTokens: 12000, maxCostUsd: 0.0405 }));
    await assert.rejects(adapter.complete({ ...request, maxTokens: 1000 }), /hard cost budget/);
    assert.equal(adapter.spentUsd, 0);
  });
});

test('preserves Chinese split at every UTF-8 byte and consumes a final event without a newline', async () => {
  const stream = [
    event('message_start', { type: 'message_start', message: { role: 'assistant', usage: { input_tokens: 8 } } }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '修复完成，😀' } }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }),
    event('message_stop', { type: 'message_stop' }).trimEnd(),
  ].join('');
  await withFetch(async () => new Response(new ReadableStream({ start(controller) {
    for (const byte of Buffer.from(stream, 'utf8')) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } })), async () => {
    const result = await new AnthropicMessagesAdapter(config({ stream: true })).complete(request);
    assert.equal(result.content[0].text, '修复完成，😀');
    assert.equal(result.usage.output_tokens, 4);
  });
});

test('includes cache reads and writes in input totals, budgets, and conservative charges', async () => {
  await withFetch(async () => jsonResponse({ input_tokens: 5, cache_read_input_tokens: 30, cache_creation_input_tokens: 10, output_tokens: 7 }), async () => {
    const adapter = new AnthropicMessagesAdapter(config({ inputRateUsdPerMillion: 2, outputRateUsdPerMillion: 3 }));
    const rows = [];
    adapter.onRequest = (row) => rows.push(row);
    await adapter.complete(request);
    assert.equal(adapter.actualInputTokens, 45);
    assert.ok(Math.abs(adapter.spentUsd - 131 / 1_000_000) < 1e-12);
    assert.equal(rows[0].usageStatus, 'complete');
    assert.equal(rows[0].costBasis, 'conservative-reported-usage');
  });
});

test('cached input cannot bypass the actual input cap', async () => {
  await withFetch(async () => jsonResponse({ input_tokens: 5, cache_read_input_tokens: 1000, output_tokens: 7 }), async () => {
    const adapter = new AnthropicMessagesAdapter(config({ maxInputTokens: 1000 }));
    await assert.rejects(adapter.complete(request), /input token total exceeded/);
    assert.equal(adapter.actualInputTokens, 1005);
  });
});

test('missing usage is unknown rather than zero and retains the full reservation', async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; return jsonResponse(undefined); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config({ maxCostUsd: 0.041 }));
    const rows = [];
    adapter.onRequest = (row) => rows.push(row);
    await assert.rejects(adapter.complete(request), /usage is missing/);
    assert.equal(adapter.spentUsd, 0.0405);
    assert.equal(rows[0].usageStatus, 'missing');
    assert.equal(rows[0].costBasis, 'full-preflight-reservation');
    assert.equal(adapter.actualInputTokens, 0);
    await assert.rejects(adapter.complete(request), /hard cost budget/);
    assert.equal(calls, 1);
  });
});

test('rejects invalid usage counters but accepts explicitly reported zero usage', async () => {
  for (const usage of [
    { input_tokens: '8', output_tokens: 2 }, { input_tokens: -1, output_tokens: 2 },
    { input_tokens: null, output_tokens: 2 }, { input_tokens: 1.5, output_tokens: 2 },
    { input_tokens: 8, output_tokens: 2, cache_read_input_tokens: -1 },
  ]) {
    await withFetch(async () => jsonResponse(usage), async () => {
      const adapter = new AnthropicMessagesAdapter(config());
      await assert.rejects(adapter.complete(request), /usage is invalid/);
      assert.equal(adapter.spentUsd, 0.0405);
    });
  }
  await withFetch(async () => jsonResponse({ input_tokens: 0, output_tokens: 0 }), async () => {
    const adapter = new AnthropicMessagesAdapter(config());
    await adapter.complete(request);
    assert.equal(adapter.spentUsd, 0);
  });
});

test('an interrupted stream retains reported usage as partial evidence', async () => {
  const stream = event('message_start', { type: 'message_start', message: { usage: { input_tokens: 23, output_tokens: 0 } } });
  await withFetch(async () => new Response(stream), async () => {
    const adapter = new AnthropicMessagesAdapter(config({ stream: true }));
    const rows = [];
    adapter.onRequest = (row) => rows.push(row);
    await assert.rejects(adapter.complete(request), /message_stop/);
    assert.deepEqual(rows[0].usage, { input_tokens: 23, output_tokens: 0 });
    assert.equal(rows[0].usageStatus, 'partial');
    assert.equal(rows[0].estimatedUsd, 0.0405);
  });
});

test('transport failures record unknown usage and redact error credentials', async () => {
  await withFetch(async () => { throw new Error('x-api-key: test-password'); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config());
    const rows = [];
    adapter.onRequest = (row) => rows.push(row);
    await assert.rejects(adapter.complete(request), /\[REDACTED\]/);
    assert.equal(rows[0].usageStatus, 'unknown');
    assert.doesNotMatch(rows[0].error, /test-password/);
    assert.equal(adapter.spentUsd, 0.0405);
  });
});

test('a failed tool JSON response still accounts for complete provider usage after message_stop', async () => {
  const stream = [
    event('message_start', { type: 'message_start', message: { usage: { input_tokens: 23 } } }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'read_file', input: {} } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{broken' } }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } }),
    event('message_stop', { type: 'message_stop' }),
  ].join('');
  await withFetch(async () => new Response(stream), async () => {
    const adapter = new AnthropicMessagesAdapter(config({ stream: true }));
    const rows = [];
    adapter.onRequest = (row) => rows.push(row);
    await assert.rejects(adapter.complete(request), /malformed JSON for tool/);
    assert.equal(rows[0].usageStatus, 'complete');
    assert.equal(rows[0].costBasis, 'conservative-reported-usage');
    assert.equal(rows[0].estimatedUsd, 35 / 1_000_000);
    assert.equal(adapter.actualInputTokens, 23);
  });
});

test('cache-write worst-case reservation is checked before network access', async () => {
  let called = false;
  await withFetch(async () => { called = true; return jsonResponse({ input_tokens: 1, output_tokens: 1 }); }, async () => {
    // Base-rate reservation would fit ($0.0205); a cache-write reservation does not ($0.0405).
    const adapter = new AnthropicMessagesAdapter(config({ maxCostUsd: 0.03 }));
    await assert.rejects(adapter.complete(request), /hard cost budget/);
    assert.equal(called, false);
  });
});

test('per-request provider limits cannot be bypassed by a lower actual cost', async () => {
  await withFetch(async () => jsonResponse({ input_tokens: 20_001, output_tokens: 0 }), async () => {
    const adapter = new AnthropicMessagesAdapter(config());
    const rows = [];
    adapter.onRequest = (row) => rows.push(row);
    await assert.rejects(adapter.complete(request), /per-request token limits/);
    assert.equal(rows[0].usageStatus, 'complete');
    assert.equal(adapter.actualInputTokens, 20_001);
  });
});

test('cumulative streaming usage is merged without adding each delta', async () => {
  const stream = [
    event('message_start', { type: 'message_start', message: { usage: { input_tokens: 5, cache_creation_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 } } } }),
    event('message_delta', { type: 'message_delta', usage: { output_tokens: 2 } }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }),
    event('message_stop', { type: 'message_stop' }),
  ].join('');
  await withFetch(async () => new Response(stream), async () => {
    const adapter = new AnthropicMessagesAdapter(config({ stream: true }));
    const result = await adapter.complete(request);
    assert.equal(result.usage.output_tokens, 7);
    assert.equal(adapter.actualInputTokens, 15);
    assert.equal(adapter.spentUsd, 32 / 1_000_000);
  });
});

test('invalid or missing cost configuration never reaches the network', async () => {
  for (const overrides of [
    { inputRateUsdPerMillion: undefined }, { outputRateUsdPerMillion: NaN },
    { maxCostUsd: Infinity }, { maxCostUsd: 0 }, { maxRequestInputTokens: 0 },
  ]) {
    let called = false;
    await withFetch(async () => { called = true; return jsonResponse({ input_tokens: 0, output_tokens: 0 }); }, async () => {
      await assert.rejects(new AnthropicMessagesAdapter(config(overrides)).complete(request), /Live requests require/);
      assert.equal(called, false);
    });
  }
});

test('rejects overlapping requests before they can bypass a shared adapter cost cap', async () => {
  let release;
  let calls = 0;
  const waiting = new Promise((resolve) => { release = resolve; });
  await withFetch(async () => { calls += 1; await waiting; return jsonResponse({ input_tokens: 1, output_tokens: 1 }); }, async () => {
    const adapter = new AnthropicMessagesAdapter(config());
    const first = adapter.complete(request);
    await assert.rejects(adapter.complete(request), /Concurrent requests are blocked/);
    release();
    await first;
    assert.equal(calls, 1);
    assert.equal(adapter.requestInFlight, false);
  });
});

test('a relay cannot omit the aggregate cache-write field while reporting nonzero write details', async () => {
  await withFetch(async () => jsonResponse({ input_tokens: 5, output_tokens: 7, cache_creation: { ephemeral_5m_input_tokens: 10 } }), async () => {
    const adapter = new AnthropicMessagesAdapter(config());
    const rows = [];
    adapter.onRequest = (row) => rows.push(row);
    await assert.rejects(adapter.complete(request), /usage is missing/);
    assert.equal(rows[0].usageStatus, 'missing');
    assert.equal(rows[0].estimatedUsd, 0.0405);
  });
});
