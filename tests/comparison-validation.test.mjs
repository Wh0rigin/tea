import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { commandArguments, recognizeValidation, nodeTestSummary, acceptanceDimensions } from '../src/comparison-validation.mjs';
import { createComparisonTurnAudit } from '../src/comparison-turn-audit.mjs';
import { createSourceCapture, createPackageScriptReader } from '../src/comparison-source-capture.mjs';

const workspace = path.resolve('fixture'), positive = 'exit=0\n# tests 1\n# pass 1\n# fail 0\n';
test('validation recognizes quoted relative paths, option order and npm scripts', () => {
  for (const command of ['node --test "./tests/public.test.mjs"', 'node --test --test-reporter=spec tests\\public.test.mjs',
    '& node.exe --test .\\tests\\public.test.mjs', 'node --test tests/public.test.mjs --test-reporter spec', 'npm test', 'npm run verify']) {
    assert.equal(recognizeValidation(command, { workspace, packageScripts: { test: 'node --test tests/public.test.mjs', verify: 'npm run test' } }).recognized, true, command);
  }
  assert.ok(recognizeValidation('node --test "tests/public test.mjs"', { workspace, targets: ['tests/public test.mjs'] }).recognized);
  assert.ok(recognizeValidation('npm test -- "tests\\public test.mjs"', { workspace, targets: ['tests/public test.mjs'], packageScripts: { test: 'node --test' } }).recognized);
});
test('validation rejects echoed commands, inline eval, compound shells, filters and script cycles', () => {
  for (const command of ['echo node --test tests/public.test.mjs', 'node -e "console.log(\'node --test tests/public.test.mjs\')"',
    'node --test tests/public.test.mjs; exit 0', 'node --test tests/public.test.mjs | echo ok', 'node --test --test-name-pattern=one tests/public.test.mjs',
    'node --test --test-shard=1/2 tests/public.test.mjs', 'npm run recursive']) {
    assert.equal(recognizeValidation(command, { workspace, packageScripts: { recursive: 'npm run recursive' } }).recognized, false, command);
  }
  assert.equal(commandArguments('node --test "unterminated'), null);
});
test('positive summary requires executed tests, all passing counts and failure zero', () => {
  assert.ok(nodeTestSummary(positive).positiveCompletion);
  assert.ok(nodeTestSummary('ℹ tests 1\nℹ pass 1\nℹ fail 0\n').positiveCompletion);
  for (const output of ['exit=0', '# tests 0\n# pass 0\n# fail 0', '# tests 2\n# pass 1\n# fail 0', '# tests 1\n# pass 0\n# fail 1', '# tests 1']) assert.equal(nodeTestSummary(output).positiveCompletion, false);
});
test('validation recognizes exact-workspace Bash cd and stderr merging for every agent', () => {
  for (const command of [`cd "${workspace}" && node --test tests/public.test.mjs`,
    'cd . && node --test tests/public.test.mjs 2>&1',
    'cd -- "." && npm test 2>&1', 'node --test tests/public.test.mjs 2>&1',
    `  cd '${workspace}' && node --test tests/public.test.mjs  `]) {
    assert.equal(recognizeValidation(command, { workspace, packageScripts: { test: 'node --test tests/public.test.mjs' } }).recognized, true, command);
  }
  for (const directory of ['C:/Users/test/project', '/c/Users/test/project', 'C:\\Users\\test\\project']) {
    assert.equal(recognizeValidation(`cd "${directory}" && node --test tests/public.test.mjs`, { workspace: 'C:\\Users\\test\\project' }).recognized, true);
  }
});
test('Bash compatibility rejects unrelated directories, status masking, substitutions and pipelines', () => {
  for (const command of ['cd ../other && node --test tests/public.test.mjs', 'cd tests && node --test tests/public.test.mjs',
    'cd .; node --test tests/public.test.mjs', 'cd . && node --test tests/public.test.mjs || true',
    'cd . && echo pass && node --test tests/public.test.mjs', 'cd . && node --test tests/public.test.mjs | tail -10',
    'node --test tests/public.test.mjs > log', 'node --test tests/public.test.mjs 2>&1; true',
    'node --test tests/public.test.mjs 2>&1 2>&1', 'cd "$PWD" && node --test tests/public.test.mjs',
    'cd `pwd` && node --test tests/public.test.mjs', 'cd . && node --test --test-only tests/public.test.mjs',
    'cd . && node --test tests/public.test.mjs\necho pass']) {
    assert.equal(recognizeValidation(command, { workspace }).recognized, false, command);
  }
});
test('native Bash wrapper still requires passing output, stable sources, and successful completion', () => {
  for (const agent of ['pi', 'claude']) for (const [output, exitCode, isError, passed] of [
    [positive.slice(7), 0, false, true], [positive.slice(7), 1, false, false],
    [positive.slice(7), 0, true, false], ['no tests executed', 0, false, false],
    ['# tests 1\n# pass 0\n# fail 1', 0, false, false]]) {
    const audit = createComparisonTurnAudit({ agent, workspace });
    audit.observe({ type: 'tool_execution_start', toolCallId: 'bash', toolName: 'bash', args: { command: 'cd . && node --test tests/public.test.mjs 2>&1' } });
    audit.observe({ type: 'tool_execution_end', toolCallId: 'bash', isError, result: { content: [{ type: 'text', text: output }], details: { exitCode } } });
    assert.equal(audit.finish().validatedAfterEdit, passed, agent + output);
  }
});
test('unknown commands retain sanitized counts without granting validation', () => {
  const audit = createComparisonTurnAudit({ agent: 'claude', workspace });
  audit.observe({ type: 'tool_execution_start', toolCallId: 'one', toolName: 'bash', args: { command: 'echo fake | cat' } });
  audit.observe({ type: 'tool_execution_end', toolCallId: 'one', result: { content: [{ type: 'text', text: positive.slice(7) }] } });
  const result = audit.finish(); assert.equal(result.validatedAfterEdit, false);
  assert.equal(result.calls[0].validationEvidence.summary.positiveCompletion, true);
  assert.equal(result.calls[0].validationEvidence.recognized, false);
});
test('native test evidence rejects nonzero exit, denial and missing test results', () => {
  for (const output of ['exit=1\n# tests 1\n# pass 1\n# fail 0', 'exit=0', 'Command denied by user.']) {
    const audit = createComparisonTurnAudit({ agent: 'tea', workspace });
    audit.observe({ type: 'tool_end', name: 'run_tests', input: { command: 'node --test tests/public.test.mjs' }, output, isError: false });
    assert.equal(audit.finish().validatedAfterEdit, false);
  }
});
test('native validation is invalidated by source changes during or after a settled test', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-audit-source-')); await writeFile(path.join(root, 'a.mjs'), 'one');
  const captureSources = createSourceCapture(root, ['a.mjs']);
  const audit = createComparisonTurnAudit({ agent: 'tea', workspace: root, captureSources });
  const start = () => audit.observe({ type: 'tool_start', name: 'run_tests', input: { command: 'node --test tests/public.test.mjs' } });
  const end = () => audit.observe({ type: 'tool_end', name: 'run_tests', input: { command: 'node --test tests/public.test.mjs' }, output: positive, isError: false });
  start(); await writeFile(path.join(root, 'a.mjs'), 'two'); end(); assert.equal(audit.finish().validatedAfterEdit, false);
  start(); end(); assert.equal(audit.finish().validatedAfterEdit, true);
  await writeFile(path.join(root, 'a.mjs'), 'three'); assert.equal(audit.finish().validatedAfterEdit, false);
  assert.notEqual(audit.finish().calls[0].sourceVersionsBefore['a.mjs'], audit.finish().calls[0].sourceVersionsAfter['a.mjs']);
});
test('source capture rejects sensitive, outside and excessive source selections', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-audit-path-'));
  assert.throws(() => createSourceCapture(root, ['.env']), /Invalid comparison source/);
  assert.throws(() => createSourceCapture(root, ['../outside.mjs'])(), /escapes/);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test tests/public.test.mjs' } }));
  const reader = createPackageScriptReader(root); assert.equal(reader().test, 'node --test tests/public.test.mjs');
  await writeFile(path.join(root, 'package.json'), '{}'); assert.deepEqual(reader(), {});
});
test('Pi positive evidence uses settled result and respects explicit failing exit', () => {
  for (const [exitCode, passed] of [[0, true], [1, false], [undefined, true]]) {
    const audit = createComparisonTurnAudit({ agent: 'pi', workspace });
    audit.observe({ type: 'tool_execution_start', toolCallId: 'one', toolName: 'powershell', args: { command: 'node --test ./tests/public.test.mjs' } });
    audit.observe({ type: 'tool_execution_end', toolCallId: 'one', isError: false, result: { details: { exitCode }, content: [{ type: 'text', text: positive.slice(7) }] } });
    assert.equal(audit.finish().validatedAfterEdit, passed);
  }
});
test('quality dimensions never turn functional success or unknown usage into completed work', () => {
  const input = { evaluation: { publicPassed: true, hiddenPassed: true, hiddenCompleted: true, scopePassed: true },
    turns: [{ status: 'completed', nativeValidationPassed: true, requirements: { passed: true, validatedAfterEdit: true } }], plannedTurns: 1, status: 'completed', usageComplete: true };
  assert.equal(acceptanceDimensions(input).accepted, true);
  for (const change of [{ usageComplete: false }, { status: 'tool_limit_reached' }, { plannedTurns: 2 },
    { evaluation: { ...input.evaluation, hiddenCompleted: false } }, { turns: [{ ...input.turns[0], nativeValidationPassed: false }] }]) assert.equal(acceptanceDimensions({ ...input, ...change }).accepted, false);
});

test('native audit rejects missing, duplicate or still-pending completion events without mutating events', () => {
  const start = { type: 'tool_start', name: 'run_tests', input: { command: 'node --test tests/public.test.mjs' } };
  const end = { ...start, type: 'tool_end', output: positive, isError: false };
  const saved = JSON.stringify([start, end]);
  const unmatched = createComparisonTurnAudit({ agent: 'tea', workspace }); unmatched.observe(end);
  assert.equal(unmatched.finish().passed, false); assert.equal(unmatched.finish().validatedAfterEdit, false);
  const pending = createComparisonTurnAudit({ agent: 'tea', workspace }); pending.observe(start); assert.equal(pending.finish().passed, false);
  const duplicate = createComparisonTurnAudit({ agent: 'tea', workspace }); duplicate.observe(start); duplicate.observe(start); duplicate.observe(end);
  assert.equal(duplicate.finish().passed, false); assert.equal(JSON.stringify([start, end]), saved);
});
