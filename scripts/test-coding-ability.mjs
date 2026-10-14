import { mkdir, mkdtemp, readFile, writeFile, readdir, lstat, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { codingTasks } from '../benchmarks/tasks/coding-ability.mjs';
import { loadCliConfig, assertBenchmarkConfig } from '../src/config.mjs';
import { resolveUserEnvironment } from '../src/user-config.mjs';
import { runTask } from '../src/agent.mjs';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = data => createHash('sha256').update(data).digest('hex');
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(mode|run-id|task-cap|suite-cap)=(.+)$/.exec(arg);
  if (!match) throw new Error('Expected --mode=preflight|live, --run-id=ID, --task-cap=USD, --suite-cap=USD');
  return [match[1], match[2]];
}));
const mode = options.mode || 'preflight', runId = options['run-id'] || `coding-${mode}-${Date.now()}`;
if (!['preflight', 'live'].includes(mode) || !/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid mode/run ID');
const outputDir = path.join(root, 'benchmarks/results', runId);
await mkdir(path.dirname(outputDir), { recursive: true });
await mkdir(outputDir); // Never overwrite an existing run.
const taskCap = Number(options['task-cap'] || 1), suiteCap = Number(options['suite-cap'] || 6);
if (![taskCap, suiteCap].every(x => Number.isFinite(x) && x > 0)) throw new Error('Finite positive caps required');
const env = mode === 'live' ? resolveUserEnvironment() : {};
const config = loadCliConfig({ maxCostUsd: taskCap, maxRequestInputBytes: 256000 }, {
  ...env, ANTHROPIC_MODEL: 'glm-5.3-flash', TEA_THINKING_MODE: 'enabled', TEA_REASONING_EFFORT: 'low',
  TEA_MAX_OUTPUT_TOKENS: '4096', TEA_MAX_TOOL_CALLS: '24', TEA_REQUEST_TIMEOUT_MS: '90000',
  TEA_INPUT_PRICE_USD_PER_MTOK: '0.8', TEA_OUTPUT_PRICE_USD_PER_MTOK: '2.8', TEA_STREAM: '1',
});
if (mode === 'live') assertBenchmarkConfig(config);
const childEnv = { PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '',
  WINDIR: process.env.WINDIR || '', TEMP: process.env.TEMP || '', TMP: process.env.TMP || '' };
async function writeTree(directory, files) {
  for (const [relative, content] of Object.entries(files)) {
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => ['..', '.git', '.tea'].includes(x))) throw new Error('Invalid fixture path');
    const filename = path.join(directory, relative); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, content);
  }
}
async function command(directory, args) {
  try {
    const result = await execute(process.execPath, args, { cwd: directory, env: childEnv, windowsHide: true, timeout: 15000, maxBuffer: 262144 });
    return { passed: true, output: result.stdout + result.stderr, code: 0 };
  } catch (error) { return { passed: false, output: (error.stdout || '') + (error.stderr || ''), code: error.code || null }; }
}
async function removeTemporary(directory) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
  if (!relative.startsWith('tea-coding-accept-') || relative.includes(path.sep) || path.isAbsolute(relative)) throw new Error('Unsafe cleanup target');
  await rm(directory, { recursive: true, force: true });
}
async function listSource(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Symlink in candidate sources');
    if (entry.isDirectory()) result.push(...await listSource(path.join(directory, entry.name), relative));
    else if (entry.isFile()) {
      if ((await lstat(path.join(directory, entry.name))).size > 160000) throw new Error('Oversized candidate source');
      result.push(relative);
    }
    if (result.length > 200) throw new Error('Too many candidate sources');
  }
  return result.sort();
}
async function acceptance(workspace, fixture) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tea-coding-accept-'));
  try {
    const source = path.join(workspace, 'src');
    if (await lstat(source).then(() => true, () => false)) {
      await listSource(source); await cp(source, path.join(directory, 'src'), { recursive: true, dereference: false });
    }
    const witness = `TEA_FINISHED_${randomUUID()}`;
    await writeFile(path.join(directory, 'hidden.test.mjs'), `${fixture.acceptance}\nimport {after} from 'node:test';after(()=>console.log('${witness}'));\n`);
    const result = await command(directory, ['--test', 'hidden.test.mjs']);
    const completed = result.output.includes(witness);
    return { passed: result.passed && completed, completed, code: result.code, outputSha256: hash(result.output),
      diagnostic: result.output.replaceAll(directory, '<acceptance>').slice(-4000) };
  } finally { await removeTemporary(directory); }
}
async function snapshot(directory, prefix = '') {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['.tea', '.git', '__pycache__'].includes(item.name)) continue;
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error('Symlink in fixture tree');
    if (item.isDirectory()) entries.push(...await snapshot(path.join(directory, item.name), relative));
    else entries.push([relative, hash(await readFile(path.join(directory, item.name)))]);
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}
const srcFiles = (await readdir(path.join(root, 'src'))).filter(x => x.endsWith('.mjs')).sort();
const sourceIdentity = async () => hash(JSON.stringify(await Promise.all(srcFiles.map(async x => [x, hash(await readFile(path.join(root, 'src', x)))]))));
const sourceSha256 = await sourceIdentity();
const commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true })).stdout.trim();
const plan = { schema: 1, runId, mode, commit, sourceSha256, manifestSha256: hash(await readFile(path.join(root, 'benchmarks/tasks/coding-ability.mjs'))),
  harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), createdAt: new Date().toISOString(),
  model: config.model, thinkingMode: config.thinkingMode, effort: config.effort, maxOutputTokens: config.maxOutputTokens,
  contextWindowTokens: config.contextWindowTokens, contextReserveTokens: config.contextReserveTokens,
  maxRequestInputBytes: config.maxRequestInputBytes, maxToolCalls: config.maxToolCalls, timeoutMs: config.timeoutMs,
  taskTimeoutMs: 600000, taskCap, suiteCap, inputRateUsdPerMillion: 0.8, outputRateUsdPerMillion: 2.8,
  priceSource: 'Previously recorded relay experiment rates; conservative accounting, not verified account billing',
  tasks: codingTasks.map(t => ({ id: t.id, level: t.level, title: t.title, files: Object.keys(t.files).length, promptSha256: hash(t.prompt),
    acceptanceSha256: hash(t.acceptance), initialTreeSha256: hash(JSON.stringify(t.files)) })),
  limitations: ['Self-authored Node.js fixtures; difficulty is an author-assigned label', 'One fresh attempt per task, no generalization or agent comparison claim',
    'Acceptance source is outside the agent workspace but on the same host; not an OS sandbox or secret benchmark', 'Headless unlisted shell commands cannot obtain approval'] };
await writeFile(path.join(outputDir, 'plan.json'), JSON.stringify(plan, null, 2));
const rows = []; let consumed = 0, stopReason = null;
const checkpoint = async () => writeFile(path.join(outputDir, 'results.json'), JSON.stringify({ ...plan, consumedUsd: consumed, stopReason, rows }, null, 2));
await checkpoint();
for (const fixture of codingTasks) {
  if (mode === 'live' && suiteCap - consumed < taskCap) { stopReason = 'suite_budget_guard'; break; }
  const directory = path.join(outputDir, 'workspaces', fixture.id);
  const row = { id: fixture.id, level: fixture.level, title: fixture.title, status: 'preflight', accepted: false, agentStarted: false, usage: null };
  rows.push(row); await checkpoint();
  await writeTree(directory, fixture.files);
  const initial = await snapshot(directory);
  const baselinePublic = await command(directory, ['--test', 'tests/public.test.mjs']);
  const baselineHidden = await acceptance(directory, fixture);
  const reference = path.join(outputDir, 'references', fixture.id);
  await writeTree(reference, { ...fixture.files, ...fixture.solution });
  const referencePublic = await command(reference, ['--test', 'tests/public.test.mjs']);
  const referenceHidden = await acceptance(reference, fixture);
  row.preflight = { baselinePublicPassed: baselinePublic.passed, baselineHiddenPassed: baselineHidden.passed,
    baselineHiddenCompleted: baselineHidden.completed, referencePublicPassed: referencePublic.passed, referenceHiddenPassed: referenceHidden.passed,
    hiddenDiagnostic: referenceHidden.passed ? null : referenceHidden.diagnostic };
  if (!baselinePublic.passed || baselineHidden.passed || !baselineHidden.completed || !referencePublic.passed || !referenceHidden.passed) {
    row.status = 'invalid_fixture'; stopReason = 'preflight_failed'; await checkpoint(); break;
  }
  row.status = 'ready'; await checkpoint(); console.log(`${fixture.id}: fixture validated`);
  if (mode === 'preflight') continue;
  const perTask = { ...config, workspace: directory, runId: 'agent', sessionId: undefined, resume: undefined, maxCostUsd: taskCap, storeRaw: false };
  row.agentStarted = true; row.status = 'running'; consumed += taskCap; await checkpoint();
  const started = Date.now();
  try {
    const result = await runTask(fixture.prompt, perTask, { signal: AbortSignal.timeout(600000),
      onEvent: event => { if (event.type === 'tool_end') console.log(`${fixture.id}: ${event.name} ${event.isError ? 'error' : 'done'}`); } });
    const summary = result.summary;
    const complete = summary.providerUsageComplete === true;
    consumed += (complete && Number.isFinite(summary.estimatedSpendUsd) ? summary.estimatedSpendUsd : taskCap) - taskCap;
    Object.assign(row, { status: result.status, elapsedMs: Date.now() - started, validationPassed: result.validationPassed,
      validationAttempts: result.validationAttempts, toolCalls: result.toolCalls, usageStatus: summary.usageStatus,
      accountedUsd: summary.estimatedSpendUsd, usage: complete ? { inputTokens: summary.inputTokens,
        cachedInputTokens: summary.cachedInputTokens, cacheCreationInputTokens: summary.cacheCreationInputTokens,
        outputTokens: summary.outputTokens, reasoningTokens: summary.reasoningTokens, totalTokens: summary.totalActualTokens,
        requests: summary.requests, compactionRequests: summary.compactionRequests } : null });
    await checkpoint();
    const finalTree = await snapshot(directory), finalMap = new Map(finalTree);
    row.changedFiles = finalTree.filter(([name, value]) => new Map(initial).get(name) !== value).map(([name]) => name);
    row.deletedFiles = initial.filter(([name]) => !finalMap.has(name)).map(([name]) => name);
    row.protectedFilesUnchanged = initial.filter(([name]) => !name.startsWith('src/')).every(([name, value]) => finalMap.get(name) === value);
    row.allowedChanges = row.changedFiles.every(name => name.startsWith('src/') || /^tests\/.+\.test\.mjs$/.test(name)) && row.deletedFiles.length === 0;
    const publicAfter = await command(directory, ['--test', 'tests/public.test.mjs']);
    const testFiles = finalTree.map(([name]) => name).filter(name => /^tests\/.+\.test\.mjs$/.test(name));
    const allPublic = await command(directory, ['--test', ...testFiles]);
    const hiddenAfter = await acceptance(directory, fixture);
    Object.assign(row, { publicPassed: publicAfter.passed, addedTestsPassed: allPublic.passed, hiddenPassed: hiddenAfter.passed,
      hiddenCompleted: hiddenAfter.completed, hiddenOutputSha256: hiddenAfter.outputSha256, failureDiagnostic: hiddenAfter.passed ? null : hiddenAfter.diagnostic });
    row.functionalPass = publicAfter.passed && hiddenAfter.passed && row.protectedFilesUnchanged && row.allowedChanges;
    row.accepted = row.functionalPass && allPublic.passed && result.status === 'completed' && result.validationPassed;
    console.log(`${fixture.id}: ${row.accepted ? 'PASS' : 'FAIL'} · ${row.usage?.totalTokens ?? 'unknown'} provider tokens`);
    if (!complete) { stopReason = 'unknown_usage_no_retry'; await checkpoint(); break; }
  } catch (error) { row.status = 'harness_error'; row.error = error.message.replaceAll(directory, '<workspace>').slice(0, 400); stopReason = 'harness_error_reserved_task_cap'; await checkpoint(); break; }
  await checkpoint();
}
const after = await sourceIdentity();
plan.sourceUnchangedDuringRun = after === sourceSha256;
if (!plan.sourceUnchangedDuringRun) stopReason = 'source_changed_during_run';
await checkpoint();
console.log(JSON.stringify({ runId, mode, fixtures: rows.length, attempted: rows.filter(x => x.agentStarted).length,
  accepted: rows.filter(x => x.accepted).length, stopReason, consumedUsd: consumed }));
if (stopReason) process.exitCode = 1;
