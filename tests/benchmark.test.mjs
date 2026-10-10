import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { estimateTextTokens, runReplayBenchmark } from '../src/benchmark.mjs';

test('labels replay token estimates as diagnostics rather than provider usage', async () => {
  const runId = `unit-${Date.now()}`;
  const { run } = await runReplayBenchmark({ suite: 'core', runId });
  assert.equal(run.gateEligible, false);
  assert.equal(run.totals.providerTotalActualTokens, null);
  assert.equal(run.totals.taskSuccessRate, null);
  assert.equal(run.mode, 'controlled-replay');
  assert.ok(run.totals.taskCount >= 8);
  const report = await readFile((await import('node:path')).join((await import('../src/benchmark.mjs')).RESULT_ROOT, runId, 'report.md'), 'utf8');
  assert.match(report, /NOT_MEASURED/);
});

test('text-size estimator is deterministic and treats CJK separately', () => {
  assert.equal(estimateTextTokens('abcdef'), 2);
  assert.equal(estimateTextTokens('修复边界'), 6);
  assert.equal(estimateTextTokens('abcdef'), estimateTextTokens('abcdef'));
});
