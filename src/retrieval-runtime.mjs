import { getQuickJS } from 'quickjs-emscripten';
import { randomUUID } from 'node:crypto';

// Each program owns an isolated runtime. Only JSON and unforgeable issued page IDs cross it.
export async function runQuickRetrieval(code, api, { check = () => {}, isPage = () => false, timeoutMs = 15000 } = {}) {
  if(typeof code!=='string'||!code.trim()||code.length>6000)throw Error('Retrieval code must be 1..6000 characters');
  const module=await getQuickJS(), runtime=module.newRuntime(), vm=runtime.newContext();
  const deadline=Date.now()+timeoutMs, pending=new Set(), deferreds=[], pages=new Map();
  let fatal, interrupted=false, main;
  runtime.setMemoryLimit(16*1024*1024);runtime.setMaxStackSize(256*1024);
  runtime.setInterruptHandler(()=>{try{check();}catch(e){fatal=e;return true;}return interrupted=Date.now()>deadline;});
  const encode=value=>{if(isPage(value)){const id=randomUUID();pages.set(id,value);return JSON.stringify({page:id});}return JSON.stringify({value});};
  const decode=text=>{if(text.length>20000)throw Error('Retrieval argument exceeds limit');const x=JSON.parse(text);if(x.page){if(!pages.has(x.page))throw Error('Invalid evidence page');return pages.get(x.page);}return x.value;};
  const bridge=vm.newFunction('bridge',(nameHandle,argHandle)=>{
    const name=vm.getString(nameHandle);let arg;
    try{check();arg=decode(vm.getString(argHandle));}catch(e){fatal=e;return {error:vm.newError(e.message)};}
    if(name==='emit'){
      try{const result=api(name,[arg]);if(result?.then)throw Error('emit must be synchronous');return vm.newString(encode(result));}
      catch(e){fatal=e;return {error:vm.newError(e.message)};}
    }
    if(pending.size>=8){fatal=Error('Too many concurrent retrieval operations');return {error:vm.newError(fatal.message)};}
    const d=vm.newPromise();deferreds.push(d);
    const task=Promise.resolve().then(()=>{if(fatal)throw fatal;check();return api(name,[arg]);}).then(value=>{
      const h=vm.newString(encode(value));d.resolve(h);h.dispose();
    },e=>{fatal=e;const h=vm.newError(e.message);d.reject(h);h.dispose();}).finally(()=>pending.delete(task));
    pending.add(task);return d.handle.dup();
  });
  vm.setProp(vm.global,'__bridge',bridge);bridge.dispose();
  const boot=`(()=>{const bridge=__bridge;delete globalThis.__bridge;const stringify=JSON.stringify,parse=JSON.parse,ids=new WeakMap();
    const pack=v=>stringify(ids.has(v)?{page:ids.get(v)}:{value:v});
    const unpack=s=>{const r=parse(s);if(r.page){const p=Object.create(null);Object.defineProperty(p,Symbol.toPrimitive,{value:()=>{throw Error('Emit evidence pages directly; do not concatenate pages with strings');}});Object.freeze(p);ids.set(p,r.page);return p;}return r.value;};
    for(const name of ['search','list','read','readHit','history','recall'])Object.defineProperty(globalThis,name,{value:async x=>unpack(await bridge(name,pack(x))),writable:false});
    Object.defineProperty(globalThis,'emit',{value:x=>unpack(bridge('emit',pack(x))),writable:false});
    globalThis.take=(a,n)=>{if(!Array.isArray(a)||!Number.isSafeInteger(n)||n<0||n>8)throw Error('take expects array and 0..8');return a.slice(0,n);};
    globalThis.empty=a=>{if(!Array.isArray(a))throw Error('empty expects array');return !a.length;};
  })();`;
  try {
    vm.unwrapResult(vm.evalCode(boot)).dispose();
    main=vm.unwrapResult(vm.evalCode(`(async()=>{\n${code}\n})()`, 'retrieval.js'));
    for(;;){
      check();if(Date.now()>deadline)throw Error('Retrieval execution limit');
      const jobs=runtime.executePendingJobs(64);if(jobs.error){const e=vm.dump(jobs.error);jobs.error.dispose();throw Error(e.message||'Retrieval job failed');}
      if(fatal)throw fatal;
      const state=vm.getPromiseState(main);
      if(state.type==='fulfilled'){state.value.dispose();break;}
      if(state.type==='rejected'){const e=vm.dump(state.error);state.error.dispose();throw Error(e.message||'Retrieval program rejected');}
      if(pending.size)await Promise.race(pending);else if(!runtime.hasPendingJob())throw Error('Retrieval promise never settles');
    }
  } finally {
    // Never dispose a VM while an already-started host operation can still settle into it.
    await Promise.allSettled([...pending]);
    main?.dispose();for(const d of deferreds)d.dispose();vm.dispose();runtime.dispose();
  }
  if(fatal)throw fatal;
  if(interrupted)throw Error('Retrieval execution limit');
}
