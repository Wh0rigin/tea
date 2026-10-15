// Inspect encrypted projection diagnostics after the frozen run has ended.
// Publishes only aggregate counts, never source, commands or conversation text.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionJournal, digest } from '../src/session-journal.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2];
if (!/^[a-zA-Z0-9_-]+$/.test(runId || '')) throw Error('Expected run ID');
const directory = path.join(root, 'benchmarks/results', runId);
const raw = JSON.parse(await readFile(path.join(directory, 'comparison.json'), 'utf8'));
if (!raw.complete || raw.rows.some(row => row.running)) throw Error('Run must finish before audit');
const rows = [];
for (const row of raw.rows) {
  const { workspace } = JSON.parse(await readFile(path.join(directory, row.id + '-workspace.json'), 'utf8'));
  const ids = await readdir(path.join(workspace, '.tea/sessions'));
  if (ids.length !== 1) throw Error('Expected one isolated task session');
  const journal = await SessionJournal.open({ workspace, id: ids[0], resume: true });
  const failures = new Map(), eligible = new Set(), referenced = new Set();
  const calls = new Map(), names = new Map();
  let eligibleProjections = 0, recentProtectedOccurrences = 0, noNetReductionProjections = 0;
  try {
    for await (const event of journal.iterateEvents()) {
      if (event.kind === 'message' && Array.isArray(event.value.content)) {
        for (const block of event.value.content) {
          if (block.type === 'tool_use') calls.set(block.id, block);
          if (block.type === 'tool_result') {
            const call = calls.get(block.tool_use_id);
            if (call) names.set('ctx-' + digest({ id: call.id, name: call.name, input: call.input, output: block.content }).slice(0, 20), call.name);
          }
        }
      }
      if (event.kind !== 'memory_assembly') continue;
      const units = (event.value.units || []).filter(unit => unit.kind === 'test_failure' && ['run_tests', 'run_shell'].includes(names.get(unit.ref)));
      for (const unit of units) {
        failures.set(unit.ref, unit.bytes);
        if (unit.supersededBy) {
          eligible.add(unit.ref);
          if (unit.decision === 'reference') referenced.add(unit.ref);
          else if (unit.reason === 'recent-active-or-protected') recentProtectedOccurrences++;
        }
      }
      if (units.some(unit => unit.supersededBy)) {
        eligibleProjections++;
        if (event.value.fallback === 'no-net-wire-reduction') noNetReductionProjections++;
      }
    }
  } finally { await journal.close(); }
  rows.push({ id: row.id, arm: row.arm, failuresObservedInProjections: failures.size,
    failureOutputBytes: [...failures.values()].reduce((a, b) => a + b, 0),
    eligibleFailures: eligible.size, referencedFailures: referenced.size,
    eligibleProjections, recentProtectedOccurrences, noNetReductionProjections });
}
const fields = ['failuresObservedInProjections', 'failureOutputBytes', 'eligibleFailures', 'referencedFailures',
  'eligibleProjections', 'recentProtectedOccurrences', 'noNetReductionProjections'];
const totals = Object.fromEntries(['baseline', 'candidate'].map(arm => [arm, Object.fromEntries(fields.map(field =>
  [field, rows.filter(row => row.arm === arm).reduce((sum, row) => sum + row[field], 0)]))]));
const audit = { unit: 'offline counts of encrypted memory_assembly diagnostics; bytes are not provider tokens',
  note: 'Eligibility metadata exists only with the candidate flag; baseline zero eligibility does not imply no repair occurred.', totals, rows };
await writeFile(path.join(directory, 'trigger-audit.json'), JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ totals }));
