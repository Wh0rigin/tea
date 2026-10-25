import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSystemPrompt } from '../src/prompts.mjs';
import { TOOL_DEFINITIONS } from '../src/tools.mjs';

const exec = promisify(execFile);

test('fresh output guidance reuses the existing workflow and follows available tools', () => {
  const prompt = buildSystemPrompt(TOOL_DEFINITIONS);
  for (const phrase of ['with fresh inputs', 'For file outputs, test missing parents',
    'fixtures must not precreate product-owned outputs', 'preserve dry-run/read-only behavior',
    'Check persisted results', 'not just exit codes or status flags', 'after the starter exits']) assert(prompt.includes(phrase));
  assert.equal(prompt.match(/For file outputs/g).length, 1);
  assert.equal(buildSystemPrompt([...TOOL_DEFINITIONS, ...TOOL_DEFINITIONS]), prompt);
  assert.doesNotMatch(buildSystemPrompt([{ name: 'read_file' }]), /missing parents|product-owned outputs|dry-run/);
  assert.doesNotMatch(prompt, /Mnamer|Helm|daemon-state|mkdir|makedirs|requirement_review/);
});

// Self-authored test-design fixture, not a model/DeepSWE accuracy experiment.
// The harness creates inputs only; the child must create output parents itself.
function fixtureSource(createParents) {
  return `import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const [mode,input,output]=process.argv.slice(2);
const log=output+'.log';
if(mode==='read-log') {
  try { process.stdout.write(await readFile(log,'utf8')); }
  catch(error) { if(error.code!=='ENOENT')throw error;process.stdout.write('no logs available'); }
} else {
  const contents=await readFile(input,'utf8');
  if(mode==='dry-run')process.stdout.write('would write '+output);
  else {
    ${createParents ? 'await mkdir(path.dirname(output),{recursive:true});' : ''}
    await writeFile(output,contents);
    await writeFile(log,'exported\\n');
  }
}
`;
}

test('independent CLI checks expose missing parent creation without preparing product outputs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-fresh-output-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('tea-fresh-output-'));
    await rm(root, { recursive: true, force: true });
  });
  const cli = path.join(root, 'export.mjs'), input = path.join(root, 'input.txt');
  await writeFile(input, 'input remains unchanged\n');
  const run = (mode, output) => exec(process.execPath, [cli, mode, input, output], { timeout: 10_000, windowsHide: true });
  const missing = filename => assert.rejects(access(filename), { code: 'ENOENT' });

  await t.test('missing nested parents fail on broken product code and pass only after product repair', async () => {
    const output = path.join(root, 'fresh output', 'nested', 'report.txt');
    await missing(path.dirname(output));
    await writeFile(cli, fixtureSource(false));
    await assert.rejects(run('write', output), error => error.code !== 0 && /ENOENT/.test(error.stderr));
    await missing(path.dirname(output));
    await writeFile(cli, fixtureSource(true));
    await run('write', output);
    assert.equal(await readFile(output, 'utf8'), await readFile(input, 'utf8'));
    assert.equal(await readFile(output + '.log', 'utf8'), 'exported\n');
    assert.equal((await run('read-log', output)).stdout, 'exported\n');
  });

  await t.test('existing output parent remains supported', async () => {
    const parent = path.join(root, 'existing');
    await mkdir(parent);
    const output = path.join(parent, 'report.txt');
    await run('write', output);
    assert.equal(await readFile(output, 'utf8'), 'input remains unchanged\n');
  });

  await t.test('dry-run does not create output directories or files', async () => {
    const parent = path.join(root, 'dry output'), output = path.join(parent, 'report.txt');
    await missing(parent);
    assert.match((await run('dry-run', output)).stdout, /would write/);
    await missing(parent);
    await missing(output);
    await missing(output + '.log');
  });

  await t.test('read-only log query does not create missing output parents', async () => {
    const parent = path.join(root, 'read only'), output = path.join(parent, 'report.txt');
    assert.equal((await run('read-log', output)).stdout, 'no logs available');
    await missing(parent);
  });

  await t.test('a parent that is a regular file fails without replacing it', async () => {
    const parent = path.join(root, 'regular-file');
    await writeFile(parent, 'preserve me');
    await assert.rejects(run('write', path.join(parent, 'report.txt')), error => error.code !== 0);
    assert.equal(await readFile(parent, 'utf8'), 'preserve me');
    assert.equal(await readFile(input, 'utf8'), 'input remains unchanged\n');
  });
});
