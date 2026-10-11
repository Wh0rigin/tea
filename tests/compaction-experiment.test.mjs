import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCompaction, historyFingerprint, seedHistory } from '../src/compaction-experiment.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareFixture, taskDefinitions } from '../src/comparison-fixtures.mjs';

const run = (variant, extra = {}) => ({ caseId: 'case', repeat: 1, category: 'stress', variant,
  totalTokens: variant === 'off' ? 1000 : 800, accepted: true, usageComplete: true, conservativeSpendUsd: 0.01, ...extra });
test('experiment counts summary-inclusive total tokens and retains negative pairs', () => {
  const result = analyzeCompaction([run('off'), run('auto', { totalTokens: 1200 })]);
  assert.equal(result.categories.stress.savingsPercent, -20); assert.equal(result.pairs[0].savedTokens, -200);
  assert.equal(result.conservativeSpendUsd, 0.02);
});
test('failed, unmatched and unknown runs cannot enter successful token savings', () => {
  for (const runs of [[run('off'), run('auto', { accepted: false })], [run('off')],
    [run('off'), run('auto', { totalTokens: null, usageComplete: false })]]) {
    const result = analyzeCompaction(runs); assert.equal(result.categories.stress.eligiblePairs, 0);
    assert.equal(result.categories.stress.savingsPercent, null); assert.equal(result.pairs[0].savingsPercent, null);
  }
});
test('seed fingerprints include Unicode bytes and reject duplicate runs', () => {
  const messages = [{ role: 'user', content: '中文🚀' }];
  assert.equal(historyFingerprint(messages).bytes, Buffer.byteLength(JSON.stringify(messages), 'utf8'));
  assert.throws(() => analyzeCompaction([run('off'), run('off')]), /Duplicate/);
});
test('stress setup is reproducible, executes actual reads, and leaves the pinned fixture unchanged', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-compaction-seed-'));
  try {
    const definition = taskDefinitions().find(d => d.taskId === 'medium-retry-budget');
    await prepareFixture(root, definition);
    const first = await seedHistory(root, definition, 'reads'), second = await seedHistory(root, definition, 'reads');
    assert.deepEqual(historyFingerprint(first), historyFingerprint(second));
    assert.ok(historyFingerprint(first).bytes > 28000);
    assert.equal(first.filter(m => m.role === 'assistant' && Array.isArray(m.content)).length, 50);
    assert.ok(JSON.stringify(first).includes('Unrelated domain utility'));
    assert.deepEqual(await seedHistory(root, definition, 'empty'), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
