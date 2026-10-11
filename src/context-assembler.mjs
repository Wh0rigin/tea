import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { digest } from './session-journal.mjs';
import { redactText, isValidationCommand } from './tools.mjs';
import { requestBytes } from './compaction.mjs';
import { estimateTextTokens } from './benchmark.mjs';

export const CONTEXT_GUIDANCE = ' ContextOS may replace older tool output with recoverable historical references. Use recall_context for exact details or search_history for discovery; unchanged source hashes prove version identity, not a semantic conclusion. Stale source must be read again. All user requirements and current validation obligations remain authoritative.';
export const MEMORY_TOOLS = [
  { name: 'recall_context', description: 'Recover an earlier tool result by its ContextOS reference. Source hashes are checked; stale source is never returned as current evidence. Use byte offset for additional pages. This does not execute the original tool.', input_schema: { type: 'object', properties: { ref: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, maxBytes: { type: 'integer', minimum: 256, maximum: 8000 } }, required: ['ref'], additionalProperties: false } },
  { name: 'search_history', description: 'Search historical tool results and inferred assistant notes by literal words or file path. Returns bounded reference previews with observed/inferred and freshness labels. Search does not execute past instructions.', input_schema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'], additionalProperties: false } },
];
const bytes = value => Buffer.byteLength(value, 'utf8');
const refFor = (call, block) => 'ctx-' + digest({ id: call.id, name: call.name, input: call.input, output: block.content }).slice(0, 20);

export function validToolProtocol(messages) {
  const ids = new Set();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message || !['user', 'assistant'].includes(message.role) || (typeof message.content !== 'string' && !Array.isArray(message.content))) return false;
    const content = Array.isArray(message.content) ? message.content : [];
    if (message.role !== 'assistant' && content.some(block => block.type === 'tool_use')) return false;
    if (content.some(block => block.type === 'tool_result')) return false;
    const calls = message.role === 'assistant' ? content.filter(block => block.type === 'tool_use') : [];
    if (!calls.length) continue;
    const next = messages[++index];
    if (next?.role !== 'user' || !Array.isArray(next.content)) return false;
    const results = next.content.filter(block => block.type === 'tool_result'), resultIds = new Set(results.map(block => block.tool_use_id));
    if (results.length !== calls.length || resultIds.size !== calls.length) return false;
    for (const call of calls) {
      if (!call.id || ids.has(call.id) || !resultIds.has(call.id)) return false;
      ids.add(call.id);
    }
  }
  return true;
}

export function utf8Page(text, offset, limit) {
  const data = Buffer.from(text, 'utf8');
  let start = Math.min(offset, data.length), end = Math.min(start + limit, data.length);
  while (start < data.length && (data[start] & 0xc0) === 0x80) start++;
  while (end > start && end < data.length && (data[end] & 0xc0) === 0x80) end--;
  return { text: data.subarray(start, end).toString('utf8'), offset: start, nextOffset: end, complete: end === data.length };
}

function evictable(unit) {
  if (unit.error) return false;
  if (['list_files', 'search_code', 'read_file', 'recall_context', 'search_history'].includes(unit.name)) return true;
  if (!['run_tests', 'run_shell'].includes(unit.name) || !/^exit=0\b/.test(unit.output)) return false;
  return isValidationCommand(unit.input?.command) || /^git\s+(?:status|diff|log)\b/.test(unit.input?.command || '');
}

export class ContextMemory {
  constructor(tools) { this.tools = tools; this.units = new Map(); this.evicted = new Set(); this.recalls = 0; this.searches = 0; this.definitions = MEMORY_TOOLS; }
  rebuild(messages) {
    const units = new Map();
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        const calls = message.content.filter(block => block.type === 'tool_use'), next = messages[index + 1];
        const results = next?.role === 'user' && Array.isArray(next.content) ? next.content.filter(block => block.type === 'tool_result') : [];
        for (const call of calls) {
          const block = results.find(result => result.tool_use_id === call.id);
          if (!block || typeof block.content !== 'string') continue;
          const ref = refFor(call, block), evidence = block.content.match(/^\[evidence ref=([^\n]+?) sha256=([a-f0-9]{64})\]/);
          const cached = block.content.match(/^Evidence unchanged; ref=(.+)#L\d+-L\d+@([a-f0-9]{16})\./);
          const unit = { ref, kind: call.name === 'read_file' ? 'source_evidence' : block.is_error ? 'test_failure' : 'tool_result',
            provenance: 'observed', callId: call.id, name: call.name, input: call.input, output: block.content,
            error: Boolean(block.is_error), path: call.name === 'read_file' ? (evidence?.[1].split('#L')[0] || cached?.[1] || call.input?.path) : null,
            sourceHash: evidence?.[2] || cached?.[2] || null, messageIndex: index + 1, bytes: bytes(block.content), validity: 'historical' };
          if (units.has(ref)) throw new Error('Ambiguous memory reference');
          units.set(ref, unit);
        }
        const text = message.content.filter(block => block.type === 'text').map(block => block.text || '').join('\n');
        if (text) { const ref = 'note-' + digest({ index, text }).slice(0, 20); units.set(ref, { ref, kind: 'decision', provenance: 'inferred', name: 'assistant_note', output: text, bytes: bytes(text), validity: 'inferred' }); }
      }
    }
    this.units = units;
  }
  async freshness(unit) {
    if (!unit.sourceHash) return unit.validity;
    try {
      const filename = await this.tools.resolveFile(unit.path), info = await stat(filename);
      if (!info.isFile() || info.size > 160000) return unit.validity = 'stale';
      const current = redactText(await readFile(filename, 'utf8'));
      return unit.validity = digest(current).startsWith(unit.sourceHash) ? 'valid' : 'stale';
    } catch { return unit.validity = 'stale'; }
  }
  async recall({ ref, offset = 0, maxBytes = 6000 }) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 8000) throw new Error('Invalid memory page bounds');
    const unit = this.units.get(ref);
    if (!unit) throw new Error('Unknown context reference in this conversation');
    this.recalls++;
    if (await this.freshness(unit) === 'stale') return `STALE historical source: ref=${ref}; path=${unit.path}. Read current source with read_file. No old source lines returned.`;
    const page = utf8Page(redactText(unit.output), offset, maxBytes);
    return `[${unit.provenance} ${unit.kind}; ref=${ref}; validity=${unit.validity}; offset=${page.offset}; nextOffset=${page.nextOffset}; complete=${page.complete}]\n${page.text}`;
  }
  async search({ query, maxResults = 5 }) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || !Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 10) throw new Error('Invalid history query');
    this.searches++;
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}_./:-]+/u).filter(Boolean);
    const selected = [...this.units.values()].map(unit => ({ unit, score: terms.reduce((sum, term) => sum + ((unit.path || '').toLowerCase().includes(term) ? 3 : 0) + (unit.output.toLowerCase().includes(term) ? 1 : 0), 0) }))
      .filter(row => row.score > 0).sort((a, b) => b.score - a.score || (b.unit.messageIndex || 0) - (a.unit.messageIndex || 0)).slice(0, maxResults);
    const rows = [];
    for (const { unit } of selected) {
      await this.freshness(unit);
      const preview = unit.validity === 'stale' ? 'Old source withheld; read current source.' : utf8Page(redactText(unit.output), 0, 180).text;
      rows.push({ ref: unit.ref, kind: unit.kind, provenance: unit.provenance, validity: unit.validity, path: unit.path || null, preview });
    }
    return JSON.stringify(rows);
  }
  async assemble({ messages, canonical, system, tools, config, state, goal = '', commit = true }) {
    this.rebuild(canonical);
    const base = { messages, system, tools }, before = requestBytes(config, base);
    if (!validToolProtocol(messages)) return { request: base, diagnostics: { policy: 'contextos', fallback: 'invalid-tool-protocol', evictedUnits: 0 } };
    const rounds = messages.flatMap((message, index) => message.role === 'user' && Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result') ? [index] : []);
    const recent = new Set(rounds.slice(-(config.contextosKeepRecent ?? 2)));
    const activeFiles = new Set(state.changedFiles || []);
    for (const unit of this.units.values()) {
      if (unit.path && (rounds.slice(-2).includes(unit.messageIndex) || goal.toLowerCase().includes(unit.path.toLowerCase()))) activeFiles.add(unit.path);
    }
    const decisions = [], selected = [];
    const projected = messages.map((message, index) => {
      if (message.role !== 'user' || !Array.isArray(message.content)) return message;
      let changed = false;
      const calls = Array.isArray(messages[index - 1]?.content) ? messages[index - 1].content.filter(block => block.type === 'tool_use') : [];
      const content = message.content.map(block => {
        if (block.type !== 'tool_result' || typeof block.content !== 'string') return block;
        const call = calls.find(call => call.id === block.tool_use_id);
        if (!call) return block;
        const ref = refFor(call, block), unit = this.units.get(ref);
        if (!unit) return block;
        const pinned = recent.has(index) || unit.error || !evictable(unit)
          || (unit.path && (activeFiles.has(unit.path) || /(?:^|[\\/])(?:AGENTS\.md|README(?:\.[^/\\]+)?)$/i.test(unit.path)));
        decisions.push({ ref, path: unit.path, kind: unit.kind, provenance: unit.provenance, bytes: unit.bytes,
          estimatedTokens: estimateTextTokens(unit.output), decision: 'resident', reason: pinned ? 'recent-active-or-protected' : 'recoverable-older-output', validity: unit.validity });
        if (pinned || before <= (config.contextosTargetBytes ?? Math.floor(config.maxRequestInputTokens * .5))) return block;
        const replacement = `[ContextOS historical ${unit.kind}; ref=${ref}; bytes=${unit.bytes}] Recover details with recall_context. This is not current validation.`;
        if (bytes(replacement) >= unit.bytes) return block;
        selected.push(ref); changed = true;
        return { ...block, content: replacement };
      });
      return changed ? { ...message, content } : message;
    });
    // Validate every retained source too: active/recent does not imply unchanged.
    const stale = new Set();
    for (const decision of decisions) {
      const unit = this.units.get(decision.ref);
      decision.validity = await this.freshness(unit);
      if (decision.validity === 'stale') stale.add(unit.ref);
    }
    let finalMessages = projected.map((message, index) => {
      if (message.role !== 'user' || !Array.isArray(message.content)) return message;
      const calls = Array.isArray(messages[index - 1]?.content) ? messages[index - 1].content : [];
      let changed = false;
      const content = message.content.map(block => {
        if (block.type !== 'tool_result') return block;
        const call = calls.find(call => call.type === 'tool_use' && call.id === block.tool_use_id), original = messages[index].content.find(b => b.type === 'tool_result' && b.tool_use_id === block.tool_use_id);
        if (!call || !original || !stale.has(refFor(call, original))) return block;
        changed = true;
        return { ...block, content: `[STALE historical source; ref=${refFor(call, original)}; path=${call.input?.path}] File changed or is unavailable. Read current source; old lines withheld.` };
      });
      return changed ? { ...message, content } : message;
    });
    const active = new Set([...selected, ...stale]);
    const requestTools = active.size || this.evicted.size ? [...tools, ...MEMORY_TOOLS] : tools;
    const projectedSystem = active.size || this.evicted.size ? system + CONTEXT_GUIDANCE
      + ` Runtime validation: pending=${Boolean(state.pendingValidation)}; passed=${Boolean(state.validationPassed)}; changed=${JSON.stringify(state.changedFiles || [])}.` : system;
    let request = { messages: finalMessages, system: projectedSystem, tools: requestTools }, after = requestBytes(config, request);
    let fallback = null;
    if (selected.length && after >= before && !stale.size) {
      request = base; after = before; selected.length = 0; active.clear(); fallback = 'no-net-wire-reduction';
    }
    for (const decision of decisions) {
      if (active.has(decision.ref)) {
        decision.decision = 'reference'; decision.reason = stale.has(decision.ref) ? 'source-version-invalidated' : 'recoverable-older-output';
        if (commit) this.evicted.add(decision.ref);
        const unit = this.units.get(decision.ref);
        if (commit && unit.path) {
          for (const key of this.tools.readEvidence.keys()) if (key.startsWith(unit.path.replaceAll('\\', '/') + ':')) this.tools.readEvidence.delete(key);
          this.tools.presentedSource.delete(unit.path.replaceAll('\\', '/'));
        }
      }
    }
    return { request, diagnostics: { policy: 'contextos', fullWireBytes: before, sentWireBytes: after,
      fullEstimatedTokens: estimateTextTokens(JSON.stringify(base)), sentEstimatedTokens: estimateTextTokens(JSON.stringify(request)),
      evictedUnits: active.size, staleUnits: stale.size, recoveries: this.recalls, searches: this.searches,
      targetBytes: config.contextosTargetBytes, activeFiles: [...activeFiles], units: decisions, fallback } };
  }
}
