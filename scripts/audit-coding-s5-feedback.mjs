// Read encrypted diagnostics; publish counters only, never raw conversations.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionJournal } from '../src/session-journal.mjs';
import { isValidationCommand } from '../src/tools.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2], partial = process.argv[3] === '--completed-only';
if (!/^[a-zA-Z0-9_-]+$/.test(runId || '') || process.argv.length > 4 || (process.argv[3] && !partial)) throw Error('Invalid arguments');
const directory = path.join(root, 'benchmarks/results', runId);
const raw = JSON.parse(await readFile(path.join(directory, 'comparison.json'), 'utf8'));
if (!partial && (!raw.endedAt || raw.rows.some(row => row.running))) throw Error('Run has not ended');
const rows = [];
for (const row of raw.rows.filter(row => !row.running && typeof row.functionalPass === 'boolean')) {
  const { workspace } = JSON.parse(await readFile(path.join(directory, row.id + '-workspace.json'), 'utf8'));
  const ids = await readdir(path.join(workspace, '.tea/sessions'));
  if (ids.length !== 1) throw Error('Expected one isolated session');
  const journal = await SessionJournal.open({ workspace, id: ids[0], resume: true });
  const counts = { repairGuidanceResults: 0, validationTimeoutResults: 0, validationFailureResults: 0,
    commandTimeouts: 0, retriesAfterTimeoutWithoutEdit: 0, sourceEditsAfterGuidance: 0,
    testEditsAfterGuidance: 0, otherEditsAfterGuidance: 0, modelRequestsAfterGuidance: 0,
    sourceEdits: 0, testEdits: 0, otherEdits: 0 };
  const calls = new Map(), timedOutCommands = new Map();
  let revision = 0, active = false;
  try {
    for await (const event of journal.iterateEvents()) {
      if (event.kind === 'request_intent' && active) counts.modelRequestsAfterGuidance++;
      if (event.kind === 'tool_intent') {
        const call = event.value; calls.set(call.id, call);
        if (['run_tests', 'run_shell'].includes(call.name) && isValidationCommand(call.input?.command)
          && timedOutCommands.get(call.input.command) === revision) counts.retriesAfterTimeoutWithoutEdit++;
      }
      if (event.kind !== 'tool_completed') continue;
      const result = event.value, call = calls.get(result.id);
      if (!call) throw Error('Completion lacks intent');
      if (!result.isError && ['apply_patch', 'write_file'].includes(call.name)) {
        revision++;
        const filename = String(call.input?.path || '').replaceAll('\\', '/');
        const kind = filename.startsWith('src/') ? 'sourceEdits' : filename.startsWith('tests/') ? 'testEdits' : 'otherEdits';
        counts[kind]++;
        if (active) {
          counts[kind + 'AfterGuidance']++;
        }
      }
      if (['run_tests', 'run_shell'].includes(call.name) && isValidationCommand(call.input?.command)) {
        if (/^Command timed out after \d+ ms\b/.test(result.output)) {
          counts.commandTimeouts++; timedOutCommands.set(call.input.command, revision);
        } else if (/^exit=0\b/.test(result.output)) timedOutCommands.delete(call.input.command);
      }
      const feedback = result.feedback;
      if (feedback?.code === 'VALIDATION_FAILED') counts.validationFailureResults++;
      if (feedback?.code === 'VALIDATION_TIMEOUT') counts.validationTimeoutResults++;
      if (feedback?.code === 'VALIDATION_TIMEOUT' || (feedback?.code === 'VALIDATION_FAILED' && feedback.next.startsWith('Compare the failing assertion with the task contract'))) {
        counts.repairGuidanceResults++; active = true;
      }
    }
  } finally { await journal.close(); }
  for (const key of ['repairGuidanceResults', 'validationTimeoutResults', 'validationFailureResults', 'commandTimeouts', 'retriesAfterTimeoutWithoutEdit']) {
    if (row[key] !== counts[key]) throw Error(`Observer/journal count mismatch: ${row.id} ${key}`);
  }
  rows.push({ id: row.id, arm: row.arm, ...counts });
}
const fields = Object.keys(rows[0] || {}).filter(key => !['id', 'arm'].includes(key));
const totals = Object.fromEntries(['baseline', 'candidate'].map(arm => [arm, Object.fromEntries(fields.map(key =>
  [key, rows.filter(row => row.arm === arm).reduce((sum, row) => sum + row[key], 0)]))]));
const report = { partial, completedAttempts: rows.length, unit: 'encrypted execution-event counts; not provider-token estimates',
  note: 'No-edit retry counts do not establish whether new diagnostic evidence justified a retry. Baseline post-guidance counters are zero by construction, not absence of ordinary repairs. Post-guidance edits are opportunities, not proof of causal improvement.', totals, rows };
await writeFile(path.join(directory, partial ? 'feedback-audit-partial.json' : 'feedback-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ completedAttempts: rows.length, totals }));
