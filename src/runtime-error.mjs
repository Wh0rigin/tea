// Operational diagnostics only: never include request bodies, headers or stacks.
export function runtimeError(error, { config = {}, stage = 'runtime', budget } = {}) {
  let message = String(error?.message || error || 'Unknown runtime error');
  if (config.apiKey) message = message.split(config.apiKey).join('[REDACTED]');
  message = message.replace(/(?:sk|pk)-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/((?:x-api-key|authorization|api[_-]?key)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/ig, '$1[REDACTED]');
  const numericBudget = budget && Object.fromEntries([
    'estimatedInputTokens', 'inputLimit', 'triggerTokens', 'contextWindowTokens', 'requestBytes',
    'maxWireBytes', 'outputLimit', 'residentBytes', 'residentLimit', 'automaticCompactions', 'emergencyCompactions',
  ].filter(key => Number.isFinite(budget[key])).map(key => [key, budget[key]]));
  return { code: error?.code || (error?.name === 'AbortError' ? 'ABORTED' : 'RUNTIME_ERROR'),
    name: error?.name || 'Error', message: message.slice(0, 1000), stage,
    ...(Number.isInteger(error?.status) ? { httpStatus: error.status } : {}),
    ...(['complete', 'partial', 'unknown', 'missing', 'invalid'].includes(error?.usageStatus) ? { usageStatus: error.usageStatus } : {}),
    ...(typeof error?.submitted === 'boolean' ? { requestSubmitted: error.submitted } : {}),
    ...(numericBudget ? { budget: numericBudget } : {}) };
}
