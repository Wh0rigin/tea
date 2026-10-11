import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TokenLedger } from '../src/ledger.mjs';
import { validateRunId } from '../src/run-id.mjs';

async function withLedger(metadata, callback) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'tea-ledger-'));
  try {
    const ledger = new TokenLedger({ workspace, runId: 'test-run', model: 'offline-test' });
    await ledger.init(metadata);
    await callback(ledger, workspace);
  } finally { await rm(workspace, { recursive: true, force: true }); }
}
const request = { requestId: 'request_1', payload: {}, response: { stop_reason: 'end_turn' } };

test('canonical provider totals count uncached, cache-read, and cache-write input exactly once', async () => {
  await withLedger({ usageSource: 'provider', runType: 'live' }, async (ledger) => {
    await ledger.request({ ...request, usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 40, reasoning_tokens: 8 } });
    const summary = await ledger.finish({ status: 'completed' });
    assert.equal(summary.inputTokens, 60);
    assert.equal(summary.uncachedInputTokens, 10);
    assert.equal(summary.outputTokens, 40);
    assert.equal(summary.totalActualTokens, 100);
    assert.equal(summary.reasoningTokens, 8);
    assert.equal(summary.providerUsageComplete, true);
    assert.equal(summary.usageStatus, 'complete');
    const rows = (await readFile(ledger.eventsPath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows[1].usage, { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 40, reasoning_tokens: 8 });
    assert.equal(rows[1].reportedInputTokens, 60);
  });
});

test('one unknown request invalidates whole-run measured totals while retaining known evidence', async () => {
  await withLedger({ usageSource: 'provider' }, async (ledger) => {
    await ledger.request({ ...request, usage: { input_tokens: 10, output_tokens: 20 } });
    await ledger.request({ ...request, usage: {}, usageStatus: 'unknown', error: 'x-api-key: private-value' });
    const summary = await ledger.finish({ status: 'failed' });
    assert.equal(summary.providerUsageComplete, false);
    assert.equal(summary.inputTokens, null);
    assert.equal(summary.outputTokens, null);
    assert.equal(summary.totalActualTokens, null);
    assert.equal(summary.reportedTotalTokens, 30);
    assert.equal(summary.unknownUsageRequests, 1);
    const rows = (await readFile(ledger.eventsPath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows[2].usageStatus, 'unknown');
    assert.match(rows[2].error, /\[REDACTED\]/);
    assert.doesNotMatch(rows[2].error, /private-value/);
    assert.equal(rows[2].request, undefined);
  });
});

test('an interrupted stream never becomes a complete measured request even with both counters', async () => {
  await withLedger({}, async (ledger) => {
    await ledger.request({ ...request, usage: { input_tokens: 10, output_tokens: 0 }, usageStatus: 'partial', error: 'stream interrupted' });
    const summary = await ledger.finish({ status: 'failed' });
    assert.equal(summary.providerUsageComplete, false);
    assert.equal(summary.usageStatus, 'partial');
    assert.equal(summary.totalActualTokens, null);
    assert.equal(summary.reportedInputTokens, 10);
  });
});

test('scripted runtime usage is never published as provider measurement', async () => {
  await withLedger({ usageSource: 'scripted', runType: 'offline-runtime' }, async (ledger) => {
    await ledger.request({ ...request, usage: { input_tokens: 10, output_tokens: 20 } });
    const summary = await ledger.finish({ status: 'completed' });
    assert.equal(summary.usageComplete, true);
    assert.equal(summary.providerUsageComplete, false);
    assert.equal(summary.usageSource, 'scripted');
    assert.equal(summary.totalActualTokens, null);
    assert.equal(summary.inputTokens, null);
    assert.equal(summary.outputTokens, null);
    assert.equal(summary.usageStatus, 'not-provider');
  });
  await withLedger({ usageSource: 'scripted' }, async (ledger) => {
    const summary = await ledger.finish({ status: 'completed' });
    assert.equal(summary.inputTokens, null);
    assert.equal(summary.totalActualTokens, null);
  });
});

test('missing, null, and string counters cannot qualify as complete usage', async () => {
  for (const usage of [{ input_tokens: 10 }, { input_tokens: null, output_tokens: 1 }, { input_tokens: '10', output_tokens: 1 }]) {
    await withLedger({}, async (ledger) => {
      await ledger.request({ ...request, usage, usageStatus: 'complete' });
      const summary = await ledger.finish({ status: 'completed' });
      assert.equal(summary.providerUsageComplete, false);
      assert.equal(summary.totalActualTokens, null);
    });
  }
});

test('rejects unsafe run IDs and protects existing run evidence', async () => {
  for (const value of ['..', '../outside', '..\\outside', 'C:\\outside', 'folder/name', 'name.', 'CON', 'nul.txt', '', 'a'.repeat(129)]) {
    assert.throws(() => validateRunId(value), /safe/);
    assert.throws(() => new TokenLedger({ workspace: os.tmpdir(), runId: value, model: 'offline-test' }), /safe/);
  }
  assert.equal(validateRunId('2026-10-10T16-55-33.559Z'), '2026-10-10T16-55-33.559Z');
  await withLedger({}, async (ledger, workspace) => {
    const duplicate = new TokenLedger({ workspace, runId: 'test-run', model: 'offline-test' });
    await assert.rejects(duplicate.init(), /EEXIST/);
    const rows = (await readFile(ledger.eventsPath, 'utf8')).trim().split('\n');
    assert.equal(rows.length, 1);
  });
});

test('a failed ledger write invalidates provider evidence even if the callback error was caught', async () => {
  await withLedger({}, async (ledger) => {
    const originalPath = ledger.eventsPath;
    ledger.eventsPath = path.join(ledger.directory, 'blocked');
    await mkdir(ledger.eventsPath);
    await assert.rejects(ledger.request({ ...request, usage: { input_tokens: 10, output_tokens: 20 } }));
    ledger.eventsPath = originalPath;
    const summary = await ledger.finish({ status: 'failed' });
    assert.equal(summary.usageComplete, true);
    assert.equal(summary.ledgerIntegrity, false);
    assert.equal(summary.providerUsageComplete, false);
    assert.equal(summary.totalActualTokens, null);
  });
});
