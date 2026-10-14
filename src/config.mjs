import path from 'node:path';
import { validateRunId } from './run-id.mjs';

export class ConfigError extends Error {}

function positiveNumber(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new ConfigError(`${label} must be a positive number`);
  return parsed;
}

function nonNegativeNumber(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ConfigError(`${label} must be a non-negative number`);
  return parsed;
}

export function loadConfig(options = {}, env = process.env) {
  const apiKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || '';
  const effort = String(options.effort || env.TEA_REASONING_EFFORT || 'low').toLowerCase();
  if (!['low', 'high', 'max'].includes(effort)) {
    throw new ConfigError('TEA_REASONING_EFFORT must be one of: low, high, max');
  }
  const thinkingMode = String(env.TEA_THINKING_MODE || 'adaptive').toLowerCase();
  if (!['adaptive', 'enabled'].includes(thinkingMode)) {
    throw new ConfigError('TEA_THINKING_MODE must be adaptive or enabled');
  }

  const contextStrategy = String(options.contextStrategy || env.TEA_CONTEXT_STRATEGY || 'v1').toLowerCase();
  if (!['baseline', 'v1-dedup', 'v1-inventory', 'v1', 'v1-inventory-expanded', 'v1-expanded', 'v1-inventory-auto', 'v1-auto'].includes(contextStrategy)) {
    throw new ConfigError('TEA_CONTEXT_STRATEGY must be one of: baseline, v1-dedup, v1-inventory, v1, v1-inventory-expanded, v1-expanded, v1-inventory-auto, v1-auto');
  }
  const initialFileLimit = positiveNumber(options.initialFileLimit ?? env.TEA_INITIAL_FILE_LIMIT, 8, '--initial-file-limit / TEA_INITIAL_FILE_LIMIT');
  if (!Number.isInteger(initialFileLimit) || initialFileLimit < 1 || initialFileLimit > 250) throw new ConfigError('--initial-file-limit / TEA_INITIAL_FILE_LIMIT must be an integer from 1 through 250');
  const historyStrategy = String(options.historyStrategy || env.TEA_HISTORY_STRATEGY || 'full').toLowerCase();
  if (!['full', 'compact-tools'].includes(historyStrategy)) throw new ConfigError('History strategy must be full or compact-tools');
  const memoryPolicy = String(options.memoryPolicy || env.TEA_MEMORY_POLICY || (historyStrategy === 'compact-tools' ? 'compact-tools' : 'full-history')).toLowerCase();
  if (!['full-history', 'compact-tools', 'contextos'].includes(memoryPolicy)) throw new ConfigError('Memory policy must be full-history, compact-tools or contextos');
  const sessionId = options.sessionId || env.TEA_SESSION_ID;
  const resume = options.resume;
  if (sessionId) validateRunId(sessionId);
  if (resume) validateRunId(resume);
  if (resume && sessionId) throw new ConfigError('Choose --session or --resume, not both');
  const historyKeepRecent = positiveNumber(options.historyKeepRecent ?? env.TEA_HISTORY_KEEP_RECENT, 2, 'History recent rounds');
  if (!Number.isInteger(historyKeepRecent) || historyKeepRecent < 2 || historyKeepRecent > 24) throw new ConfigError('History recent rounds must be an integer from 2 through 24');

  const compaction = String(options.compaction || env.TEA_COMPACTION || 'auto').toLowerCase();
  if (!['off', 'auto'].includes(compaction)) throw new ConfigError('Compaction must be off or auto');
  const compactionTriggerRatio = positiveNumber(env.TEA_COMPACTION_TRIGGER_RATIO, 0.8, 'Compaction trigger ratio');
  if (compactionTriggerRatio >= 1) throw new ConfigError('Compaction trigger ratio must be less than 1');
  const maxRequestInputTokens = Math.floor(positiveNumber(env.TEA_MAX_REQUEST_INPUT_TOKENS, 12000, 'TEA_MAX_REQUEST_INPUT_TOKENS'));
  const contextosTargetBytes = positiveNumber(options.contextosTargetBytes ?? env.TEA_CONTEXTOS_TARGET_BYTES,
    Math.max(1, Math.floor(maxRequestInputTokens * .5)), 'ContextOS target bytes');
  if (!Number.isSafeInteger(contextosTargetBytes)) throw new ConfigError('ContextOS target bytes must be a positive safe integer');
  const compactionKeepRecentBytes = positiveNumber(options.compactionKeepRecentBytes ?? env.TEA_COMPACTION_KEEP_RECENT_BYTES,
    Math.max(1, Math.floor(maxRequestInputTokens * 0.3)), 'Compaction recent bytes');
  if (!Number.isSafeInteger(compactionKeepRecentBytes)) throw new ConfigError('Compaction recent bytes must be a positive safe integer');
  const compactionMaxPerTurn = positiveNumber(env.TEA_COMPACTION_MAX_PER_TURN, 2, 'Compaction attempts per turn');
  if (!Number.isInteger(compactionMaxPerTurn) || compactionMaxPerTurn > 8) throw new ConfigError('Compaction attempts per turn must be an integer from 1 through 8');
  const memoryGc = String(options.memoryGc || env.TEA_MEMORY_GC || 'auto').toLowerCase();
  if (!['auto', 'off'].includes(memoryGc)) throw new ConfigError('Memory GC must be auto or off');
  const memoryCacheBytes = positiveNumber(env.TEA_MEMORY_CACHE_BYTES, 262144, 'Memory cache bytes');
  const memoryGcMaxResidentBytes = positiveNumber(env.TEA_MEMORY_MAX_RESIDENT_BYTES, 4194304, 'Resident history bytes');
  const sessionStorageMaxBytes = positiveNumber(env.TEA_SESSION_MAX_STORAGE_BYTES, 536870912, 'Session storage bytes');
  for (const value of [memoryCacheBytes, memoryGcMaxResidentBytes, sessionStorageMaxBytes]) {
    if (!Number.isSafeInteger(value)) throw new ConfigError('Memory and storage byte limits must be safe integers');
  }

  const maxCostUsd = nonNegativeNumber(
    options.maxCostUsd ?? env.TEA_MAX_COST_USD,
    0,
    '--max-cost-usd / TEA_MAX_COST_USD'
  );
  const inputRate = env.TEA_INPUT_PRICE_USD_PER_MTOK === undefined || env.TEA_INPUT_PRICE_USD_PER_MTOK === ''
    ? undefined : Number(env.TEA_INPUT_PRICE_USD_PER_MTOK);
  const outputRate = env.TEA_OUTPUT_PRICE_USD_PER_MTOK === undefined || env.TEA_OUTPUT_PRICE_USD_PER_MTOK === ''
    ? undefined : Number(env.TEA_OUTPUT_PRICE_USD_PER_MTOK);
  if (inputRate !== undefined && (!Number.isFinite(inputRate) || inputRate < 0)) {
    throw new ConfigError('TEA_INPUT_PRICE_USD_PER_MTOK must be a non-negative number');
  }
  if (outputRate !== undefined && (!Number.isFinite(outputRate) || outputRate < 0)) {
    throw new ConfigError('TEA_OUTPUT_PRICE_USD_PER_MTOK must be a non-negative number');
  }

  return {
    apiKey,
    baseUrl: String(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    model: String(env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'),
    apiVersion: String(env.ANTHROPIC_VERSION || '2023-06-01'),
    maxCostUsd,
    inputRateUsdPerMillion: inputRate,
    outputRateUsdPerMillion: outputRate,
    maxOutputTokens: Math.floor(positiveNumber(env.TEA_MAX_OUTPUT_TOKENS, 1200, 'TEA_MAX_OUTPUT_TOKENS')),
    maxRequestInputTokens,
    maxToolCalls: Math.floor(positiveNumber(env.TEA_MAX_TOOL_CALLS, 24, 'TEA_MAX_TOOL_CALLS')),
    capabilityFeedback: env.TEA_CAPABILITY_FEEDBACK === '1',
    timeoutMs: Math.floor(positiveNumber(env.TEA_REQUEST_TIMEOUT_MS, 90000, 'TEA_REQUEST_TIMEOUT_MS')),
    effort,
    thinkingMode,
    contextStrategy,
    initialFileLimit,
    historyStrategy: options.memoryPolicy || env.TEA_MEMORY_POLICY ? (memoryPolicy === 'compact-tools' ? 'compact-tools' : 'full') : historyStrategy,
    historyKeepRecent,
    memoryPolicy,
    contextosTargetBytes,
    contextosKeepRecent: historyKeepRecent,
    sessionId,
    resume,
    compaction,
    compactionTriggerRatio,
    compactionKeepRecentBytes,
    compactionMaxPerTurn,
    memoryGc,
    memoryCacheBytes,
    memoryGcMaxResidentBytes,
    sessionStorageMaxBytes,
    stream: env.TEA_STREAM !== '0',
    storeRaw: env.TEA_STORE_RAW === '1',
    workspace: path.resolve(options.workspace || process.cwd()),
    maxInputTokens: options.maxInputTokens === undefined
      ? undefined
      : Math.floor(positiveNumber(options.maxInputTokens, undefined, '--max-input-tokens')),
    runId: options.runId || new Date().toISOString().replaceAll(':', '-'),
  };
}

export function assertLiveConfig(config) {
  if (!config.apiKey) throw new ConfigError('Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the environment');
  if (!Number.isFinite(config.maxCostUsd) || !(config.maxCostUsd > 0)) throw new ConfigError('A positive finite --max-cost-usd or TEA_MAX_COST_USD is required for live calls');
  if (config.inputRateUsdPerMillion === undefined || config.outputRateUsdPerMillion === undefined) {
    throw new ConfigError('Set both TEA_INPUT_PRICE_USD_PER_MTOK and TEA_OUTPUT_PRICE_USD_PER_MTOK to the current provider rates before making live calls');
  }
  for (const value of [config.inputRateUsdPerMillion, config.outputRateUsdPerMillion, config.cacheCreationRateUsdPerMillion ?? 0]) {
    if (!Number.isFinite(value) || value < 0) throw new ConfigError('Provider prices must be finite non-negative numbers');
  }
  for (const field of ['maxOutputTokens', 'maxRequestInputTokens', 'maxToolCalls', 'timeoutMs']) {
    if (!Number.isSafeInteger(config[field]) || config[field] <= 0) throw new ConfigError(`${field} must be a positive safe integer`);
  }
  if (config.maxInputTokens !== undefined && (!Number.isSafeInteger(config.maxInputTokens) || config.maxInputTokens <= 0)) throw new ConfigError('maxInputTokens must be a positive safe integer');
}

export function estimateUsd(inputTokens, outputTokens, config) {
  const inRate = config.inputRateUsdPerMillion ?? 0;
  const outRate = config.outputRateUsdPerMillion ?? 0;
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
}
