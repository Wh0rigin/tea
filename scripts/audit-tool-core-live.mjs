// Local decryption; publish counters only. No model or network calls.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SessionJournal } from '../src/session-journal.mjs';
import { isValidationCommand } from '../src/tools.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2]; assert(/^[a-zA-Z0-9_-]+$/.test(runId || ''));
const directory = path.join(root, 'benchmarks/results', runId), raw = JSON.parse(await readFile(path.join(directory, 'comparison.json'), 'utf8'));
assert(raw.endedAt && !raw.rows.some(x => x.running), 'Ended run required');
const rows = [];
for (const row of raw.rows) {
  assert.equal(typeof row.functionalPass, 'boolean');
  const { workspace } = JSON.parse(await readFile(path.join(directory, row.id + '-workspace.json'), 'utf8'));
  const ids = await readdir(path.join(workspace, '.tea/sessions')); assert.equal(ids.length, 1);
  const journal = await SessionJournal.open({ workspace, id: ids[0], resume: true });
  const counts = { successfulEdits: 0, validationToolResults: 0, commandTimeouts: 0 };
  const calls = new Map();
  try {
    for await (const event of journal.iterateEvents()) {
      if (event.kind === 'tool_intent') calls.set(event.value.id, event.value);
      if (event.kind !== 'tool_completed') continue;
      const result = event.value, call = calls.get(result.id); assert(call);
      if (!result.isError && ['apply_patch', 'write_file'].includes(call.name)) counts.successfulEdits++;
      if (['run_tests', 'run_shell'].includes(call.name) && isValidationCommand(call.input?.command)) counts.validationToolResults++;
      if (['run_tests', 'run_shell'].includes(call.name) && /^Command timed out after \d+ ms\b/.test(result.output)) counts.commandTimeouts++;
    }
  } finally { await journal.close(); }
  for (const key of Object.keys(counts)) assert.equal(counts[key], row[key], `Observer mismatch ${row.id} ${key}`);
  const ledger = (await readFile(path.join(workspace, '.tea/runs/agent/ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const requests = ledger.filter(x => x.type === 'model_request');
  if (row.usage) {
    assert(requests.every(x => x.usageComplete));
    assert.equal(requests.reduce((n, x) => n + x.reportedInputTokens + x.reportedOutputTokens, 0), row.usage.totalTokens);
    assert.equal(requests.length, row.usage.requests);
  }
  rows.push({ id: row.id, arm: row.arm, ...counts,
    unknownUsageRequests: requests.filter(x => !x.usageComplete).length,
    incompleteStreamRequests: requests.filter(x => /stream ended before the message_stop event/.test(x.error || '')).length });
}
const totals = Object.fromEntries(['baseline', 'candidate'].map(arm => [arm, Object.fromEntries(['successfulEdits', 'validationToolResults', 'commandTimeouts', 'unknownUsageRequests', 'incompleteStreamRequests'].map(k => [k, rows.filter(x => x.arm === arm).reduce((n, x) => n + x[k], 0)]))]));
await writeFile(path.join(directory, 'tool-core-audit.json'), JSON.stringify({ auditedAttempts: rows.length, totals, rows }, null, 2));
console.log(JSON.stringify({ auditedAttempts: rows.length, totals }));
