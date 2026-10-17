import { codingTasks } from './coding-ability.mjs';
const base=codingTasks[0];
const source='src/runtime/dispatch/recovery.mjs';
const acceptance=`import test from 'node:test';import assert from 'node:assert/strict';
test('retry contract',async()=>{const {remainingRetries:r}=await import('./src/index.mjs');
assert.equal(r(0),3);assert.equal(r(2),1);assert.equal(r(9),0);assert.equal(r(0,{maxRetries:0}),0);
const p=Object.freeze({maxRetries:5});assert.equal(r(1,p),4);
for(const n of [-1,1.5,NaN,Infinity,'1',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>r(n),RangeError);
for(const p of [null,{}, {maxRetries:-1},{maxRetries:1.5},{maxRetries:'3'},{maxRetries:Infinity}])assert.throws(()=>r(1,p),RangeError);
assert.equal(r(Number.MAX_SAFE_INTEGER,{maxRetries:Number.MAX_SAFE_INTEGER}),0);
});`;
const discovery={...base,id:'retrieval-retry',level:2,title:'多步检索重试策略',
  prompt:'Locate and repair remainingRetries exported by src/index.mjs, following the actual source/re-export chain. remainingRetries(attempt,policy={maxRetries:3}) returns max(0,policy.maxRetries-attempt). attempt and maxRetries must be nonnegative safe integers; invalid arguments, null policy or missing maxRetries throw RangeError. Zero is valid; do not mutate policy. Preserve existing files/tests; add useful tests and run them. No dependencies or network.',
  files:{'AGENTS.md':base.files['AGENTS.md'],'package.json':base.files['package.json'],'tests/public.test.mjs':base.files['tests/public.test.mjs'],
    'src/index.mjs':"export {remainingRetries} from './runtime/recovery.mjs';\n",
    'src/runtime/recovery.mjs':"export {remainingRetries} from './dispatch/recovery.mjs';\n",
    [source]:'export function remainingRetries(attempt,policy={maxRetries:3}){return (policy.maxRetries||3)-attempt;}\n',
    ...Object.fromEntries(Array.from({length:40},(_,i)=>[`src/archive/cache-${i}.mjs`,`export const cache${i}=${i};\n`]))},
  acceptance,solution:{[source]:'export function remainingRetries(attempt,policy={maxRetries:3}){if(!Number.isSafeInteger(attempt)||attempt<0||!policy||!Number.isSafeInteger(policy.maxRetries)||policy.maxRetries<0)throw new RangeError("bounds");return Math.max(0,policy.maxRetries-attempt);}\n'}};
export const retrievalTasks=[base,discovery,codingTasks.find(x=>x.id==='l3-pagination')];
