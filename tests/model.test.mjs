import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicMessagesAdapter, ModelError } from '../src/model.mjs';

function event(type, value) { return `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`; }

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
