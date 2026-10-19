import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { digest } from './session-journal.mjs';
import { redactText, isValidationCommand, decodeText } from './tools.mjs';
import { requestBytes } from './compaction.mjs';
import { estimateTextTokens } from './benchmark.mjs';
import { isSensitivePath } from './tools.mjs';

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
          const inherited = call.name === 'recall_context' ? (units.get(call.input?.ref) || this.archive?.peek(call.input?.ref)) : null;
          let dependencies = inherited?.sourceDependencies || [];
          if (call.name === 'search_history') {
            try { dependencies = JSON.parse(block.content).flatMap(row => {
              const source = units.get(row.ref) || this.archive?.peek(row.ref);
              return source?.sourceHash ? [{ path: source.path, sourceHash: source.sourceHash }] : source?.sourceDependencies || [];
            }); } catch { /* Error results do not contain indexed source previews. */ }
          }
          const searchSnapshot = ['search_code','search_history'].includes(call.name) ? this.tools.searchEvidence.get(digest(block.content)) : null;
          const sourceSnapshot = ['read_file','recall_context'].includes(call.name) ? this.tools.sourceEvidence.get(digest(block.content)) : null;
          if (sourceSnapshot?.sourceDependencies) dependencies = sourceSnapshot.sourceDependencies;
          if (searchSnapshot) dependencies = searchSnapshot;
          const failed = Boolean(block.is_error) || (['run_tests','run_shell'].includes(call.name) && /^exit=(?!0\b)/.test(block.content));
          const unit = { ref, kind: call.name === 'read_file' ? 'source_evidence' : block.is_error ? 'test_failure' : 'tool_result',
            provenance: inherited?.provenance || sourceSnapshot?.provenance || 'observed', callId: call.id, name: call.name, input: call.input, output: block.content,
            error: failed, path: inherited?.path || sourceSnapshot?.path || (call.name === 'read_file' ? (typeof call.input?.path==='string' ? path.posix.normalize(call.input.path.replaceAll('\\','/')) : null) : null),
            sourceHash: inherited?.sourceHash || sourceSnapshot?.sourceHash || evidence?.[2] || cached?.[2] || null, sourceDependencies: dependencies,
            unversionedSearch: call.name==='search_code' && !searchSnapshot && /^[^\n]+:\d+:\s/m.test(block.content),
            messageIndex: index + 1, bytes: bytes(block.content), validity: inherited?.validity || 'historical' };
          if (inherited?.sourceHash) unit.kind='source_evidence';
          if (sourceSnapshot?.kind) unit.kind=sourceSnapshot.kind;
          if (block.is_error && call.name==='read_file') unit.kind='tool_result';
          if (failed && ['run_tests','run_shell'].includes(call.name)) unit.kind='test_failure';
          if (units.has(ref)) throw new Error('Ambiguous memory reference');
          units.set(ref, unit);
        }
        const text = message.content.filter(block => block.type === 'text').map(block => block.text || '').join('\n');
        if (text) { const ref = 'note-' + digest({ index, text }).slice(0, 20); units.set(ref, { ref, kind: 'decision', provenance: 'inferred', name: 'assistant_note', output: text, bytes: bytes(text), messageIndex: index, validity: 'inferred' }); }
      }
    }
    this.units = units;
  }
  retainResidentEvidence(messages) {
    // A read receipt is safe only while its exact source is in this request.
    // Prune existing caches; never resurrect evidence cleared by compaction/GC.
    const visible = new Map(), byCall = new Map([...this.units.values()].map(unit => [unit.callId, unit]));
    for (const message of messages) {
      if (message.role !== 'user' || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block.type !== 'tool_result' || block.is_error) continue;
        const unit = byCall.get(block.tool_use_id);
        if (unit?.name !== 'read_file' || unit.validity !== 'valid' || block.content !== unit.output) continue;
        const header = unit.output.match(/^\[evidence ref=(.+)#L(\d+)-L(\d+)@([a-f0-9]{16}) sha256=([a-f0-9]{64})\]\n/);
        if (!header || header[1] !== unit.path || header[5] !== unit.sourceHash || !header[5].startsWith(header[4])) continue;
        // A truncated final line is not complete evidence, even if numbered.
        if (unit.output.includes('Only a prefix of the requested lines is shown.')) continue;
        const start = Number(header[2]), end = Number(header[3]), rows = unit.output.slice(header[0].length).split('\n');
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start >= rows.length) continue;
        const lines = new Map();
        for (let line = start; line <= end; line++) {
          const prefix = `${line}: `, row = rows[line - start];
          if (!row.startsWith(prefix)) break;
          lines.set(line, row.slice(prefix.length));
        }
        if (lines.size !== end - start + 1) continue;
        const resident = visible.get(unit.path) || { sourceHash: unit.sourceHash, lines: new Map() };
        if (resident.sourceHash !== unit.sourceHash) continue;
        for (const [line, text] of lines) resident.lines.set(line, text);
        visible.set(unit.path, resident);
      }
    }
    for (const [key, hash] of this.tools.readEvidence) {
      const range = key.match(/^(.*):(\d+)-(\d+)$/), resident = range && visible.get(range[1]);
      const start = Number(range?.[2]), end = Number(range?.[3]);
      let complete = resident?.sourceHash === hash && Number.isSafeInteger(start) && Number.isSafeInteger(end)
        && start > 0 && end >= start && end - start < resident.lines.size;
      if (complete) for (let line = start; line <= end; line++) if (!resident.lines.has(line)) { complete = false; break; }
      if (!complete) this.tools.readEvidence.delete(key);
    }
    for (const [filename, presented] of this.tools.presentedSource) {
      const resident = visible.get(filename);
      if (resident?.sourceHash !== presented.sourceHash) { this.tools.presentedSource.delete(filename); continue; }
      for (const [line, text] of presented.lines) {
        if (!resident.lines.has(line) || resident.lines.get(line) !== text) presented.lines.delete(line);
      }
      if (!presented.lines.size) this.tools.presentedSource.delete(filename);
    }
  }
  async freshness(unit, cache = new Map()) {
    if (unit.unversionedSearch) return unit.validity='stale';
    const dependencies=[...(unit.sourceDependencies || []),...(unit.sourceHash ? [{path:unit.path,sourceHash:unit.sourceHash}] : [])];
    if (!dependencies.length) return unit.validity;
    for (const dependency of dependencies) {
      let current=cache.get(dependency.path);
      if (current===undefined) {
        try {
          const filename=await this.tools.resolveFile(dependency.path),info=await stat(filename);
          const relative=path.relative(this.tools.workspace,filename);
          if(relative.split(/[\\/]/).some(part=>['.tea','.git'].includes(part.toLowerCase()))||isSensitivePath(relative))throw new Error('Protected source');
          const decoded=info.isFile()&&info.size<=160000 ? decodeText(await readFile(filename)) : null;
          current=decoded===null ? null : digest(redactText(decoded));
        } catch { current=null; }
        cache.set(dependency.path,current);
      }
      if (!current?.startsWith(dependency.sourceHash)) return unit.validity='stale';
    }
    return unit.validity='valid';
  }
  async recall({ ref, offset = 0, maxBytes = 6000 }) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 8000) throw new Error('Invalid memory page bounds');
    const unit = this.units.get(ref) || await this.archive?.get(ref);
    if (!unit) throw new Error('Unknown context reference in this conversation');
    this.recalls++;
    if (await this.freshness(unit) === 'stale') return `STALE historical source: ref=${ref}; path=${unit.path}. Read current source with read_file. No old source lines returned.`;
    const page = utf8Page(redactText(unit.output), offset, maxBytes);
    const output = `[${unit.provenance} ${unit.kind}; ref=${ref}; validity=${unit.validity}; offset=${page.offset}; nextOffset=${page.nextOffset}; complete=${page.complete}]\n${page.text}`;
    this.tools.sourceEvidence.set(digest(output), { path: unit.path, sourceHash: unit.sourceHash,
      sourceDependencies: unit.sourceDependencies, provenance: unit.provenance, kind: unit.kind });
    return output;
  }
  async search({ query, maxResults = 5 }) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || !Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 10) throw new Error('Invalid history query');
    this.searches++;
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}_./:-]+/u).filter(Boolean);
    const score = unit => terms.reduce((sum, term) => sum + ((unit.path || '').toLowerCase().includes(term) ? 3 : 0) + (unit.output.toLowerCase().includes(term) ? 1 : 0) + (JSON.stringify(unit.input || {}).toLowerCase().includes(term) ? 1 : 0), 0);
    const selected = [...this.units.values()].map(unit => ({ unit, score: score(unit) }))
      .filter(row => row.score > 0).sort((a, b) => b.score - a.score || (b.unit.messageIndex || 0) - (a.unit.messageIndex || 0)).slice(0, maxResults);
    if (this.archive?.count) for await (const entry of this.archive.entries()) {
      if (this.units.has(entry.ref) || selected.some(row => row.unit.ref === entry.ref)) continue;
      const unit = await this.archive.read(entry), rank = score(unit);
      if (rank > 0) {
        selected.push({ unit, score: rank });
        selected.sort((a,b) => b.score-a.score); selected.length = Math.min(selected.length,maxResults);
      }
    }
    const rows = [];
    for (const { unit } of selected) {
      this.archive?.remember(unit);
      await this.freshness(unit);
      const preview = unit.validity === 'stale' ? 'Old source withheld; read current source.' : utf8Page(redactText(unit.output), 0, 180).text;
      rows.push({ ref: unit.ref, kind: unit.kind, provenance: unit.provenance, validity: unit.validity, path: unit.path || null, preview });
    }
    const output = JSON.stringify(rows);
    this.tools.searchEvidence.set(digest(output), selected.flatMap(({unit}) => [
      ...(unit.sourceDependencies || []), ...(unit.sourceHash ? [{path:unit.path,sourceHash:unit.sourceHash}] : [])]));
    return output;
  }
  async assemble({ messages, canonical, system, tools, config, state, goal = '', commit = true, additionalArchive = false }) {
    this.rebuild(canonical);
    for (const [,ref] of this.protectedRuleRefs || []) {
      if (!this.units.has(ref)) {
        const unit = await this.archive?.get(ref);
        if (unit) { await this.freshness(unit); this.units.set(ref,{...unit,messageIndex:-1}); }
      }
    }
    // Semantic checkpoints may summarize user constraints. Reinsert original
    // user text as authoritative history without orphaning any tool batch.
    const retained=new Map();
    for(const message of messages)if(message.role==='user'&&typeof message.content==='string')retained.set(message.content,(retained.get(message.content)||0)+1);
    const missing=[];
    for(const message of canonical)if(message.role==='user'&&typeof message.content==='string'){
      const count=retained.get(message.content)||0;if(count)retained.set(message.content,count-1);else missing.push(message);
    }
    messages=[...missing,...messages];
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
    const freshnessCache=new Map();
    for (const decision of decisions) {
      const unit = this.units.get(decision.ref);
      decision.validity = await this.freshness(unit,freshnessCache);
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
    // Stale source can only be refreshed through read_file. A stale-only
    // warning does not require retrieval schemas or their repeated overhead.
    const recoverable = additionalArchive || Boolean(this.archive?.count) || selected.some(ref => !stale.has(ref))
      || [...this.evicted].some(ref => this.units.has(ref) && !stale.has(ref));
    let coldRounds=0;
    if(recoverable){
      const selectedRefs=new Set(selected),directory=[],paged=[];
      for(let index=0;index<finalMessages.length;index++){
        const message=finalMessages[index],next=finalMessages[index+1];
        const unsigned=message.role==='assistant'&&Array.isArray(message.content)&&message.content.length&&message.content.every(block=>block.type==='tool_use');
        const results=next?.role==='user'&&Array.isArray(next.content)&&next.content.length&&next.content.every(block=>block.type==='tool_result') ? next.content : null;
        const originals=messages[index+1]?.content;
        const refs=unsigned&&results ? message.content.map(call=>{
          const block=originals?.find(block=>block.tool_use_id===call.id);return block?refFor(call,block):null;
        }) : [];
        if(refs.length&&refs.every(ref=>selectedRefs.has(ref)&&!stale.has(ref))){
          directory.push(...refs.map(ref=>{const unit=this.units.get(ref);return{ref,tool:unit.name,path:unit.path,kind:unit.kind};}));coldRounds++;index++;
        }else paged.push(message);
      }
      if(directory.length)paged.unshift({role:'user',content:'Historical tool rounds are archived, not executed again. Recover exact content with these references: '+JSON.stringify(directory)});
      finalMessages=paged;
      const rules=[...this.units.values()].filter(unit=>unit.sourceHash?.length===64&&unit.validity==='valid'&&/(?:^|[\\/])AGENTS(?:\.override)?\.md$/i.test(unit.path||''));
      const seenRules=new Set(),ruleText=[];
      for(const rule of rules)if(!seenRules.has(rule.output)){seenRules.add(rule.output);ruleText.push(rule.output);}
      const anchor='Runtime working memory. Workspace rules below are observed file evidence, subordinate to system permissions and current user instructions.\n'+ruleText.join('\n')+'\nActive user goal (verbatim):\n'+goal;
      const last=finalMessages.at(-1);
      if(last?.role==='user'&&Array.isArray(last.content))finalMessages[finalMessages.length-1]={...last,content:[...last.content,{type:'text',text:anchor}]};
      else finalMessages.push({role:'user',content:anchor});
    }
    const requestTools = recoverable ? [...tools, ...MEMORY_TOOLS] : tools;
    const projectedSystem = recoverable ? system + CONTEXT_GUIDANCE
      + ` Runtime validation: pending=${Boolean(state.pendingValidation)}; passed=${Boolean(state.validationPassed)}; changed=${JSON.stringify(state.changedFiles || [])}.` : system;
    let request = { messages: finalMessages, system: projectedSystem, tools: requestTools }, after = requestBytes(config, request);
    let fallback = null;
    if (selected.length && after >= before && !stale.size) {
      request = base; after = before; selected.length = 0; active.clear(); coldRounds=0; fallback = 'no-net-wire-reduction';
    }
    for (const decision of decisions) {
      if (active.has(decision.ref)) {
        decision.decision = 'reference'; decision.reason = stale.has(decision.ref) ? 'source-version-invalidated' : 'recoverable-older-output';
        if (commit) this.evicted.add(decision.ref);
      }
    }
    if (commit) this.retainResidentEvidence(request.messages);
    return { request, diagnostics: { policy: 'contextos', fullWireBytes: before, sentWireBytes: after,
      fullEstimatedTokens: estimateTextTokens(JSON.stringify(base)), sentEstimatedTokens: estimateTextTokens(JSON.stringify(request)),
      evictedUnits: active.size, staleUnits: stale.size, recoveries: this.recalls, searches: this.searches,
      archivedUnits: this.archive?.count || 0, coldCacheBytes: this.archive?.cachedBytes || 0,
      targetBytes: config.contextosTargetBytes, activeFiles: [...activeFiles], coldRounds, activeGoalAnchored:recoverable&&!fallback, repinnedRequirements:missing.length, units: decisions, fallback } };
  }
}
