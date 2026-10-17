// A small interpreted JavaScript subset, never eval/Function/vm. No host objects enter its scope.
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const functions = new Set(['search', 'list', 'read', 'readHit', 'history', 'recall', 'take', 'empty', 'emit']);
export const RETRIEVAL_TOOL = {
  name: 'retrieve_code',
  description: 'Combine dependent read-only retrieval in one call. Restricted JS: let/const, assignment, if/else, for(const x of array), await, objects/arrays, own fields/indexes. APIs: search({query,path,maxResults,offset,startLine,includeOmitted})->{items:[{path,line,text}],coverage,complete,nextOffset,nextLine}; list({path,maxFiles,offset,includeOmitted})->{items:[paths],complete,nextOffset}; read({path,startLine,endLine}), readHit(hit) return opaque evidence pages; history({query})->{items}; recall({ref}) returns a page. take(array,n), empty(array), emit(value). Only emitted values return; emit pages directly. Max 8 operations/4 pages/10KB output; no imports, shell, writes or arbitrary JS. Example: let s=await search({query:"retry",path:"src"}); if(empty(s.items)){s=await search({query:"retry"});} for(const h of take(s.items,2)){emit(await readHit(h));} Use ordinary tools for simple calls; read AGENTS.md via read_file.',
  input_schema: { type: 'object', properties: { code: { type: 'string', maxLength: 6000 } }, required: ['code'], additionalProperties: false },
};

export function parseRetrieval(code) {
  if (typeof code !== 'string' || !code.trim() || code.length > 6000) throw Error('Retrieval code must be 1..6000 characters');
  const tokens = []; let pos = 0;
  while (pos < code.length) {
    if (/\s/.test(code[pos])) { pos++; continue; }
    if (code.startsWith('//', pos)) { const n = code.indexOf('\n', pos); pos = n < 0 ? code.length : n + 1; continue; }
    const rest = code.slice(pos), match = /^(?:([A-Za-z_$][\w$]*)|(\d+)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([{}()[\],;:.=]))/.exec(rest);
    if (!match) throw Error('Unsupported retrieval syntax');
    let value = match[0], kind = match[1] ? 'id' : match[2] ? 'number' : match[3] ? 'string' : 'punct';
    if (kind === 'string') {
      if (value[0] === '"') value = JSON.parse(value);
      else value = value.slice(1, -1).replace(/\\(['\\])/g, '$1');
    }
    tokens.push({ kind, value }); pos += match[0].length;
    if (tokens.length > 2000) throw Error('Retrieval program too complex');
  }
  let index = 0, depth = 0;
  const peek = value => tokens[index]?.value === value;
  const pop = value => { const t = tokens[index++]; if (!t || value !== undefined && t.value !== value) throw Error(`Expected ${value || 'token'}`); return t; };
  const name = () => { const t = pop(); if (t.kind !== 'id' || forbidden.has(t.value) || functions.has(t.value)) throw Error('Invalid variable'); return t.value; };
  const expression = () => {
    if (++depth > 24) throw Error('Retrieval nesting limit');
    let node; const token = pop();
    if (token.kind === 'string' || token.kind === 'number') node = { type: 'literal', value: token.kind === 'number' ? Number(token.value) : token.value };
    else if (token.value === 'true' || token.value === 'false' || token.value === 'null') node = { type: 'literal', value: token.value === 'null' ? null : token.value === 'true' };
    else if (token.value === 'await') node = expression();
    else if (token.value === '{') {
      const pairs = []; while (!peek('}')) {
        const key = pop(); if (!['id','string'].includes(key.kind) || forbidden.has(key.value)) throw Error('Invalid object key');
        pop(':'); pairs.push([key.value, expression()]); if (!peek(',')) break; pop(',');
      } pop('}'); node = { type: 'object', pairs };
    } else if (token.value === '[') {
      const values = []; while (!peek(']')) { values.push(expression()); if (!peek(',')) break; pop(','); }
      pop(']'); node = { type: 'array', values };
    } else if (token.kind === 'id') {
      if (forbidden.has(token.value)) throw Error('Forbidden identifier');
      if (peek('(')) {
        if (!functions.has(token.value)) throw Error('Unknown retrieval function');
        pop('('); const args = []; while (!peek(')')) { args.push(expression()); if (!peek(',')) break; pop(','); }
        pop(')'); node = { type: 'call', name: token.value, args };
      } else node = { type: 'variable', name: token.value };
    } else throw Error('Unsupported expression');
    while (peek('.') || peek('[')) {
      let key; if (peek('.')) { pop('.'); const t = pop(); if (t.kind !== 'id') throw Error('Invalid field'); key = { type: 'literal', value: t.value }; }
      else { pop('['); key = expression(); pop(']'); }
      node = { type: 'field', object: node, key };
    }
    depth--; return node;
  };
  let blockDepth = 0;
  const statements = (nested = false) => {
    if (++blockDepth > 16) throw Error('Retrieval block nesting limit');
    const result = [];
    while (index < tokens.length && !(nested && peek('}'))) {
      if (peek('let') || peek('const')) {
        const constant = pop().value === 'const', id = name(); pop('='); const value = expression(); pop(';'); result.push({ type: 'declare', id, value, constant });
      } else if (peek('if')) {
        pop('if'); pop('('); const condition = expression(); pop(')'); pop('{'); const yes = statements(true); pop('}');
        let no = []; if (peek('else')) { pop('else'); pop('{'); no = statements(true); pop('}'); }
        result.push({ type: 'if', condition, yes, no });
      } else if (peek('for')) {
        pop('for'); pop('('); pop('const'); const id = name(); pop('of'); const values = expression(); pop(')'); pop('{'); const body = statements(true); pop('}');
        result.push({ type: 'for', id, values, body });
      } else if (tokens[index]?.kind === 'id' && tokens[index + 1]?.value === '=') {
        const id = name(); pop('='); const value = expression(); pop(';'); result.push({ type: 'assign', id, value });
      } else { const value = expression(); pop(';'); result.push({ type: 'expression', value }); }
    }
    blockDepth--; return result;
  };
  const program = statements(); if (index !== tokens.length) throw Error('Unexpected trailing token'); return program;
}

export async function interpretRetrieval(program, api, check) {
  const evaluate = async (node, scope) => {
    check();
    if (node.type === 'literal') return node.value;
    if (node.type === 'variable') { if (!scope.has(node.name)) throw Error(`Unknown variable: ${node.name}`); return scope.get(node.name).value; }
    if (node.type === 'object') { const value = Object.create(null); for (const [key, child] of node.pairs) value[key] = await evaluate(child, scope); return value; }
    if (node.type === 'array') { const value = []; for (const child of node.values) value.push(await evaluate(child, scope)); return value; }
    if (node.type === 'field') {
      const object = await evaluate(node.object, scope), key = await evaluate(node.key, scope);
      if (!['string','number'].includes(typeof key) || forbidden.has(String(key)) || object === null || object === undefined
        || !Object.hasOwn(object, key)) throw Error('Only existing own data fields are available');
      return object[key];
    }
    const args = []; for (const child of node.args) args.push(await evaluate(child, scope));
    if (node.name === 'take') { if (!Array.isArray(args[0]) || !Number.isSafeInteger(args[1]) || args[1] < 0 || args[1] > 8) throw Error('take expects array and 0..8'); return args[0].slice(0,args[1]); }
    if (node.name === 'empty') { if (!Array.isArray(args[0])) throw Error('empty expects array'); return !args[0].length; }
    return api(node.name, args);
  };
  const run = async (nodes, scope) => {
    for (const node of nodes) {
      check();
      if (node.type === 'declare') { if (scope.has(node.id)) throw Error('Variable already declared'); scope.set(node.id, { value: await evaluate(node.value, scope), constant: node.constant }); }
      else if (node.type === 'assign') { const entry = scope.get(node.id); if (!entry || entry.constant) throw Error('Assignment requires declared let'); entry.value = await evaluate(node.value, scope); }
      else if (node.type === 'if') { const condition = await evaluate(node.condition,scope); if (typeof condition !== 'boolean') throw Error('if condition must be boolean'); await run(condition ? node.yes : node.no, new Map(scope)); }
      else if (node.type === 'for') {
        const values = await evaluate(node.values,scope); if (!Array.isArray(values) || values.length > 8) throw Error('Loop requires at most 8 items; use take');
        for (const value of values) { const local = new Map(scope); if (local.has(node.id)) throw Error('Loop variable shadows existing binding'); local.set(node.id,{value,constant:true}); await run(node.body,local); }
      } else await evaluate(node.value,scope);
    }
  };
  await run(program,new Map());
}

export async function executeRetrieval(backend, { code } = {}) {
  if (!backend.retrievalCode) throw Error('Retrieval code is disabled');
  backend.retrievalSubcalls = 0; backend.pendingRetrieval = null;
  const program = parseRetrieval(code), started = Date.now(); let steps = 0;
  const check = () => { backend.signal?.throwIfAborted(); if (++steps > 3000 || Date.now()-started > 15000) throw Error('Retrieval execution limit'); };
  const staged = new backend.constructor({ workspace:backend.workspace, deduplicateReads:false, enableFileCreation:false });
  staged.signal = backend.signal; staged.sessionTerms = new Map(backend.sessionTerms);
  const pages = new WeakMap(), emitted = [], delivered = [], dependencies = new Map(); let outputBytes = 0, pageCount = 0;
  const track = values => { for (const value of values || []) dependencies.set(value.path + '@' + value.sourceHash, value); };
  let memory;
  if (backend.contextMemory) {
    memory = new backend.contextMemory.constructor(staged);
    memory.units = new Map([...backend.contextMemory.units].map(([k,v])=>[k,{...v}]));
    memory.archive = backend.contextMemory.archive; staged.contextMemory = memory;
  }
  const page = (output, originalRead = false) => {
    const snapshot=originalRead?staged.sourceEvidence.get(hash(output)):null;
    const presented=snapshot?{sourceHash:snapshot.sourceHash,lines:new Map([...output.matchAll(/^(\d+): (.*)$/gm)].map(m=>[Number(m[1]),m[2]]))}:null;
    const handle = Object.create(null); pages.set(handle,{output,originalRead,snapshot,presented}); return handle;
  };
  const render = value => {
    if (value && typeof value === 'object' && pages.has(value)) {
      const record = pages.get(value); delivered.push(record); if (++pageCount > 4) throw Error('At most four evidence pages'); return record.output;
    }
    // Plain search/history objects have bounded, already redacted values; pages must be emitted directly.
    if (value && typeof value === 'object') {
      let size=0;
      const visit = (v, depth=0) => {
        check(); if (depth>24) throw Error('Output nesting limit');
        if(typeof v==='string')size+=Buffer.byteLength(v,'utf8');
        if (v && typeof v==='object') {
          if(pages.has(v)) throw Error('Emit evidence pages directly');
          for(const [key,child] of Object.entries(v)){size+=Buffer.byteLength(key,'utf8');visit(child,depth+1);}
        }
        if(size>10000)throw Error('Retrieval output exceeds 10KB');
      };
      visit(value);
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  try {
    await interpretRetrieval(program, async (name,args) => {
      check();
      if (args.length !== 1) throw Error('Each retrieval function expects exactly one argument');
      if (name === 'emit') {
        const output = render(args[0]); if (typeof output!=='string') throw Error('Cannot emit undefined');
        outputBytes += Buffer.byteLength(output,'utf8') + 2; if(outputBytes>10000)throw Error('Retrieval output exceeds 10KB; select fewer/smaller pages');
        emitted.push(output); return null;
      }
      if (backend.retrievalSubcalls >= Math.min(8,backend.retrievalRemaining ?? 8)) throw Error('Retrieval operation limit');
      backend.retrievalSubcalls++;
      const input = args[0]; if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Retrieval operation expects an object');
      await backend.retrievalObserver?.({name,stage:'intent'});
      let result;
      try {
      if (name === 'search') {
        result = await staged.searchCode(input,{structured:true}); track(result.dependencies); delete result.dependencies;
      } else if (name === 'list') {
        const count = Math.max(1,Math.min(32,Number(input.maxFiles)||16)), offset = input.offset ?? 0;
        if (!Number.isSafeInteger(count) || !Number.isSafeInteger(offset) || offset < 0 || offset>100000)throw Error('Invalid listing limits');
        const items = await staged.listFilePaths({...input,maxFiles:count+1,offset});
        result = { items:items.slice(0,count), complete:items.length<=count, nextOffset:items.length>count?offset+count:null,
          coverage:'Bounded text scan; filters, depth and file-size limits apply. A miss is not repository-wide absence.' };
      } else if (name === 'read' || name === 'readHit') {
        const actual = name === 'readHit' ? {path:input.path,startLine:Math.max(1,input.line-12),endLine:input.line+24} : input;
        if (name==='readHit' && (!Number.isSafeInteger(input.line)||input.line<1))throw Error('readHit requires a search hit');
        const filename=await staged.resolveFile(actual.path);
        if(/^AGENTS(?:\.override)?\.md$/i.test(filename.split(/[\\/]/).at(-1)))throw Error('Read workspace instructions with ordinary read_file so their separate protected identity is preserved');
        const output = await staged.toolService.execute('read_file',actual);
        const snapshot = staged.sourceEvidence.get(hash(output)); track(snapshot?[snapshot]:[]);
        result = page(output,true);
      } else if (name === 'history' || name === 'recall') {
        if (!memory)throw Error('ContextOS is unavailable');
        const output = await memory[name==='history'?'search':'recall'](input);
        track(staged.searchEvidence.get(hash(output)));
        const snapshot=staged.sourceEvidence.get(hash(output)); track(snapshot?.sourceDependencies);
        if(snapshot?.path&&snapshot.sourceHash)track([snapshot]);
        result=name==='history'?{items:JSON.parse(output)}:page(output);
      } else throw Error('Unknown retrieval operation');
      } catch(error) { await backend.retrievalObserver?.({name,stage:'settled',isError:true});throw error; }
      check(); await backend.retrievalObserver?.({name,stage:'settled',isError:false}); return result;
    },check);
    check(); if (!emitted.length) throw Error('Use emit to return evidence');
    const output=emitted.join('\n\n');
    backend.pendingRetrieval={output,staged,delivered,dependencies:[...dependencies.values()]};
    return output;
  } catch(error) { backend.pendingRetrieval=null; throw error; }
}

// Call only after the outer tool_result is durably appended; discarded intermediate reads never become delivered evidence.
export function commitRetrieval(backend, output) {
  const pending=backend.pendingRetrieval; backend.pendingRetrieval=null;
  if(!pending || pending.output!==output)return false;
  for(const record of pending.delivered)if(record.originalRead) {
    const snapshot=record.snapshot;
    if(!snapshot)continue;
    const presented=record.presented, previous=backend.presentedSource.get(snapshot.path);
    if(presented)backend.presentedSource.set(snapshot.path,{sourceHash:presented.sourceHash,
      lines:new Map([...(previous?.sourceHash===presented.sourceHash?previous.lines:[]),...presented.lines])});
  }
  while(backend.presentedSource.size>32)backend.presentedSource.delete(backend.presentedSource.keys().next().value);
  backend.sourceEvidence.set(hash(output),{sourceDependencies:pending.dependencies,provenance:'observed',kind:'tool_result'});
  while(backend.sourceEvidence.size>128)backend.sourceEvidence.delete(backend.sourceEvidence.keys().next().value);
  return true;
}
