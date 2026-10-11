import { randomUUID } from 'node:crypto';
import { normalizeAnthropicUsage } from './usage.mjs';

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
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      target[key] = Math.max(Number.isFinite(target[key]) ? target[key] : 0, value);
    } else target[key] = value;
  }
  return target;
}

async function readSseMessage(body) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
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
  const consumeLine = (rawLine) => {
    const line = rawLine.replace(/\r$/, '');
    if (!line) { flushEvent(); return; }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
  };
  const drainLines = () => {
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      consumeLine(line);
    }
  };

  try {
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      drainLines();
      if (failure) throw failure;
    }
    buffer += decoder.decode();
    drainLines();
    // Some gateways omit the final newline and event delimiter.
    if (buffer) consumeLine(buffer);
    if (dataLines.length) flushEvent();
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
  } catch (error) {
    const failure = error instanceof ModelError ? error : new ModelError(`Provider stream failed: ${safeProviderError(error.message)}`);
    failure.usage = response?.usage || {};
    failure.usageStatus = gotStop && normalizeAnthropicUsage(failure.usage).complete ? 'complete'
      : response ? 'partial' : 'unknown';
    throw failure;
  }
}

export class AnthropicMessagesAdapter {
  constructor(config) { this.config = config; }

  async complete({ system, messages, tools, maxTokens }) {
    const config = this.config;
    if (this.requestInFlight) throw new ModelError('Concurrent requests are blocked to preserve the hard budget');
    if (!Number.isFinite(config.maxCostUsd) || config.maxCostUsd <= 0
      || !Number.isFinite(config.inputRateUsdPerMillion) || config.inputRateUsdPerMillion < 0
      || !Number.isFinite(config.outputRateUsdPerMillion) || config.outputRateUsdPerMillion < 0
      || !Number.isSafeInteger(config.maxRequestInputTokens) || config.maxRequestInputTokens <= 0
      || !Number.isSafeInteger(maxTokens || config.maxOutputTokens) || (maxTokens || config.maxOutputTokens) <= 0) {
      throw new ModelError('Live requests require a finite positive cost cap, valid input/output rates, and positive integer token limits');
    }
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
    // Cache reads are charged without their discount; unknown write TTL uses
    // the standard Anthropic 1-hour (2x input) rate as a conservative default.
    const cacheCreationRate = config.cacheCreationRateUsdPerMillion ?? config.inputRateUsdPerMillion * 2;
    if (!Number.isFinite(cacheCreationRate) || cacheCreationRate < 0) {
      throw new ModelError('Cache creation rate must be a non-negative finite number');
    }
    const reserveInputRate = Math.max(config.inputRateUsdPerMillion, cacheCreationRate);
    const reserveUsd = (config.maxRequestInputTokens * reserveInputRate + body.max_tokens * config.outputRateUsdPerMillion) / 1_000_000;
    const reportedCost = (counts) => ((counts.uncachedInputTokens + counts.cachedInputTokens) * config.inputRateUsdPerMillion
      + counts.cacheCreationInputTokens * cacheCreationRate + counts.outputTokens * config.outputRateUsdPerMillion) / 1_000_000;
    if (this.spentUsd + reserveUsd > config.maxCostUsd + Number.EPSILON) {
      throw new ModelError(`Request blocked by hard cost budget: estimated upper bound $${reserveUsd.toFixed(6)} would exceed remaining $${Math.max(0, config.maxCostUsd - this.spentUsd).toFixed(6)}`);
    }
    if (config.maxInputTokens !== undefined && this.spentInputBound + conservativeInputBound > config.maxInputTokens) {
      throw new ModelError(`Request blocked by --max-input-tokens using conservative UTF-8 byte accounting (${this.spentInputBound + conservativeInputBound} > ${config.maxInputTokens})`);
    }

    const started = Date.now();
    let response;
    let result;
    let recorded = false;
    this.requestInFlight = true;
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
      const usage = result.usage || {};
      const counts = normalizeAnthropicUsage(usage);
      if (!counts.complete) {
        const error = new ModelError(`Provider usage is ${counts.status}; complete non-negative integer input_tokens and output_tokens are required`);
        error.usage = usage;
        error.usageStatus = counts.status;
        throw error;
      }
      const actualUsd = reportedCost(counts);
      this.spentUsd += actualUsd;
      this.spentInputBound += conservativeInputBound;
      this.actualInputTokens += counts.inputTokens;
      recorded = true;
      await this.onRequest?.({ requestId, payload: body, response: result, usage, usageStatus: 'complete', costBasis: 'conservative-reported-usage', estimatedInputTokens: conservativeInputBound, estimatedUsd: actualUsd, elapsedMs: Date.now() - started });
      if (counts.inputTokens > config.maxRequestInputTokens || counts.outputTokens > body.max_tokens) {
        throw new ModelError('Provider-reported usage exceeded the per-request token limits; stopping after this billed request');
      }
      if (actualUsd > reserveUsd + Number.EPSILON) {
        throw new ModelError('Provider-reported usage exceeded the preflight reservation; stopping to protect the hard budget');
      }
      if (this.spentUsd > config.maxCostUsd + Number.EPSILON) {
        throw new ModelError('Provider-reported usage exceeded the hard cost budget; stopping after this billed request');
      }
      if (config.maxInputTokens !== undefined && this.actualInputTokens > config.maxInputTokens) {
        throw new ModelError('Provider-reported input token total exceeded --max-input-tokens; stopping after this billed request');
      }
      return result;
    } catch (error) {
      if (!recorded) {
        // Keep the full preflight reservation after a transport error: the provider may have processed the request.
        const usage = error.usage || {};
        const counts = normalizeAnthropicUsage(usage);
        const completeUsage = error.usageStatus === 'complete' && counts.complete;
        const retainedUsd = completeUsage ? reportedCost(counts) : reserveUsd;
        this.spentUsd += retainedUsd;
        this.spentInputBound += conservativeInputBound;
        if (completeUsage) this.actualInputTokens += counts.inputTokens;
        recorded = true;
        await this.onRequest?.({ requestId, payload: body, response: result || null, usage,
          usageStatus: error.usageStatus || 'unknown',
          costBasis: completeUsage ? 'conservative-reported-usage' : 'full-preflight-reservation',
          estimatedInputTokens: conservativeInputBound, estimatedUsd: retainedUsd,
          elapsedMs: Date.now() - started, error: safeProviderError(error.message) });
      }
      if (error instanceof ModelError) throw error;
      throw new ModelError(`Model request failed: ${safeProviderError(error.message)}`);
    } finally { this.requestInFlight = false; }
  }

  spentUsd = 0;
  spentInputBound = 0;
  actualInputTokens = 0;
  requestInFlight = false;
}
