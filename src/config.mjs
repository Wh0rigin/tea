import { normalizeEditPermissions } from './edit-permissions.mjs';
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
  const memoryPolicy = String(options.memoryPolicy || env.TEA_MEMORY_POLICY || (historyStrategy === 'compact-tools' ? 'compact-tools' : options.defaultMemoryPolicy || 'full-history')).toLowerCase();
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
  const contextBudgetPolicy = options.contextBudgetPolicy ?? env.TEA_CONTEXT_BUDGET_POLICY ?? options.defaultContextBudgetPolicy ?? 'reserved-output';
  if (!['pi', 'reserved-output'].includes(contextBudgetPolicy)) throw new ConfigError('Context budget policy must be pi or reserved-output');
  const compactionTriggerRatio = positiveNumber(env.TEA_COMPACTION_TRIGGER_RATIO, contextBudgetPolicy === 'pi' ? 1 : 0.8, 'Compaction trigger ratio');
  if (compactionTriggerRatio > 1 || (contextBudgetPolicy !== 'pi' && compactionTriggerRatio === 1)) throw new ConfigError('Compaction trigger ratio must be at most 1');
  const contextWindowValue = options.contextWindowTokens ?? env.TEA_CONTEXT_WINDOW_TOKENS ?? options.defaultContextWindowTokens;
  const contextWindowTokens = contextWindowValue === undefined ? undefined : positiveNumber(contextWindowValue, undefined, 'Context window tokens');
  const contextReserveTokens = positiveNumber(options.contextReserveTokens ?? env.TEA_CONTEXT_RESERVE_TOKENS, contextBudgetPolicy === 'pi' ? 16384 : 4096, 'Context reserve tokens');
  const configuredOutput = Math.floor(positiveNumber(env.TEA_MAX_OUTPUT_TOKENS, options.defaultMaxOutputTokens ?? 1200, 'TEA_MAX_OUTPUT_TOKENS'));
  if (!Number.isSafeInteger(contextReserveTokens) || (contextWindowTokens !== undefined &&
    (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens <= (contextBudgetPolicy === 'pi' ? contextReserveTokens : configuredOutput + contextReserveTokens)))) {
    throw new ConfigError('Context window must be a safe integer larger than output/reserve requirements for its budget policy');
  }
  const maxRequestInputTokens = Math.floor(positiveNumber(options.maxRequestInputBytes ?? env.TEA_MAX_REQUEST_INPUT_BYTES ?? env.TEA_MAX_REQUEST_INPUT_TOKENS,
    options.defaultMaxRequestInputBytes ?? 12000, 'TEA_MAX_REQUEST_INPUT_TOKENS'));
  const contextosTargetBytes = positiveNumber(options.contextosTargetBytes ?? env.TEA_CONTEXTOS_TARGET_BYTES,
    options.defaultContextosTargetBytes ?? Math.max(1, Math.floor(maxRequestInputTokens * .5)), 'ContextOS target bytes');
  if (!Number.isSafeInteger(contextosTargetBytes)) throw new ConfigError('ContextOS target bytes must be a positive safe integer');
  const workingSetValue = options.contextosWorkingSetBytes ?? env.TEA_CONTEXTOS_WORKING_SET_BYTES ?? 0;
  const contextosWorkingSetBytes = Number(workingSetValue);
  if (!Number.isSafeInteger(contextosWorkingSetBytes) || contextosWorkingSetBytes < 0 || contextosWorkingSetBytes > 262144) {
    throw new ConfigError('ContextOS working set bytes must be an integer from 0 through 262144');
  }
  const compactionKeepRecentBytes = positiveNumber(options.compactionKeepRecentBytes ?? env.TEA_COMPACTION_KEEP_RECENT_BYTES,
    options.defaultCompactionKeepRecentBytes ?? Math.max(1, Math.floor(maxRequestInputTokens * 0.3)), 'Compaction recent bytes');
  if (!Number.isSafeInteger(compactionKeepRecentBytes)) throw new ConfigError('Compaction recent bytes must be a positive safe integer');
  const compactionReserveTokens = positiveNumber(options.compactionReserveTokens ?? env.TEA_COMPACTION_RESERVE_TOKENS,
    16384, 'Compaction reserve tokens');
  if (!Number.isSafeInteger(compactionReserveTokens) || compactionReserveTokens < 2) {
    throw new ConfigError('Compaction reserve tokens must be a safe integer of at least 2');
  }
  const recentTokenValue = options.compactionKeepRecentTokens ?? env.TEA_COMPACTION_KEEP_RECENT_TOKENS
    ?? (contextBudgetPolicy === 'pi' && options.compactionKeepRecentBytes === undefined && env.TEA_COMPACTION_KEEP_RECENT_BYTES === undefined ? 20000 : undefined);
  let compactionKeepRecentTokens = recentTokenValue === undefined ? undefined : positiveNumber(recentTokenValue, undefined, 'Compaction recent tokens');
  if (compactionKeepRecentTokens !== undefined && !Number.isSafeInteger(compactionKeepRecentTokens)) throw new ConfigError('Compaction recent tokens must be a safe integer');
  // Small windows must leave room for the checkpoint and subsequent work.
  if (contextWindowTokens && compactionKeepRecentTokens !== undefined) {
    compactionKeepRecentTokens = Math.min(compactionKeepRecentTokens, Math.max(1, Math.floor((contextWindowTokens - contextReserveTokens) / 2)));
  }
  const attemptValue = env.TEA_COMPACTION_MAX_PER_TURN;
  const compactionMaxPerTurn = attemptValue === undefined && contextBudgetPolicy === 'pi' ? null : positiveNumber(attemptValue, 2, 'Compaction attempts per turn');
  if (compactionMaxPerTurn !== null && (!Number.isInteger(compactionMaxPerTurn) || compactionMaxPerTurn > 8)) throw new ConfigError('Compaction attempts per turn must be an integer from 1 through 8');
  const memoryGc = String(options.memoryGc || env.TEA_MEMORY_GC || 'auto').toLowerCase();
  if (!['auto', 'off'].includes(memoryGc)) throw new ConfigError('Memory GC must be auto or off');
  const memoryCacheBytes = positiveNumber(env.TEA_MEMORY_CACHE_BYTES, 262144, 'Memory cache bytes');
  const memoryGcMaxResidentBytes = positiveNumber(env.TEA_MEMORY_MAX_RESIDENT_BYTES, 4194304, 'Resident history bytes');
  const sessionStorageMaxBytes = positiveNumber(env.TEA_SESSION_MAX_STORAGE_BYTES, 536870912, 'Session storage bytes');
  for (const value of [memoryCacheBytes, memoryGcMaxResidentBytes, sessionStorageMaxBytes]) {
    if (!Number.isSafeInteger(value)) throw new ConfigError('Memory and storage byte limits must be safe integers');
  }

  const costOption = options.maxCostUsd ?? env.TEA_MAX_COST_USD;
  const maxCostUsd = costOption === undefined || costOption === '' || costOption === null || String(costOption).toLowerCase() === 'none'
    ? null : nonNegativeNumber(costOption, null, '--max-cost-usd / TEA_MAX_COST_USD');
  if (maxCostUsd === 0) throw new ConfigError('Use --max-cost-usd none to disable the monetary cap, or specify a positive amount');
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

  let editPermissions;
  try { editPermissions=normalizeEditPermissions((options.editPermissions !== undefined ? options.editPermissions : (env.TEA_EDIT_PERMISSIONS === undefined ? {} : JSON.parse(env.TEA_EDIT_PERMISSIONS)))); }
  catch { throw new ConfigError('Invalid editPermissions / TEA_EDIT_PERMISSIONS; use workspace-relative allow, ask and deny arrays'); }
  return {
    editPermissions,
    apiKey,
    baseUrl: String(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    model: String(env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'),
    apiVersion: String(env.ANTHROPIC_VERSION || '2023-06-01'),
    maxCostUsd,
    inputRateUsdPerMillion: inputRate,
    outputRateUsdPerMillion: outputRate,
    maxOutputTokens: Math.floor(positiveNumber(env.TEA_MAX_OUTPUT_TOKENS, options.defaultMaxOutputTokens ?? 1200, 'TEA_MAX_OUTPUT_TOKENS')),
    maxRequestInputTokens,
    maxRequestInputBytes: maxRequestInputTokens,
    contextWindowTokens, contextReserveTokens, contextBudgetPolicy,
    fitOutputBudget: options.fitOutputBudget ?? env.TEA_FIT_OUTPUT_BUDGET === '1',
    maxToolCalls: (env.TEA_MAX_TOOL_CALLS === undefined && contextBudgetPolicy === 'pi' ? null : Math.floor(positiveNumber(env.TEA_MAX_TOOL_CALLS, 24, 'TEA_MAX_TOOL_CALLS'))),
    completionReview: options.completionReview ?? env.TEA_COMPLETION_REVIEW === '1',
    capabilityFeedback: env.TEA_CAPABILITY_FEEDBACK === undefined ? Boolean(options.defaultCapabilityFeedback) : env.TEA_CAPABILITY_FEEDBACK === '1',
    enableFileCreation: options.enableFileCreation ?? (env.TEA_ENABLE_FILE_CREATION === undefined || env.TEA_ENABLE_FILE_CREATION === '1'),
    timeoutMs: Math.floor(positiveNumber(env.TEA_REQUEST_TIMEOUT_MS, 90000, 'TEA_REQUEST_TIMEOUT_MS')),
    effort,
    thinkingMode,
    contextStrategy,
    initialFileLimit,
    historyStrategy: options.memoryPolicy || env.TEA_MEMORY_POLICY ? (memoryPolicy === 'compact-tools' ? 'compact-tools' : 'full') : historyStrategy,
    historyKeepRecent,
    memoryPolicy,
    contextosTargetBytes, contextosWorkingSetBytes,
    contextosKeepRecent: historyKeepRecent,
    sessionId,
    resume,
    compaction,
    compactionTriggerRatio,
    compactionKeepRecentBytes, compactionKeepRecentTokens,
    compactionMaxPerTurn,
    compactionReserveTokens,
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
  if (!config.apiKey) throw new ConfigError('Run tea config to save your API settings, or set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the environment');
  if (config.maxCostUsd != null && (!Number.isFinite(config.maxCostUsd) || config.maxCostUsd <= 0)) throw new ConfigError('An explicit cost cap must be finite and positive');
  if (config.maxCostUsd != null && !hasProviderPrices(config)) {
    throw new ConfigError('Set both TEA_INPUT_PRICE_USD_PER_MTOK and TEA_OUTPUT_PRICE_USD_PER_MTOK to the current provider rates before making live calls');
  }
  for (const value of [config.inputRateUsdPerMillion, config.outputRateUsdPerMillion, config.cacheCreationRateUsdPerMillion].filter(value => value !== undefined)) {
    if (!Number.isFinite(value) || value < 0) throw new ConfigError('Provider prices must be finite non-negative numbers');
  }
  for (const field of ['maxOutputTokens', 'maxRequestInputTokens', 'timeoutMs', ...(config.maxToolCalls === null ? [] : ['maxToolCalls'])]) {
    if (!Number.isSafeInteger(config[field]) || config[field] <= 0) throw new ConfigError(`${field} must be a positive safe integer`);
  }
  if (config.maxInputTokens !== undefined && (!Number.isSafeInteger(config.maxInputTokens) || config.maxInputTokens <= 0)) throw new ConfigError('maxInputTokens must be a positive safe integer');
}

export function loadCliConfig(options = {}, env = process.env) {
  return loadConfig({ ...options,
    defaultContextBudgetPolicy: 'pi',
    defaultMemoryPolicy: options.historyStrategy || env.TEA_HISTORY_STRATEGY ? undefined : 'contextos',
    defaultMaxRequestInputBytes: 2097152, defaultMaxOutputTokens: 4096, defaultContextWindowTokens: 32768,
    defaultCompactionKeepRecentBytes: 16000,
    defaultContextosTargetBytes: 32000, defaultCapabilityFeedback: true }, env);
}

export function hasProviderPrices(config) {
  return [config.inputRateUsdPerMillion, config.outputRateUsdPerMillion].every(value => Number.isFinite(value) && value >= 0);
}

export function assertBenchmarkConfig(config) {
  assertLiveConfig(config);
  if (!Number.isFinite(config.maxCostUsd) || config.maxCostUsd <= 0) throw new ConfigError('Live experiments require a positive finite --max-cost-usd and current provider prices');
}

export function estimateUsd(inputTokens, outputTokens, config) {
  const inRate = config.inputRateUsdPerMillion ?? 0;
  const outRate = config.outputRateUsdPerMillion ?? 0;
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
}
