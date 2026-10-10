import path from 'node:path';

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
    maxRequestInputTokens: Math.floor(positiveNumber(env.TEA_MAX_REQUEST_INPUT_TOKENS, 12000, 'TEA_MAX_REQUEST_INPUT_TOKENS')),
    maxToolCalls: Math.floor(positiveNumber(env.TEA_MAX_TOOL_CALLS, 24, 'TEA_MAX_TOOL_CALLS')),
    timeoutMs: Math.floor(positiveNumber(env.TEA_REQUEST_TIMEOUT_MS, 90000, 'TEA_REQUEST_TIMEOUT_MS')),
    effort,
    thinkingMode,
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
  if (!(config.maxCostUsd > 0)) throw new ConfigError('A positive --max-cost-usd or TEA_MAX_COST_USD is required for live calls');
  if (config.inputRateUsdPerMillion === undefined || config.outputRateUsdPerMillion === undefined) {
    throw new ConfigError('Set both TEA_INPUT_PRICE_USD_PER_MTOK and TEA_OUTPUT_PRICE_USD_PER_MTOK to the current provider rates before making live calls');
  }
}

export function estimateUsd(inputTokens, outputTokens, config) {
  const inRate = config.inputRateUsdPerMillion ?? 0;
  const outRate = config.outputRateUsdPerMillion ?? 0;
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
}
