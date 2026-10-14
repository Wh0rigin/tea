import { mkdir, mkdtemp, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { codingTasks } from '../benchmarks/tasks/coding-ability.mjs';
import { loadCliConfig, assertBenchmarkConfig } from '../src/config.mjs';
import { resolveUserEnvironment } from '../src/user-config.mjs';
import { startComparisonGateway } from '../src/comparison-gateway.mjs';
import { createPiComparisonSession } from '../src/comparison-pi-rpc.mjs';
import { createComparisonTurnAudit } from '../src/comparison-turn-audit.mjs';
import { createPackageScriptReader } from '../src/comparison-source-capture.mjs';
import { assertNoAncestorInstructions } from '../src/comparison-fixtures.mjs';
import { writeTree, command, acceptance, snapshot } from './coding-ability-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = data => createHash('sha256').update(data).digest('hex');
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const pair = /^--(mode|run-id)=(.+)$/.exec(arg); if (!pair) throw new Error('Expected --mode=prepare|live and --run-id=ID'); return [pair[1], pair[2]];
}));
const mode = options.mode || 'prepare', runId = options['run-id'] || `coding-pi-${Date.now()}`;
if (!['prepare','live'].includes(mode) || !/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid mode/run ID');
const output = path.join(root, 'benchmarks/results', runId);
await mkdir(path.dirname(output), { recursive: true }); await mkdir(output);
const baseline = JSON.parse(await readFile(path.join(root, 'benchmarks/reports/coding-ability-glm-20261014-v1/summary.json'), 'utf8'));
const baselinePlan = JSON.parse(await readFile(path.join(root, 'benchmarks/reports/coding-ability-glm-20261014-v1/frozen-plan.json'), 'utf8'));
if (hash(await readFile(path.join(root, 'benchmarks/tasks/coding-ability.mjs'))) !== baseline.manifestSha256) throw new Error('Fixtures changed since recorded TEA run');
const piRoot = path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent');
const piCli = path.join(piRoot, 'dist/bundle/cli.js');
const piPackage = JSON.parse(await readFile(path.join(piRoot, 'package.json'), 'utf8'));
const bundleNames = (await readdir(path.join(piRoot, 'dist/bundle'))).filter(x => x.endsWith('.js')).sort();
const piIdentity = async () => hash(JSON.stringify(await Promise.all(bundleNames.map(async name => [name, hash(await readFile(path.join(piRoot, 'dist/bundle', name)))]))));
const piSha256 = await piIdentity();
const env = mode === 'live' ? resolveUserEnvironment() : {};
const config = { ...loadCliConfig({ maxCostUsd: 6, maxRequestInputBytes: baseline.maxRequestInputBytes,
  contextWindowTokens: baseline.contextWindowTokens, contextReserveTokens: baseline.contextReserveTokens }, {
  ...env, ANTHROPIC_MODEL: baseline.model, TEA_THINKING_MODE: baseline.thinkingMode, TEA_REASONING_EFFORT: baseline.effort,
  TEA_MAX_OUTPUT_TOKENS: String(baseline.maxOutputTokens), TEA_REQUEST_TIMEOUT_MS: String(baseline.timeoutMs),
  TEA_INPUT_PRICE_USD_PER_MTOK: '0.8', TEA_OUTPUT_PRICE_USD_PER_MTOK: '2.8', TEA_STREAM: '1',
}), comparisonMaxRequests: 32, piAutoCompaction: true };
if (mode === 'live') assertBenchmarkConfig(config);
const workspaceRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tea-coding-pi-')));
await assertNoAncestorInstructions(path.join(workspaceRoot, 'probe'));
const report = { schema: 1, runId, mode, createdAt: new Date().toISOString(), source: 'recorded TEA vs new native Pi; one attempt per task',
  baselineRunId: baseline.runId, baselineSummarySha256: hash(await readFile(path.join(root, 'benchmarks/reports/coding-ability-glm-20261014-v1/summary.json'))),
  manifestSha256: baseline.manifestSha256, pi: { version: piPackage.version, package: piPackage.name, bundleSha256: piSha256 },
  common: { model: config.model, thinkingMode: config.thinkingMode, thinkingBudget: Math.min(config.maxOutputTokens-1,8000),
    effort: config.effort, maxOutputTokens: config.maxOutputTokens, contextWindowTokens: config.contextWindowTokens,
    maxRequestInputBytes: config.maxRequestInputTokens, taskTimeoutMs: baseline.taskTimeoutMs, requestTimeoutMs: config.timeoutMs,
    maxToolCalls: baseline.maxToolCalls, taskCapUsd: 1, suiteCapUsd: 6, maxRequests: 32,
    inputRateUsdPerMillion: .8, outputRateUsdPerMillion: 2.8, endpointSha256: hash(config.baseUrl) },
  differences: ['Native prompts, tools and compaction policies retained', 'TEA unlisted commands require approval; native Pi runs its PowerShell tool',
    'Recorded TEA and Pi are sequential cohorts; no timing speedup claim', 'Pi retries/extensions/skills disabled; automatic compaction enabled',
    'Same configured capacity, not a verified provider context limit', 'RPC stops Pi on the 25th tool-start event; boundary may interrupt an in-flight operation'],
  rows: [], requests: [], stopReason: null, complete: false };
const save = () => writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2));
await save();
let gateway;
try {
  if (mode === 'live') gateway = await startComparisonGateway(config, { perCaseBudget: 1, onRecord: async row => { report.requests.push(row); await save(); } });
  for (const fixture of codingTasks) {
    if (gateway?.halted) { report.stopReason = 'gateway_halted_unknown_usage_or_limit'; break; }
    if (await piIdentity() !== piSha256) throw new Error('Pi bundle changed during run');
    const identity = baselinePlan.tasks.find(x => x.id === fixture.id);
    if (!identity || hash(fixture.prompt) !== identity.promptSha256 || hash(fixture.acceptance) !== identity.acceptanceSha256 || hash(JSON.stringify(fixture.files)) !== identity.initialTreeSha256) throw new Error('Unmatched task identity');
    const workspace = path.join(workspaceRoot, fixture.id); await writeTree(workspace, fixture.files);
    const initial = await snapshot(workspace);
    const publicBefore = await command(workspace, ['--test', 'tests/public.test.mjs']);
    const hiddenBefore = await acceptance(workspace, fixture);
    const row = { id: fixture.id, level: fixture.level, title: fixture.title, matchedInitialTreeSha256: identity.initialTreeSha256,
      status: 'prepared', running: false, agentStarted: false, accepted: false, baselinePublicPassed: publicBefore.passed,
      baselineHiddenPassed: hiddenBefore.passed, baselineHiddenCompleted: hiddenBefore.completed, usage: null };
    report.rows.push(row); await save();
    if (!publicBefore.passed || hiddenBefore.passed || !hiddenBefore.completed) throw new Error('Invalid comparison initial fixture');
    console.log(`${fixture.id}: matching fixture ready`);
    if (mode === 'prepare') continue;
    const captureSources = () => {
      const entries = [];
      const visit = (directory, prefix) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const filename = path.join(directory, entry.name), relative = `${prefix}/${entry.name}`;
          if (entry.isSymbolicLink()) throw new Error('Symlink source');
          if (entry.isDirectory()) visit(filename, relative);
          else { if (lstatSync(filename).size > 160000) throw new Error('Oversized source'); entries.push([relative, hash(readFileSync(filename))]); }
        }
      };
      try { visit(path.join(workspace,'src'),'src'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return Object.fromEntries(entries.sort(([a],[b]) => a.localeCompare(b)));
    };
    const audit = createComparisonTurnAudit({ agent: 'pi', workspace, captureSources, getPackageScripts: createPackageScriptReader(workspace) });
    row.agentStarted = true; row.running = true; row.status = 'running'; await save();
    let session, tools = 0, started = Date.now();
    try {
      session = await createPiComparisonSession({ piCli, workspace, agentDir: path.join(output, 'pi-config', fixture.id),
        baseUrl: `${gateway.baseUrl}/pi/${fixture.id}`, token: gateway.token, config, timeoutMs: baseline.taskTimeoutMs });
      const result = await session.prompt(fixture.prompt, { onEvent: event => {
        audit.observe(event);
        if (event.type === 'tool_execution_start' && ++tools > baseline.maxToolCalls) throw new Error('Tool count guard reached');
        if (event.type === 'tool_execution_end') console.log(`${fixture.id}: ${event.toolName} ${event.isError ? 'error' : 'done'}`);
      } });
      row.status = result.status; row.error = result.errorMessage; row.compactions = result.compactions;
    } catch (error) { row.status = 'failed'; row.error = String(error.message).replaceAll(workspace,'<workspace>').slice(0,400); }
    finally { if (session) row.nativeEventSha256 = (await session.close()).stdoutSha256; }
    await gateway.waitForIdle();
    const observed = audit.finish(), events = gateway.forCase(fixture.id,'pi').filter(x => x.submitted);
    row.usageComplete = events.length > 0 && events.every(x => x.complete);
    row.usage = row.usageComplete ? { inputTokens: events.reduce((s,x)=>s+x.inputTokens,0), outputTokens: events.reduce((s,x)=>s+x.outputTokens,0),
      totalTokens: events.reduce((s,x)=>s+x.totalTokens,0), cachedInputTokens: events.reduce((s,x)=>s+(x.usage.cache_read_input_tokens||0),0),
      cacheCreationInputTokens: events.reduce((s,x)=>s+(x.usage.cache_creation_input_tokens||0),0), requests: events.length } : null;
    Object.assign(row, { running: false, elapsedMs: Date.now()-started, toolCalls: tools, validationPassed: observed.validatedAfterEdit,
      validationAttempts: observed.calls.filter(x=>x.relevantValidation).length, toolErrors: observed.calls.filter(x=>!x.success).length,
      nativeAudit: observed, guards: gateway.forCase(fixture.id,'pi').filter(x=>x.guard).map(x=>x.guard) });
    await save();
    const finalTree = await snapshot(workspace), finalMap = new Map(finalTree);
    row.changedFiles = finalTree.filter(([name,value]) => new Map(initial).get(name)!==value).map(([name])=>name);
    row.deletedFiles = initial.filter(([name])=>!finalMap.has(name)).map(([name])=>name);
    row.protectedFilesUnchanged = initial.filter(([name])=>!name.startsWith('src/')).every(([name,value])=>finalMap.get(name)===value);
    row.allowedChanges = row.changedFiles.every(name=>name.startsWith('src/')||/^tests\/.+\.test\.mjs$/.test(name))&&row.deletedFiles.length===0;
    const publicAfter = await command(workspace,['--test','tests/public.test.mjs']);
    const tests = finalTree.map(([name])=>name).filter(name=>/^tests\/.+\.test\.mjs$/.test(name));
    const allPublic = await command(workspace,['--test',...tests]);
    const hiddenAfter = await acceptance(workspace,fixture);
    Object.assign(row,{publicPassed:publicAfter.passed,addedTestsPassed:allPublic.passed,hiddenPassed:hiddenAfter.passed,hiddenCompleted:hiddenAfter.completed,
      hiddenOutputSha256:hiddenAfter.outputSha256,failureDiagnostic:hiddenAfter.passed?null:hiddenAfter.diagnostic});
    row.functionalPass=publicAfter.passed&&hiddenAfter.passed&&row.protectedFilesUnchanged&&row.allowedChanges;
    row.accepted=row.functionalPass&&allPublic.passed&&row.status==='completed'&&row.validationPassed;
    await save();console.log(`${fixture.id}: ${row.accepted?'PASS':'FAIL'} · ${row.usage?.totalTokens??'unknown'} tokens`);
    if (!row.usageComplete) { report.stopReason='unknown_usage_no_retry'; break; }
  }
} finally {
  report.piSourceUnchanged = await piIdentity() === piSha256;
  report.complete=report.rows.length===8&&!report.stopReason&&report.rows.every(x=>!x.running);
  report.accountedUsd=gateway?.accountedUsd??0; report.endedAt=new Date().toISOString(); await save();
  if(gateway)await gateway.close();
}
console.log(JSON.stringify({runId,complete:report.complete,accepted:report.rows.filter(x=>x.accepted).length,attempted:report.rows.filter(x=>x.agentStarted).length}));
if(report.stopReason)process.exitCode=1;
