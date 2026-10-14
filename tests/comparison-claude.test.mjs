import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeClaudeRead, claudeToolArgs } from '../src/comparison-claude.mjs';
import { createComparisonTurnAudit } from '../src/comparison-turn-audit.mjs';

test('Claude full numbered reads preserve trailing newline, tabs and Unicode', () => {
  assert.equal(decodeClaudeRead('1\tconst x = "中文😀";\n2\t\tvalue\n3\t'), 'const x = "中文😀";\n\tvalue\n');
  assert.equal(decodeClaudeRead('   1→line\n   2→'), 'line\n');
});
test('Claude partial, omitted and malformed source remains unconfirmed', () => {
  for (const value of ['2\tpartial','1\tfirst\n3\tmissing','1\tfirst\n...','not numbered','1\tfirst\n']) assert.equal(decodeClaudeRead(value),null);
});
test('Claude file arguments and native events retain source and validation rules', () => {
  assert.equal(claudeToolArgs({ input: { file_path: 'source.mjs' } }).path,'source.mjs');
  const audit=createComparisonTurnAudit({agent:'claude',workspace:process.cwd(),requiredPath:'source.mjs',expectedOutput:'source\n',readOnly:true});
  audit.observe({type:'tool_execution_start',toolCallId:'r',toolName:'read',args:{path:'source.mjs'}});
  audit.observe({type:'tool_execution_end',toolCallId:'r',result:{content:[{type:'text',text:'source\n'}]}});
  assert.equal(audit.finish().passed,true);
});
