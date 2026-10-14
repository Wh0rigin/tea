import { mkdir, mkdtemp, readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, assertLiveConfig } from '../src/config.mjs';
import { runTask, createAgentSession } from '../src/agent.mjs';
import { WorkspaceTools, redactText } from '../src/tools.mjs';
import { validateRunId } from '../src/run-id.mjs';
import { taskDefinitions, prepareFixture, cloneFixture, treeFingerprint, assertNoAncestorInstructions } from '../src/comparison-fixtures.mjs';
import { contextosFixture, contextosAcceptance, CONTEXTOS_CASES } from '../src/contextos-benchmark.mjs';
import { startComparisonGateway } from '../src/comparison-gateway.mjs';
import { createPiComparisonSession } from '../src/comparison-pi-rpc.mjs';
import { createComparisonTurnAudit } from '../src/comparison-turn-audit.mjs';
import { analyzeComparison, writeComparisonReport } from '../src/comparison-report.mjs';
import { prepareRevisionEngine, revisionPairOptions } from '../src/comparison-revisions.mjs';
import { analyzeRevisionComparison, writeRevisionComparisonReport } from '../src/comparison-revision-report.mjs';
import { acceptanceDimensions, shouldStopComparisonTurn } from '../src/comparison-validation.mjs';
import { createSourceCapture, createPackageScriptReader } from '../src/comparison-source-capture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile), hash = value => createHash('sha256').update(value).digest('hex');
const options = {};
for (let n = 2; n < process.argv.length; n++) {
  const key = process.argv[n];
  if (!['--mode', '--run-id', '--repeat', '--max-cost-usd', '--pi-package', '--timeout-ms', '--groups', '--scales', '--baseline-ref', '--candidate-ref', '--candidate-auto-gc', '--both-auto-gc'].includes(key) || !process.argv[n + 1]) throw new Error(`Invalid option ${key}`);
  options[key.slice(2)] = process.argv[++n];
}
const mode = options.mode || 'prepare', repeat = Number(options.repeat || 3), timeoutMs = Number(options['timeout-ms'] || 180000);
if (!['prepare', 'live', 'contract'].includes(mode) || !Number.isSafeInteger(repeat) || repeat < 3 || repeat > 20 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('Invalid experiment controls');
const scales = options.scales?.split(',') || ['small', 'medium', 'large'];
const groups = options.groups?.split(',') || ['fresh', 'long-session'];
if (!scales.length || new Set(scales).size !== scales.length || scales.some(scale => !['small', 'medium', 'large'].includes(scale)) || !groups.length || new Set(groups).size !== groups.length || groups.some(group => !['fresh', 'long-session'].includes(group))) throw new Error('Invalid task selection');
const runId = validateRunId(options['run-id'] || `contextos-pi-${Date.now()}`);
const revisions = revisionPairOptions(options);
if (options['candidate-auto-gc'] && (!revisions || options['candidate-auto-gc'] !== 'true')) throw new Error('Candidate auto GC requires a revision comparison');
if (options['both-auto-gc'] && (!revisions || options['both-auto-gc'] !== 'true' || options['candidate-auto-gc'])) throw new Error('Both auto GC requires an exclusive revision comparison');
const output = path.join(ROOT, 'benchmarks', 'results', runId);
const piRoot = path.resolve(options['pi-package'] || path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent'));
const piPackage = revisions ? null : JSON.parse(await readFile(path.join(piRoot, 'package.json'), 'utf8')), piCli = revisions ? null : path.join(piRoot, 'dist', 'bundle', 'cli.js');
const config = { ...loadConfig({ maxCostUsd: options['max-cost-usd'], memoryPolicy: 'contextos', contextosTargetBytes: 32000, compaction: 'off', contextStrategy: 'v1' }),
  comparisonMaxRequests: 100, piAutoCompaction: true, maxRequestInputTokens: 160000 };
if (options['both-auto-gc']) Object.assign(config, { compaction: 'auto', memoryGc: 'auto' });
if (config.storeRaw) throw new Error('Raw API storage must remain off');
if (mode !== 'prepare') assertLiveConfig(config);
if (mode === 'contract') {
  const endpoint = new URL(config.baseUrl);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || config.apiKey !== 'loopback-only-no-real-key') throw new Error('Contract mode requires loopback endpoint and dummy credential');
}
const perCaseBudget = 1.4;
await mkdir(path.dirname(output), { recursive: true }); await mkdir(output);
const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'tea-contextos-pi-'));
await assertNoAncestorInstructions(path.join(workspaceRoot, 'probe'));
const snapshot = async () => {
  const chunks = [];
  for (const folder of ['src', 'scripts']) for (const name of (await readdir(path.join(ROOT, folder))).filter(name => name.endsWith('.mjs')).sort()) chunks.push(`${folder}/${name}\0`, await readFile(path.join(ROOT, folder, name)), '\0');
  return hash(Buffer.concat(chunks.map(value => Buffer.isBuffer(value) ? value : Buffer.from(value))));
};
const sourceHash = await snapshot();
const report = { schemaVersion: 3, acceptanceVersion: 'native-positive-validation-v6', stoppingPolicy: 'continue-completed-turns-grade-requirements', comparisonKind: revisions ? 'tea-revisions' : 'tea-pi', mode, runId, startedAt: new Date().toISOString(), usageSource: mode === 'live' ? 'provider-wire' : mode === 'contract' ? 'scripted-loopback' : 'none', paidProviderRequests: 0,
  benchmarkKind: 'Self-authored JavaScript fixtures: nine fresh coding tasks at three sizes plus one empty-start 30-inspection/repair workflow; three repetitions; not production holdout.',
  teaSourceSha256: sourceHash, teaSourceCommit: (await execute('git', ['rev-parse', 'HEAD'], { cwd: ROOT, windowsHide: true })).stdout.trim(),
  pi: revisions ? null : { name: piPackage.name, version: piPackage.version, cliSha256: hash(await readFile(piCli)) },
  commonProfile: { model: config.model, thinkingMode: config.thinkingMode, effort: config.effort, maxOutputTokens: config.maxOutputTokens,
    maxRequestInputBound: config.maxRequestInputTokens, totalBudgetUsd: mode !== 'prepare' ? config.maxCostUsd : null,
    inputRateUsdPerMillion: config.inputRateUsdPerMillion ?? null, outputRateUsdPerMillion: config.outputRateUsdPerMillion ?? null,
    maxRequestsPerAgentTask: config.comparisonMaxRequests, api: 'anthropic-messages', apiVersion: config.apiVersion,
    endpointSha256: hash(config.baseUrl), rateBasis: 'User-supplied conservative rates; not invoice', turnTimeoutMs: timeoutMs },
  teaProfile: { memoryPolicy: config.memoryPolicy, contextosTargetBytes: config.contextosTargetBytes, contextStrategy: config.contextStrategy, compaction: config.compaction, maxToolCallsPerTurn: config.maxToolCalls,
    requestedCapabilityFeedback: Boolean(config.capabilityFeedback) },
  piProfile: { nativeRpc: true, autoCompaction: true, contextWindow: 200000, automaticRetry: false, cacheWarming: false, persistedSession: false, extensions: false, skills: false },
  profileNote: 'Gateway normalizes model/thinking/effort/output, preserves native prompts/tools and cache directives. Pi native auto-compaction is enabled; TEA uses deterministic ContextOS and semantic compaction off. Sessions start empty. No scripted seed history. Native tool limits differ; shared 100-request/1.4 USD per-run and configured suite guard apply.',
  perAgentTaskBudgetUsd: perCaseBudget, workspaceContextIsolated: true, workspaceRoot, tasks: [], runs: [], requests: [], repeat, complete: false };
const save = () => writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
const definitions = [];
const engines = {};
if (revisions) {
  for (const role of ['baseline', 'candidate']) engines[role] = await prepareRevisionEngine({ repository: ROOT, ref: revisions[role], directory: path.join(workspaceRoot, `${role}-engine`) });
  report.engines = Object.fromEntries(Object.entries(engines).map(([role, value]) => [role, { ...value.metadata, sourceUnchanged: false }]));
  report.profileNote = 'Native TEA revisions loaded from committed snapshots; common model, controls, budgets, fixtures and acceptance. No Pi dependency. Frozen engine and harness source hashes are checked separately. All attempted work counts.';
  report.piProfile = null;
}
const roles = revisions ? ['baseline', 'candidate'] : ['tea', 'pi'];
let gateway;
try {
  for (const task of groups.includes('fresh') ? taskDefinitions().filter(task => scales.includes(task.scale)) : []) {
    const definition = { ...task, allowed: [task.entry], validation: [process.execPath, ['--test', 'tests/public.test.mjs']] };
    const identity = await prepareFixture(path.join(output, 'bases', definition.taskId), definition);
    definitions.push({ definition, paths: [], identity, group: 'fresh' });
  }
  if (groups.includes('long-session')) {
  const long = await contextosFixture(path.join(output, 'bases', 'long-30'), CONTEXTOS_CASES.find(item => item.id === 'long-30'));
  long.definition = { ...long.definition, taskId: 'long-30', scale: 'long-session' }; long.group = 'long-session'; definitions.push(long);
  }
  report.taskSelection = { scales, groups };
  report.benchmarkKind = `Self-authored JavaScript fixtures; selected groups ${groups.join(',')}, sizes ${scales.join(',')}; ${definitions.length} tasks, ${repeat} repetitions; not production holdout.`;
  for (const fixture of definitions) {
    const { definition, identity, paths, group } = fixture;
    const initial = await contextosAcceptance(path.join(output, 'bases', definition.taskId), definition, path.join(workspaceRoot, 'initial-acceptance', definition.taskId));
    if (!initial.publicPassed || initial.hiddenPassed || !initial.hiddenCompleted || !initial.scopePassed) throw new Error(`Invalid baseline ${definition.taskId}`);
    const prompts = [...paths.slice(0, group === 'long-session' ? 30 : 0).map(file => `Read ${file} completely using your native file-reading tool. Read-only inspection: do not edit or execute commands/tests. Reply in at most 12 words.`), definition.prompt];
    fixture.prompts = prompts;
    report.tasks.push({ taskId: definition.taskId, scale: definition.scale, family: definition.name, group, entry: definition.entry, ...identity,
      prompts, initialPublicPassed: true, initialHiddenPassed: false, plannedTurns: prompts.length });
    console.log(`Prepared ${definition.taskId}: ${identity.fileCount} files; ${prompts.length} turns`);
  }
  await save();
  if (mode !== 'prepare') {
    gateway = await startComparisonGateway(config, { perCaseBudget, onRecord: async row => {
      if (mode === 'live' && row.submitted) report.paidProviderRequests += 1;
      report.requests.push(row); await appendFile(path.join(output, 'wire-usage.jsonl'), JSON.stringify(row) + '\n'); await save();
    } });
    outer: for (let repetition = 1; repetition <= repeat; repetition++) for (let index = 0; index < definitions.length; index++) {
      const fixture = definitions[index], { definition, identity, paths, group, prompts } = fixture;
      const caseId = `${definition.taskId}-r${repetition}`;
      for (const agent of (index + repetition) % 2 ? roles : [...roles].reverse()) {
        if (gateway.halted) break outer;
        if (await snapshot() !== sourceHash || piCli && hash(await readFile(piCli)) !== report.pi.cliSha256) throw new Error('Agent source changed during comparison');
        if (revisions && !await engines[agent].verify()) throw new Error('Frozen revision source changed during comparison');
        const workspace = path.join(workspaceRoot, caseId, agent);
        await mkdir(path.dirname(workspace), { recursive: true }); await cloneFixture(path.join(output, 'bases', definition.taskId), workspace);
        await assertNoAncestorInstructions(workspace);
        const fingerprint = await treeFingerprint(workspace);
        if (fingerprint.sha256 !== identity.sha256) throw new Error('Initial workspaces differ');
        const started = Date.now(), baseUrl = `${gateway.baseUrl}/${agent}/${caseId}`;
        const turnConfig = { ...config, workspace, sessionId: 'comparison', apiKey: gateway.token, baseUrl, maxCostUsd: perCaseBudget, storeRaw: false };
        if (options['candidate-auto-gc']) Object.assign(turnConfig, { compaction: agent === 'candidate' ? 'auto' : 'off', memoryGc: agent === 'candidate' ? 'auto' : 'off' });
        const teaEngine = revisions ? engines[agent].engine : { runTask, createAgentSession };
        const ToolClass = revisions ? engines[agent].tools.WorkspaceTools : WorkspaceTools;
        const expectedTools = new ToolClass({ workspace, deduplicateReads: false }); await expectedTools.init();
        const captureSources = createSourceCapture(workspace, [...definition.allowed, 'package.json', 'tests/public.test.mjs']);
        const getPackageScripts = createPackageScriptReader(workspace);
        const run = { taskId: definition.taskId, caseId, agent, repetition, scale: definition.scale, group, initialSha256: fingerprint.sha256,
          initialCommit: identity.commit, turns: [], running: true, status: 'failed', accepted: false, recoveryCalls: 0, compactions: 0, toolCalls: 0 };
        if (revisions) Object.assign(run, { engineCommit: engines[agent].metadata.commit, engineSha256: engines[agent].metadata.sourceSha256, compactionPolicy: turnConfig.compaction, memoryGcPolicy: turnConfig.memoryGc ?? null });
        report.runs.push(run); await save();
        let session, piSession;
        console.log(`Start ${caseId}/${agent}`);
        try {
          if (agent !== 'pi') session = teaEngine.createAgentSession(turnConfig);
          else piSession = await createPiComparisonSession({ piCli, workspace, agentDir: path.join(output, 'pi-config', caseId), baseUrl, token: gateway.token, config, timeoutMs });
          for (let phase = 0; phase < prompts.length; phase++) {
            const requiredPath = group === 'long-session' && phase < 30 ? paths[phase] : null;
            const expectedOutput = requiredPath ? agent !== 'pi' ? await expectedTools.readFile({ path: requiredPath }) : await readFile(path.join(workspace, requiredPath), 'utf8') : null;
            const audit = createComparisonTurnAudit({ agent, workspace, requiredPath, expectedOutput, readOnly: Boolean(requiredPath), captureSources, getPackageScripts });
            const before = gateway.forCase(caseId, agent).length, turnStarted = Date.now();
            const onEvent = event => { audit.observe(event); if (event.type === 'tool_start' && ['recall_context', 'search_history'].includes(event.name)) run.recoveryCalls++; };
            const result = agent !== 'pi' ? await teaEngine.runTask(prompts[phase], { ...turnConfig, runId: `phase-${phase + 1}` }, { session, onEvent, signal: AbortSignal.timeout(timeoutMs) })
              : await piSession.prompt(prompts[phase], { onEvent });
            await gateway.waitForIdle();
            const requirements = audit.finish();
            if (requiredPath) requirements.unchangedWorkspace = (await treeFingerprint(workspace)).sha256 === identity.sha256;
            requirements.passed &&= !requiredPath || requirements.unchangedWorkspace;
            const rows = gateway.forCase(caseId, agent).slice(before).filter(row => row.submitted);
            run.turns.push({ phase: phase + 1, status: result.status, requirements, elapsedMs: Date.now() - turnStarted,
              requests: rows.length, totalTokens: rows.length && rows.every(row => row.complete) ? rows.reduce((sum, row) => sum + row.totalTokens, 0) : null,
              nativeValidationPassed: agent !== 'pi' ? result.validationPassed : requirements.validatedAfterEdit,
              ledgerIntegrity: agent !== 'pi' ? result.summary.ledgerIntegrity : null,
              context: session?.memoryDiagnostics ? { fullWireBytes: session.memoryDiagnostics.fullWireBytes, sentWireBytes: session.memoryDiagnostics.sentWireBytes, evictedUnits: session.memoryDiagnostics.evictedUnits } : null });
            run.toolCalls += result.toolCalls; run.compactions = session?.compactionCount ?? run.compactions + (result.compactions || 0);
            await save();
            if (phase % 5 === 4 || phase === prompts.length - 1) console.log(`  ${caseId}/${agent}: ${phase + 1}/${prompts.length} turns`);
            if (shouldStopComparisonTurn({ status: result.status, requirements, requiredPath })) { run.error = result.errorMessage || 'Native turn incomplete or protocol failure'; break; }
          }
          if (!run.error && run.turns.length === prompts.length && run.turns.every(turn => turn.status === 'completed')) run.status = 'completed';
        } catch (error) { run.error = redactText(String(error.message)).replaceAll(workspace, '[WORKSPACE]').slice(0, 1000); }
        finally { if (piSession) Object.assign(run, await piSession.close()); }
        await gateway.waitForIdle();
        const evaluation = await contextosAcceptance(workspace, definition, path.join(workspaceRoot, 'acceptance', caseId, agent));
        evaluation.nativeValidationPassed = Boolean(run.turns.at(-1)?.nativeValidationPassed && run.turns.at(-1)?.requirements.validatedAfterEdit);
        evaluation.readRequirementsPassed = run.turns.length === prompts.length && run.turns.every(turn => turn.requirements.passed);
        const rows = gateway.forCase(caseId, agent), submitted = rows.filter(row => row.submitted), known = submitted.length > 0 && submitted.every(row => row.complete);
        const quality = acceptanceDimensions({ evaluation, turns: run.turns, plannedTurns: prompts.length, status: run.status, usageComplete: known });
        Object.assign(run, { running: false, accepted: quality.accepted, qualityDimensions: quality.dimensions,
          acceptance: evaluation, elapsedMs: Date.now() - started, requests: submitted.length, usageComplete: known,
          totalTokens: known ? submitted.reduce((sum, row) => sum + row.totalTokens, 0) : null,
          inputTokens: known ? submitted.reduce((sum, row) => sum + row.inputTokens, 0) : null,
          outputTokens: known ? submitted.reduce((sum, row) => sum + row.outputTokens, 0) : null,
          reportedTokenLowerBound: submitted.reduce((sum, row) => sum + (row.totalTokens ?? row.reportedTokenLowerBound ?? 0), 0),
          accountedUsd: submitted.reduce((sum, row) => sum + (row.accountedUsd || 0), 0), guards: rows.filter(row => row.guard).map(row => row.guard) });
        await save();
        console.log(`Finish ${caseId}/${agent}: accepted=${run.accepted}, tokens=${run.totalTokens ?? 'unknown'}, $${run.accountedUsd.toFixed(5)}`);
      }
    }
  }
  report.complete = mode === 'prepare' || report.runs.length === definitions.length * repeat * 2 && !gateway.halted;
  report.accountedUsd = gateway?.accountedUsd ?? 0; report.haltedForUnknownUsageOrLimit = gateway?.halted ?? false;
  report.paidProviderRequests = mode === 'live' ? report.requests.filter(row => row.submitted).length : 0;
  report.endedAt = new Date().toISOString(); report.teaSourceAfterSha256 = await snapshot(); report.sourceUnchanged = sourceHash === report.teaSourceAfterSha256;
  report.piSourceUnchanged = revisions ? null : hash(await readFile(piCli)) === report.pi.cliSha256;
  if (revisions) for (const role of roles) report.engines[role].sourceUnchanged = await engines[role].verify();
  report.analysis = revisions ? analyzeRevisionComparison(report) : analyzeComparison(report); await save();
  if (revisions) await writeRevisionComparisonReport(report, output); else await writeComparisonReport(report, output);
  console.log(`Saved ${output}; complete=${report.complete}; $${report.accountedUsd.toFixed(6)}`);
} catch (error) { report.error = redactText(String(error.message)); await save(); throw error; }
finally { if (gateway) await gateway.close(); }
