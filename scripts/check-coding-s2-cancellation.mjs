// Reproduce a counterexample in the rejected, frozen S2 candidate. No API calls.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRevisionEngine } from '../src/comparison-revisions.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tea-s2-cancel-')));
try {
  const frozen = await prepareRevisionEngine({ repository, ref: '7ea8d82', directory: path.join(temporary, 'engine') });
  const workspace = path.join(temporary, 'workspace'); await mkdir(workspace);
  await writeFile(path.join(workspace, 'a.mjs'), 'export const a = 1;\n'.repeat(40));
  const tools = new frozen.tools.WorkspaceTools({ workspace, batchReads: true }); await tools.init();
  const original = tools.readFile.bind(tools), controller = new AbortController();
  tools.signal = controller.signal;
  tools.readFile = async (...args) => {
    const output = await original(...args);
    controller.abort(new Error('Injected cancellation before batch delivery'));
    return output;
  };
  await assert.rejects(tools.readFiles({ files: [{ path: 'a.mjs' }] }), /Injected cancellation/);
  tools.signal = undefined; tools.readFile = original;
  const next = await tools.readFile({ path: 'a.mjs' });
  assert.ok(next.startsWith('Evidence unchanged;'), 'Historical counterexample did not reproduce');
  assert.equal(await frozen.verify(), true);
  console.log(JSON.stringify({ candidate: frozen.metadata.commit, counterexampleConfirmed: true,
    cancelledBeforeBatchDelivery: true, nextReadIncorrectlyClaimsPriorEvidence: true,
    unit: 'offline deterministic cancellation injection; not provider tokens' }));
} finally {
  const relative = path.relative(await realpath(os.tmpdir()), temporary);
  if (!relative.startsWith('tea-s2-cancel-') || relative.includes(path.sep)) throw new Error('Unsafe cleanup target');
  await rm(temporary, { recursive: true, force: true });
}
