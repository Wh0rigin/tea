// Administrative offline finalization after the original runner has stopped.
// Does not submit, resume or retry a model request, and does not change ledgers.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { SessionJournal } from '../src/session-journal.mjs';
import { codingTasks } from '../benchmarks/tasks/coding-ability.mjs';
import { normalizeAnthropicUsage } from '../src/usage.mjs';
import { snapshot, command, acceptance } from './coding-ability-harness.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2]; assert(/^[a-zA-Z0-9_-]+$/.test(runId || ''));
assert.equal(process.argv[3], '--original-runner-stopped');
const directory = path.join(root, 'benchmarks/results', runId), filename = path.join(directory, 'comparison.json');
const original = await readFile(filename), raw = JSON.parse(original);
assert(!raw.endedAt && raw.rows.filter(x => x.running).length === 1, 'One interrupted active attempt required');
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(hash(await readFile(path.join(root, 'benchmarks/tasks/coding-ability.mjs'))), raw.manifestSha256);
for (const [arm, engine] of Object.entries(raw.engine)) for (const file of engine.files) {
  assert.equal(hash(await readFile(path.join(directory, 'engines', arm, file.path))), file.sha256);
}
const row = raw.rows.find(x => x.running), fixture = codingTasks.find(x => x.id === row.taskId); assert(fixture);
const { workspace } = JSON.parse(await readFile(path.join(directory, row.id + '-workspace.json'), 'utf8'));
const ids = await readdir(path.join(workspace, '.tea/sessions')); assert.equal(ids.length, 1);
// Exclusive journal ownership also prevents finalizing a still-owned active session.
const journal = await SessionJournal.open({ workspace, id: ids[0], resume: true });
const events = [];
try { for await (const event of journal.iterateEvents()) events.push(event); } finally { await journal.close(); }
const intents = events.filter(x => x.kind === 'request_intent'), settled = events.filter(x => x.kind === 'request_settled');
const unresolved = intents.filter(x => !settled.some(s => s.value.requestId === x.value.requestId));
assert(unresolved.length > 0, 'This finalizer is only for unresolved usage');
const ledger = (await readFile(path.join(workspace, '.tea/runs/agent/ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
const requests = ledger.filter(x => x.type === 'model_request');
assert(requests.every(x => x.usageComplete)); assert.equal(requests.length, settled.length);
const counts = requests.map(x => normalizeAnthropicUsage(x.usage)); assert(counts.every(x => x.complete));
const sum = key => counts.reduce((n, x) => n + x[key], 0);
const calls = new Map(), telemetry = { versionedWriteAttempts: 0, versionedWriteSuccesses: 0, versionedWriteErrors: 0, commandTimeouts: 0 };
for (const event of events) {
  if (event.kind === 'tool_intent') calls.set(event.value.id, event.value);
  if (event.kind !== 'tool_completed') continue;
  const result = event.value, call = calls.get(result.id); assert(call);
  if (call.name === 'write_file' && call.input.expected_sha256 !== undefined) {
    telemetry.versionedWriteAttempts++; telemetry[result.isError ? 'versionedWriteErrors' : 'versionedWriteSuccesses']++;
  }
  if (['run_tests', 'run_shell'].includes(call.name) && /^Command timed out after \d+ ms\b/.test(result.output)) telemetry.commandTimeouts++;
}
const state = events.findLast(x => x.kind === 'runtime_state')?.value || {};
const tools = ledger.filter(x => x.type === 'tool_call'), final = await snapshot(workspace), finalMap = new Map(final);
const initial = new Map(Object.entries(fixture.files).map(([name, text]) => [name, hash(text)]));
const publicAfter = await command(workspace, ['--test', 'tests/public.test.mjs']);
const tests = final.map(([name]) => name).filter(name => /^tests\/.+\.test\.mjs$/.test(name));
const allPublic = await command(workspace, ['--test', ...tests]), hidden = await acceptance(workspace, fixture);
Object.assign(row, telemetry, { running: false, status: 'interrupted_unknown_usage', accepted: false,
  usage: null, usageComplete: false, accountedUsd: null, retainedReservationUsd: 1,
  knownPartialUsage: { requests: counts.length, inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'),
    totalTokens: sum('totalTokens'), cachedInputTokens: sum('cachedInputTokens'), cacheCreationInputTokens: sum('cacheCreationInputTokens') },
  validationPassed: Boolean(state.validationPassed), validationAttempts: state.validationAttempts || 0,
  toolCalls: tools.length, toolErrors: tools.filter(x => x.error).length,
  singleReadCalls: tools.filter(x => x.name === 'read_file').length,
  writeExistingErrors: tools.filter(x => x.name === 'write_file' && x.error?.includes('File already exists')).length,
  firstRequestInputTokens: requests[0]?.reportedInputTokens ?? null,
  changedFiles: final.filter(([name, value]) => initial.get(name) !== value).map(([name]) => name),
  deletedFiles: [...initial.keys()].filter(name => !finalMap.has(name)),
  protectedFilesUnchanged: [...initial].filter(([name]) => !name.startsWith('src/')).every(([name, value]) => finalMap.get(name) === value),
  publicPassed: publicAfter.passed, addedTestsPassed: allPublic.passed, hiddenPassed: hidden.passed, hiddenCompleted: hidden.completed,
  hiddenOutputSha256: hidden.outputSha256, failureDiagnostic: hidden.passed ? null : hidden.diagnostic });
row.allowedChanges = row.changedFiles.every(name => name.startsWith('src/') || /^tests\/.+\.test\.mjs$/.test(name)) && !row.deletedFiles.length;
row.functionalPass = row.publicPassed && row.hiddenPassed && row.protectedFilesUnchanged && row.allowedChanges;
row.codeBehaviorPass = row.publicPassed && row.hiddenPassed && row.addedTestsPassed;
raw.complete = false; raw.sourceUnchanged = true; raw.qualityGatePassed = false; raw.gatePassed = false;
raw.stopReason = 'interrupted_unknown_usage_reservation_retained_no_retry'; raw.endedAt = new Date().toISOString();
raw.interruption = { originalComparisonSha256: hash(original), unresolvedRequests: unresolved.length,
  settledRequests: settled.length, retainedReservationUsd: 1, completedAttempts: raw.rows.filter(x => x.usageComplete).length,
  note: 'Original runner no longer active. Offline administrative closure and local grading only; no model retry. This is not an agent coding failure.' };
await writeFile(path.join(directory, 'comparison-before-interruption-finalization.json'), original, { flag: 'wx' });
await writeFile(filename, JSON.stringify(raw, null, 2));
console.log(JSON.stringify({ runId, completed: raw.interruption.completedAttempts, interrupted: row.id,
  unresolvedRequests: unresolved.length, knownPartialTokens: row.knownPartialUsage.totalTokens, complete: false, modelCalls: 0 }));
