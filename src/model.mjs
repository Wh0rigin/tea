import { randomUUID } from 'node:crypto';

export class ModelError extends Error {
  constructor(message, status) { super(message); this.name = 'ModelError'; this.status = status; }
}

function safeProviderError(text) {
  return String(text)
    .replace(/(?:sk|pk)-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/(x-api-key\s*[:=]\s*)[^\s,]+/ig, '$1[REDACTED]')
    .slice(0, 1000);
}

function mergeUsage(target, source = {}) {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number') target[key] = Math.max(target[key] || 0, value);
  }
  return target;
}

async function readSseMessage(body) {
  let buffer = '';
  let eventName = '';
  let dataLines = [];
  let response;
  const blocks = new Map();
  let gotStop = false;
  let failure;

  const consume = (name, rawData) => {
    if (!rawData) return;
    let event;
    try { event = JSON.parse(rawData); }
    catch { throw new ModelError('Provider returned malformed streaming JSON'); }
    if (name === 'error' || event.type === 'error') {
      failure = new ModelError(safeProviderError(event.error?.message || event.message || 'Provider stream failed'));
      return;
    }
    switch (event.type || name) {
      case 'message_start':
        response = { ...(event.message || {}), content: [], usage: { ...(event.message?.usage || {}) } };
        break;
      case 'content_block_start': {
        const block = { ...(event.content_block || {}) };
        if (block.type === 'text' && typeof block.text !== 'string') block.text = '';
        if (block.type === 'thinking' && typeof block.thinking !== 'string') block.thinking = '';
        if (block.type === 'tool_use' && !block.input) { block.input = {}; block.partial_json = ''; }
        blocks.set(event.index, block);
        break;
      }
      case 'content_block_delta': {
        const block = blocks.get(event.index) || { type: event.delta?.type };
        const delta = event.delta || {};
        if (delta.type === 'text_delta') block.text = `${block.text || ''}${delta.text || ''}`;
        else if (delta.type === 'thinking_delta') block.thinking = `${block.thinking || ''}${delta.thinking || ''}`;
        else if (delta.type === 'signature_delta') block.signature = `${block.signature || ''}${delta.signature || ''}`;
        else if (delta.type === 'input_json_delta') block.partial_json = `${block.partial_json || ''}${delta.partial_json || ''}`;
        blocks.set(event.index, block);
        break;
      }
      case 'message_delta':
        if (response) {
          response.stop_reason = event.delta?.stop_reason || response.stop_reason;
          mergeUsage(response.usage, event.usage);
        }
        break;
      case 'message_stop':
        gotStop = true;
        break;
    }
  };

  const flushEvent = () => {
    consume(eventName, dataLines.join('\n'));
    eventName = '';
    dataLines = [];
  };

  for await (const chunk of body) {
    buffer += Buffer.from(chunk).toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (!line) { flushEvent(); continue; }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') eventName = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (failure) throw failure;
  }
  if (buffer.trim() || dataLines.length) flushEvent();
  if (failure) throw failure;
  if (!gotStop || !response) throw new ModelError('Provider stream ended before the message_stop event');
  response.content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => {
    if (block.type === 'tool_use' && block.partial_json) {
      try { block.input = JSON.parse(block.partial_json); }
      catch { throw new ModelError(`Provider returned malformed JSON for tool ${block.name || 'unknown'}`); }
    }
    delete block.partial_json;
    return block;
  });
  return response;
}

export class AnthropicMessagesAdapter {
  constructor(config) { this.config = config; }

  async complete({ system, messages, tools, maxTokens }) {
    const config = this.config;
    const body = {
      model: config.model,
      max_tokens: maxTokens || config.maxOutputTokens,
      stream: config.stream,
      system,
      messages,
      tools,
      thinking: config.thinkingMode === 'adaptive' ? { type: 'adaptive' } : { type: 'enabled', budget_tokens: Math.min(config.maxOutputTokens, 8000) },
      output_config: { effort: config.effort },
    };
    const requestId = randomUUID();
    const url = `${config.baseUrl}/v1/messages`;
    const requestBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    const conservativeInputBound = requestBytes;
    if (conservativeInputBound > config.maxRequestInputTokens) {
      throw new ModelError(`Request blocked: serialized request is ${conservativeInputBound} bytes; per-request input limit is ${config.maxRequestInputTokens} tokens`);
    }
    const reserveUsd = (config.maxRequestInputTokens * config.inputRateUsdPerMillion + body.max_tokens * config.outputRateUsdPerMillion) / 1_000_000;
    if (this.spentUsd + reserveUsd > config.maxCostUsd + Number.EPSILON) {
      throw new ModelError(`Request blocked by hard cost budget: estimated upper bound $${reserveUsd.toFixed(6)} would exceed remaining $${Math.max(0, config.maxCostUsd - this.spentUsd).toFixed(6)}`);
    }
    if (config.maxInputTokens !== undefined && this.spentInputBound + conservativeInputBound > config.maxInputTokens) {
      throw new ModelError(`Request blocked by --max-input-tokens using conservative UTF-8 byte accounting (${this.spentInputBound + conservativeInputBound} > ${config.maxInputTokens})`);
    }

    const started = Date.now();
    let response;
    let result;
    let actualUsd = reserveUsd;
    let didRespond = false;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': config.apiVersion,
          'x-api-key': config.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) throw new ModelError(`Provider returned HTTP ${response.status}: ${safeProviderError(await response.text())}`, response.status);
      result = config.stream ? await readSseMessage(response.body) : await response.json();
      didRespond = true;
      const usage = result.usage || {};
      const inputTokens = Number(usage.input_tokens || 0);
      const outputTokens = Number(usage.output_tokens || 0);
      // Charge cached input at the undiscounted input rate for a conservative local cap.
      actualUsd = (inputTokens * config.inputRateUsdPerMillion + outputTokens * config.outputRateUsdPerMillion) / 1_000_000;
      this.spentUsd += actualUsd;
      this.spentInputBound += conservativeInputBound;
      await this.onRequest?.({ requestId, payload: body, response: result, usage, estimatedInputTokens: conservativeInputBound, estimatedUsd: actualUsd, elapsedMs: Date.now() - started });
      if (actualUsd > reserveUsd + Number.EPSILON) {
        throw new ModelError('Provider-reported usage exceeded the preflight reservation; stopping to protect the hard budget');
      }
      if (config.maxInputTokens !== undefined && this.actualInputTokens + inputTokens > config.maxInputTokens) {
        throw new ModelError('Provider-reported input token total exceeded --max-input-tokens; stopping after this billed request');
      }
      this.actualInputTokens += inputTokens;
      return result;
    } catch (error) {
      if (!didRespond) {
        // Keep the full preflight reservation after a transport error: the provider may have processed the request.
        this.spentUsd += reserveUsd;
        this.spentInputBound += conservativeInputBound;
        await this.onRequest?.({ requestId, payload: body, response: null, usage: {}, estimatedInputTokens: conservativeInputBound, estimatedUsd: reserveUsd, elapsedMs: Date.now() - started, error: safeProviderError(error.message) });
      }
      if (error instanceof ModelError) throw error;
      throw new ModelError(`Model request failed: ${safeProviderError(error.message)}`);
    }
  }

  spentUsd = 0;
  spentInputBound = 0;
  actualInputTokens = 0;
}
