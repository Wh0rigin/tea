// Completed journals only; export observable tool metadata, never private reasoning or source.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SessionJournal } from '../src/session-journal.mjs';
const runId = process.argv[2];
if (!/^[a-zA-Z0-9_-]+$/.test(runId || '')) throw Error('Invalid run ID');
const dir = path.resolve('benchmarks/results', runId), report = JSON.parse(await readFile(path.join(dir, 'comparison.json'), 'utf8'));
if (!report.endedAt || report.rows.some(r => r.running)) throw Error('Ended run required');
const rows = [];
for (const row of report.rows) {
  const { workspace } = JSON.parse(await readFile(path.join(dir, row.id + '-workspace.json'), 'utf8'));
  const ids = await readdir(path.join(workspace, '.tea/sessions'));
  if (ids.length !== 1) throw Error('Ambiguous session');
  const journal = await SessionJournal.open({ workspace, id: ids[0], resume: true });
  const calls = new Map(), sequence = [], readRules = new Set(), signatures = new Map();
  let notices = 0, existingWriteErrors = 0, duplicateReadCalls = 0;
  try { for await (const event of journal.iterateEvents()) {
    if (event.kind === 'tool_intent') calls.set(event.value.id, event.value);
    if (event.kind !== 'tool_completed') continue;
    const result = event.value, call = calls.get(result.id); if (!call) throw Error('Missing intent');
    const input = call.input || {}, output = result.output || '';
    if (output.includes('Applicable workspace instructions:')) notices++;
    if (call.name === 'write_file' && result.isError && output.includes('File already exists')) existingWriteErrors++;
    if (call.name === 'read_file') {
      const signature = JSON.stringify(input);
      if (signatures.has(signature)) duplicateReadCalls++;
      signatures.set(signature, true);
      if (!result.isError && /(?:^|\/)AGENTS\.md$/.test(input.path || '')) readRules.add(input.path);
    }
    sequence.push({ tool: call.name, ...(input.path ? { path: input.path } : {}), ...(input.query ? { query: input.query } : {}),
      ...(input.command ? { command: input.command } : {}), error: Boolean(result.isError),
      feedbackCode: result.isError ? /"code":"([A-Z_]+)"/.exec(output)?.[1] || 'UNCLASSIFIED' : null,
      instructionNotice: output.includes('Applicable workspace instructions:'),
      ...(['apply_patch', 'write_file'].includes(call.name) ? { rulesReadBeforeEdit: [...readRules] } : {}) });
  } } finally { await journal.close(); }
  const editIndex = sequence.findIndex(e => ['apply_patch', 'write_file'].includes(e.tool)
    && (row.taskId.includes('retry') ? e.path === 'src/runtime/dispatch/recovery.mjs'
      : row.taskId.includes('pagination') ? ['src/api.mjs', 'src/pagination.mjs'].includes(e.path) : true));
  const before = sequence.slice(0, editIndex < 0 ? sequence.length : editIndex);
  const readBefore = file => before.some(e => e.tool === 'read_file' && e.path === file && !e.error);
  const applicableRule = row.taskId.includes('retry') ? 'src/runtime/dispatch/AGENTS.md'
    : row.taskId.includes('pagination') ? 'src/AGENTS.md' : 'AGENTS.md';
  const localRuleReadBeforeTargetEdit = readBefore(applicableRule);
  const ruleReadBeforeTargetEdit = readBefore('AGENTS.md') && localRuleReadBeforeTargetEdit;
  const procedureCompliant = !row.taskId.includes('pagination') || readBefore('src/store.mjs') && readBefore('tests/public.test.mjs');
  const ledger = (await readFile(path.join(workspace, '.tea/runs/agent/ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const requests = ledger.filter(e => e.type === 'model_request');
  const knownTokenLowerBound = requests.reduce((n,e) => n + e.reportedInputTokens + e.reportedOutputTokens, 0);
  const unknownUsageRequests = requests.filter(e => !e.usageComplete).length;
  const incompleteStreamRequests = requests.filter(e => /stream ended before the message_stop event/.test(e.error || '')).length;
  if (row.usage && knownTokenLowerBound !== row.usage.totalTokens) throw Error('Token audit mismatch');
  rows.push({ id: row.id, notices, existingWriteErrors, duplicateReadCalls, readRules: [...readRules],
    targetEditAttempted: editIndex >= 0, knownTokenLowerBound, unknownUsageRequests, incompleteStreamRequests,
    ruleReadBeforeTargetEdit, localRuleReadBeforeTargetEdit, procedureCompliant, fullAcceptanceWithProcedure: row.accepted && procedureCompliant, sequence });
}
await writeFile(path.join(dir, 'action-audit.json'), JSON.stringify({ runId, rows }, null, 2));
console.log(JSON.stringify({ runId, rows }));
