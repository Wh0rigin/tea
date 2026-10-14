const smoke = "import test from 'node:test'; import assert from 'node:assert/strict'; test('Node runtime available', () => assert.ok(process.versions.node));\n";
const rules = '# Fixture rules\nImplement the stated contract using Node.js built-ins. Source changes belong in src/. Do not alter existing tests, package.json or these rules. Add regression tests if useful. Run node --test tests/public.test.mjs and any added tests before claiming completion. No dependencies or network access are needed.\n';
const hidden = body => `import test from 'node:test'; import assert from 'node:assert/strict';\n${body}\n`;
const task = (id, level, title, prompt, files, acceptance, solution, distractors = 0) => ({
  id, level, title, prompt: `${prompt}\nPreserve existing public behavior and tests. Add useful regression tests and execute them.`,
  files: { 'AGENTS.md': rules, 'package.json': '{"type":"module","scripts":{"test":"node --test tests/*.test.mjs"}}\n',
    'tests/public.test.mjs': smoke, ...files,
    ...Object.fromEntries(Array.from({ length: distractors }, (_, i) => [`src/archive/sample-${i}.mjs`, `export const sample${i} = ${i};\n`])) },
  acceptance: hidden(acceptance), solution,
});

export const codingTasks = [
  task('l1-narcissistic', 1, '新建水仙花数模块',
    'Create src/numbers.mjs exporting isNarcissistic(n) and findNarcissistic(start,end). A nonnegative safe integer is narcissistic if the sum of its digits raised to its digit count equals itself. isNarcissistic returns false for all other inputs. findNarcissistic returns all such numbers in inclusive bounds, sorted; reject invalid, negative, reversed or nonsafe bounds with RangeError.', {},
    `test('classification and inclusive ranges', async () => {
      const m = await import('./src/numbers.mjs');
      for (const n of [0,1,9,153,370,371,407,1634,8208,9474]) assert.equal(m.isNarcissistic(n),true);
      for (const n of [-1,10,152,1.5,NaN,Infinity,'153',null,Number.MAX_SAFE_INTEGER+1]) assert.equal(m.isNarcissistic(n),false);
      assert.deepEqual(m.findNarcissistic(100,999),[153,370,371,407]); assert.deepEqual(m.findNarcissistic(0,0),[0]);
      for (const bounds of [[5,2],[-1,10],[0,1.5],[0,Infinity]]) assert.throws(()=>m.findNarcissistic(...bounds),RangeError);
    });`,
    { 'src/numbers.mjs': "export function isNarcissistic(n) { if (!Number.isSafeInteger(n) || n < 0) return false; const digits=String(n); return [...digits].reduce((s,d)=>s+Number(d)**digits.length,0)===n; }\nexport function findNarcissistic(start,end) { if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start) throw new RangeError('bounds'); const result=[]; for(let n=start;n<=end;n++) if(isNarcissistic(n)) result.push(n); return result; }\n" }),
  task('l1-intervals', 1, '区间合并与输入保护',
    'Fix mergeIntervals in src/intervals.mjs. Return sorted merged inclusive intervals, merging overlaps and touching endpoints. Do not mutate the input or its nested arrays. Empty input returns []; reject nonarrays, malformed pairs, nonfinite endpoints or start>end with TypeError.',
    { 'src/intervals.mjs': 'export function mergeIntervals(items) { return items.sort((a,b)=>a[0]-b[0]); }\n',
      'tests/public.test.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import {mergeIntervals} from '../src/intervals.mjs'; test('single interval',()=>assert.deepEqual(mergeIntervals([[1,2]]),[[1,2]]));\n" },
    `test('merging and no mutation', async()=>{ const {mergeIntervals:m}=await import('./src/intervals.mjs');
      const input=[[8,10],[1,4],[4,6],[2,3],[12,12]]; const before=structuredClone(input);
      assert.deepEqual(m(input),[[1,6],[8,10],[12,12]]); assert.deepEqual(input,before);
      assert.deepEqual(m(Object.freeze([Object.freeze([2,4]),Object.freeze([1,3])])),[[1,4]]);
      assert.deepEqual(m([]),[]); assert.deepEqual(m([[-3,-1],[-1,0]]),[[-3,0]]);
      for(const x of [null,{},[[2,1]],[[0,Infinity]],[[1]],[[NaN,2]]]) assert.throws(()=>m(x),TypeError);
    });`,
    { 'src/intervals.mjs': "export function mergeIntervals(items) { if(!Array.isArray(items)||items.some(x=>!Array.isArray(x)||x.length!==2||!x.every(Number.isFinite)||x[0]>x[1])) throw new TypeError('intervals'); const sorted=items.map(x=>[...x]).sort((a,b)=>a[0]-b[0]); const result=[]; for(const x of sorted) { const last=result.at(-1); if(last&&x[0]<=last[1]) last[1]=Math.max(last[1],x[1]); else result.push(x); } return result; }\n" }),
  task('l2-csv', 2, '带引号的 CSV 状态机',
    'Implement parseCsv(text) in src/csv.mjs. Return arrays of string fields. Support commas, LF/CRLF, quoted fields containing delimiters/newlines, and doubled quotes inside quoted fields. Preserve spaces and empty fields. Empty input returns []; a final line terminator adds no extra row. Reject a quote inside an unquoted field, text after a closing quote, and an unterminated quote with SyntaxError. Reject nonstring input with TypeError.',
    { 'src/csv.mjs': "export function parseCsv(text) { return text.split('\\n').map(row=>row.split(',')); }\n",
      'tests/public.test.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import {parseCsv} from '../src/csv.mjs'; test('plain fields',()=>assert.deepEqual(parseCsv('a,b'),[['a','b']]));\n" },
    String.raw`test('CSV quoted records',async()=>{const {parseCsv:p}=await import('./src/csv.mjs');
      assert.deepEqual(p('a,"b,c","d""e"\r\nx,"y\nz",\r\n'),[['a','b,c','d"e'],['x','y\nz','']]);
      assert.deepEqual(p(''),[]); assert.deepEqual(p(','),[['','']]); assert.deepEqual(p('""'),[['']]);
      assert.deepEqual(p(' a , b \n'),[[' a ',' b ']]); assert.deepEqual(p('\n\n'),[[''],['']]);
      for(const x of ['"abc','ab"c','"a"b','"a" ']) assert.throws(()=>p(x),SyntaxError);
      assert.throws(()=>p(1),TypeError);
    });`,
    { 'src/csv.mjs': String.raw`export function parseCsv(text) {
      if(typeof text!=='string') throw new TypeError('text'); if(!text) return [];
      const rows=[]; let row=[],field='',mode='plain',ended=false;
      for(let i=0;i<text.length;i++){const c=text[i];ended=false;
        if(mode==='quoted'){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else mode='closed';}else field+=c;continue;}
        if(c===','||c==='\n'||(c==='\r'&&text[i+1]==='\n')){row.push(field);field='';mode='plain';if(c!==','){rows.push(row);row=[];ended=true;if(c==='\r')i++;}continue;}
        if(mode==='closed')throw new SyntaxError('after quote');
        if(c==='"'){if(field)throw new SyntaxError('unquoted quote');mode='quoted';}else field+=c;
      }
      if(mode==='quoted')throw new SyntaxError('unterminated');if(!ended){row.push(field);rows.push(row);}return rows;
    }
` }, 2),
  task('l2-ttl-cache', 2, 'TTL 缓存跨文件修复',
    'Fix createCache({now}) exported by src/index.mjs, preserving its API set(key,value,ttlMs), get(key), has(key), delete(key), size(). The clock is injected. Entries expire when now() >= insertionTime+ttlMs; TTL must be a finite nonnegative number, otherwise RangeError; zero TTL expires immediately. has must distinguish a stored undefined from absence. size excludes expired entries. Reads do not refresh TTL; overwrites reset it; delete returns whether a live entry existed.',
    { 'src/clock.mjs': 'export const clock = () => Date.now();\n', 'src/index.mjs': "export {createCache} from './cache.mjs';\n",
      'src/cache.mjs': "import {clock} from './clock.mjs';\nexport function createCache({now=clock}={}) { const data=new Map(); return {set(k,v,ttl){data.set(k,{v,until:now()+ttl});},get(k){return data.get(k)?.v;},has(k){return data.has(k);},delete(k){return data.delete(k);},size(){return data.size;}}; }\n",
      'tests/public.test.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import {createCache} from '../src/index.mjs'; test('basic cache',()=>{const c=createCache({now:()=>0});c.set('a',3,10);assert.equal(c.get('a'),3);});\n" },
    `test('clock, presence and expiry',async()=>{const {createCache}=await import('./src/index.mjs');let time=0;const c=createCache({now:()=>time});
      c.set('a',undefined,10);assert.equal(c.has('a'),true);time=9;assert.equal(c.has('a'),true);time=10;assert.equal(c.has('a'),false);assert.equal(c.size(),0);
      c.set('b',1,5);time=12;c.set('b',2,10);time=21;assert.equal(c.get('b'),2);time=22;assert.equal(c.delete('b'),false);
      c.set('zero',5,0);assert.equal(c.has('zero'),false);c.set('x',7,10);assert.equal(c.delete('x'),true);assert.equal(c.delete('x'),false);
      for(const ttl of [-1,Infinity,NaN,'10'])assert.throws(()=>c.set('bad',1,ttl),RangeError);
    });`,
    { 'src/cache.mjs': "import {clock} from './clock.mjs';\nexport function createCache({now=clock}={}) { const data=new Map(); const live=k=>{const item=data.get(k);if(item&&now()>=item.until){data.delete(k);return undefined;}return item;}; return {set(k,v,ttl){if(typeof ttl!=='number'||!Number.isFinite(ttl)||ttl<0)throw new RangeError('ttl');data.set(k,{v,until:now()+ttl});},get(k){return live(k)?.v;},has(k){return Boolean(live(k));},delete(k){const exists=Boolean(live(k));data.delete(k);return exists;},size(){for(const k of data.keys())live(k);return data.size;}}; }\n" }, 4),
  task('l3-scheduler', 3, '异步并发调度器',
    'Implement mapLimit(items,limit,worker) exported from src/index.mjs. Validate items array, positive integer limit, function worker. Process each item exactly once with worker(item,index); at most limit workers run concurrently. Return Promise.allSettled-style records in input order, absorbing synchronous throws and asynchronous rejections while continuing other items. Empty input resolves []. Validation errors must reject with TypeError. Inputs must not be mutated.',
    { 'src/index.mjs': "export {mapLimit} from './scheduler.mjs';\n", 'src/scheduler.mjs': 'export async function mapLimit(items,limit,worker){ return Promise.all(items.map(worker)); }\n',
      'tests/public.test.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import {mapLimit} from '../src/index.mjs';test('empty batch',async()=>assert.deepEqual(await mapLimit([],2,x=>x),[]));\n" },
    `test('bounded concurrent work and ordered outcomes',async()=>{const {mapLimit}=await import('./src/index.mjs');let active=0,peak=0;const calls=[];
      const input=Object.freeze([0,1,2,3,4,5]);const result=await mapLimit(input,2,async(x,i)=>{calls.push(i);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,(6-x)*3));active--;if(x===2)throw new Error('bad');return x*2;});
      assert.ok(peak<=2);assert.ok(peak>=2);assert.deepEqual(calls.sort((a,b)=>a-b),[0,1,2,3,4,5]);
      assert.deepEqual(result.map(x=>x.status),['fulfilled','fulfilled','rejected','fulfilled','fulfilled','fulfilled']);assert.equal(result[4].value,8);assert.equal(result[2].reason.message,'bad');
      const sync=await mapLimit([1,2],1,x=>{if(x===1)throw Error('sync');return x;});assert.equal(sync[0].status,'rejected');assert.equal(sync[1].value,2);
      for(const args of [[null,2,x=>x],[[],0,x=>x],[[],1.5,x=>x],[[],2,null]])await assert.rejects(mapLimit(...args),TypeError);
    });`,
    { 'src/scheduler.mjs': "export async function mapLimit(items,limit,worker){if(!Array.isArray(items)||!Number.isInteger(limit)||limit<=0||typeof worker!=='function')throw new TypeError('arguments');const result=new Array(items.length);let next=0;async function consume(){while(next<items.length){const i=next++;try{result[i]={status:'fulfilled',value:await worker(items[i],i)};}catch(reason){result[i]={status:'rejected',reason};}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},consume));return result;}\n" }, 6),
  task('l3-pagination', 3, '多层 API 游标分页',
    'Repair listPage({store,limit,cursor}) exported by src/api.mjs. store.snapshot() returns {version,items}; items have unique string id and numeric score. Order ascending score then id using JS string comparison. limit defaults to 2 and must be integer 1..50. Return {items,nextCursor}; cursor is base64url-encoded JSON {version,score,id} pointing to the last returned item. Validate structure, matching snapshot version and existence of the anchor; reject malformed, stale or unknown cursors with RangeError. nextCursor is null when no more items. Never mutate stored objects. Keep snapshot() API intact.',
    { 'src/store.mjs': 'export function makeStore(items,version=1){return {snapshot:()=>({version,items})};}\n',
      'src/api.mjs': "import {paginate} from './pagination.mjs';\nexport function listPage({store,limit=2,cursor=null}){return paginate(store.snapshot(),limit,cursor);}\n",
      'src/pagination.mjs': 'export function paginate(snapshot,limit,cursor){return {items:snapshot.items.slice(0,limit),nextCursor:null};}\n',
      'tests/public.test.mjs': "import test from 'node:test';import assert from 'node:assert/strict';import {makeStore} from '../src/store.mjs';import {listPage} from '../src/api.mjs';test('single item',()=>assert.deepEqual(listPage({store:makeStore([{id:'a',score:1}])}),{items:[{id:'a',score:1}],nextCursor:null}));\n" },
    `test('stable pages, ties and cursor validation',async()=>{const {makeStore}=await import('./src/store.mjs');const {listPage:p}=await import('./src/api.mjs');
      const items=[{id:'z',score:3},{id:'b',score:1},{id:'a',score:1},{id:'m',score:2}];const original=structuredClone(items);const store=makeStore(items,7);
      const one=p({store});assert.deepEqual(one.items.map(x=>x.id),['a','b']);assert.deepEqual(JSON.parse(Buffer.from(one.nextCursor,'base64url')), {version:7,score:1,id:'b'});
      const two=p({store,cursor:one.nextCursor});assert.deepEqual(two.items.map(x=>x.id),['m','z']);assert.equal(two.nextCursor,null);assert.deepEqual(items,original);
      assert.equal(p({store:makeStore([])}).nextCursor,null);
      const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');for(const cursor of ['bad',encode({version:6,score:1,id:'b'}),encode({version:7,score:1,id:'missing'}),encode({version:7,score:'1',id:'b'})])assert.throws(()=>p({store,cursor}),RangeError);
      for(const limit of [0,51,1.5,'2'])assert.throws(()=>p({store,limit}),RangeError);
    });`,
    { 'src/pagination.mjs': `export function paginate(snapshot,limit,cursor){
      if(!Number.isInteger(limit)||limit<1||limit>50)throw new RangeError('limit');
      const items=snapshot.items.map(x=>({...x})).sort((a,b)=>a.score-b.score||(a.id<b.id?-1:a.id>b.id?1:0));let start=0;
      if(cursor!==null&&cursor!==undefined){try{if(typeof cursor!=='string'||!cursor||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();const c=JSON.parse(Buffer.from(cursor,'base64url').toString());if(c.version!==snapshot.version||typeof c.id!=='string'||typeof c.score!=='number'||!Number.isFinite(c.score))throw Error();const at=items.findIndex(x=>x.id===c.id&&x.score===c.score);if(at<0)throw Error();start=at+1;}catch{throw new RangeError('cursor');}}
      const page=items.slice(start,start+limit);const last=page.at(-1);return {items:page,nextCursor:start+page.length<items.length?Buffer.from(JSON.stringify({version:snapshot.version,score:last.score,id:last.id})).toString('base64url'):null};
    }\n` }, 9),
  task('l4-transfers', 4, '事务与幂等转账',
    'Repair createBank(accounts) exported from src/index.mjs. It returns balance(id), transfer({id,from,to,amount}), entries(). Initial accounts are nonnegative safe-integer balances. Reject invalid initial accounts and invalid amount (nonpositive/nonsafe integer) with RangeError. Unknown accounts, empty/nonstring operation id, same-account transfers, insufficient funds and destination overflow also throw RangeError. A successful transfer atomically updates balances and records one immutable receipt {id,from,to,amount}. Retrying the same operation id with identical fields returns an equivalent receipt without changing balances/log. Conflicting reuse throws RangeError. Any failure leaves balances, idempotency state and log unchanged, so a failed id may be reused successfully later. entries() and returned receipts must not allow callers to mutate internal state.',
    { 'src/index.mjs': "export {createBank} from './bank.mjs';\n",
      'src/accounts.mjs': 'export function accountMap(accounts){return new Map(Object.entries(accounts));}\n',
      'src/journal.mjs': 'export function journal(){const rows=[];return {append:r=>rows.push(r),entries:()=>rows};}\n',
      'src/bank.mjs': "import {accountMap} from './accounts.mjs';import {journal} from './journal.mjs';\nexport function createBank(accounts){const data=accountMap(accounts),log=journal();return {balance:id=>data.get(id),entries:()=>log.entries(),transfer:r=>{data.set(r.from,data.get(r.from)-r.amount);if(!data.has(r.to))throw new RangeError('account');data.set(r.to,data.get(r.to)+r.amount);log.append(r);return r;}};}\n",
      'tests/public.test.mjs': "import test from 'node:test';import assert from 'node:assert/strict';import {createBank} from '../src/index.mjs';test('basic transfer',()=>{const b=createBank({a:10,b:0});b.transfer({id:'one',from:'a',to:'b',amount:3});assert.equal(b.balance('a'),7);assert.equal(b.balance('b'),3);});\n" },
    `test('atomic validation, replay and isolated journal',async()=>{const {createBank}=await import('./src/index.mjs');const b=createBank({a:20,b:0,c:Number.MAX_SAFE_INTEGER});
      for(const r of [{id:'f',from:'a',to:'missing',amount:2},{id:'f',from:'a',to:'b',amount:30},{id:'f',from:'a',to:'c',amount:1},{id:'f',from:'a',to:'a',amount:1},{id:'',from:'a',to:'b',amount:1}])assert.throws(()=>b.transfer(r),RangeError);
      assert.equal(b.balance('a'),20);assert.deepEqual(b.entries(),[]);const r={id:'f',from:'a',to:'b',amount:5};const receipt=b.transfer(r);assert.deepEqual(receipt,r);assert.deepEqual(b.transfer({...r}),r);assert.equal(b.balance('a'),15);assert.equal(b.entries().length,1);
      assert.throws(()=>b.transfer({...r,amount:6}),RangeError);try{receipt.amount=99;}catch{}const log=b.entries();try{log[0].amount=99;log.push(r);}catch{}assert.equal(b.entries().length,1);assert.equal(b.entries()[0].amount,5);
      for(const amount of [0,-1,1.5,Infinity,'2',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>b.transfer({id:'bad',from:'a',to:'b',amount}),RangeError);
      for(const accounts of [{a:-1},{a:1.5},{a:Infinity},{a:'2'}])assert.throws(()=>createBank(accounts),RangeError);
    });`,
    { 'src/bank.mjs': `import {accountMap} from './accounts.mjs';import {journal} from './journal.mjs';
      export function createBank(accounts){if(!accounts||typeof accounts!=='object'||Array.isArray(accounts)||Object.values(accounts).some(x=>!Number.isSafeInteger(x)||x<0))throw new RangeError('accounts');const data=accountMap(accounts),log=journal(),seen=new Map();return {
        balance:id=>data.get(id),entries:()=>log.entries().map(r=>({...r})),transfer:r=>{
          if(!r||typeof r.id!=='string'||!r.id||!data.has(r.from)||!data.has(r.to)||r.from===r.to||!Number.isSafeInteger(r.amount)||r.amount<=0)throw new RangeError('transfer');
          const prior=seen.get(r.id);if(prior){if(prior.from!==r.from||prior.to!==r.to||prior.amount!==r.amount)throw new RangeError('conflict');return {...prior};}
          if(data.get(r.from)<r.amount||!Number.isSafeInteger(data.get(r.to)+r.amount))throw new RangeError('funds');const receipt=Object.freeze({id:r.id,from:r.from,to:r.to,amount:r.amount});
          data.set(r.from,data.get(r.from)-r.amount);data.set(r.to,data.get(r.to)+r.amount);seen.set(r.id,receipt);log.append(receipt);return {...receipt};
        }};}
    \n` }, 16),
  task('l4-dependency-plan', 4, '依赖图与增量重建',
    'Implement planBuild(graph,changed) exported by src/index.mjs. graph maps string task names to arrays of direct dependency names. Reject malformed graph/changed inputs, unknown dependency or changed task, and cycles anywhere (even outside the affected subgraph) with TypeError. Return changed tasks plus all transitive dependents, each once, in a topological order. Dependencies unaffected by changes are not included. Among currently eligible affected tasks choose the lexicographically smallest using JS string comparison. Do not mutate graph or changed. Duplicate dependencies and changed names are tolerated. Empty changed returns [] after validating the whole graph.',
    { 'src/index.mjs': "export {planBuild} from './planner.mjs';\n", 'src/planner.mjs': 'export function planBuild(graph,changed){return [...changed].sort();}\n',
      'src/legacy/notes.mjs': 'export const oldPlanner = "do not use this obsolete planner";\n',
      'tests/public.test.mjs': "import test from 'node:test';import assert from 'node:assert/strict';import {planBuild} from '../src/index.mjs';test('unchanged graph',()=>assert.deepEqual(planBuild({a:[],b:['a']},[]),[]));\n" },
    `test('incremental closure and deterministic DAG ordering',async()=>{const {planBuild:p}=await import('./src/index.mjs');const graph={a:[],b:['a'],c:['a'],d:['b','c'],z:[],y:['z']};const before=structuredClone(graph);
      assert.deepEqual(p(graph,['a']),['a','b','c','d']);assert.deepEqual(p(graph,['b']),['b','d']);assert.deepEqual(p(graph,['z','a','a']),['a','b','c','d','z','y']);assert.deepEqual(graph,before);
      assert.deepEqual(p({a:[],b:['a','a']},['a']),['a','b']);assert.deepEqual(p({a:[],b:['a']},['b']),['b']);
      for(const [g,c] of [[{a:['missing']},[]],[{a:['b'],b:['a'],z:[]},['z']],[{a:['a']},[]],[{a:[]},['missing']],[{a:'x'},[]],[{},null],[null,[]]])assert.throws(()=>p(g,c),TypeError);
      const large=Object.fromEntries(Array.from({length:100},(_,i)=>['n'+String(i).padStart(3,'0'),i?['n'+String(i-1).padStart(3,'0')]:[]]));assert.equal(p(large,['n000']).length,100);
    });`,
    { 'src/planner.mjs': `export function planBuild(graph,changed){
      if(!graph||typeof graph!=='object'||Array.isArray(graph)||!Array.isArray(changed))throw new TypeError('inputs');const names=Object.keys(graph),reverse=new Map(names.map(x=>[x,new Set()])),degree=new Map();
      for(const name of names){const deps=graph[name];if(!Array.isArray(deps)||deps.some(x=>typeof x!=='string'||!reverse.has(x)))throw new TypeError('dependencies');const unique=new Set(deps);degree.set(name,unique.size);for(const d of unique)reverse.get(d).add(name);}
      if(changed.some(x=>typeof x!=='string'||!reverse.has(x)))throw new TypeError('changed');const ready=names.filter(x=>degree.get(x)===0),order=[];
      while(ready.length){ready.sort();const x=ready.shift();order.push(x);for(const y of reverse.get(x)){degree.set(y,degree.get(y)-1);if(degree.get(y)===0)ready.push(y);}}if(order.length!==names.length)throw new TypeError('cycle');
      const affected=new Set(changed),queue=[...affected];for(let i=0;i<queue.length;i++)for(const y of reverse.get(queue[i]))if(!affected.has(y)){affected.add(y);queue.push(y);}
      const result=[],done=new Set();while(result.length<affected.size){const available=[...affected].filter(x=>!done.has(x)&&graph[x].every(d=>!affected.has(d)||done.has(d))).sort();const x=available[0];done.add(x);result.push(x);}return result;
    }\n` }, 24),
];
