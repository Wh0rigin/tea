import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codingTasks } from '../benchmarks/tasks/coding-ability.mjs';
import { configurePiComparison } from '../src/comparison-pi.mjs';

test('Pi uses the same configured context capacity and retains the historical fallback', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tea-pi-budget-'));
  try {
    const config = { model: 'test', maxOutputTokens: 4096, inputRateUsdPerMillion: .8, outputRateUsdPerMillion: 2.8,
      contextWindowTokens: 32768, piAutoCompaction: true };
    await configurePiComparison({ agentDir: directory, baseUrl: 'http://127.0.0.1', token: 'test-only', config });
    const models = JSON.parse(await readFile(path.join(directory,'models.json'),'utf8'));
    assert.equal(models.providers.comparison.models[0].contextWindow, 32768);
    assert.equal(models.providers.comparison.models[0].maxTokens, 4096);
    assert.equal(JSON.parse(await readFile(path.join(directory,'settings.json'),'utf8')).compaction.enabled, true);
    delete config.contextWindowTokens;
    await configurePiComparison({ agentDir: directory, baseUrl: 'http://127.0.0.1', token: 'test-only', config });
    assert.equal(JSON.parse(await readFile(path.join(directory,'models.json'),'utf8')).providers.comparison.models[0].contextWindow, 200000);
  } finally {
    const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(directory));
    assert.ok(relative.startsWith('tea-pi-budget-')&&!relative.includes(path.sep));
    await rm(directory,{recursive:true,force:true});
  }
});

test('both coding harnesses use identical acceptance and workspace helpers', async () => {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const original=await readFile(path.join(root,'scripts/test-coding-ability.mjs'),'utf8');
  const shared=await readFile(path.join(root,'scripts/coding-ability-harness.mjs'),'utf8');
  const body=original.slice(original.indexOf('const childEnv ='),original.indexOf('const srcFiles ='));
  assert.ok(shared.replaceAll('\r\n','\n').includes(body.replaceAll('\r\n','\n')));
});

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
