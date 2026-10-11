import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryHandoff } from '../src/memory-handoff.mjs';
test('handoff preserves pending validation, provenance and accounting without routing or credentials',()=>{
  const session={model:'same-model',pendingValidation:true,validationPassed:false,validationAttempts:2,changedFiles:['a.py'],
    messages:[{role:'user',content:'Original scope restriction'},{role:'assistant',content:'Inferred note'},
      {role:'user',content:[{type:'tool_result',content:'Observation'}]},{role:'user',content:'Current task'}],
    budgetUnknown:true,adapter:{spentUsd:.25,actualInputTokens:1200,config:{apiKey:'credential-canary'}},
    taskState:{goal:{text:'Preserve API',provenance:'user_confirmed'},decisions:[{text:'Possible cause',provenance:'inferred'}],
      confirmed_findings:[{text:'Test failed',provenance:'observed'}]}};
  const result=memoryHandoff(session);assert.equal(result.validation.pending,true);assert.equal(result.accounting.unresolved,true);
  assert.equal(result.inferredDecisions[0].provenance,'inferred');assert.equal(result.observedFindings[0].provenance,'observed');
  assert.deepEqual(result.retainedUserMessages,['Original scope restriction','Current task']);
  assert.doesNotMatch(JSON.stringify(result),/credential-canary|apiKey/);result.validation.changedFiles.push('other');assert.deepEqual(session.changedFiles,['a.py']);
});
