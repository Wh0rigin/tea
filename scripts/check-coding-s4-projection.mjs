// Offline request-shape controls against the exact frozen live engines; no model calls.
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2];
if (!/^[a-zA-Z0-9_-]+$/.test(runId || '')) throw Error('Expected frozen run ID');
const output = path.join(root, 'benchmarks/results', runId);
const workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tea-s4-controls-')));
const hash = value => createHash('sha256').update(value).digest('hex');
const pair = (id, text, command = 'node --test sample.test.mjs') => [
  { role: 'assistant', content: [{ type: 'tool_use', id, name: 'run_tests', input: { command } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: /^exit=1/.test(text) }] },
];
try {
  const engines = {};
  for (const arm of ['baseline', 'candidate']) {
    const module = name => import(pathToFileURL(path.join(output, 'engines', arm, 'src', name + '.mjs')).href);
    const { WorkspaceTools } = await module('tools');
    const { ContextMemory, validToolProtocol } = await module('context-assembler');
    const { loadCliConfig } = await module('config');
    const tools = new WorkspaceTools({ workspace }); await tools.init();
    engines[arm] = { tools, memory: new ContextMemory(tools), validToolProtocol,
      config: { ...loadCliConfig({ workspace }, {}), contextosTargetBytes: 1000000, compactResolvedTests: arm === 'candidate' } };
  }
  const controls = [];
  for (const kind of ['no-failure', 'unresolved', 'small-resolved', 'large-resolved']) {
    const large = 'exit=1\nORIGINAL_FAILURE_DETAILS\n' + 'assertion trace\n'.repeat(700);
    const messages = [{ role: 'user', content: 'Keep API compatibility.' },
      ...pair('first', kind === 'no-failure' ? 'exit=0' : kind === 'small-resolved' ? 'exit=1\nx' : large),
      ...pair('middle', 'exit=0', 'node --test other.test.mjs'),
      ...pair('last', kind === 'unresolved' ? 'exit=1\nSTILL_FAILING' : 'exit=0\n# tests 1\n# pass 1\n')];
    const original = JSON.stringify(messages), projections = {};
    for (const arm of ['baseline', 'candidate']) {
      const e = engines[arm], plan = await e.memory.assemble({ messages, canonical: messages, system: 'fixed system',
        tools: e.tools.modelToolDefinitions({ includeMemory: false }), config: e.config,
        state: { pendingValidation: kind === 'unresolved', validationPassed: kind !== 'unresolved', changedFiles: [] } });
      assert.equal(e.validToolProtocol(plan.request.messages), true);
      assert.equal(JSON.stringify(messages), original);
      const serialized = JSON.stringify(plan.request);
      projections[arm] = { bytes: Buffer.byteLength(serialized), requestSha256: hash(serialized),
        resolvedFailureReferences: plan.diagnostics.resolvedFailureReferences || 0 };
    }
    const identical = projections.baseline.requestSha256 === projections.candidate.requestSha256;
    assert.equal(identical, kind !== 'large-resolved');
    if (kind === 'large-resolved') {
      assert.ok(projections.candidate.bytes < projections.baseline.bytes);
      assert.equal(projections.candidate.resolvedFailureReferences, 1);
    }
    controls.push({ kind, historySha256: hash(original), identical, ...projections });
  }
  const report = { unit: 'serialized adapter-input UTF-8 bytes; offline, no provider tokens or API calls', controls };
  await writeFile(path.join(output, 'projection-controls.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  const target = await realpath(workspace), rel = path.relative(await realpath(os.tmpdir()), target);
  assert.ok(rel.startsWith('tea-s4-controls-') && !path.isAbsolute(rel) && !rel.includes('..'));
  await rm(target, { recursive: true, force: true });
}
