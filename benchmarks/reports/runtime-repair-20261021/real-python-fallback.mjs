import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const source = process.env.TEA_REPAIR_SOURCE || '/candidate';
const { runTask } = await import(pathToFileURL(path.join(source, 'src/agent.mjs')));
const { loadConfig } = await import(pathToFileURL(path.join(source, 'src/config.mjs')));
const workspace = await mkdtemp(path.join(os.tmpdir(), 'tea-real-python-'));
try {
 const actions = [
  ['write_file', { path: 'calc.py', content: 'def square(x):\n    return x * x\n' }],
  ['write_file', { path: 'test_calc.py', content: "import unittest\nfrom calc import square\nclass SquareTest(unittest.TestCase):\n    def test_zero(self): self.assertEqual(square(0),0)\n    def test_negative(self): self.assertEqual(square(-3),9)\n" }],
  ['run_tests', { command: 'python -m pytest -q' }],
  ['run_tests', { command: 'python -m unittest discover -s . -q' }],
 ];
 let requests = 0; const results = [];
 const result = await runTask('Create square and validate its zero and negative inputs', loadConfig({ workspace, runId: 'actual-python', compaction: 'off', capabilityFeedback: true }, {}), {
  onEvent: e => { if (e.type === 'tool_end' && e.name === 'run_tests') results.push(e.output); },
  adapterFactory: () => ({ complete: async () => ++requests === 1
   ? { content: actions.map(([name,input],i) => ({ type:'tool_use',id:'py-'+i,name,input })), stop_reason:'tool_use' }
   : { content:[{type:'text',text:'Fixture completed.'}],stop_reason:'end_turn' } }),
 });
 assert.match(results[0], /No module named pytest/);
 assert.match(results[1], /Ran 2 tests/); assert.match(results[1], /\bOK\b/);
 console.log(JSON.stringify({ arm: process.argv[2], selfAuthoredFixture: true, scriptedModelChoices: true, realPythonCommands: true,
  providerCalls: 0, providerTokenSavings: null, modelSolvingImprovement: null, requests, status: result.status,
  validationPassed: result.validationPassed, sourceFailures: result.validationFailures.length,
  unavailableChecks: result.validationUnavailable || [], actualAlternativeTests: 2,
  limitationReported: result.text.includes('Unavailable checks remain unverified') }));
} finally { await rm(workspace,{ recursive:true,force:true }); }
