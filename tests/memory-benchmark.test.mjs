import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkMemoryPreservation, loadMemoryManifest, measureHistory, renderMemoryReport, runMemoryBenchmark } from '../src/memory-benchmark.mjs';

test('measures serialized messages bytes and characters separately from provider usage', () => {
  const messages = [{ role: 'user', content: '中文 evidence' }];
  const metric = measureHistory(messages);
  assert.equal(metric.messagesJsonChars, JSON.stringify(messages).length);
  assert.equal(metric.messagesJsonUtf8Bytes, Buffer.byteLength(JSON.stringify(messages), 'utf8'));
  assert.ok(metric.messagesJsonUtf8Bytes > metric.messagesJsonChars);
  assert.ok(metric.completeArgsJsonUtf8Bytes > metric.messagesJsonUtf8Bytes);
  assert.ok(metric.heuristicMessagesTokenEstimate > 0);
});

test('independent preservation checker detects roles, paired IDs, failure edits, and read changes', () => {
  const full = [{ role: 'user', content: 'task' }];
  for (const [index, name, content, isError] of [
    [0, 'run_tests', 'exit=1\nFAILURE_MARKER original context', false],
    [1, 'read_file', '[evidence sha256=' + 'a'.repeat(64) + ']\n1: original', false],
    [2, 'read_file', 'ENOENT missing.mjs', true],
    [3, 'search_code', 'candidate.mjs:1: untrusted result content', false],
  ]) {
    full.push({ role: 'assistant', content: [{ type: 'tool_use', id: `call_${index}`, name, input: { path: 'candidate.mjs' } }] });
    full.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `call_${index}`, content, is_error: isError }] });
  }
  assert.equal(checkMemoryPreservation(full, full).passed, true);
  const failure = structuredClone(full);
  failure[2].content[0].content = 'exit=0';
  assert.match(checkMemoryPreservation(full, failure).problems.join('\n'), /failure evidence changed/);
  const read = structuredClone(full);
  read[4].content[0].content = 'summary';
  assert.match(checkMemoryPreservation(full, read).problems.join('\n'), /read evidence changed/);
  const pair = structuredClone(full);
  pair[2].content[0].tool_use_id = 'unknown';
  assert.match(checkMemoryPreservation(full, pair).problems.join('\n'), /tool pair changed/);
  const promoted = structuredClone(full);
  promoted[2].role = 'system';
  assert.match(checkMemoryPreservation(full, promoted).problems.join('\n'), /promoted outside user role/);
  const latest = structuredClone(full);
  latest[8].content[0].content = 'summary';
  assert.match(checkMemoryPreservation(full, latest).problems.join('\n'), /recent tool round changed/);
});

test('memory manifest includes short tasks, failures, repeated discovery, and refreshed read evidence', async () => {
  const { manifest, manifestSha256 } = await loadMemoryManifest();
  assert.equal(manifest.tasks.length, 7);
  assert.equal(new Set(manifest.tasks.map((task) => task.taskId)).size, 7);
  assert.equal(manifest.source.origin, 'self-authored');
  assert.match(manifestSha256, /^[a-f0-9]{64}$/);
  assert.ok(manifest.tasks.some((task) => task.rounds.length === 1));
  assert.ok(manifest.tasks.some((task) => task.rounds.some((round) => round.calls.some((call) => call.name === 'apply_patch'))));
});

test('actual tools form paired long histories without counting scripted diagnostics as model success', async () => {
  const { run, outputDir } = await runMemoryBenchmark({ runId: `memory-unit-${Date.now()}-${process.pid}` });
  assert.equal(run.mode, 'offline-memory-replay');
  assert.equal(run.totals.taskCount, 7);
  assert.equal(run.gateEligible, false);
  assert.equal(run.totals.providerTotalActualTokens, null);
  assert.equal(run.totals.modelTaskSuccessRate, null);
  assert.equal(run.totals.preservationChecksPassed, true);
  assert.equal(run.sourceUnchangedDuringRun, true);
  assert.ok(run.totals.reductionPercent.messagesJsonUtf8Bytes > 5);
  assert.ok(run.totals.compact.completeArgsJsonUtf8Bytes < run.totals.full.completeArgsJsonUtf8Bytes);
  for (const row of run.tasks) {
    assert.ok(row.requests.every((request) => request.preservation.passed));
    assert.ok(row.requests.every((request) => request.compact.messagesJsonUtf8Bytes <= request.full.messagesJsonUtf8Bytes));
    assert.equal(row.requestCount, row.roundCount + 1);
    assert.match(row.workspaceFilesSha256, /^[a-f0-9]{64}$/);
  }
  for (const row of run.tasks.filter((row) => row.taskId.startsWith('memory-short'))) {
    assert.equal(row.full.messagesJsonUtf8Bytes, row.compact.messagesJsonUtf8Bytes);
  }
  const quiet = run.tasks.find((row) => row.taskId === 'memory-quiet-success-long');
  assert.equal(quiet.full.messagesJsonUtf8Bytes, quiet.compact.messagesJsonUtf8Bytes);
  const verbose = run.tasks.find((row) => row.taskId === 'memory-success-long');
  assert.ok(verbose.reductionPercent.messagesJsonUtf8Bytes > 0);
  const failures = run.tasks.find((row) => row.taskId === 'memory-failure-preservation');
  assert.equal(failures.finalPreservation.failureResults, 4);
  assert.equal(failures.fixtureEvidence.failureMarkers, 3);
  const refreshed = run.tasks.find((row) => row.taskId === 'memory-evidence-refresh');
  assert.equal(refreshed.finalPreservation.distinctReadEvidenceHashes, 2);
  assert.equal(refreshed.finalPreservation.readResults, 14);
  assert.equal(refreshed.fixtureEvidence.fullReads, 2);
  assert.equal(refreshed.fixtureEvidence.readReferences, 12);
  assert.match(renderMemoryReport(run), /NOT_MEASURED/);
  assert.equal(JSON.parse(await readFile(path.join(outputDir, 'run.json'), 'utf8')).runId, run.runId);
});

test('memory benchmark rejects unsafe IDs and invalid retention before executing tools', async () => {
  await assert.rejects(runMemoryBenchmark({ runId: '../escape' }), /Run ID/);
  await assert.rejects(runMemoryBenchmark({ keepRecentRounds: 1 }), /between 2 and 100/);
  await assert.rejects(runMemoryBenchmark({ taskIds: ['unknown'] }), /Unknown memory task ID/);
});

test('rejects duplicate task IDs, malformed calls, and oversized histories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-memory-manifest-'));
  try {
    const filename = path.join(root, 'manifest.json');
    const validTask = { taskId: 'task', profile: 'small', rounds: [{ calls: [{ name: 'list_files', input: {} }] }] };
    await writeFile(filename, JSON.stringify({ mode: 'tool-memory-replay', tasks: [validTask, validTask] }));
    await assert.rejects(loadMemoryManifest(filename), /Duplicate memory task ID/);
    await writeFile(filename, JSON.stringify({ mode: 'tool-memory-replay', tasks: [{ ...validTask, rounds: [{ calls: [{ name: 'unknown', input: {} }] }] }] }));
    await assert.rejects(loadMemoryManifest(filename), /Invalid memory tool call/);
    await writeFile(filename, JSON.stringify({ mode: 'tool-memory-replay', tasks: [{ ...validTask, rounds: [{ ...validTask.rounds[0], repeat: 101 }] }] }));
    await assert.rejects(loadMemoryManifest(filename), /Invalid memory round/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
