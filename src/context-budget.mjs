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
  const inputLimit = config.contextWindowTokens - (request.maxTokens ?? config.maxOutputTokens) - config.contextReserveTokens;
  return { estimatedInputTokens: estimateContextTokens(request, scale), inputLimit,
    triggerTokens: Math.floor(inputLimit * config.compactionTriggerRatio),
    contextWindowTokens: config.contextWindowTokens, source: 'local-estimate' };
}
