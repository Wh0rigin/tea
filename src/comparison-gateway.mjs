import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeAnthropicUsage } from './usage.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');

export class WireUsage {
  constructor() { this.usage = {}; this.stopped = false; this.buffer = ''; this.data = []; this.decoder = new TextDecoder('utf-8', { fatal: true }); }
  line(line) {
    if (!line.trim()) {
      if (this.data.length) {
        const event = JSON.parse(this.data.join('\n'));
        if (event.type === 'message_start') Object.assign(this.usage, event.message?.usage || {});
        if (event.type === 'message_delta') Object.assign(this.usage, event.usage || {});
        if (event.type === 'message_stop') this.stopped = true;
        if (event.type === 'error') throw new Error('Provider reported a streaming error');
        this.data = [];
      }
    } else if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''));
  }
  append(chunk) {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) { this.line(this.buffer.slice(0, index).replace(/\r$/, '')); this.buffer = this.buffer.slice(index + 1); }
    if (this.buffer.length > 8_000_000) throw new Error('Provider streaming record too large');
  }
  finish() {
    this.buffer += this.decoder.decode();
    if (this.buffer) this.line(this.buffer.replace(/\r$/, ''));
    this.line('');
    const counts = normalizeAnthropicUsage(this.usage);
    return { usage: this.usage, complete: this.stopped && counts.complete, counts };
  }
}

/** One common billing observer for both agents. Never use client SDK defaults as usage evidence. */
export async function startComparisonGateway(config, { onRecord = async () => {}, token = randomUUID(), perCaseBudget = config.maxCostUsd } = {}) {
  const records = [];
  const caseSpend = new Map();
  const caseCalls = new Map();
  let accountedUsd = 0;
  let busy = false;
  let halted = false;
  const active = new Set();
  const cacheWriteRate = config.cacheCreationRateUsdPerMillion ?? config.inputRateUsdPerMillion * 2;
  const reserve = (config.maxRequestInputTokens * Math.max(config.inputRateUsdPerMillion, cacheWriteRate)
    + config.maxOutputTokens * config.outputRateUsdPerMillion) / 1_000_000;
  if (![reserve, perCaseBudget, config.maxCostUsd].every(x => Number.isFinite(x) && x > 0)) throw new Error('Gateway requires explicit finite positive budgets and nonzero reservation prices');
  const reject = (response, status, message) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } })); };
  const server = createServer(async (request, response) => {
    // Pi's Anthropic SDK uses the same messages path with ?beta=true.
    let localUrl;
    try { localUrl = new URL(request.url || '/', 'http://127.0.0.1'); }
    catch { reject(response, 400, 'Invalid local route'); return; }
    const match = /^\/(tea|pi|baseline|candidate)\/([a-z0-9-]+)\/v1\/messages$/.exec(localUrl.pathname);
    if (request.method !== 'POST' || !match || request.headers['x-api-key'] !== token) { reject(response, 403, 'Unknown comparison route or local credential'); return; }
    const [, agent, caseId] = match;
    const key = `${caseId}/${agent}`;
    if (busy || halted) { reject(response, 429, 'Comparison halted or another request is running'); return; }
    busy = true;
    const controller = new AbortController();
    active.add(controller);
    const started = Date.now();
    let charged = false;
    let submitted = false;
    let row;
    let meter;
    let evidence = {};
    const cancelled = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close', cancelled);
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const chunks = [];
      let requestBytes = 0;
      for await (const chunk of request) { requestBytes += chunk.length; if (requestBytes > 8_000_000) throw new Error('Request too large'); chunks.push(chunk); }
      const incoming = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      // Keep each agent's native prompts and tools. Normalize only shared model controls.
      const body = { ...incoming, model: config.model, max_tokens: config.maxOutputTokens, stream: true,
        thinking: config.thinkingMode === 'adaptive' ? { type: 'adaptive' } : { type: 'enabled', budget_tokens: Math.min(config.maxOutputTokens - 1, 8000) },
        output_config: { effort: config.effort } };
      delete body.temperature; delete body.top_p; delete body.top_k;
      const payload = JSON.stringify(body);
      const bytes = Buffer.byteLength(payload);
      evidence = { requestSha256: hash(payload), bytes,
        normalizedControls: { model: body.model, maxTokens: body.max_tokens, thinking: body.thinking, outputConfig: body.output_config } };
      const calls = caseCalls.get(key) || 0;
      const spend = caseSpend.get(key) || 0;
      const guard = bytes > config.maxRequestInputTokens ? 'Input byte guard reached'
        : calls >= (config.comparisonMaxRequests ?? 24) ? 'Request count guard reached'
        : spend + reserve > perCaseBudget + Number.EPSILON ? 'Per-case cost reservation exhausted'
        : accountedUsd + reserve > config.maxCostUsd + Number.EPSILON ? 'Suite cost reservation exhausted' : null;
      if (guard) {
        row = { agent, caseId, submitted: false, complete: false, guard, ...evidence, elapsedMs: Date.now() - started };
        records.push(row); await onRecord(row); reject(response, 400, guard); return;
      }
      accountedUsd += reserve;
      caseSpend.set(key, spend + reserve);
      caseCalls.set(key, calls + 1);
      charged = true;
      submitted = true;
      const upstream = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': config.apiVersion, 'x-api-key': config.apiKey },
        body: payload, signal: controller.signal,
      });
      if (!upstream.ok) throw new Error(`Upstream HTTP ${upstream.status}`);
      if (!upstream.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Comparison requires an SSE response');
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      meter = new WireUsage();
      const digest = createHash('sha256');
      for await (const chunk of upstream.body) {
        meter.append(chunk); digest.update(chunk);
        if (!response.write(chunk)) await new Promise((resolve, rejectWait) => {
          const done = () => { response.removeListener('drain', done); response.removeListener('close', closed); resolve(); };
          const closed = () => { response.removeListener('drain', done); rejectWait(new Error('Comparison client disconnected')); };
          response.once('drain', done); response.once('close', closed);
        });
      }
      const usage = meter.finish();
      row = { agent, caseId, submitted: true, complete: usage.complete, usage: usage.usage,
        inputTokens: usage.complete ? usage.counts.inputTokens : null, outputTokens: usage.complete ? usage.counts.outputTokens : null,
        totalTokens: usage.complete ? usage.counts.totalTokens : null, reportedTokenLowerBound: usage.counts.totalTokens,
        ...evidence, responseSha256: digest.digest('hex'), elapsedMs: Date.now() - started };
      if (usage.complete) {
        const cost = ((usage.counts.uncachedInputTokens + usage.counts.cachedInputTokens) * config.inputRateUsdPerMillion
          + usage.counts.cacheCreationInputTokens * cacheWriteRate + usage.counts.outputTokens * config.outputRateUsdPerMillion) / 1_000_000;
        row.accountedUsd = cost;
        accountedUsd += cost - reserve;
        caseSpend.set(key, (caseSpend.get(key) || 0) + cost - reserve);
        if (usage.counts.inputTokens > config.maxRequestInputTokens || usage.counts.outputTokens > config.maxOutputTokens
          || cost > reserve + Number.EPSILON || accountedUsd > config.maxCostUsd + Number.EPSILON) {
          halted = true; row.limitExceeded = true;
        }
      } else { halted = true; row.accountedUsd = reserve; }
      records.push(row); await onRecord(row);
      response.end();
    } catch (error) {
      // A failed checkpoint also stops unsent requests; the cost ledger must remain durable.
      halted = true;
      if (!row) {
        row = { agent, caseId, submitted, complete: false, ...evidence, usage: meter?.usage || {}, reportedTokenLowerBound: normalizeAnthropicUsage(meter?.usage).totalTokens,
          error: String(error.message).slice(0, 300), accountedUsd: charged ? reserve : 0, elapsedMs: Date.now() - started };
        records.push(row); await onRecord(row).catch(() => { halted = true; });
      }
      if (!response.headersSent) reject(response, 502, 'Comparison request failed; see sanitized ledger');
      else response.destroy();
    } finally { clearTimeout(timeout); response.removeListener('close', cancelled); active.delete(controller); busy = false; }
  });
  await new Promise((resolve, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', resolve); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, token, records,
    get accountedUsd() { return accountedUsd; }, get halted() { return halted; },
    forCase: (caseId, agent) => records.filter(row => row.caseId === caseId && row.agent === agent),
    waitForIdle: async () => { while (busy) await new Promise(resolve => setTimeout(resolve, 25)); },
    close: async () => { for (const controller of active) controller.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
