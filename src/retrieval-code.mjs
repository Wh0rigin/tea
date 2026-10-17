import { runQuickRetrieval } from './retrieval-runtime.mjs';
// Bounded read-only host API; programs execute in an isolated QuickJS/WASM runtime.
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
export const RETRIEVAL_TOOL = {
  name: 'retrieve_code',
  description: 'Read-only JavaScript in an isolated QuickJS runtime. APIs: search({query,path,maxResults,offset,startLine,includeOmitted})->{items:[{path,line,text}],coverage,complete,nextOffset,nextLine}; list({path,maxFiles,offset})->{items:[paths],complete,nextOffset}; read({path,startLine,endLine}), readHit(hit), recall({ref}) return opaque pages; history({query})->{items}; take(array,n), empty(array), emit(value). Await retrieval, emit pages directly. Standard JS arrays, strings, loops and branching work. Max 8 operations/4 pages/10KB output. At a retrieval limit, emitted prefix returns marked incomplete; continue as needed. No host filesystem, imports, shell or writes. Read AGENTS.md with read_file.',
  input_schema: { type: 'object', properties: { code: { type: 'string', maxLength: 6000 } }, required: ['code'], additionalProperties: false },
};

export async function executeRetrieval(backend, { code } = {}) {
  if (!backend.retrievalCode) throw Error('Retrieval code is disabled');
  backend.retrievalSubcalls = 0; backend.pendingRetrieval = null;
  const started = Date.now(); let steps = 0;
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
  const bounded = message => Object.assign(Error(message),{bounded:true});
  const render = value => {
    if (value && typeof value === 'object' && pages.has(value)) {
      const record = pages.get(value); if (pageCount >= 4) throw bounded('At most four evidence pages'); return record.output;
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
    await runQuickRetrieval(code, (name,args) => {
      check();
      if (args.length !== 1) throw Error('Each retrieval function expects exactly one argument');
      if (name === 'emit') {
        const output = render(args[0]); if (typeof output!=='string') throw Error('Cannot emit undefined');
        const bytes=Buffer.byteLength(output,'utf8')+2;if(outputBytes+bytes>9600)throw bounded('Retrieval output limit; select fewer/smaller pages');
        outputBytes+=bytes;emitted.push(output);if(pages.has(args[0])){pageCount++;delivered.push(pages.get(args[0]));}return null;
      }
      return (async()=>{
      if (backend.retrievalSubcalls >= Math.min(8,backend.retrievalRemaining ?? 8)) throw bounded('Retrieval operation limit');
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
      })();
    },{check,isPage:value=>value&&typeof value==='object'&&pages.has(value)});
    check(); if (!emitted.length) throw Error('Use emit to return evidence');
    const output=emitted.join('\n\n');
    backend.pendingRetrieval={output,staged,delivered,dependencies:[...dependencies.values()]};
    return output;
  } catch(error) {
    backend.pendingRetrieval=null;
    if(error.bounded&&emitted.length&&!backend.signal?.aborted){
      const output=emitted.join('\n\n')+'\n\n[Retrieval incomplete: '+error.message+'. Only the emitted prefix is delivered; continue with a smaller program.]';
      backend.pendingRetrieval={output,staged,delivered,dependencies:[...dependencies.values()]};return output;
    }
    throw error;
  }
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
