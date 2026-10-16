// Zero API calls: exact first-request and diagnostic compatibility controls.
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), runId = process.argv[2];
if (!/^[a-zA-Z0-9_-]+$/.test(runId || '')) throw Error('Expected frozen run ID');
const directory = path.join(root, 'benchmarks/results', runId), workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tea-s5-controls-')));
const hash = text => createHash('sha256').update(text).digest('hex');
try {
  await writeFile(path.join(workspace, 'sample.mjs'), 'export const value = 1;\n');
  const engines = {}, first = {};
  for (const arm of ['baseline', 'candidate']) {
    const module = name => import(pathToFileURL(path.join(directory, 'engines', arm, 'src', name + '.mjs')).href);
    const { loadCliConfig } = await module('config'), { runTask } = await module('agent');
    engines[arm] = await module('tool-feedback');
    await runTask('Inspect the workspace.', { ...loadCliConfig({ workspace, runId: arm, compaction: 'off' }, {}), testRepairFeedback: arm === 'candidate' },
      { adapterFactory: () => ({ complete: async request => {
        first[arm] = JSON.stringify({ system: request.system, messages: request.messages, tools: request.tools });
        return { content: [{ type: 'text', text: 'Inspected.' }], stop_reason: 'end_turn' };
      } }) });
  }
  assert.equal(first.baseline, first.candidate);
  const controls = [];
  for (const kind of ['success', 'assertion', 'command-timeout', 'network-timeout', 'non-validation', 'permission', 'cancellation']) {
    const input = { toolName: 'run_tests', validation: kind !== 'non-validation', output: kind === 'success' ? 'exit=0\npassed' : 'exit=1\nassertion' };
    if (kind === 'command-timeout') { input.error = new Error('Command timed out after 1000 ms'); input.output = undefined; }
    if (kind === 'network-timeout') { input.error = Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' }); input.output = undefined; }
    if (kind === 'permission') { input.error = Object.assign(new Error('denied'), { feedbackCode: 'CAPABILITY_DENIED' }); input.output = undefined; }
    if (kind === 'cancellation') { input.error = new Error('Command cancelled'); input.output = undefined; }
    const values = {};
    for (const arm of ['baseline', 'candidate']) {
      const feedback = engines[arm].toolFailureFeedback({ ...input, repairGuidance: arm === 'candidate' }), text = JSON.stringify(feedback);
      values[arm] = { feedbackSha256: hash(text), bytes: Buffer.byteLength(text), code: feedback?.code || null, retryable: feedback?.retryable ?? null };
    }
    const identical = values.baseline.feedbackSha256 === values.candidate.feedbackSha256;
    assert.equal(identical, !['assertion', 'command-timeout'].includes(kind));
    controls.push({ kind, identical, ...values });
  }
  const report = { unit: 'offline serialized bytes and fingerprints; scripted first response, no API usage',
    firstRequest: { identical: true, bytes: Buffer.byteLength(first.baseline), sha256: hash(first.baseline) }, controls };
  await writeFile(path.join(directory, 'feedback-controls.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  const target = await realpath(workspace), relative = path.relative(await realpath(os.tmpdir()), target);
  assert.ok(relative.startsWith('tea-s5-controls-') && !path.isAbsolute(relative) && !relative.includes('..'));
  await rm(target, { recursive: true, force: true });
}
