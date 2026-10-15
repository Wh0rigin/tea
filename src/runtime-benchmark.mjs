import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runTask } from './agent.mjs';
import { PROJECT_ROOT, RESULT_ROOT, sha256 } from './benchmark.mjs';
import { assertBenchmarkConfig, loadConfig } from './config.mjs';
import { validateRunId } from './run-id.mjs';
import { WorkspaceTools } from './tools.mjs';
import { BoundedOutput } from './output.mjs';

function within(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Fixture paths must be relative');
  const filename = path.resolve(root, relative);
  const resolved = path.relative(root, filename);
  if (!resolved || resolved === '..' || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved)) throw new Error('Fixture path escapes its directory');
  if (resolved.split(path.sep).some((part) => ['.git', '.tea'].includes(part))) throw new Error('Fixture paths cannot modify runner metadata');
  return filename;
}

async function command(executable, args, cwd, extraEnv = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false,
      env: { PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '', TEMP: process.env.TEMP || '', TMP: process.env.TMP || '', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'] });
    const output = new BoundedOutput({ maxChars: 32_000 });
    let settled = false;
    let timedOut = false;
    let cleanup = Promise.resolve();
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        cleanup = new Promise((done) => {
          const killer = spawn(path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
          killer.once('error', () => { child.kill(); done(); });
          killer.once('close', done);
        });
      } else child.kill();
    }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => output.append(chunk));
    child.once('error', (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
    child.once('close', async (code, signal) => { clearTimeout(timer); if (!settled) { settled = true; await cleanup; resolve({ code, signal, timedOut, output: output.render() }); } });
  });
}

async function pinRepository(workspace, files) {
  for (const [relative, text] of Object.entries(files)) {
    const filename = within(workspace, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, text, 'utf8');
  }
  const git = async (args, env) => {
    const result = await command('git', args, workspace, env);
    if (result.code !== 0 || result.timedOut) throw new Error(`Cannot pin fixture repository: ${result.output}`);
    return result.output.trim();
  };
  await git(['-c', 'init.defaultBranch=main', 'init', '-q']);
  await git(['-c', 'core.autocrlf=false', 'add', '--all']);
  await git(['-c', 'user.name=tea fixture', '-c', 'user.email=fixtures@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Pinned self-authored fixture'],
    { GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' });
  return git(['rev-parse', 'HEAD']);
}

export async function hiddenAcceptance(workspace, fixture, { timeoutMs = 10_000 } = {}) {
  // The acceptance test is materialized outside the workspace only while the agent is stopped.
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-acceptance-'));
  try {
    await writeFile(path.join(root, 'candidate.mjs'), await readFile(within(workspace, fixture.entry)), 'utf8');
    const witness = `TEA_ACCEPTANCE_FINISHED_${randomUUID()}`;
    const testSource = `${fixture.hiddenTest}\nimport { after as teaAcceptanceAfter } from 'node:test';\nteaAcceptanceAfter(() => process.stdout.write(${JSON.stringify(witness + '\n')}));\n`;
    await writeFile(path.join(root, 'hidden.test.mjs'), testSource, 'utf8');
    const result = await command(process.execPath, ['--test', 'hidden.test.mjs'], root, {}, timeoutMs);
    const completed = result.output.includes(witness);
    return { passed: result.code === 0 && !result.timedOut && completed, exitCode: result.code, completed,
      timedOut: result.timedOut, outputSha256: sha256(result.output) };
  } finally { await rm(root, { recursive: true, force: true }); }
}

function scriptedAdapter(fixture, variant) {
  let index = 0;
  const calls = (items) => ({ content: items.map((item, offset) => ({ type: 'tool_use', id: `fixture_${index}_${offset}`, ...item })), stop_reason: 'tool_use' });
  const phases = [
    [{ name: 'read_file', input: { path: 'AGENTS.md' } }, { name: 'read_file', input: { path: fixture.entry } }],
    [{ name: 'read_file', input: { path: fixture.entry } }],
    variant === 'unchanged' ? [] : fixture.solution.map((input) => ({ name: 'apply_patch', input })),
    [{ name: 'run_tests', input: { command: fixture.publicTestCommand } }],
  ].filter((items) => items.length);
  if (variant === 'extended') {
    for (let round = 0; round < 8; round += 1) phases.push([{ name: 'run_tests', input: { command: 'node --test tests/diagnostic.test.mjs' } }]);
  }
  return { complete: async () => {
    const items = phases[index++];
    return items ? calls(items) : { content: [{ type: 'text', text: 'Scripted runtime check finished.' }], stop_reason: 'end_turn' };
  } };
}

export async function loadExecutableManifest(filename = path.join(PROJECT_ROOT, 'benchmarks', 'tasks', 'runtime-smoke.json')) {
  const text = await readFile(filename, 'utf8');
  const manifest = JSON.parse(text);
  if (manifest.mode !== 'executable-fixtures' || !Array.isArray(manifest.tasks) || !manifest.tasks.length) throw new Error('Expected an executable-fixtures manifest with tasks');
  const ids = new Set();
  for (const task of manifest.tasks) {
    validateRunId(task.taskId);
    if (ids.has(task.taskId)) throw new Error(`Duplicate task ID: ${task.taskId}`);
    ids.add(task.taskId);
    if (typeof task.prompt !== 'string' || typeof task.hiddenTest !== 'string' || !Array.isArray(task.solution) || !task.files || !Object.values(task.files).every((value) => typeof value === 'string')) throw new Error(`Invalid fixture: ${task.taskId}`);
    if (typeof task.files[task.entry] !== 'string') throw new Error(`Missing fixture entry: ${task.taskId}`);
    for (const filename of Object.keys(task.files)) within(PROJECT_ROOT, filename);
    for (const patch of task.solution) {
      if (typeof patch.search !== 'string' || !patch.search || typeof patch.replace !== 'string' || !Object.hasOwn(task.files, patch.path)) throw new Error(`Invalid solution: ${task.taskId}`);
    }
  }
  return { manifest, manifestSha256: sha256(text) };
}

export async function runExecutableBenchmark({ mode = 'runtime', suite = 'runtime-smoke', strategy = 'v1', initialFileLimit,
  runId = `runtime-${new Date().toISOString().replaceAll(':', '-')}`, config, onProgress = () => {}, fixtureVariant = 'solution', taskIds,
  historyStrategy = 'full', historyKeepRecent = 2 } = {}) {
  if (!['runtime', 'live'].includes(mode)) throw new Error('Executable benchmark mode must be runtime or live');
  if (suite !== 'runtime-smoke') throw new Error('Only runtime-smoke is available for executable fixtures');
  if (!['solution', 'unchanged', 'extended'].includes(fixtureVariant)) throw new Error('Unknown scripted fixture variant');
  if (mode === 'live' && fixtureVariant === 'extended') throw new Error('Extended diagnostic loops are a scripted stress check only');
  validateRunId(runId);
  // This fixture compares tool-history policies; keep summary activation fixed.
  const validatedConfig = loadConfig({ contextStrategy: strategy, initialFileLimit, historyStrategy, historyKeepRecent, compaction: 'off' }, {});
  if (mode === 'live') { if (!config) throw new Error('Live benchmark requires configured credentials, rates, and a total budget'); assertBenchmarkConfig(config); }
  const { manifest, manifestSha256 } = await loadExecutableManifest();
  const selected = taskIds ? manifest.tasks.filter((task) => taskIds.includes(task.taskId)) : manifest.tasks;
  if (!selected.length || (taskIds && selected.length !== new Set(taskIds).size)) throw new Error('Unknown task ID in executable benchmark selection');
  const outputDir = path.join(RESULT_ROOT, runId);
  await mkdir(RESULT_ROOT, { recursive: true });
  await mkdir(outputDir); // Never overwrite a previous run or resume a dirty fixture.
  const tasks = [];
  let reservedSpendUsd = 0;
  let consumedInputTokens = 0;
  let stopReason = null;
  const wallStarted = Date.now();
  const source = await command('git', ['rev-parse', 'HEAD'], PROJECT_ROOT);
  const diff = await command('git', ['diff', 'HEAD', '--', 'src'], PROJECT_ROOT);
  const sourceFiles = ['agent.mjs', 'cli.mjs', 'terminal.mjs', 'benchmark.mjs', 'config.mjs', 'context.mjs', 'memory.mjs', 'tools.mjs', 'output.mjs', 'model.mjs', 'ledger.mjs', 'usage.mjs', 'run-id.mjs', 'runtime-benchmark.mjs'];
  const snapshot = async () => sha256(JSON.stringify(await Promise.all(sourceFiles.map(async (filename) => [filename, await readFile(path.join(PROJECT_ROOT, 'src', filename), 'utf8')]))));
  const sourceSnapshotSha256 = await snapshot();
  const checkpoint = async () => writeFile(path.join(outputDir, 'checkpoint.json'), `${JSON.stringify({ schemaVersion: 1, runId, mode: mode === 'live' ? 'live-fixture' : 'offline-runtime',
    manifestSha256, sourceSnapshotSha256, localBudgetConsumedUsd: mode === 'live' ? reservedSpendUsd : null, stopReason, tasks }, null, 2)}\n`, 'utf8');
  await checkpoint();
  for (const fixture of selected) {
    if (mode === 'live' && reservedSpendUsd >= config.maxCostUsd) { stopReason = 'suite_budget_exhausted'; break; }
    if (mode === 'live' && config.maxInputTokens !== undefined && consumedInputTokens >= config.maxInputTokens) { stopReason = 'suite_input_budget_exhausted'; break; }
    const workspace = path.join(outputDir, 'workspaces', fixture.taskId);
    const taskStarted = Date.now();
    const row = { taskId: fixture.taskId, category: fixture.category, language: fixture.language, difficulty: fixture.difficulty,
      status: 'preparing', agentStarted: false, acceptance: 'NOT_RUN', providerUsage: null, toolCalls: 0, toolOutputChars: 0 };
    tasks.push(row);
    await checkpoint();
    try {
    await mkdir(workspace, { recursive: true });
    const files = fixtureVariant === 'extended' ? { ...fixture.files,
      'tests/diagnostic.test.mjs': "import test from 'node:test';\ntest('fixed verbose diagnostic stress', () => {\n  for (let index = 0; index < 120; index += 1) console.log('diagnostic ' + index + ': ' + 'fixture-log '.repeat(12));\n});\n" } : fixture.files;
    const repositoryCommit = await pinRepository(workspace, files);
    const fileSnapshotSha256 = sha256(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
    const tools = new WorkspaceTools({ workspace });
    await tools.init();
    const publicBefore = await tools.runTests({ command: fixture.publicTestCommand });
    const hiddenBefore = await hiddenAcceptance(workspace, fixture);
    if (!/^exit=0\b/.test(publicBefore) || hiddenBefore.passed || !hiddenBefore.completed || hiddenBefore.timedOut) throw new Error(`Invalid initial fixture ${fixture.taskId}: public must pass and hidden assertions must complete with failure`);
    Object.assign(row, { repositoryCommit, fileSnapshotSha256, acceptanceTestsSha256: sha256(fixture.publicTestCommand + fixture.hiddenTest), publicBeforePassed: true, hiddenBeforePassed: false });
    const taskConfig = { ...(mode === 'live' ? config : validatedConfig), contextStrategy: strategy,
      initialFileLimit: validatedConfig.initialFileLimit, historyStrategy: validatedConfig.historyStrategy, historyKeepRecent: validatedConfig.historyKeepRecent, workspace, runId: 'agent',
      ...(mode === 'live' ? { maxCostUsd: config.maxCostUsd - reservedSpendUsd,
        maxInputTokens: config.maxInputTokens === undefined ? undefined : config.maxInputTokens - consumedInputTokens } : {}) };
    await onProgress(`${fixture.taskId}: ${mode === 'live' ? 'provider execution' : 'scripted runtime execution'}`);
    row.agentStarted = true;
    row.status = 'running';
    await checkpoint();
    const agentResult = await runTask(fixture.prompt, taskConfig, mode === 'live' ? {} : { adapterFactory: () => scriptedAdapter(fixture, fixtureVariant) });
    const usageComplete = mode === 'live' && agentResult.summary.providerUsageComplete === true;
    reservedSpendUsd += mode === 'live' ? agentResult.summary.estimatedSpendUsd : 0;
    consumedInputTokens += mode === 'live' ? Math.max(agentResult.summary.reportedInputTokens, agentResult.summary.estimatedInputTokens) : 0;
    Object.assign(row, { status: agentResult.status, acceptance: 'PENDING',
      providerUsage: usageComplete ? { inputTokens: agentResult.summary.inputTokens, outputTokens: agentResult.summary.outputTokens,
        totalActualTokens: agentResult.summary.totalActualTokens } : null,
      usageStatus: agentResult.summary.usageStatus, toolCalls: agentResult.toolCalls, toolOutputChars: agentResult.summary.toolOutputChars,
      validationAttempts: agentResult.validationAttempts, agentWallElapsedMs: agentResult.wallElapsedMs, wallElapsedMs: Date.now() - taskStarted,
      contextDiagnostics: agentResult.contextDiagnostics,
      ledgerPath: path.relative(outputDir, agentResult.runDirectory).replaceAll(path.sep, '/'),
      notes: mode === 'live' ? 'Self-authored executable fixture; independent acceptance, not production-repository evidence.' : 'Scripted tool selection and supplied patch exercise real code/tests only; no model intelligence or provider tokens measured.' });
    await checkpoint(); // Provider charges are durable before any acceptance process can fail.
    const publicAfter = await tools.runTests({ command: fixture.publicTestCommand });
    const hiddenAfter = await hiddenAcceptance(workspace, fixture);
    const acceptance = /^exit=0\b/.test(publicAfter) && hiddenAfter.passed && agentResult.status === 'completed';
    Object.assign(row, { acceptance: acceptance ? 'PASS' : 'FAIL', publicAfterPassed: /^exit=0\b/.test(publicAfter), hiddenAfterPassed: hiddenAfter.passed,
      hiddenAcceptanceCompleted: hiddenAfter.completed, hiddenAcceptanceTimedOut: hiddenAfter.timedOut,
      hiddenAcceptanceOutputSha256: hiddenAfter.outputSha256, wallElapsedMs: Date.now() - taskStarted });
    await checkpoint();
    if (mode === 'live' && (!usageComplete || agentResult.status === 'failed')) { stopReason = 'provider_failure_or_unknown_usage'; break; }
    } catch (error) {
      Object.assign(row, { acceptance: 'FAIL', harnessError: String(error.message).slice(0, 1000), wallElapsedMs: Date.now() - taskStarted });
      if (row.status === 'preparing') row.status = 'fixture_invalid';
      if (row.status === 'running') {
        row.status = 'agent_result_unavailable';
        // A crash after a paid request leaves spend uncertain; reserve the remaining suite budget and stop.
        if (mode === 'live') reservedSpendUsd = config.maxCostUsd;
      }
      stopReason = 'harness_error';
      await checkpoint();
      break;
    }
  }
  const attempted = tasks.filter((row) => row.agentStarted);
  const actualComplete = mode === 'live' && attempted.length > 0 && attempted.every((row) => row.providerUsage !== null);
  const sumUsage = (key) => actualComplete ? attempted.reduce((sum, row) => sum + row.providerUsage[key], 0) : null;
  const sourceSnapshotAfterSha256 = await snapshot();
  const run = { schemaVersion: 1, runId, createdAt: new Date().toISOString(), mode: mode === 'live' ? 'live-fixture' : 'offline-runtime',
    suite, strategy, historyStrategy: validatedConfig.historyStrategy, historyKeepRecent: validatedConfig.historyKeepRecent,
    initialFileLimit: validatedConfig.initialFileLimit, fixtureVariant: mode === 'live' ? null : fixtureVariant,
    source: manifest.source, seed: manifest.seed, manifestSha256, commit: source.code === 0 ? source.output.trim() : null,
    sourceDiffSha256: sha256(diff.output), sourceSnapshotSha256, sourceSnapshotAfterSha256,
    sourceUnchangedDuringRun: sourceSnapshotSha256 === sourceSnapshotAfterSha256,
    executionIsolation: 'none', hiddenTestsConfidential: false,
    model: mode === 'live' ? config.model : null, effort: mode === 'live' ? config.effort : null,
    parametersSha256: sha256(JSON.stringify(mode === 'live' ? { model: config.model, effort: config.effort, stream: config.stream, thinkingMode: config.thinkingMode,
      maxOutputTokens: config.maxOutputTokens, maxRequestInputTokens: config.maxRequestInputTokens, maxToolCalls: config.maxToolCalls,
      initialFileLimit: validatedConfig.initialFileLimit, strategy, historyStrategy, historyKeepRecent } : { initialFileLimit: validatedConfig.initialFileLimit, strategy, fixtureVariant, historyStrategy, historyKeepRecent })),
    gateEligible: false, gateReason: mode === 'live' ? 'Smoke fixtures only; no paired core/holdout revision gate.' : 'Offline scripted execution has no provider token or model task-success measurement.',
    stopReason, totals: { taskCount: selected.length, preparedTasks: tasks.length, attemptedTasks: attempted.length, acceptedTasks: tasks.filter((row) => row.acceptance === 'PASS').length,
      acceptanceRate: attempted.length ? tasks.filter((row) => row.acceptance === 'PASS').length / attempted.length : null,
      modelTaskSuccessRate: mode === 'live' && attempted.length ? tasks.filter((row) => row.acceptance === 'PASS').length / attempted.length : null,
      providerInputTokens: sumUsage('inputTokens'), providerOutputTokens: sumUsage('outputTokens'), providerTotalActualTokens: sumUsage('totalActualTokens'),
      providerUsageComplete: actualComplete, localBudgetConsumedUsd: mode === 'live' ? reservedSpendUsd : null, billedUsd: null,
      toolOutputChars: tasks.reduce((sum, row) => sum + row.toolOutputChars, 0), wallElapsedMs: Date.now() - wallStarted }, tasks };
  run.totals.sentRequestPayloadBytes = tasks.reduce((sum, row) => sum + (row.contextDiagnostics?.sentRequestPayloadBytes ?? 0), 0);
  run.totals.fullRequestPayloadBytes = tasks.reduce((sum, row) => sum + (row.contextDiagnostics?.fullRequestPayloadBytes ?? 0), 0);
  run.totals.sentHeuristicTokens = tasks.reduce((sum, row) => sum + (row.contextDiagnostics?.sentHeuristicTokens ?? 0), 0);
  run.totals.compactedResultOccurrences = tasks.reduce((sum, row) => sum + (row.contextDiagnostics?.compactedResultOccurrences ?? 0), 0);
  await writeFile(path.join(outputDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  await checkpoint();
  await writeFile(path.join(outputDir, 'report.md'), renderExecutableReport(run), 'utf8');
  return { run, outputDir };
}

export function renderExecutableReport(run) {
  return `# Executable benchmark ${run.runId}\n\n- Mode: ${run.mode}\n- Suite: ${run.suite}\n- Strategy: ${run.strategy}\n- History: ${run.historyStrategy ?? 'full'}\n` +
    `- Attempted fixtures: ${run.totals.attemptedTasks}/${run.totals.taskCount}\n- Independent acceptance: ${run.totals.acceptedTasks}/${run.totals.attemptedTasks}\n` +
    `- Provider actual tokens: ${run.totals.providerTotalActualTokens ?? 'NOT_MEASURED'}\n- Model task success: ${run.mode === 'offline-runtime' ? 'NOT_MEASURED (scripted patches)' : run.totals.modelTaskSuccessRate}\n` +
    `- Tool output characters: ${run.totals.toolOutputChars}\n- Serialized adapter-input bytes: ${run.totals.sentRequestPayloadBytes ?? 'NOT_MEASURED'} (diagnostic, not provider tokens)\n- Gate: INELIGIBLE — ${run.gateReason}\n`;
}
