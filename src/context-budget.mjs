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
  const piPolicy = config.contextBudgetPolicy === 'pi';
  const originalInputLimit = config.contextWindowTokens - config.contextReserveTokens
    - (piPolicy ? 0 : (request.maxTokens ?? config.maxOutputTokens));
  const inputLimit = !piPolicy && config.fitOutputBudget
    ? config.contextWindowTokens - config.contextReserveTokens : originalInputLimit;
  return { estimatedInputTokens: estimateContextTokens(request, scale), inputLimit,
    triggerTokens: Math.floor(originalInputLimit * config.compactionTriggerRatio),
    contextWindowTokens: config.contextWindowTokens, source: 'local-estimate' };
}

// Pi scheduling keeps main's fitted output allowance. The opt-in experiment
// applies only to reserved-output scheduling and preserves its earlier trigger.
export function fitOutputLimit(config, request, scale = 1) {
  const ceiling = request.maxTokens ?? config.maxOutputTokens;
  const piPolicy = config.contextBudgetPolicy === 'pi';
  if ((!piPolicy && !config.fitOutputBudget) || !config.contextWindowTokens) return ceiling;
  const reserve = piPolicy ? 0 : config.contextReserveTokens;
  return Math.min(ceiling, Math.max(1, config.contextWindowTokens - reserve - estimateContextTokens(request, scale)));
}
