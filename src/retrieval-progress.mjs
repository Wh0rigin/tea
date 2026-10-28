import { createHash } from 'node:crypto';

const RETRIEVAL = new Set(['read_file', 'search_code', 'list_files', 'recall_context', 'search_history']);
const digest = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const RETRIEVAL_NOTICE = '[Runtime retrieval feedback; not a user requirement] Recent lookups repeated identical request/result text. Reuse evidence if it is still visible, or change query/scope and read the needed range. Re-read missing/stale evidence. Repetition does not prove source freshness; do not edit before understanding.';

// Observational, per-turn and bounded. It never caches a tool execution or source body.
export class RetrievalProgress {
  constructor() {
    this.seen = new Map();
    this.repeated = 0;
    this.observed = 0;
    this.notices = 0;
    this.lastNotice = -Infinity;
    this.checkpoint = null;
  }
  invalidate() { this.seen.clear(); this.repeated = 0; }
  beginBatch(checkpoint) {
    if (checkpoint !== this.checkpoint) { this.invalidate(); this.checkpoint = checkpoint; }
  }
  observe(name, input, output, isError = false) {
    // Even a shell command or failed operation can change files or reveal new facts.
    if (isError || !RETRIEVAL.has(name)) { this.invalidate(); return; }
    this.observed++;
    const key = digest(JSON.stringify([name, canonical(input)])), result = digest(String(output));
    this.repeated = this.seen.get(key) === result ? this.repeated + 1 : 0;
    this.seen.delete(key); this.seen.set(key, result);
    if (this.seen.size > 64) this.seen.delete(this.seen.keys().next().value);
  }
  notice() {
    if (this.repeated < 3 || this.notices >= 2 || this.observed - this.lastNotice < 12) return null;
    const event = { type: 'retrieval_progress', noticeNumber: ++this.notices,
      consecutiveRepeatedOutputs: this.repeated, observedRetrievals: this.observed };
    this.lastNotice = this.observed;
    this.repeated = 0;
    return event;
  }
}
