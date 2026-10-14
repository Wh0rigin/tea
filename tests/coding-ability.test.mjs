import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codingTasks } from '../benchmarks/tasks/coding-ability.mjs';

test('all eight graded fixtures reject initial code and accept independently checked reference code', { timeout: 120000 }, async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const runId = `coding-ci-${randomUUID()}`;
  const resultRoot = path.resolve(root, 'benchmarks/results'), directory = path.resolve(resultRoot, runId);
  assert.equal(path.relative(resultRoot, directory), runId);
  assert.equal(codingTasks.length, 8); assert.equal(new Set(codingTasks.map(t => t.id)).size, 8);
  for (const level of [1, 2, 3, 4]) assert.equal(codingTasks.filter(t => t.level === level).length, 2);
  try {
    await promisify(execFile)(process.execPath, ['scripts/test-coding-ability.mjs', '--mode=preflight', `--run-id=${runId}`],
      { cwd: root, timeout: 110000, windowsHide: true, maxBuffer: 20000 });
    const result = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'));
    assert.equal(result.stopReason, null); assert.equal(result.sourceUnchangedDuringRun, true);
    assert.equal(result.rows.length, 8); assert.equal(result.consumedUsd, 0);
    for (const row of result.rows) {
      assert.equal(row.agentStarted, false); assert.equal(row.usage, null);
      assert.equal(row.preflight.baselinePublicPassed, true); assert.equal(row.preflight.baselineHiddenPassed, false);
      assert.equal(row.preflight.baselineHiddenCompleted, true); assert.equal(row.preflight.referencePublicPassed, true);
      assert.equal(row.preflight.referenceHiddenPassed, true);
    }
  } finally {
    assert.equal(path.relative(resultRoot, directory), runId);
    await rm(directory, { recursive: true, force: true });
  }
});
