import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_ROOT = path.join(PROJECT_ROOT, 'benchmarks', 'results');

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

export function estimateTextTokens(text) {
  const value = String(text);
  const wideChars = (value.match(/[\u2E80-\u9FFF\uF900-\uFAFF]/g) || []).length;
  return Math.ceil(wideChars * 1.4 + (value.length - wideChars) / 4);
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

export async function runReplayBenchmark({ suite = 'core', runId = `replay-${new Date().toISOString().replaceAll(':', '-')}` } = {}) {
  if (suite !== 'core') throw new Error(`Unknown suite: ${suite}. Available replay suite: core`);
  const manifestPath = path.join(PROJECT_ROOT, 'benchmarks', 'tasks', 'core-replay.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  if (manifest.mode !== 'controlled-replay') throw new Error('Replay manifest must declare controlled-replay mode');
  const tasks = manifest.tasks.map((task) => {
    const supplied = task.trace.contextSentToModel || '';
    const rawToolOutput = task.trace.rawToolOutput || '';
    return {
      taskId: task.taskId,
      category: task.category,
      language: task.language,
      difficulty: task.difficulty,
      estimatedInputTokens: estimateTextTokens(task.taskPrompt + supplied),
      taskPromptChars: task.taskPrompt.length,
      rawToolOutputChars: rawToolOutput.length,
      contextSentChars: supplied.length,
      contextRecallLabels: task.trace.expectedEvidenceLabels,
      providerUsage: null,
      acceptance: 'NOT_RUN',
      attemptCount: 1,
      notes: 'Controlled fixture only; not a live model execution or task-success measurement.',
    };
  });
  const configuration = {
    suite, mode: 'controlled-replay', manifestSha256: sha256(manifestText),
    estimator: 'heuristic text estimate (CJK code points × 1.4 + other characters ÷ 4)',
    seed: manifest.seed, commit: gitHead(), model: null, effort: null,
    actualTokenFields: 'NOT_MEASURED', acceptanceTests: 'NOT_RUN',
  };
  const run = {
    schemaVersion: 1, runId, createdAt: new Date().toISOString(), ...configuration,
    gateEligible: false,
    totals: {
      taskCount: tasks.length,
      providerInputTokens: null,
      providerOutputTokens: null,
      providerTotalActualTokens: null,
      heuristicInputTokenEstimate: tasks.reduce((sum, row) => sum + row.estimatedInputTokens, 0),
      successCount: null,
      taskSuccessRate: null,
      rawToolOutputChars: tasks.reduce((sum, row) => sum + row.rawToolOutputChars, 0),
      contextSentChars: tasks.reduce((sum, row) => sum + row.contextSentChars, 0),
      medianHeuristicTokens: median(tasks.map((row) => row.estimatedInputTokens)),
      p95LatencyMs: null,
      estimatedUsd: null,
      measuredUsd: null,
    },
    tasks,
  };
  const outputDir = path.join(RESULT_ROOT, runId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  const csvRows = [
    'task_id,category,language,difficulty,estimated_input_tokens,provider_actual_tokens,success,raw_tool_output_chars,context_sent_chars',
    ...tasks.map((row) => [row.taskId, row.category, row.language, row.difficulty, row.estimatedInputTokens, '', '', row.rawToolOutputChars, row.contextSentChars].join(',')),
  ];
  await writeFile(path.join(outputDir, 'summary.csv'), `${csvRows.join('\n')}\n`, 'utf8');
  await writeFile(path.join(outputDir, 'report.md'), renderRunReport(run), 'utf8');
  return { run, outputDir };
}

export async function loadRun(reference) {
  const filename = reference.endsWith('.json') ? path.resolve(reference) : path.join(RESULT_ROOT, reference, 'run.json');
  return JSON.parse(await readFile(filename, 'utf8'));
}

export async function compareRuns(baseReference, candidateReference) {
  const [base, candidate] = await Promise.all([loadRun(baseReference), loadRun(candidateReference)]);
  const baseById = new Map(base.tasks.map((row) => [row.taskId, row]));
  const paired = candidate.tasks.filter((row) => baseById.has(row.taskId)).map((row) => ({
    taskId: row.taskId,
    base: baseById.get(row.taskId).estimatedInputTokens,
    candidate: row.estimatedInputTokens,
  }));
  const deltas = paired.map((row) => row.candidate - row.base);
  const baseTotal = paired.reduce((sum, row) => sum + row.base, 0);
  const candidateTotal = paired.reduce((sum, row) => sum + row.candidate, 0);
  const estimateReductionPercent = baseTotal === 0 ? null : (baseTotal - candidateTotal) / baseTotal * 100;
  const ci = pairedBootstrapMean(deltas, 2000, 773);
  return {
    schemaVersion: 1,
    baseRunId: base.runId,
    candidateRunId: candidate.runId,
    pairedTaskCount: paired.length,
    baseProviderTotalActualTokens: base.totals.providerTotalActualTokens,
    candidateProviderTotalActualTokens: candidate.totals.providerTotalActualTokens,
    heuristicTokenEstimateReductionPercent: estimateReductionPercent,
    pairedBootstrapHeuristicDelta95: ci,
    taskSuccessRateChanged: base.totals.taskSuccessRate !== null || candidate.totals.taskSuccessRate !== null,
    gateEligible: Boolean(base.gateEligible && candidate.gateEligible && paired.length >= 40 && base.totals.providerTotalActualTokens !== null && candidate.totals.providerTotalActualTokens !== null),
    verdict: 'INELIGIBLE: controlled replay estimates do not establish billed token savings or task correctness.',
    paired,
  };
}

export function renderRunReport(run) {
  return `# Benchmark run ${run.runId}\n\n` +
    `- Mode: ${run.mode}\n- Commit: ${run.commit || 'unavailable before Git initialization'}\n- Task count: ${run.totals.taskCount}\n` +
    `- Provider actual tokens: NOT_MEASURED\n- Task success rate: NOT_MEASURED\n- Heuristic input estimate: ${run.totals.heuristicInputTokenEstimate} (diagnostic only)\n` +
    `- Acceptance tests: NOT_RUN\n- Eligible for optimization gate: no\n\n` +
    `This controlled replay measures fixture payload sizes. It does not call a model, validate code changes, or represent billed usage.\n`;
}

export function renderComparisonReport(result) {
  const reduction = result.heuristicTokenEstimateReductionPercent;
  return `# Replay comparison\n\n- Base run: ${result.baseRunId}\n- Candidate run: ${result.candidateRunId}\n- Paired tasks: ${result.pairedTaskCount}\n` +
    `- Heuristic input-estimate reduction: ${reduction === null ? 'n/a' : `${reduction.toFixed(2)}%`}\n` +
    `- Paired bootstrap 95% interval for candidate − base heuristic tokens: [${result.pairedBootstrapHeuristicDelta95.lower.toFixed(2)}, ${result.pairedBootstrapHeuristicDelta95.upper.toFixed(2)}]\n` +
    `- Gate: ${result.verdict}\n`;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pairedBootstrapMean(values, iterations, seed) {
  if (!values.length) return { lower: 0, upper: 0, confidence: 0.95, iterations };
  let state = seed >>> 0;
  const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 0x1_0000_0000; };
  const estimates = [];
  for (let sample = 0; sample < iterations; sample += 1) {
    let total = 0;
    for (let item = 0; item < values.length; item += 1) total += values[Math.floor(random() * values.length)];
    estimates.push(total / values.length);
  }
  estimates.sort((a, b) => a - b);
  return { lower: estimates[Math.floor(iterations * 0.025)], upper: estimates[Math.min(iterations - 1, Math.floor(iterations * 0.975))], confidence: 0.95, iterations };
}

export { PROJECT_ROOT, RESULT_ROOT, sha256 };
