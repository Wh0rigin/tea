import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, assertLiveConfig } from '../src/config.mjs';
import { runTask, createAgentSession } from '../src/agent.mjs';
import { AnthropicMessagesAdapter, ModelError } from '../src/model.mjs';
import { assertNoAncestorInstructions, cloneFixture, prepareFixture, taskDefinitions } from '../src/comparison-fixtures.mjs';
import { hiddenAcceptance } from '../src/runtime-benchmark.mjs';
import { analyzeCompaction, historyFingerprint, seedHistory } from '../src/compaction-experiment.mjs';

const exec = promisify(execFile);
const output = path.resolve(process.argv[2] || 'benchmarks/results/compaction-live');
const repeat = Number(process.env.TEA_COMPACTION_EXPERIMENT_REPEAT || 2);
const perRunBudget = Number(process.env.TEA_COMPACTION_RUN_BUDGET_USD || 0.25);
const maxRequests = 24;
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5 || !Number.isFinite(perRunBudget) || perRunBudget <= 0) throw new Error('Invalid experiment limits');
const config = loadConfig({}, process.env); assertLiveConfig(config);
if (config.storeRaw) throw new Error('Experiment raw storage must remain disabled');
// Fail if the output exists: never overwrite paid evidence.
await mkdir(output, { recursive: false });
const workspaceRoot = path.join(os.tmpdir(), `tea-compaction-${Date.now()}`);
await mkdir(workspaceRoot); await assertNoAncestorInstructions(workspaceRoot);
const definitions = taskDefinitions();
const cases = [
  { id: 'short-small-cache', task: 'small-cache-key', category: 'seeded-stress', shape: 'empty' },
  { id: 'source-medium-retry', task: 'medium-retry-budget', category: 'seeded-stress', shape: 'reads' },
  { id: 'inventory-large-unicode', task: 'large-unicode', category: 'seeded-stress', shape: 'inventory' },
  { id: 'workflow-large-retry', task: 'large-retry-budget', category: 'model-workflow', shape: 'empty' },
];
const sourceFiles = ['src/agent.mjs', 'src/compaction.mjs', 'src/compaction-experiment.mjs', 'src/config.mjs',
  'src/model.mjs', 'src/ledger.mjs', 'src/tools.mjs', 'src/memory.mjs', 'src/comparison-fixtures.mjs', 'src/runtime-benchmark.mjs', 'scripts/compare-compaction.mjs'];
const snapshot = async () => { const hash = createHash('sha256'); for (const file of sourceFiles) { hash.update(file); hash.update(await readFile(file)); } return hash.digest('hex'); };
const report = { version: 1, startedAt: new Date().toISOString(), model: config.model,
  engineCommit: (await exec('git', ['rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim(), engineSha256: await snapshot(),
  profile: { thinkingMode: config.thinkingMode, effort: config.effort, taskMaxOutputTokens: config.maxOutputTokens,
    summaryMaxOutputTokens: Math.min(config.maxOutputTokens, 1200), maxRequestWireBytes: config.maxRequestInputTokens,
    historyStrategy: config.historyStrategy, triggerRatio: config.compactionTriggerRatio,
    keepRecentBytes: config.compactionKeepRecentBytes, maxCompactionAttemptsPerTurn: config.compactionMaxPerTurn,
    maxToolCallsPerTurn: config.maxToolCalls, maxRequestsPerRun: maxRequests, requestTimeoutMs: config.timeoutMs,
    turnTimeoutMs: 300000, totalBudgetUsd: config.maxCostUsd, perRunBudgetUsd: perRunBudget,
    inputRateUsdPerMillion: config.inputRateUsdPerMillion, outputRateUsdPerMillion: config.outputRateUsdPerMillion,
    endpointSha256: createHash('sha256').update(config.baseUrl).digest('hex'), stream: config.stream },
  notes: ['Self-authored JavaScript fixtures; no universal savings claim.',
    'seeded-stress setup uses scripted calls to real read-only tools; setup is not model-generated or billed.',
    'model-workflow includes all provider calls from inspection through repair.',
    'Every total includes summary requests and all provider cache input; reasoning is included in output, never counted twice.',
    'Costs are conservative estimates/reservations, not invoices. Unknown usage stays null; no automatic retry.',
    'Variants share the task output cap. Summary requests use the native 1200 cap and enabled-thinking budget 1199.'],
  repeat, cases: [], runs: [], complete: false };
const save = async () => { report.analysis = analyzeCompaction(report.runs); await writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n'); };
async function acceptance(workspace, definition) {
  const publicPassed = await exec(process.execPath, ['--test', 'tests/public.test.mjs'], { cwd: workspace, windowsHide: true, timeout: 10000 }).then(() => true, () => false);
  const hidden = await hiddenAcceptance(workspace, { entry: definition.entry, hiddenTest:
    `import test from 'node:test'; import assert from 'node:assert/strict'; import {${definition.export}} from './candidate.mjs'; test('independent acceptance',async()=>{${definition.hidden}});` });
  const changed = (await exec('git', ['diff', '--name-only', 'HEAD'], { cwd: workspace, windowsHide: true })).stdout.trim().split(/\r?\n/).filter(Boolean);
  const untracked = (await exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd: workspace, windowsHide: true })).stdout.trim().split(/\r?\n/).filter(n => n && !n.startsWith('.tea/'));
  const scopePassed = changed.every(n => n === definition.entry) && !untracked.length;
  return { publicPassed, hiddenPassed: hidden.passed, hiddenCompleted: hidden.completed, scopePassed,
    passed: publicPassed && hidden.passed && scopePassed };
}
let budgetStopped = false;
for (const item of cases) {
  const definition = definitions.find(d => d.taskId === item.task);
  const base = path.join(workspaceRoot, `${item.id}-base`), pinned = await prepareFixture(base, definition);
  const initial = await acceptance(base, definition);
  if (!initial.publicPassed || initial.hiddenPassed || !initial.hiddenCompleted || !initial.scopePassed) throw new Error('Invalid initial fixture');
  const seed = await seedHistory(base, definition, item.shape), seedFingerprint = historyFingerprint(seed);
  const prompts = item.category === 'model-workflow' ? [
    'Read AGENTS.md and README.md. Then inspect all file inventory pages using list_files with maxFiles=250 and offsets 0,250,500,750,1000. Do not modify files or solve bugs yet. Finish with at most 80 words describing project organization.',
    definition.prompt,
  ] : [definition.prompt];
  report.cases.push({ ...item, entry: definition.entry, ...pinned, seed: seedFingerprint, prompts,
    promptSha256: createHash('sha256').update(JSON.stringify(prompts)).digest('hex'), initial }); await save();
  for (let repetition = 1; repetition <= repeat; repetition++) {
    const order = repetition % 2 ? ['off', 'auto'] : ['auto', 'off'];
    for (const variant of order) {
      const spent = report.runs.reduce((n, r) => n + r.conservativeSpendUsd, 0);
      if (spent + perRunBudget > config.maxCostUsd + Number.EPSILON) { budgetStopped = true; break; }
      const workspace = path.join(workspaceRoot, `${item.id}-${repetition}-${variant}`);
      await cloneFixture(base, workspace); await assertNoAncestorInstructions(workspace);
      const turnConfig = { ...config, workspace, maxCostUsd: perRunBudget, compaction: variant };
      const session = createAgentSession(turnConfig); session.messages = structuredClone(seed);
      const adapter = new AnthropicMessagesAdapter(turnConfig); session.adapter = adapter; session.offline = false;
      const complete = adapter.complete.bind(adapter); let attempts = 0;
      const run = { caseId: item.id, category: item.category, repeat: repetition, variant, accepted: false,
        usageComplete: false, totalTokens: null, conservativeSpendUsd: 0, running: true };
      report.runs.push(run); await save();
      adapter.complete = async request => {
        if (++attempts > maxRequests) throw new ModelError('Experiment request limit reached');
        try { return await complete(request); }
        finally { run.conservativeSpendUsd = adapter.spentUsd; await save(); }
      };
      const started = Date.now(), turns = [], rows = [];
      console.log(`Starting ${item.id}/${repetition}/${variant}`);
      for (let phase = 0; phase < prompts.length; phase++) {
        const result = await runTask(prompts[phase], { ...turnConfig, runId: `phase-${phase + 1}` },
          { session, signal: AbortSignal.timeout(300000) });
        const ledger = (await readFile(path.join(result.runDirectory, 'ledger.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
        rows.push(...ledger.filter(row => row.type === 'model_request').map(({ purpose, usage, usageComplete, usageStatus, estimatedUsd, costBasis, requestSha256, responseSha256, stopReason }) =>
          ({ purpose, usage, usageComplete, usageStatus, estimatedUsd, costBasis, requestSha256, responseSha256, stopReason })));
        turns.push({ phase: phase + 1, status: result.status, validationPassed: result.validationPassed,
          validationAttempts: result.validationAttempts, changedFiles: result.changedFiles, compactionCount: session.compactionCount,
          summary: result.summary, checkpoints: ledger.filter(row => row.type === 'conversation_compaction' || row.type === 'compaction_rejected') });
        if (result.status !== 'completed') break;
      }
      const evaluation = await acceptance(workspace, definition), usageComplete = rows.length > 0 && rows.every(r => r.usageComplete)
        && turns.every(t => t.summary.ledgerIntegrity);
      const inputTokens = usageComplete ? turns.reduce((n, t) => n + t.summary.inputTokens, 0) : null;
      const outputTokens = usageComplete ? turns.reduce((n, t) => n + t.summary.outputTokens, 0) : null;
      Object.assign(run, { running: false,
        accepted: evaluation.passed && turns.length === prompts.length && turns.every(t => t.status === 'completed'),
        acceptance: evaluation, usageComplete, inputTokens, outputTokens, totalTokens: usageComplete ? inputTokens + outputTokens : null,
        summaryRequests: rows.filter(r => r.purpose === 'compaction').length,
        summaryTokens: usageComplete ? turns.reduce((n, t) => n + t.summary.compactionInputTokens + t.summary.compactionOutputTokens, 0) : null,
        conservativeSpendUsd: adapter.spentUsd, elapsedMs: Date.now() - started, turns, requests: rows });
      await save();
      console.log(`Finished ${item.id}/${repetition}/${variant}: accepted=${run.accepted}, tokens=${run.totalTokens ?? 'unknown'}, summaries=${run.summaryRequests}, spent=$${adapter.spentUsd.toFixed(6)}`);
      if (!usageComplete && rows.length) { budgetStopped = true; break; }
    }
    if (budgetStopped) break;
  }
  if (budgetStopped) break;
}
report.complete = !budgetStopped && report.runs.length === cases.length * repeat * 2;
report.budgetOrUnknownUsageStopped = budgetStopped; report.endedAt = new Date().toISOString();
report.engineAfterSha256 = await snapshot(); report.sourceUnchanged = report.engineSha256 === report.engineAfterSha256;
await save(); console.log(`Experiment complete=${report.complete}; unchanged source=${report.sourceUnchanged}; total conservative spend=$${report.analysis.conservativeSpendUsd.toFixed(6)}`);
