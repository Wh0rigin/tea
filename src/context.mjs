const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'bug', 'by', 'change', 'code', 'do', 'does', 'file', 'fix',
  'for', 'from', 'function', 'given', 'if', 'in', 'into', 'is', 'it', 'make', 'module', 'of', 'on', 'or',
  'preserve', 'same', 'should', 'support', 'task', 'test', 'that', 'the', 'this', 'to', 'update', 'with', 'without',
]);

const ALWAYS_INCLUDE = /^(?:readme(?:\..*)?|agents\.md|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|pom\.xml|cargo\.toml|go\.mod)$/i;
const QUERY_GROUPS = [
  ['session', 'signed', 'signin', 'login', 'authentication', 'auth', 'credential', 'credentials', 'cookie'],
  ['expiration', 'expire', 'expired', 'expiry', 'invalid', 'lifetime', 'ttl', 'period', 'deadline'],
  ['refresh', 'renew', 'renewal', 'regenerate', 'rotate', 'rotation', 'synchronize', 'synchronization', 'sync'],
  ['stale', 'outdated', 'obsolete', 'cached'],
  ['retry', 'repeat', 'attempt', 'attempts', 'transient', 'temporary', 'backoff'],
  ['http', 'request', 'transport', 'network'],
];

function splitTerms(text) {
  const separated = String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const terms = new Set((separated.match(/[\p{L}\p{N}]+/gu) || []).filter((term) => term.length > 1 && !STOP_WORDS.has(term)));
  for (const sequence of separated.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || []) {
    for (let index = 0; index < sequence.length - 1; index += 1) terms.add(sequence.slice(index, index + 2));
  }
  return terms;
}

function fileTerms(filename) {
  return splitTerms(filename.replaceAll('\\', '/').replaceAll('/', ' '));
}

function scorePath(taskTerms, filename) {
  const terms = fileTerms(filename);
  let score = 0;
  for (const term of taskTerms) {
    if (terms.has(term)) score += 5;
    else if (term.length >= 4 && [...terms].some((candidate) => candidate.length >= 4 && (candidate.includes(term) || term.includes(candidate)))) score += 2;
  }
  const depth = filename.split(/[\\/]/).length;
  if (depth === 1 && ALWAYS_INCLUDE.test(filename)) score += 4;
  if (/(^|\/)(test|tests|spec|specs)(\/|$)/i.test(filename) && taskTerms.has('test')) score += 3;
  return score;
}

function expandedTaskTerms(task) {
  const terms = splitTerms(task);
  for (const group of QUERY_GROUPS) {
    if (group.some((term) => terms.has(term))) for (const term of group) terms.add(term);
  }
  return terms;
}

export function rankFilesForTask(task, files, limit = 8, { queryExpansion = false } = {}) {
  const count = Math.max(1, Math.min(250, Math.floor(Number(limit) || 8)));
  const taskTerms = queryExpansion ? expandedTaskTerms(task) : splitTerms(task);
  const unique = [...new Set(files.map((file) => String(file).replaceAll('\\', '/')))].sort((a, b) => a.localeCompare(b));
  const ranked = unique.map((file) => ({ file, score: scorePath(taskTerms, file) }))
    .sort((a, b) => b.score - a.score || a.file.length - b.file.length || a.file.localeCompare(b.file));
  const pinned = ranked.filter(({ file }) => /(^|\/)agents\.md$/i.test(file) || (file.split('/').length === 1 && ALWAYS_INCLUDE.test(file)));
  const selected = [];
  const append = (file) => { if (selected.length < count && !selected.includes(file)) selected.push(file); };
  for (const item of pinned) append(item.file);
  for (const item of ranked) append(item.file);
  return selected;
}

export function buildProgressiveInventory(task, files, { limit = 8, queryExpansion = false } = {}) {
  const normalized = [...new Set(files.map((file) => String(file).replaceAll('\\', '/')))].sort((a, b) => a.localeCompare(b));
  let queryExpansionApplied = queryExpansion === true;
  if (queryExpansion === 'auto') {
    const taskTerms = splitTerms(task);
    const lexicalBest = normalized.reduce((best, file) => {
      if (file.split('/').length === 1 && ALWAYS_INCLUDE.test(file)) return best;
      return Math.max(best, scorePath(taskTerms, file));
    }, 0);
    queryExpansionApplied = lexicalBest < 5;
  }
  const selected = normalized.length <= limit ? normalized : rankFilesForTask(task, normalized, limit, { queryExpansion: queryExpansionApplied });
  const partial = selected.length < normalized.length;
  const headings = [
    `Text-file inventory: ${normalized.length} indexed; showing ${selected.length}${partial ? ' likely paths (partial)' : ' paths (complete)'}.`,
    ...(partial ? ['This list is ranked by task/path term overlap, not proof of relevance. Use list_files or search_code to expand it when needed.'] : []),
  ];
  return {
    text: `${headings.join('\n')}\n${selected.join('\n') || '(no text files found)'}`,
    totalFiles: normalized.length,
    selectedFiles: selected,
    relevantFilesVisible: null,
    queryExpansionApplied,
  };
}

export function buildBaselineInventory(files, limit = 160) {
  const normalized = files.map((file) => String(file).replaceAll('\\', '/'));
  const selected = normalized.slice(0, Math.max(1, Math.min(700, Math.floor(Number(limit) || 160))));
  return {
    text: `Initial text-file listing (${selected.length}${selected.length < normalized.length ? ` of ${normalized.length}` : ''}):\n${selected.join('\n') || '(no text files found)'}`,
    totalFiles: normalized.length,
    selectedFiles: selected,
    relevantFilesVisible: null,
  };
}

export function buildSyntheticInventory(spec) {
  const files = [...(spec.rootFiles || [])];
  const count = Math.max(0, Math.min(5000, Number(spec.decoyCount) || 0));
  const prefixes = spec.decoyPrefixes || ['archive/record', 'docs/history/page'];
  for (let index = 0; index < count; index += 1) {
    const prefix = prefixes[index % prefixes.length];
    const extension = prefix.includes('record') ? '.md' : '.js';
    files.push(`${prefix}-${String(index).padStart(4, '0')}${extension}`);
  }
  files.push(...(spec.relevantFiles || []));
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

export function retrievalRecall(expectedFiles, selectedFiles) {
  const selected = new Set(selectedFiles.map((file) => file.replaceAll('\\', '/')));
  const expected = expectedFiles.map((file) => file.replaceAll('\\', '/'));
  const found = expected.filter((file) => selected.has(file));
  return { expected: expected.length, found: found.length, recall: expected.length ? found.length / expected.length : null, missing: expected.filter((file) => !selected.has(file)) };
}
