import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { instructionTasks as tasks } from '../benchmarks/tasks/instruction-discovery.mjs';
import { loadCliConfig, assertBenchmarkConfig } from '../src/config.mjs';
import { resolveUserEnvironment } from '../src/user-config.mjs';
import { prepareRevisionEngine } from '../src/comparison-revisions.mjs';
import { assertNoAncestorInstructions } from '../src/comparison-fixtures.mjs';
import { writeTree, command, acceptance, snapshot } from './coding-ability-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const m = /^--(mode|run-id)=(.+)$/.exec(arg); if (!m) throw Error('Invalid option'); return [m[1], m[2]];
}));
const mode = options.mode || 'prepare', runId = options['run-id'];
if (!['prepare', 'live'].includes(mode) || !/^[a-zA-Z0-9_-]+$/.test(runId || '')) throw Error('Invalid mode/run ID');
const output = path.join(root, 'benchmarks/results', runId);
await mkdir(output); await mkdir(path.join(output, 'engines'));
const engine = {};
for (const arm of ['baseline', 'candidate']) engine[arm] = await prepareRevisionEngine({ repository: root,
  ref: arm === 'baseline' ? 'df89c92244c5d2381b5cb2b09d2e930ee5006d59' : '55c0975cee9760af48316661a12f105e80dd6139', directory: path.join(output, 'engines', arm) });
const env = mode === 'live' ? resolveUserEnvironment() : {};
const config = loadCliConfig({ maxCostUsd: 1, editPermissions: {}, memoryPolicy: 'contextos', maxRequestInputBytes: 256000,
  contextWindowTokens: 32768, contextReserveTokens: 4096 }, { ...env,
  ANTHROPIC_MODEL: 'glm-5.3-flash', TEA_THINKING_MODE: 'enabled', TEA_REASONING_EFFORT: 'low', TEA_MAX_OUTPUT_TOKENS: '4096',
  TEA_MAX_TOOL_CALLS: '24', TEA_REQUEST_TIMEOUT_MS: '90000', TEA_INPUT_PRICE_USD_PER_MTOK: '0.8', TEA_OUTPUT_PRICE_USD_PER_MTOK: '2.8', TEA_STREAM: '1', TEA_CAPABILITY_FEEDBACK: '1' });
if (mode === 'live') assertBenchmarkConfig(config);
const workspaceRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tea-edit-recovery-live-')));
await assertNoAncestorInstructions(path.join(workspaceRoot, 'probe'));
const frozenFiles = ['scripts/compare-edit-error-recovery.mjs', 'scripts/coding-ability-harness.mjs', 'benchmarks/tasks/instruction-discovery.mjs', 'benchmarks/tasks/retrieval-code.mjs', 'benchmarks/tasks/coding-ability.mjs'];
const digest = async () => hash(JSON.stringify(await Promise.all(frozenFiles.map(async file => [file, hash(await readFile(path.join(root, file)))]))));
const frozenSha256 = await digest();
const report = { schema: 1, runId, mode, createdAt: new Date().toISOString(), engine: Object.fromEntries(Object.entries(engine).map(([k,v]) => [k,v.metadata])), frozenSha256,
  taskManifestSha256: hash(JSON.stringify(tasks)), repeats: 2, planned: 12,
  config: { model: config.model, endpointSha256: hash(config.baseUrl), thinking: config.thinkingMode, effort: config.effort, stream: config.stream,
    maxOutputTokens: config.maxOutputTokens, capabilityFeedback: config.capabilityFeedback, memoryPolicy: config.memoryPolicy, compaction: config.compaction,
    contextWindowTokens: config.contextWindowTokens, contextReserveTokens: config.contextReserveTokens,
    maxRequestInputBytes: config.maxRequestInputBytes, maxToolCalls: config.maxToolCalls, maxTransportRequestsPerAttempt: 32,
    timeoutMs: config.timeoutMs, taskTimeoutMs: 600000, taskCapUsd: 1, suiteCapUsd: 3.99, editPermissions: {},
    inputControlRatePerMillion: 0.8, outputControlRatePerMillion: 2.8,
    pricing: 'Inherited conservative control estimates from prior GLM runs, not verified billing; preflight reservation covers unknown usage.' },
  scope: 'Three self-authored diagnostic tasks, two repeats per arm; edit-error feedback versus its direct parent, both with identical instruction discovery. Natural error occurrence is not forced; no triggering errors means no mechanism exposure. Not a cross-agent benchmark.',
  stoppingPolicy: 'Unknown usage retains 1 USD task reservation and stops; no paid retries. All failures retained. 32 network attempts max per task.',
  gate: 'All usage complete; full acceptance must not decrease overall or by task; all-attempt tokens must decrease to claim optimization. Audit existing-file error exposure and recovery. No universal performance claim.',
  preflight: [], rows: [], consumedUsd: 0, complete: false, stopReason: null };
const save = () => writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2));
await save();
for (const task of tasks) {
  const initial = path.join(workspaceRoot, 'preflight-' + task.id), reference = path.join(workspaceRoot, 'reference-' + task.id);
  await writeTree(initial, task.files); await writeTree(reference, { ...task.files, ...task.solution });
  const originalPublic = await command(initial, ['--test', 'tests/public.test.mjs']), originalHidden = await acceptance(initial, task);
  const referencePublic = await command(reference, ['--test', 'tests/public.test.mjs']), referenceHidden = await acceptance(reference, task);
  const passed = originalPublic.passed && !originalHidden.passed && originalHidden.completed && referencePublic.passed && referenceHidden.passed;
  report.preflight.push({ id: task.id, passed, initialSha256: hash(JSON.stringify(task.files)), promptSha256: hash(task.prompt), acceptanceSha256: hash(task.acceptance) });
  await save(); if (!passed) throw Error('Fixture preflight failed: ' + task.id);
}
const originalFetch = globalThis.fetch;
let transportRequests = 0;
globalThis.fetch = (...args) => { if (++transportRequests > 32) throw Error('Frozen network request cap reached'); return originalFetch(...args); };
try {
if (mode === 'live') outer: for (let repeat = 1; repeat <= 2; repeat++) for (let index = 0; index < tasks.length; index++) {
  const task = tasks[index], order = (repeat + index) % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
  for (const arm of order) {
    if (report.consumedUsd + 1 > 3.99) { report.stopReason = 'suite_budget_guard'; break outer; }
    if (await readFile(path.join(output, 'STOP_AFTER_CURRENT')).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) { report.stopReason = 'operator_stop'; break outer; }
    if (await digest() !== frozenSha256 || !await engine[arm].verify()) throw Error('Frozen source changed');
    const workspace = path.join(workspaceRoot, randomUUID()); await writeTree(workspace, task.files);
    const initial = await snapshot(workspace), id = `${task.id}-r${repeat}-${arm}`;
    await writeFile(path.join(output, id + '-workspace.json'), JSON.stringify({ workspace }));
    const row = { id, taskId: task.id, arm, repeat, running: true, status: 'running', accepted: false, usage: null };
    report.rows.push(row); report.consumedUsd += 1; await save(); console.log('START ' + id);
    const runConfig = { ...config, workspace, runId: 'agent', sessionId: undefined, resume: undefined, maxCostUsd: 1, storeRaw: false };
    const session = engine[arm].engine.createAgentSession(runConfig); transportRequests = 0;
    const started = Date.now();
    try {
      const result = await engine[arm].engine.runTask(task.prompt, runConfig, { session, signal: AbortSignal.timeout(600000),
        onEvent: e => { if (e.type === 'tool_end') console.log(`${id}: ${e.name} ${e.isError ? 'error' : 'done'}`); } });
      const s = result.summary, complete = s.providerUsageComplete === true;
      report.consumedUsd += (complete && Number.isFinite(s.estimatedSpendUsd) ? s.estimatedSpendUsd : 1) - 1;
      Object.assign(row, { running: false, status: result.status, elapsedMs: Date.now() - started, validationPassed: result.validationPassed,
        toolCalls: result.toolCalls, transportRequests, usageComplete: complete, accountedUsd: s.estimatedSpendUsd,
        usage: complete ? { inputTokens: s.inputTokens, outputTokens: s.outputTokens, totalTokens: s.totalActualTokens,
          cachedInputTokens: s.cachedInputTokens, cacheCreationInputTokens: s.cacheCreationInputTokens, requests: s.requests, compactionRequests: s.compactionRequests } : null });
      await save();
      const final = await snapshot(workspace), finalMap = new Map(final), initialMap = new Map(initial);
      row.changedFiles = final.filter(([file,value]) => initialMap.get(file) !== value).map(([file]) => file);
      row.deletedFiles = initial.filter(([file]) => !finalMap.has(file)).map(([file]) => file);
      row.protectedFilesUnchanged = initial.filter(([file]) => !file.startsWith('src/') || file.endsWith('/AGENTS.md')).every(([file,value]) => finalMap.get(file) === value);
      row.allowedChanges = row.changedFiles.every(file => file.startsWith('src/') && !file.endsWith('/AGENTS.md') || /^tests\/.+\.test\.mjs$/.test(file)) && row.deletedFiles.length === 0;
      const publicAfter = await command(workspace, ['--test', 'tests/public.test.mjs']);
      const allPublic = await command(workspace, ['--test', ...final.map(([file]) => file).filter(file => /^tests\/.+\.test\.mjs$/.test(file))]);
      const hidden = await acceptance(workspace, task);
      const behavior = task.behaviorAcceptance ? await acceptance(workspace, { ...task, acceptance: task.behaviorAcceptance }) : hidden;
      Object.assign(row, { publicPassed: publicAfter.passed, addedTestsPassed: allPublic.passed, hiddenPassed: hidden.passed, hiddenCompleted: hidden.completed,
        codeBehaviorPass: publicAfter.passed && allPublic.passed && behavior.passed, localContractPassed: hidden.passed });
      row.accepted = row.codeBehaviorPass && hidden.passed && row.protectedFilesUnchanged && row.allowedChanges && result.status === 'completed' && result.validationPassed;
      const ledger = (await readFile(path.join(result.runDirectory, 'ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
      row.firstRequestInputTokens = ledger.find(e => e.type === 'model_request')?.reportedInputTokens ?? null;
      row.toolErrors = ledger.filter(e => e.type === 'tool_call' && e.error).length;
      await save(); console.log(`FINISH ${id}: ${row.accepted ? 'PASS' : 'FAIL'} ${row.usage?.totalTokens ?? 'unknown'} tokens`);
      if (!complete) { report.stopReason = 'unknown_usage_no_retry'; break outer; }
    } catch (error) {
      Object.assign(row, { running: false, status: 'harness_error', error: String(error.message).replaceAll(workspace, '<workspace>').slice(0, 300) });
      report.stopReason = 'harness_error_reservation_retained'; await save(); break outer;
    }
  }
}
} finally { globalThis.fetch = originalFetch; }
report.sourceUnchanged = await digest() === frozenSha256 && await engine.baseline.verify() && await engine.candidate.verify();
report.complete = mode === 'prepare' || report.rows.length === 12 && !report.stopReason && report.sourceUnchanged;
report.endedAt = new Date().toISOString(); await save();
console.log(JSON.stringify({ runId, complete: report.complete, rows: report.rows.length, spentControlUsd: report.consumedUsd, stopReason: report.stopReason }));
if (report.stopReason) process.exitCode = 1;
