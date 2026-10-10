import { createHash } from 'node:crypto';
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export class TokenLedger {
  constructor({ workspace, runId, model, storeRaw = false }) {
    this.directory = path.join(workspace, '.tea', 'runs', runId);
    this.eventsPath = path.join(this.directory, 'ledger.jsonl');
    this.model = model;
    this.storeRaw = storeRaw;
    this.totals = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      reasoningTokens: 0,
      estimatedInputTokens: 0,
      estimatedSpendUsd: 0,
      toolCalls: 0,
      toolOutputChars: 0,
      contextChars: 0,
      elapsedMs: 0,
    };
  }

  async init(metadata = {}) {
    await mkdir(this.directory, { recursive: true });
    await this.event({ type: 'run_started', timestamp: new Date().toISOString(), model: this.model, ...metadata });
  }

  async event(entry) {
    await appendFile(this.eventsPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  async request({ requestId, payload, response, usage = {}, estimatedInputTokens = 0, estimatedUsd = 0, elapsedMs = 0, error }) {
    this.totals.requests += 1;
    this.totals.inputTokens += Number(usage.input_tokens || 0);
    this.totals.outputTokens += Number(usage.output_tokens || 0);
    this.totals.cachedInputTokens += Number(usage.cache_read_input_tokens || 0);
    this.totals.cacheCreationInputTokens += Number(usage.cache_creation_input_tokens || 0);
    this.totals.reasoningTokens += Number(usage.reasoning_tokens || 0);
    this.totals.estimatedInputTokens += estimatedInputTokens;
    this.totals.estimatedSpendUsd += estimatedUsd;
    this.totals.elapsedMs += elapsedMs;
    const row = {
      type: 'model_request', timestamp: new Date().toISOString(), requestId,
      model: this.model, usage, estimatedInputTokens, estimatedUsd,
      stopReason: response?.stop_reason || null, elapsedMs,
      requestSha256: digest(JSON.stringify(payload)),
      responseSha256: digest(JSON.stringify(response || error || '')),
    };
    if (this.storeRaw) {
      row.request = payload;
      row.response = response;
      row.error = error ? String(error).replace(/(?:sk|pk)-[A-Za-z0-9_-]{12,}/g, '[REDACTED]') : undefined;
    }
    await this.event(row);
  }

  async tool({ name, input, output, elapsedMs, error }) {
    this.totals.toolCalls += 1;
    this.totals.elapsedMs += elapsedMs || 0;
    this.totals.toolOutputChars += String(output || '').length;
    const row = {
      type: 'tool_call', timestamp: new Date().toISOString(), name,
      inputSha256: digest(JSON.stringify(input)), outputSha256: digest(output || ''),
      outputChars: String(output || '').length, elapsedMs, error: error ? String(error) : undefined,
    };
    if (this.storeRaw) {
      row.input = input;
      row.output = String(output || '');
    }
    await this.event(row);
  }

  async finish({ status, prompt = '' } = {}) {
    this.totals.estimatedInputTokens = Math.round(this.totals.estimatedInputTokens);
    this.totals.contextChars = String(prompt).length;
    const summary = { ...this.totals, status, completedAt: new Date().toISOString() };
    await this.event({ type: 'run_finished', ...summary });
    await writeFile(path.join(this.directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    return summary;
  }
}
