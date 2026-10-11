import { createHash } from 'node:crypto';
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeAnthropicUsage } from './usage.mjs';
import { validateRunId } from './run-id.mjs';

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export class TokenLedger {
  constructor({ workspace, runId, model, storeRaw = false }) {
    this.directory = path.join(path.resolve(workspace), '.tea', 'runs', validateRunId(runId));
    this.eventsPath = path.join(this.directory, 'ledger.jsonl');
    this.model = model;
    this.storeRaw = storeRaw;
    this.usageSource = 'provider';
    this.completeUsageRequests = 0;
    this.partialUsageRequests = 0;
    this.unknownUsageRequests = 0;
    this.ledgerIntegrity = true;
    this.totals = {
      requests: 0,
      inputTokens: 0,
      uncachedInputTokens: 0,
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
    this.usageSource = metadata.usageSource || 'provider';
    this.runType = metadata.runType || 'live';
    await mkdir(path.dirname(this.directory), { recursive: true });
    // Never append a new run to another run's evidence or overwrite its summary.
    await mkdir(this.directory);
    await this.event({ type: 'run_started', timestamp: new Date().toISOString(), model: this.model, ...metadata });
  }

  async event(entry) {
    try { await appendFile(this.eventsPath, `${JSON.stringify(entry)}\n`, 'utf8'); }
    catch (error) { this.ledgerIntegrity = false; throw error; }
  }

  async request({ requestId, payload, response, usage = {}, usageStatus, costBasis, estimatedInputTokens = 0, estimatedUsd = 0, elapsedMs = 0, error }) {
    const counts = normalizeAnthropicUsage(usage);
    const status = usageStatus === 'complete' && !counts.complete ? counts.status
      : usageStatus || (error ? 'partial' : counts.status);
    this.totals.requests += 1;
    if (status === 'complete' && counts.complete) this.completeUsageRequests += 1;
    else if (Object.keys(usage || {}).length) this.partialUsageRequests += 1;
    else this.unknownUsageRequests += 1;
    this.totals.inputTokens += counts.inputTokens;
    this.totals.uncachedInputTokens += counts.uncachedInputTokens;
    this.totals.outputTokens += counts.outputTokens;
    this.totals.cachedInputTokens += counts.cachedInputTokens;
    this.totals.cacheCreationInputTokens += counts.cacheCreationInputTokens;
    this.totals.reasoningTokens += counts.reasoningTokens;
    this.totals.estimatedInputTokens += estimatedInputTokens;
    this.totals.estimatedSpendUsd += estimatedUsd;
    this.totals.elapsedMs += elapsedMs;
    const row = {
      type: 'model_request', timestamp: new Date().toISOString(), requestId,
      model: this.model, usage, usageSource: this.usageSource,
      usageStatus: status, usageComplete: status === 'complete' && counts.complete,
      reportedInputTokens: counts.inputTokens, reportedOutputTokens: counts.outputTokens,
      costBasis: costBasis || 'unspecified', estimatedInputTokens, estimatedUsd,
      error: error ? String(error).replace(/(?:sk|pk)-[A-Za-z0-9_-]{12,}/g, '[REDACTED]').replace(/(x-api-key\s*[:=]\s*)[^\s,]+/ig, '$1[REDACTED]').slice(0, 1000) : undefined,
      stopReason: response?.stop_reason || null, elapsedMs,
      requestSha256: digest(JSON.stringify(payload)),
      responseSha256: digest(JSON.stringify(response || error || '')),
    };
    if (this.storeRaw) {
      row.request = payload;
      row.response = response;
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
    const usageComplete = this.totals.requests > 0 && this.completeUsageRequests === this.totals.requests;
    const providerUsageComplete = this.usageSource === 'provider' && usageComplete && this.ledgerIntegrity;
    const summary = {
      ...this.totals,
      usageSource: this.usageSource, runType: this.runType, usageComplete, providerUsageComplete,
      ledgerIntegrity: this.ledgerIntegrity,
      usageStatus: this.usageSource !== 'provider' ? 'not-provider'
        : usageComplete ? 'complete' : this.partialUsageRequests ? 'partial' : 'unknown',
      completeUsageRequests: this.completeUsageRequests, partialUsageRequests: this.partialUsageRequests,
      unknownUsageRequests: this.unknownUsageRequests,
      reportedInputTokens: this.totals.inputTokens,
      reportedOutputTokens: this.totals.outputTokens,
      reportedTotalTokens: this.totals.inputTokens + this.totals.outputTokens,
      inputTokens: providerUsageComplete ? this.totals.inputTokens : null,
      outputTokens: providerUsageComplete ? this.totals.outputTokens : null,
      totalActualTokens: providerUsageComplete ? this.totals.inputTokens + this.totals.outputTokens : null,
      status, completedAt: new Date().toISOString(),
    };
    await this.event({ type: 'run_finished', ...summary });
    await writeFile(path.join(this.directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    return summary;
  }
}
