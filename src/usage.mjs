// Anthropic input_tokens excludes cached reads and writes. Keep the provider
// fields intact while exposing one canonical input total for caps and reports.
export function normalizeAnthropicUsage(usage) {
  const source = usage && typeof usage === 'object' && !Array.isArray(usage) ? usage : {};
  const invalid = [];
  const missing = [];
  const count = (name, required = false) => {
    if (!Object.hasOwn(source, name)) {
      if (required) missing.push(name);
      return 0;
    }
    const value = source[name];
    if (!Number.isSafeInteger(value) || value < 0) { invalid.push(name); return 0; }
    return value;
  };
  const uncachedInputTokens = count('input_tokens', true);
  const outputTokens = count('output_tokens', true);
  const cachedInputTokens = count('cache_read_input_tokens');
  let cacheCreationInputTokens = count('cache_creation_input_tokens');
  // A relay must not silently turn reported cache writes into zero by dropping
  // the aggregate field. The breakdown is evidence, not a second token charge.
  const cacheCreation = source.cache_creation;
  if (cacheCreation && typeof cacheCreation === 'object' && !Array.isArray(cacheCreation)) {
    let breakdown = 0;
    for (const name of ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']) {
      if (!Object.hasOwn(cacheCreation, name)) continue;
      const value = cacheCreation[name];
      if (!Number.isSafeInteger(value) || value < 0) invalid.push(`cache_creation.${name}`);
      else breakdown += value;
    }
    if (!Object.hasOwn(source, 'cache_creation_input_tokens') && breakdown > 0) {
      missing.push('cache_creation_input_tokens');
      cacheCreationInputTokens = breakdown;
    }
  }
  const reasoningTokens = count('reasoning_tokens');
  const inputTokens = uncachedInputTokens + cachedInputTokens + cacheCreationInputTokens;
  if (!Number.isSafeInteger(inputTokens)) invalid.push('total_input_tokens');
  if (!Number.isSafeInteger(inputTokens + outputTokens)) invalid.push('total_tokens');
  return {
    complete: missing.length === 0 && invalid.length === 0,
    status: invalid.length ? 'invalid' : missing.length ? 'missing' : 'complete',
    missing, invalid, uncachedInputTokens, outputTokens, cachedInputTokens,
    cacheCreationInputTokens, reasoningTokens, inputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}
