// Offline diagnostic only: no model adapter, configuration, credentials or network.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SessionJournal } from '../src/session-journal.mjs';
import { isValidationCommand } from '../src/tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = value => Buffer.byteLength(String(value), 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const normalize = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
const total = requests => requests.reduce((n, r) => n + r.tokens, 0);
const sum = (items, key) => items.reduce((n, x) => n + (x[key] || 0), 0);

export function analyze(events, ledger) {
  const billed = new Map(ledger.filter(x => x.type === 'model_request').map(x => [x.requestId, x]));
  const calls = new Map(), tools = [], requests = [], seenReads = new Map(), fullReads = new Map();
  const lastEdit = new Map();
  let assembly = null, reset = false, sinceRequest = [], ordinal = 0;
  for (const e of events) {
    ordinal++;
    if (['memory_gc_checkpoint', 'conversation_reset', 'session_resumed'].includes(e.kind)) { reset = true; seenReads.clear(); fullReads.clear(); }
    if (e.kind === 'memory_assembly') assembly = e.value;
    if (e.kind === 'request_intent') {
      const bill = billed.get(e.value.requestId);
      assert(bill?.usageComplete, 'Missing complete request usage');
      if (bill.purpose === 'compaction') { reset = true; seenReads.clear(); fullReads.clear(); }
      const phase = !requests.length ? 'initial' : sinceRequest.some(x => x.error) ? 'after-error'
        : sinceRequest.some(x => x.edit) ? 'after-edit'
          : sinceRequest.some(x => x.validation) ? 'after-validation' : 'after-discovery';
      requests.push({ ordinal, tokens: bill.reportedInputTokens + bill.reportedOutputTokens,
        input: bill.reportedInputTokens, output: bill.reportedOutputTokens, phase,
        // Conservative byte exposure only; no attribution of provider tokens to fragments.
        fullHistory: !reset && assembly?.evictedUnits === 0 && assembly?.fullWireBytes === assembly?.sentWireBytes });
      sinceRequest = [];
    }
    if (e.kind === 'tool_intent') calls.set(e.value.id, { ...e.value, ordinal });
    if (e.kind !== 'tool_completed') continue;
    const result = e.value, call = calls.get(result.id);
    assert(call, 'Completion without intent');
    const filename = normalize(call.input?.path), output = String(result.output);
    const edit = !result.isError && ['write_file', 'apply_patch'].includes(call.name);
    const validation = ['run_tests', 'run_shell'].includes(call.name) && isValidationCommand(call.input?.command);
    const item = { ordinal, intentOrdinal: call.ordinal, name: call.name, filename,
      error: Boolean(result.isError), edit, validation, outputBytes: bytes(output),
      validationSuccess: validation && !result.isError && /^exit=0\b/.test(output) && !/\b(?:tests?\s*[:=]?\s*0|0\s+tests?)\b/i.test(output),
      writeExisting: call.name === 'write_file' && result.isError && /File already exists/.test(output),
      contentBytes: call.name === 'write_file' ? bytes(call.input?.content || '') : 0 };
    if (call.name === 'write_file') item.bodyHash = sha(String(call.input?.content || ''));
    if (call.name === 'apply_patch') item.bodyHash = sha(String(call.input?.replace ?? ''));
    if (item.writeExisting) {
      const previous = fullReads.get(filename);
      item.priorFullRead = Boolean(previous && previous.ordinal > (lastEdit.get(filename) || 0));
    }
    if (call.name === 'read_file' && !item.error) {
      item.referenceOnly = /^Evidence unchanged; ref=/.test(output);
      const match = output.match(/(?:^\[evidence ref=|^Evidence unchanged; ref=)([^\s\]]+)/);
      if (match) {
        const identity = filename + ':' + match[1];
        item.sameVersionRangeSeen = seenReads.has(identity);
        item.repeatedFullOutput = item.sameVersionRangeSeen && !item.referenceOnly;
        seenReads.set(identity, ordinal);
      }
      if (!item.referenceOnly && /^\[evidence ref=/.test(output) && !/Only a prefix of the requested lines is shown/.test(output)
        && (call.input.startLine ?? 1) === 1 && call.input.endLine === undefined) fullReads.set(filename, { ordinal });
    }
    if (edit) lastEdit.set(filename, ordinal);
    tools.push(item); sinceRequest.push(item);
  }
  assert.equal(requests.length, billed.size, 'Request count does not reconcile');
  const episodes = tools.filter(x => x.writeExisting).map(failure => {
    const repaired = tools.find(x => x.intentOrdinal > failure.ordinal && x.edit && x.filename === failure.filename);
    const end = repaired?.intentOrdinal ?? Infinity;
    const window = requests.filter(r => r.ordinal > failure.ordinal && r.ordinal < end);
    return { failure, repaired, window, reads: tools.filter(x => x.intentOrdinal > failure.ordinal && x.intentOrdinal < end && x.name === 'read_file' && x.filename === failure.filename).length };
  });
  // Union request ordinals: two failed writes in one response must not double count a billed request.
  const windowOrdinals = new Set(episodes.flatMap(x => x.window.map(r => r.ordinal)));
  const windowRequests = requests.filter(r => windowOrdinals.has(r.ordinal));
  const success = tools.filter(x => x.validationSuccess);
  const exposures = success.map(t => ({ ...t, after: requests.filter(r => r.ordinal > t.ordinal),
    verified: requests.filter(r => r.ordinal > t.ordinal && r.fullHistory) }));
  const repeats = tools.filter(x => x.name === 'read_file' && !x.error);
  const phases = Object.fromEntries(['initial', 'after-error', 'after-edit', 'after-validation', 'after-discovery'].map(phase => {
    const r = requests.filter(x => x.phase === phase); return [phase, { requests: r.length, providerTokens: total(r), inputTokens: sum(r, 'input'), outputTokens: sum(r, 'output') }];
  }));
  return {
    providerTokens: total(requests), requests: requests.length, phases,
    writeExistingFailures: episodes.length, attemptsWithWriteExisting: Number(episodes.length > 0),
    failedWriteContentBytes: sum(episodes.map(x => x.failure), 'contentBytes'),
    failuresWithPriorFullRead: episodes.filter(x => x.failure.priorFullRead).length,
    failuresFollowedBySuccessfulEdit: episodes.filter(x => x.repaired).length,
    failuresFollowedByRead: episodes.filter(x => x.reads > 0).length,
    failuresWithIdenticalSuccessfulPatchBody: episodes.filter(x => x.repaired?.name === 'apply_patch' && x.repaired.bodyHash === x.failure.bodyHash).length,
    recoveryWindowRequests: windowRequests.length, recoveryWindowProviderTokens: total(windowRequests),
    recoveryWindowInputTokens: sum(windowRequests, 'input'), recoveryWindowOutputTokens: sum(windowRequests, 'output'),
    readCalls: repeats.length, unchangedReadReferences: repeats.filter(x => x.referenceOnly).length,
    repeatedFullReads: repeats.filter(x => x.repeatedFullOutput).length,
    repeatedFullReadBytes: sum(repeats.filter(x => x.repeatedFullOutput), 'outputBytes'),
    successfulValidations: success.length, successfulValidationOutputBytes: sum(success, 'outputBytes'),
    largestSuccessfulValidationOutputBytes: Math.max(0, ...success.map(x => x.outputBytes)),
    successfulValidationsOver2KiB: success.filter(x => x.outputBytes > 2048).length,
    successfulValidationsWithOneLaterRequest: exposures.filter(x => x.after.length === 1).length,
    successfulValidationsWithMultipleLaterRequests: exposures.filter(x => x.after.length > 1).length,
    successfulValidationVerifiedExposureBytes: exposures.reduce((n, x) => n + x.outputBytes * x.verified.length, 0),
    // Maximum raw output bytes a hypothetical 512-byte preview could remove in verified full-history requests.
    successfulValidation512BytePreviewExposureReduction: exposures.reduce((n, x) => n + Math.max(0, x.outputBytes - 512) * x.verified.length, 0),
    successfulValidationCanonical512BytePreviewExposureReduction: exposures.reduce((n, x) => n + Math.max(0, x.outputBytes - 512) * x.after.length, 0),
  };
}

function selfCheck() {
  const event = (kind, value) => ({ kind, value });
  const intent = id => event('request_intent', { requestId: id });
  const call = (id, name, input) => event('tool_intent', { id, name, input });
  const done = (id, output, isError = false) => event('tool_completed', { id, output, isError });
  const bill = id => ({ type: 'model_request', requestId: id, usageComplete: true, reportedInputTokens: 90, reportedOutputTokens: 10 });
  const assembly = event('memory_assembly', { evictedUnits: 0, fullWireBytes: 100, sentWireBytes: 100 });
  const read = (id, hash) => [call(id, 'read_file', { path: 'src/a.mjs' }), done(id, `[evidence ref=src/a.mjs#L1-L2@${hash} sha256=${hash}]\n1: x\n2: y`)];
  const events = [assembly, intent('1'), ...read('r1', 'a'), ...read('r2', 'a'), ...read('r3', 'b'),
    call('w1', 'write_file', { path: 'src/a.mjs', content: 'new' }), done('w1', 'File already exists', true),
    call('w2', 'write_file', { path: 'src/a.mjs', content: 'new' }), done('w2', 'File already exists', true),
    assembly, intent('2'), call('p', 'apply_patch', { path: 'src/a.mjs', replace: 'new' }), done('p', 'ok'),
    call('t', 'run_tests', { command: 'node --test' }), done('t', 'exit=0\n' + 'x'.repeat(3000)), assembly, intent('3')];
  const result = analyze(events, ['1', '2', '3'].map(bill));
  assert.equal(result.providerTokens, 300); assert.equal(result.writeExistingFailures, 2);
  assert.equal(result.recoveryWindowProviderTokens, 100); assert.equal(result.recoveryWindowRequests, 1);
  assert.equal(result.failuresWithPriorFullRead, 2); assert.equal(result.repeatedFullReads, 1);
  assert.equal(result.failuresWithIdenticalSuccessfulPatchBody, 2);
  assert.equal(result.successfulValidationsWithOneLaterRequest, 1);
  assert.equal(result.successfulValidation512BytePreviewExposureReduction, 2495);
  assert.equal(Object.values(result.phases).reduce((n, x) => n + x.providerTokens, 0), 300);
  const projected = analyze([...events.slice(0, -2), event('memory_assembly', { evictedUnits: 1, fullWireBytes: 100, sentWireBytes: 80 }), intent('3')], ['1', '2', '3'].map(bill));
  assert.equal(projected.successfulValidationVerifiedExposureBytes, 0);
  const reset = analyze([...events.slice(0, -2), event('memory_gc_checkpoint', {}), assembly, intent('3')], ['1', '2', '3'].map(bill));
  assert.equal(reset.successfulValidationVerifiedExposureBytes, 0);
  const edited = analyze([...events, call('w3', 'write_file', { path: 'src/a.mjs', content: 'newer' }), done('w3', 'File already exists', true)], ['1', '2', '3'].map(bill));
  assert.equal(edited.writeExistingFailures, 3); assert.equal(edited.failuresWithPriorFullRead, 2);
  assert.throws(() => analyze(events, ['1', '2'].map(bill)), /Missing complete/);
  console.log('Offline synthetic checks passed: union windows, read versions, output exposure, phase partition and incomplete usage. No provider calls.');
}

async function main() {
  if (process.argv[2] === '--self-check') { assert.equal(process.argv.length, 3); selfCheck(); return; }
  const args = process.argv.slice(2), out = args.find(x => x.startsWith('--output-id='));
  const outputId = out?.slice('--output-id='.length) || 'coding-p0-cost-attribution-20261016';
  assert(/^[a-zA-Z0-9_-]+$/.test(outputId), 'Invalid output ID');
  const runIds = args.filter(x => x !== out); assert(runIds.length > 0, 'Supply source run IDs');
  const reports = [];
  for (const runId of runIds) {
    assert(/^[a-zA-Z0-9_-]+$/.test(runId));
    const directory = path.join(root, 'benchmarks/results', runId);
    const rawBytes = await readFile(path.join(directory, 'comparison.json'));
    const raw = JSON.parse(rawBytes); assert(raw.endedAt && raw.complete && !raw.rows.some(x => x.running), 'Completed source required');
    const rows = [];
    for (const row of raw.rows) {
      let location;
      try { location = JSON.parse(await readFile(path.join(directory, row.id + '-workspace.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; rows.push({ id: row.id, arm: row.arm, auditAvailable: false, reason: 'workspace_locator_unavailable' }); continue; }
      const ids = await readdir(path.join(location.workspace, '.tea/sessions')); assert.equal(ids.length, 1);
      const ledger = (await readFile(path.join(location.workspace, '.tea/runs/agent/ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
      const journal = await SessionJournal.open({ workspace: location.workspace, id: ids[0], resume: true });
      const events = [];
      try { for await (const event of journal.iterateEvents()) events.push(event); } finally { await journal.close(); }
      const metrics = analyze(events, ledger);
      assert.equal(metrics.providerTokens, row.usage.totalTokens, 'Audit/source usage mismatch');
      if (row.writeExistingErrors !== undefined) assert.equal(metrics.writeExistingFailures, row.writeExistingErrors, 'Write observer mismatch');
      rows.push({ id: row.id, arm: row.arm, taskId: row.taskId, repeat: row.repeat, accepted: row.accepted, auditAvailable: true, ...metrics });
    }
    const totals = Object.fromEntries(['baseline', 'candidate'].map(arm => {
      const sample = rows.filter(x => x.arm === arm && x.auditAvailable), first = sample[0];
      return [arm, { available: sample.length, planned: raw.rows.filter(x => x.arm === arm).length,
        ...(first ? Object.fromEntries(Object.keys(first).filter(k => typeof first[k] === 'number' && k !== 'repeat').map(k => [k, k === 'largestSuccessfulValidationOutputBytes' ? Math.max(...sample.map(x => x[k])) : sum(sample, k)])) : {}),
        ...(first ? { phases: Object.fromEntries(Object.keys(first.phases).map(p => [p, Object.fromEntries(Object.keys(first.phases[p]).map(k => [k, sample.reduce((n, x) => n + x.phases[p][k], 0)]))])) } : {}) }];
    }));
    const engine = Object.fromEntries(Object.entries(raw.engine).map(([arm, value]) => [arm, { commit: value.commit, sourceSha256: value.sourceSha256 }]));
    reports.push({ runId, sourceSha256: sha(rawBytes), engine, sourceRows: raw.rows.length, totals, rows });
    console.log(JSON.stringify({ runId, totals }));
  }
  const destination = path.join(root, 'benchmarks/reports', outputId);
  await mkdir(destination); // Refuse overwriting an earlier audit.
  await writeFile(path.join(destination, 'summary.json'), JSON.stringify({ schema: 'tea-coding-cost-audit-v1',
    method: 'Offline journal and provider ledger audit. Recovery windows are observed associated request costs, not avoidable tokens. Output exposure is UTF-8 bytes, not provider tokens. No paid calls.',
    sources: reports }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
