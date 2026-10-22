// Diagnostic only: forward original chunks; retain bounded protocol counters, never content.
const allowed = new Set(['message_start', 'message_delta', 'message_stop', 'content_block_start',
  'content_block_delta', 'content_block_stop', 'ping', 'error']);
export function observeTransport(fetchImpl, record) {
  let sequence = 0;
  return async (...args) => {
    const id = ++sequence;
    let response;
    try { response = await fetchImpl(...args); }
    catch (error) { await record({ id, phase: 'fetch_failed' }); throw error; }
    const media = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const summary = { id, status: response.status,
      media: ['text/event-stream', 'application/json', 'text/html'].includes(media) ? media : 'other-or-missing',
      bytes: 0, events: {}, malformedData: 0, oversizedLines: 0, bom: false,
      firstCharacter: null, terminal: false, messageStart: false, jsonEnvelope: false };
    await record({ id, phase: 'headers', status: summary.status, media: summary.media });
    if (!response.body) { await record({ ...summary, phase: 'no_body' }); return response; }
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    let line = '', dropping = false, ended = false;
    const consume = value => {
      const text = value.replace(/\r$/, '');
      if (!text.startsWith('data:')) return;
      const data = text.slice(5).trimStart();
      if (!data) return;
      try {
        const event = JSON.parse(data);
        const type = allowed.has(event.type) ? event.type : 'other';
        summary.events[type] = (summary.events[type] || 0) + 1;
        if (type === 'message_start') summary.messageStart = true;
        if (type === 'message_stop') summary.terminal = true;
      } catch { summary.malformedData++; }
    };
    const inspect = text => {
      for (const ch of text) {
        if (ch === '\uFEFF') summary.bom = true;
        if (summary.firstCharacter === null && !/\s|\uFEFF/.test(ch)) {
          summary.firstCharacter = ch === '{' ? 'json-like' : ch === '<' ? 'html-like' : 'other';
          summary.jsonEnvelope = ch === '{';
        }
        if (ch === '\n') { if (!dropping) consume(line); line = ''; dropping = false; }
        else if (!dropping) {
          if (line.length < 65536) line += ch;
          else { line = ''; dropping = true; summary.oversizedLines++; }
        }
      }
    };
    const finish = async phase => {
      if (ended) return;
      ended = true; inspect(decoder.decode());
      if (line && !dropping) consume(line);
      await record({ ...summary, phase });
    };
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) { await finish('body_complete'); controller.close(); return; }
          summary.bytes += value.byteLength;
          inspect(decoder.decode(value, { stream: true }));
          controller.enqueue(value);
        } catch (error) { await finish('body_failed'); controller.error(error); }
      },
      async cancel(reason) { try { await reader.cancel(reason); } finally { await finish('cancelled'); } },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
