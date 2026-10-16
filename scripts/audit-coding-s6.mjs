// Decrypt locally; emit only reviewed aggregate counters, never commands or source.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SessionJournal } from '../src/session-journal.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2]; assert(/^[a-zA-Z0-9_-]+$/.test(runId || ''));
const directory = path.join(root, 'benchmarks/results', runId), raw = JSON.parse(await readFile(path.join(directory, 'comparison.json'), 'utf8'));
assert(raw.endedAt && !raw.rows.some(x => x.running), 'Ended run required');
const rows = [];
for (const row of raw.rows) {
  if (!('functionalPass' in row)) continue;
  const { workspace } = JSON.parse(await readFile(path.join(directory, row.id + '-workspace.json'), 'utf8'));
  const ids = await readdir(path.join(workspace, '.tea/sessions')); assert.equal(ids.length, 1);
  const journal = await SessionJournal.open({ workspace, id: ids[0], resume: true });
  const counts = { versionedWriteAttempts: 0, versionedWriteSuccesses: 0, versionedWriteErrors: 0, commandTimeouts: 0,
    hashMismatchErrors: 0, unavailableEvidenceErrors: 0, sourceChangedErrors: 0,
    versionedSourceEdits: 0, versionedTestEdits: 0, versionedOtherEdits: 0 };
  const calls = new Map(), reads = new Map();
  try {
    for await (const event of journal.iterateEvents()) {
      if (event.kind === 'tool_intent') calls.set(event.value.id, event.value);
      if (event.kind !== 'tool_completed') continue;
      const result = event.value, call = calls.get(result.id); assert(call);
      const filename = String(call.input?.path || '').replaceAll('\\', '/').replace(/^\.\//, '');
      if (call.name === 'read_file' && !result.isError) {
        const digest = result.output.match(/sha256=([a-f0-9]{64})/)?.[1];
        if (digest) reads.set(filename, digest);
      }
      if (['run_tests', 'run_shell'].includes(call.name) && /^Command timed out after \d+ ms\b/.test(result.output)) counts.commandTimeouts++;
      if (call.name !== 'write_file' || call.input?.expected_sha256 === undefined) continue;
      counts.versionedWriteAttempts++;
      if (result.isError) {
        counts.versionedWriteErrors++;
        if (reads.has(filename) && reads.get(filename) !== call.input.expected_sha256) counts.hashMismatchErrors++;
        if (/No delivered/.test(result.output)) counts.unavailableEvidenceErrors++;
        if (/evidence expired/.test(result.output)) counts.sourceChangedErrors++;
      } else {
        counts.versionedWriteSuccesses++;
        counts[filename.startsWith('src/') ? 'versionedSourceEdits' : filename.startsWith('tests/') ? 'versionedTestEdits' : 'versionedOtherEdits']++;
      }
    }
  } finally { await journal.close(); }
  for (const key of ['versionedWriteAttempts', 'versionedWriteSuccesses', 'versionedWriteErrors', 'commandTimeouts']) assert.equal(counts[key], row[key], `Observer mismatch ${row.id} ${key}`);
  const ledger = (await readFile(path.join(workspace, '.tea/runs/agent/ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const requests = ledger.filter(x => x.type === 'model_request');
  if (row.usage) {
    assert(requests.every(x => x.usageComplete));
    assert.equal(requests.reduce((n, x) => n + x.reportedInputTokens + x.reportedOutputTokens, 0), row.usage.totalTokens);
  }
  if (row.knownPartialUsage) {
    assert.equal(row.usage, null); assert.equal(row.usageComplete, false);
    assert(requests.every(x => x.usageComplete));
    assert.equal(requests.length, row.knownPartialUsage.requests);
    assert.equal(requests.reduce((n, x) => n + x.reportedInputTokens + x.reportedOutputTokens, 0), row.knownPartialUsage.totalTokens);
  }
  rows.push({ id: row.id, arm: row.arm, ...counts });
}
const totals = Object.fromEntries(['baseline', 'candidate'].map(arm => [arm, Object.fromEntries(Object.keys(rows[0] || {}).filter(k => !['id', 'arm'].includes(k)).map(k => [k, rows.filter(x => x.arm === arm).reduce((n, x) => n + x[k], 0)]))]));
const report = { auditedAttempts: rows.length, unit: 'tool event counts; mismatched-hash errors may also be unavailable-evidence errors', totals, rows };
await writeFile(path.join(directory, 'versioned-write-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ auditedAttempts: rows.length, totals }));
