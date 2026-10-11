import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareRuns, estimateTextTokens, runReplayBenchmark } from '../src/benchmark.mjs';

test('labels replay estimates as diagnostics and finds the expected synthetic V1 delta', async () => {
  const baselineId = `unit-baseline-${Date.now()}`;
  const candidateId = `unit-v1-${Date.now()}`;
  const { run: baseline } = await runReplayBenchmark({ suite: 'core', strategy: 'baseline', runId: baselineId });
  const { run: candidate } = await runReplayBenchmark({ suite: 'core', strategy: 'v1', runId: candidateId });
  assert.equal(baseline.gateEligible, false);
  assert.equal(baseline.totals.providerTotalActualTokens, null);
  assert.equal(baseline.totals.taskSuccessRate, null);
  assert.equal(baseline.mode, 'controlled-replay');
  assert.equal(baseline.totals.taskCount, candidate.totals.taskCount);
  const before = baseline.tasks.find((row) => row.taskId === 'replay-js-repeated-read');
  const after = candidate.tasks.find((row) => row.taskId === 'replay-js-repeated-read');
  assert.ok(after.estimatedInputTokens < before.estimatedInputTokens);
  const comparison = await compareRuns(baselineId, candidateId);
  assert.equal(comparison.gateEligible, false);
  assert.ok(comparison.heuristicTokenEstimateReductionPercent > 0);
  const report = await readFile((await import('node:path')).join((await import('../src/benchmark.mjs')).RESULT_ROOT, baselineId, 'report.md'), 'utf8');
  assert.match(report, /NOT_MEASURED/);
});

test('text-size estimator is deterministic and treats CJK separately', () => {
  assert.equal(estimateTextTokens('abcdef'), 2);
  assert.equal(estimateTextTokens('修复边界'), 6);
  assert.equal(estimateTextTokens('abcdef'), estimateTextTokens('abcdef'));
});

test('screens inventory compaction on synthetic repositories and records relevant-file recall', async () => {
  const baselineId = `inventory-baseline-${Date.now()}`;
  const candidateId = `inventory-v1-${Date.now()}`;
  const { run: baseline } = await runReplayBenchmark({ suite: 'core', strategy: 'baseline', runId: baselineId });
  const { run: candidate } = await runReplayBenchmark({ suite: 'core', strategy: 'v1-inventory', runId: candidateId });
  const { run: expanded } = await runReplayBenchmark({ suite: 'core', strategy: 'v1-inventory-expanded', runId: `inventory-expanded-${Date.now()}` });
  const { run: automatic } = await runReplayBenchmark({ suite: 'core', strategy: 'v1-inventory-auto', runId: `inventory-auto-${Date.now()}` });
  const { run: tightLimit } = await runReplayBenchmark({ suite: 'core', strategy: 'v1', initialFileLimit: 4, runId: `inventory-cap4-${Date.now()}` });
  assert.equal(baseline.gateEligible, false);
  assert.equal(baseline.totals.inventoryRecall.tasks, 13);
  assert.equal(candidate.totals.inventoryRecall.tasks, 13);
  assert.ok(candidate.totals.inventoryRecall.recall > baseline.totals.inventoryRecall.recall);
  assert.ok(candidate.totals.inventoryRecall.recall < 1);
  assert.equal(expanded.totals.inventoryRecall.recall, 1);
  assert.equal(automatic.totals.inventoryRecall.recall, 1);
  assert.ok(automatic.totals.inventoryRecall.queryExpansionTasks < expanded.totals.inventoryRecall.queryExpansionTasks);
  assert.equal(tightLimit.initialFileLimit, 4);
  assert.equal(tightLimit.totals.inventoryRecall.recall, 0.5);
  await assert.rejects(runReplayBenchmark({ suite: 'core', strategy: 'v1', initialFileLimit: 251, runId: `inventory-invalid-${Date.now()}` }), /1 through 250/);
  for (const task of candidate.tasks.filter((row) => row.inventoryDiagnostic)) {
    if (task.taskId.startsWith('replay-inventory-')) assert.equal(task.inventoryDiagnostic.recall, 1);
    assert.ok(task.inventoryDiagnostic.selectedFiles <= 8);
  }
});
