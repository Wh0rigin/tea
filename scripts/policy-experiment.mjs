import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT, RESULT_ROOT, sha256 } from '../src/benchmark.mjs';
import { createPolicyState, decideEffort, POLICY_EFFORTS, POLICY_STRATEGIES } from '../src/policy.mjs';
import { validateRunId } from '../src/run-id.mjs';

const EVENT_KINDS = new Set(['pass', 'failure', 'edit', 'read', 'search', 'git', 'zero', 'help', 'self-report', 'unknown']);
const DEFAULT_COMMAND = 'node --test value.test.mjs';

export async function loadPolicyManifest(filename = path.join(PROJECT_ROOT, 'benchmarks', 'tasks', 'policy-replay.json')) {
  const source = await readFile(filename, 'utf8');
  const manifest = JSON.parse(source);
  if (manifest.mode !== 'policy-simulation' || !Array.isArray(manifest.tasks) || !manifest.tasks.length) throw new Error('Expected a policy-simulation manifest');
  const ids = new Set();
  for (const task of manifest.tasks) {
    validateRunId(task.taskId);
    if (ids.has(task.taskId)) throw new Error('Duplicate policy task ID');
    ids.add(task.taskId);
    if (!POLICY_EFFORTS.includes(task.initialEffort) || !Array.isArray(task.events) || !task.events.length || task.events.length > 100) throw new Error('Invalid policy task');
    for (const event of task.events) if (!EVENT_KINDS.has(event.kind)) throw new Error('Unknown policy event kind');
  }
  return { manifest, manifestSha256: sha256(source) };
}

/** Fixed declared states only. No command below is executed. */
export function materializePolicyTrace(task) {
  let sourceRevision = 'source-a';
  let validationAttempts = 0;
  return task.events.map((event, step) => {
    sourceRevision = event.sourceRevision ?? sourceRevision;
    validationAttempts = event.validationAttempts ?? event.attempt ?? validationAttempts;
    const source = event.evidenceSourceRevision ?? sourceRevision;
    const command = event.command ?? DEFAULT_COMMAND;
    const testSummary = `\nstdout:\n# tests 1\n# pass ${event.kind === 'failure' ? 0 : 1}\n# fail ${event.kind === 'failure' ? 1 : 0}\n# duration_ms ${event.duration ?? step + 1}\nstderr:\n`;
    let latestToolEvidence;
    if (['pass', 'failure', 'zero', 'unknown'].includes(event.kind)) {
      const output = event.kind === 'zero' ? 'exit=0\nstdout:\n# tests 0\n# pass 0\n# fail 0\nstderr:\n'
        : event.kind === 'unknown' ? 'partial process output without exit status'
          : `exit=${event.kind === 'failure' ? 1 : 0}${event.kind === 'failure' ? '\n# AssertionError: expected current revision' : ''}${testSummary}`;
      latestToolEvidence = { name: 'run_tests', input: { command }, output, is_error: false, attempt: event.attempt, sourceRevision: source };
    } else if (event.kind === 'edit') latestToolEvidence = { name: 'apply_patch', input: { path: 'value.mjs', search: 'old value', replace: 'new value' }, output: 'Updated value.mjs', is_error: false };
    else if (event.kind === 'read') latestToolEvidence = { name: 'read_file', input: { path: 'value.mjs' }, output: `[evidence ref=value.mjs@${sourceRevision}]\n1: export const value = 1;`, is_error: false };
    else if (event.kind === 'search') latestToolEvidence = { name: 'search_code', input: { query: 'value' }, output: 'No matches.', is_error: false };
    else if (event.kind === 'git') latestToolEvidence = { name: 'run_tests', input: { command: 'git status' }, output: 'exit=0\nstdout:\nworking tree clean\nstderr:\n', is_error: false };
    else if (event.kind === 'help') latestToolEvidence = { name: 'run_tests', input: { command: 'node --test --help' }, output: 'exit=0\nstdout:\nUsage: node [options]\nstderr:\n', is_error: false };
    return { step, sourceRevision, pendingValidation: event.pendingValidation ?? ['failure', 'edit'].includes(event.kind),
      validationPassed: event.validationPassed ?? event.kind === 'pass', validationAttempts,
      changedFiles: sourceRevision === 'source-a' ? [] : ['value.mjs'], remainingBudget: event.remainingBudget ?? 100,
      ...(latestToolEvidence ? { latestToolEvidence } : {}),
      ...(event.kind === 'self-report' ? { assistantClaim: 'Everything is now correct.' } : {}) };
  });
}

function emptyStats() {
  return { observedSteps: 0, allowedRequestDecisions: 0, stoppedTasks: 0,
    effortSteps: Object.fromEntries(POLICY_EFFORTS.map((key) => [key, 0])),
    actions: { up: 0, down: 0, hold: 0, stop: 0 }, switches: 0, immediateReversals: 0,
    minimumHoldViolations: 0, downgradeEvidenceViolations: 0, budgetViolations: 0,
    manufacturedRetries: 0, manufacturedValidationCalls: 0 };
}

function inspectDecision(stats, row, previousSwitch, config) {
  const decision = row.decision;
  stats.observedSteps += 1;
  stats.actions[decision.action] += 1;
  stats.effortSteps[decision.effort] += 1;
  if (decision.requestAllowed) stats.allowedRequestDecisions += 1;
  if (decision.action === 'stop') stats.stoppedTasks += 1;
  if (decision.createsRetry) stats.manufacturedRetries += 1;
  if (decision.createsValidationCall) stats.manufacturedValidationCalls += 1;
  if (decision.requestAllowed && row.observation.remainingBudget < decision.budget.requestReserve + config.validationReserve) stats.budgetViolations += 1;
  if (['up', 'down'].includes(decision.action)) {
    stats.switches += 1;
    if (decision.stepsAtEffortBeforeDecision < config.minimumHoldSteps) stats.minimumHoldViolations += 1;
    if (previousSwitch && previousSwitch.action !== decision.action && decision.step - previousSwitch.step < config.minimumHoldSteps) stats.immediateReversals += 1;
    if (decision.action === 'down' && (decision.evidence.status !== 'success' || decision.observedSuccessStreak < config.successesBeforeDowngrade
      || row.observation.pendingValidation || !row.observation.validationPassed || row.observation.latestToolEvidence?.sourceRevision !== row.observation.sourceRevision)) stats.downgradeEvidenceViolations += 1;
    return decision;
  }
  return previousSwitch;
}

export async function runPolicyExperiment({ runId = `policy-${new Date().toISOString().replaceAll(':', '-')}`, manifestPath } = {}) {
  validateRunId(runId);
  const { manifest, manifestSha256 } = await loadPolicyManifest(manifestPath);
  const outputDir = path.join(RESULT_ROOT, runId);
  await mkdir(RESULT_ROOT, { recursive: true });
  await mkdir(outputDir);
  const sourceFiles = ['src/policy.mjs', 'scripts/policy-experiment.mjs', 'src/tools.mjs'];
  const snapshot = async () => sha256(JSON.stringify(await Promise.all(sourceFiles.map(async (filename) => [filename, await readFile(path.join(PROJECT_ROOT, filename), 'utf8')]))));
  const sourceSnapshotSha256 = await snapshot();
  const strategies = [];
  for (const strategy of POLICY_STRATEGIES) {
    const totals = emptyStats();
    const tasks = [];
    for (const task of manifest.tasks) {
      let state = createPolicyState({ strategy, ...(['upgrade-only', 'bidirectional'].includes(strategy) ? { initialEffort: task.initialEffort } : {}) });
      const observations = materializePolicyTrace(task);
      const inputSha256 = sha256(JSON.stringify(observations));
      const rows = [];
      let previousSwitch;
      const stats = emptyStats();
      for (const observation of observations) {
        const result = decideEffort(state, observation, manifest.config);
        rows.push({ observation, decision: result.decision, resultingState: result.state });
        previousSwitch = inspectDecision(stats, rows.at(-1), previousSwitch, manifest.config);
        state = result.state;
        if (result.decision.action === 'stop') break;
      }
      for (const key of Object.keys(stats)) {
        if (typeof stats[key] === 'number') totals[key] += stats[key];
        else for (const subkey of Object.keys(stats[key])) totals[key][subkey] += stats[key][subkey];
      }
      tasks.push({ taskId: task.taskId, declaredSteps: observations.length, initialEffort: rows[0].decision.effortBefore,
        inputSha256, inputAfterSha256: sha256(JSON.stringify(observations)), inputUnchanged: inputSha256 === sha256(JSON.stringify(observations)),
        stats, rows });
    }
    strategies.push({ strategy, taskCount: tasks.length, totals, tasks });
  }
  const sourceSnapshotAfterSha256 = await snapshot();
  const run = { schemaVersion: 1, runId, createdAt: new Date().toISOString(), mode: 'policy-simulation', source: manifest.source,
    manifestSha256, sourceSnapshotSha256, sourceSnapshotAfterSha256, sourceUnchangedDuringRun: sourceSnapshotSha256 === sourceSnapshotAfterSha256,
    gateEligible: false, gateReason: 'Fixed declared runtime states test policy mechanics only; no model, real code execution, or acceptance measurement.',
    config: manifest.config, budgetUnit: 'abstract-simulation-unit', providerTotalActualTokens: null,
    estimatedOutputTokenSavings: null, modelTaskSuccessRate: null, actualCodeAcceptanceRate: null,
    validationStateTrust: 'Source identities, tool-output shapes, attempts, and validation booleans are fixed simulation inputs assumed to come from a trusted runtime. They are not authenticated here.',
    protections: ['Full source evidence and signed thinking/history are not read or changed by the policy.',
      'No requests, tests, retries, or validation calls are created by a routing decision.',
      'Downgrade requires two distinct aligned successful validation attempts on current source, and a minimum two-step hold.',
      'Upgrade uses repeated validation failures on the same source and command; differing logs do not imply differing root causes.',
      'New edits/source identities reset streaks and expire earlier validation attempts monotonically; returning to an old source identity cannot revive old evidence.',
      'Every allowed request retains a positive validation reserve; insufficient budget stops instead of skipping tests.'],
    totals: { taskCount: manifest.tasks.length, strategyCount: strategies.length,
      protectionViolations: strategies.reduce((sum, row) => sum + row.totals.minimumHoldViolations + row.totals.downgradeEvidenceViolations + row.totals.budgetViolations
        + row.totals.manufacturedRetries + row.totals.manufacturedValidationCalls + row.totals.immediateReversals, 0),
      allInputsUnchanged: strategies.every((row) => row.tasks.every((task) => task.inputUnchanged)) }, strategies };
  await writeFile(path.join(outputDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outputDir, 'report.md'), renderPolicyReport(run), 'utf8');
  return { run, outputDir };
}

export function renderPolicyReport(run) {
  return `# Reasoning policy simulation ${run.runId}\n\n- Mode: ${run.mode}\n- Fixed traces: ${run.totals.taskCount}\n- Strategies: ${run.totals.strategyCount}\n` +
    `- Protection violations: ${run.totals.protectionViolations}\n- Inputs unchanged: ${run.totals.allInputsUnchanged}\n- Provider tokens: NOT_MEASURED\n` +
    `- Output token savings: NOT_MEASURED\n- Model success and real code acceptance: NOT_MEASURED\n- Gate: INELIGIBLE\n\n` +
    `Budget reservations use abstract simulation units, with no provider/token/USD mapping. No code, test, or provider request is executed.\n\n` +
    run.strategies.map((row) => `- ${row.strategy}: ${row.totals.observedSteps} observed steps; low/high/max ${row.totals.effortSteps.low}/${row.totals.effortSteps.high}/${row.totals.effortSteps.max}; ` +
      `${row.totals.actions.up} upgrades, ${row.totals.actions.down} downgrades, ${row.totals.actions.stop} budget stops, ${row.totals.immediateReversals} immediate reversals.\n`).join('') +
    `\n## Protection conditions\n\n${run.protections.map((text) => `- ${text}\n`).join('')}\n${run.validationStateTrust}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--run-id')) throw new Error('Usage: node scripts/policy-experiment.mjs [--run-id SAFE_ID]');
  const { run, outputDir } = await runPolicyExperiment({ ...(args.length ? { runId: args[1] } : {}) });
  process.stdout.write(`${JSON.stringify({ runId: run.runId, outputDir, totals: run.totals,
    strategies: run.strategies.map((row) => ({ strategy: row.strategy, ...row.totals })) }, null, 2)}\n`);
}
