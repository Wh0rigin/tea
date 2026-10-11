import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.mjs';
import { compareRuns, RESULT_ROOT } from '../src/benchmark.mjs';
import { hiddenAcceptance, loadExecutableManifest, runExecutableBenchmark } from '../src/runtime-benchmark.mjs';

test('executable smoke has 12 independent source and acceptance fixtures', async () => {
  const { manifest, manifestSha256 } = await loadExecutableManifest();
  assert.equal(manifest.tasks.length, 12);
  assert.equal(manifest.source.origin, 'self-authored');
  assert.match(manifestSha256, /^[a-f0-9]{64}$/);
  for (const task of manifest.tasks) {
    assert.ok(task.files['AGENTS.md']);
    assert.ok(task.files[task.entry]);
    assert.ok(task.solution.length > 0);
    assert.ok(!Object.keys(task.files).some((filename) => /hidden/i.test(filename)));
  }
});

test('executes pinned code and hidden tests, labels scripted acceptance separately from model success', async () => {
  const { manifest } = await loadExecutableManifest();
  const taskIds = manifest.tasks.slice(0, 2).map((task) => task.taskId);
  const stamp = `${Date.now()}-${process.pid}`;
  const before = await runExecutableBenchmark({ runId: `runtime-unit-base-${stamp}`, strategy: 'baseline', taskIds });
  const after = await runExecutableBenchmark({ runId: `runtime-unit-v1-${stamp}`, strategy: 'v1', taskIds });
  for (const { run, outputDir } of [before, after]) {
    assert.equal(run.mode, 'offline-runtime');
    assert.equal(run.gateEligible, false);
    assert.equal(run.totals.acceptedTasks, taskIds.length);
    assert.equal(run.totals.providerTotalActualTokens, null);
    assert.equal(run.totals.modelTaskSuccessRate, null);
    assert.equal(run.totals.localBudgetConsumedUsd, null);
    assert.match(run.sourceSnapshotSha256, /^[a-f0-9]{64}$/);
    for (const row of run.tasks) {
      assert.equal(row.hiddenBeforePassed, false);
      assert.equal(row.hiddenAfterPassed, true);
      assert.equal(row.validationAttempts, 1);
      assert.match(row.repositoryCommit, /^[a-f0-9]{40}$/);
      assert.equal(row.providerUsage, null);
      const files = await readdir(path.join(outputDir, 'workspaces', row.taskId));
      assert.ok(!files.some((name) => /hidden|acceptance/.test(name)));
    }
  }
  assert.deepEqual(before.run.tasks.map((row) => row.repositoryCommit), after.run.tasks.map((row) => row.repositoryCommit));
  await assert.rejects(compareRuns(before.run.runId, after.run.runId), /controlled-replay only/);
});

test('unchanged code is rejected even when the agent says completed and public tests pass', async () => {
  const { manifest } = await loadExecutableManifest();
  const { run } = await runExecutableBenchmark({ runId: `runtime-negative-${Date.now()}-${process.pid}`, fixtureVariant: 'unchanged', taskIds: [manifest.tasks[0].taskId] });
  assert.equal(run.tasks[0].status, 'completed');
  assert.equal(run.tasks[0].publicAfterPassed, true);
  assert.equal(run.tasks[0].hiddenAfterPassed, false);
  assert.equal(run.totals.acceptedTasks, 0);
});

test('rejects unsafe run IDs, decimal caps, and live calls without prices before execution', async () => {
  await assert.rejects(runExecutableBenchmark({ runId: '../escape' }), /run.?id/i);
  await assert.rejects(runExecutableBenchmark({ initialFileLimit: 8.5 }), /integer/);
  await assert.rejects(runExecutableBenchmark({ mode: 'live', config: loadConfig({}, {}) }), /API_KEY/);
});

test('early process exit cannot bypass hidden assertions and timeout ends test workers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-hidden-negative-'));
  try {
    const fixture = { entry: 'candidate.mjs', hiddenTest: "import './candidate.mjs';\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('must run', () => assert.fail('negative control'));\n" };
    await writeFile(path.join(root, 'candidate.mjs'), 'process.exit(0);\n');
    const early = await hiddenAcceptance(root, fixture);
    assert.equal(early.passed, false);
    assert.equal(early.completed, false);
    await writeFile(path.join(root, 'candidate.mjs'), 'setInterval(() => {}, 1000);\n');
    const timed = await hiddenAcceptance(root, fixture, { timeoutMs: 200 });
    assert.equal(timed.passed, false);
    assert.equal(timed.timedOut, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('acceptance exceptions preserve attempted task evidence and a final failed run', async () => {
  const { manifest } = await loadExecutableManifest();
  const task = manifest.tasks[0];
  const runId = `runtime-checkpoint-${Date.now()}-${process.pid}`;
  const { run, outputDir } = await runExecutableBenchmark({ runId, taskIds: [task.taskId],
    onProgress: async () => unlink(path.join(RESULT_ROOT, runId, 'workspaces', task.taskId, task.entry)),
  });
  assert.equal(run.stopReason, 'harness_error');
  assert.equal(run.totals.attemptedTasks, 1);
  assert.equal(run.totals.acceptedTasks, 0);
  assert.ok(run.tasks[0].ledgerPath);
  assert.match(run.tasks[0].harnessError, /ENOENT/);
  const checkpoint = JSON.parse(await readFile(path.join(outputDir, 'checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.tasks[0].acceptance, 'FAIL');
  assert.ok(checkpoint.tasks[0].toolOutputChars > 0);
  assert.equal(JSON.parse(await readFile(path.join(outputDir, 'run.json'), 'utf8')).stopReason, 'harness_error');
});
