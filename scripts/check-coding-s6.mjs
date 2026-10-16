// Fixed-state execution controls; bytes and scripted requests are not provider tokens.
import { readFile, writeFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadCliConfig } from '../src/config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2]; assert(/^[a-zA-Z0-9_-]+$/.test(runId || ''));
const directory = path.join(root, 'benchmarks/results', runId);
const source = JSON.parse(await readFile(path.join(directory, 'comparison.json'), 'utf8'));
const base = await realpath(os.tmpdir()), workspace = await realpath(await mkdtemp(path.join(base, 'tea-s6-control-')));
const hash = value => createHash('sha256').update(value).digest('hex');
const results = {};
try {
  for (const arm of ['baseline', 'candidate']) {
    for (const file of source.engine[arm].files) assert.equal(hash(await readFile(path.join(directory, 'engines', arm, file.path))), file.sha256);
    const engine = await import(pathToFileURL(path.join(directory, 'engines', arm, 'src/agent.mjs')).href);
    const old = 'export const value = 1;\n', content = 'export const value = 2;\n';
    await writeFile(path.join(workspace, 'a.mjs'), old);
    await writeFile(path.join(workspace, 'check.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import {value} from './a.mjs'; test('value',()=>assert.equal(value,2));\n");
    let step = 0, requestBytes = 0, first;
    const config = { ...loadCliConfig({ workspace, runId: arm }, {}), versionedWrite: arm === 'candidate' };
    const calls = input => ({ content: [{ type: 'tool_use', id: `${arm}-${step}`, ...input }], stop_reason: 'tool_use' });
    const result = await engine.runTask('Set value to 2 and run the test.', config, { adapterFactory: () => ({ complete: async request => {
      const wire = JSON.stringify(request); first ||= wire; requestBytes += Buffer.byteLength(wire);
      if (++step === 1) return calls({ name: 'read_file', input: { path: 'a.mjs' } });
      if (step === 2) return calls({ name: 'write_file', input: { path: 'a.mjs', content,
        ...(arm === 'candidate' ? { expected_sha256: hash(old) } : {}) } });
      if (step === 3 && arm === 'baseline') return calls({ name: 'apply_patch', input: { path: 'a.mjs', search: old, replace: content } });
      if (step === (arm === 'baseline' ? 4 : 3)) return calls({ name: 'run_tests', input: { command: 'node --test check.test.mjs' } });
      return { content: [{ type: 'text', text: 'Verified.' }], stop_reason: 'end_turn' };
    } }) });
    assert.equal(result.status, 'completed'); assert(result.validationPassed);
    assert.equal(await readFile(path.join(workspace, 'a.mjs'), 'utf8'), content);
    results[arm] = { scriptedModelRequests: step, serializedRequestBytes: requestBytes,
      firstRequestBytes: Buffer.byteLength(first), firstRequestSha256: hash(first), validationPassed: true,
      toolCalls: result.toolCalls, usageSource: 'scripted control; no provider tokens measured' };
  }
  await writeFile(path.join(directory, 'execution-controls.json'), JSON.stringify({ unit: 'UTF-8 bytes and scripted request counts only', results }, null, 2));
  console.log(JSON.stringify(results));
} finally {
  const relative = path.relative(base, workspace); assert(relative.startsWith('tea-s6-control-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
  await rm(workspace, { recursive: true, force: true });
}
