import { ToolFeedbackError } from './tool-feedback.mjs';

export function patchEdits(input) {
  const batch = Object.hasOwn(input, 'edits');
  if (batch && (Object.hasOwn(input, 'search') || Object.hasOwn(input, 'replace'))) {
    throw new ToolFeedbackError('INPUT_INVALID', 'Use edits OR a single search/replace pair, not both');
  }
  const entries = batch ? input.edits : [{ search: input.search, replace: input.replace }];
  if (!Array.isArray(entries) || !entries.length || entries.length > 32) {
    throw new ToolFeedbackError('INPUT_INVALID', 'apply_patch edits must contain 1 through 32 replacements');
  }
  return Object.freeze(Array.from(entries, entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some(key => !['search', 'replace'].includes(key))
      || typeof entry.search !== 'string' || !entry.search.length || typeof entry.replace !== 'string') {
      throw new ToolFeedbackError('INPUT_INVALID', 'apply_patch requires a non-empty search string and a replace string for each edit. To create a new file, use write_file with path and content');
    }
    return Object.freeze({ search: entry.search, replace: entry.replace });
  }));
}

// Resolve every edit against the original. No write occurs on any invalid edit.
export function applyExactEdits(source, edits) {
  const spans = edits.map(({ search, replace }) => {
    const start = source.indexOf(search);
    if (start < 0) throw new ToolFeedbackError('PATCH_NOT_FOUND', 'Patch search text was not found; all edits remain unapplied');
    if (source.indexOf(search, start + 1) >= 0) {
      throw new ToolFeedbackError('PATCH_AMBIGUOUS', 'Patch search text is ambiguous; include more surrounding lines');
    }
    return { start, end: start + search.length, replace };
  }).sort((a, b) => a.start - b.start);
  let cursor = 0, result = '';
  for (const span of spans) {
    if (span.start < cursor) throw new ToolFeedbackError('PATCH_OVERLAP', 'Patch edits overlap in the original file; merge them into one edit');
    result += source.slice(cursor, span.start) + span.replace;
    cursor = span.end;
  }
  return result + source.slice(cursor);
}
