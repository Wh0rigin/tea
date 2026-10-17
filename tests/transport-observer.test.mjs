import test from 'node:test';
import assert from 'node:assert/strict';
import { observeTransport } from '../scripts/transport-observer.mjs';

test('transport observer preserves arbitrary chunk bytes and terminal without final delimiter', async () => {
  const input = Buffer.from('event: message_start\r\ndata: {"type":"message_start","message":{"private":"secret"}}\r\n\r\ndata: {"type":"message_stop"}');
  const rows = [];
  const fetch = observeTransport(async () => new Response(new ReadableStream({ start(c) {
    for (let i = 0; i < input.length; i += 3) c.enqueue(input.subarray(i, i + 3)); c.close();
  } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }), row => rows.push(row));
  assert.deepEqual(Buffer.from(await (await fetch('unused')).arrayBuffer()), input);
  assert.equal(rows.at(-1).terminal, true);
  assert.equal(rows.at(-1).messageStart, true);
  assert.equal(rows.at(-1).bytes, input.length);
  assert(!JSON.stringify(rows).includes('secret'));
});

test('transport observer differentiates truncated SSE from JSON without retaining payload', async () => {
  for (const [media, body, starts, json] of [
    ['text/event-stream', 'data: {"type":"message_start"}\n\n', true, false],
    ['application/json', '{"error":"private-error"}', false, true],
  ]) {
    const rows = [];
    await (await observeTransport(async () => new Response(body, { headers: { 'content-type': media } }), r => rows.push(r))()).text();
    assert.equal(rows.at(-1).messageStart, starts); assert.equal(rows.at(-1).jsonEnvelope, json);
    assert.equal(rows.at(-1).terminal, false); assert(!JSON.stringify(rows).includes('private-error'));
  }
});

test('transport observer preserves errors and bounds oversized diagnostic lines', async () => {
  const rows = [], failure = new Error('private-network-detail');
  const failed = observeTransport(async () => { throw failure; }, r => rows.push(r));
  await assert.rejects(failed(), e => e === failure);
  assert.deepEqual(rows, [{ id: 1, phase: 'fetch_failed' }]);
  const input = 'data: ' + 'x'.repeat(70000) + '\ndata: {"type":"message_stop"}\n';
  const response = await observeTransport(async () => new Response(input), r => rows.push(r))();
  assert.equal(await response.text(), input);
  assert.equal(rows.at(-1).oversizedLines, 1); assert.equal(rows.at(-1).terminal, true);
});
