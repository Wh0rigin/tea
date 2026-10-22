// Local estimates are scheduling signals, never provider usage or billing evidence.
export function estimateContextTokens(request, scale = 1) {
  const text = JSON.stringify({ system: request.system || '', tools: request.tools || [], messages: request.messages || [] });
  let ascii = 0, unicodeBytes = 0;
  for (const character of text) {
    if (character.codePointAt(0) < 128) ascii++;
    else unicodeBytes += Buffer.byteLength(character, 'utf8');
  }
  return Math.ceil((ascii / 3 + unicodeBytes / 2 + 256) * 1.2 * Math.max(1, scale));
}

export function contextBudget(config, request, scale = 1) {
  if (!config.contextWindowTokens) return null; // Legacy SDK/experiment configurations.
  const originalInputLimit = config.contextWindowTokens - (request.maxTokens ?? config.maxOutputTokens) - config.contextReserveTokens;
  const inputLimit = config.fitOutputBudget ? config.contextWindowTokens - config.contextReserveTokens : originalInputLimit;
  return { estimatedInputTokens: estimateContextTokens(request, scale), inputLimit,
    triggerTokens: Math.floor(originalInputLimit * config.compactionTriggerRatio),
    contextWindowTokens: config.contextWindowTokens, source: 'local-estimate' };
}

export function fitOutputLimit(config, request, scale = 1) {
  const ceiling = request.maxTokens ?? config.maxOutputTokens;
  if (!config.fitOutputBudget || !config.contextWindowTokens) return ceiling;
  return Math.min(ceiling, Math.max(1, config.contextWindowTokens - config.contextReserveTokens - estimateContextTokens(request, scale)));
}
