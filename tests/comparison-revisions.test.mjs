import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { prepareRevisionEngine, revisionPairOptions } from '../src/comparison-revisions.mjs';
import { analyzeRevisionComparison } from '../src/comparison-revision-report.mjs';

const execute = promisify(execFile);
test('revision CLI rejects incomplete controls and nonlocal contract endpoints before work', async () => {
  const script = path.resolve('scripts/compare-contextos-pi.mjs');
  const env = { ...process.env, ANTHROPIC_API_KEY: 'loopback-only-no-real-key', ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: 'https://provider.invalid', TEA_STORE_RAW: '0', TEA_MAX_COST_USD: '1',
    TEA_INPUT_PRICE_USD_PER_MTOK: '.8', TEA_OUTPUT_PRICE_USD_PER_MTOK: '2.8' };
  for (const [args, expected] of [
    [['--baseline-ref', 'HEAD'], /Both --baseline-ref and --candidate-ref/],
    [['--both-auto-gc', 'true'], /Both auto GC requires an exclusive revision comparison/],
    [['--baseline-ref', 'HEAD', '--candidate-ref', 'HEAD', '--both-auto-gc', 'false'], /Both auto GC requires an exclusive revision comparison/],
    [['--baseline-ref', 'HEAD', '--candidate-ref', 'HEAD', '--both-auto-gc', 'true', '--candidate-auto-gc', 'true'], /Both auto GC requires an exclusive revision comparison/],
    [['--baseline-ref', 'HEAD', '--candidate-ref', 'HEAD', '--repeat', '21'], /Invalid experiment controls/],
    [['--baseline-ref', 'HEAD', '--candidate-ref', 'HEAD', '--mode', 'contract'], /Contract mode requires loopback endpoint and dummy credential/],
  ]) {
    await assert.rejects(execute(process.execPath, [script, ...args], { env, windowsHide: true, timeout: 10000 }), error => expected.test(error.stderr));
  }
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-revision-test-')), repository = path.join(root, 'repository');
  await mkdir(path.join(repository, 'src'), { recursive: true });
  const git = async (...args) => (await execute('git', args, { cwd: repository, windowsHide: true })).stdout.trim();
  await git('init', '--quiet'); await writeFile(path.join(repository, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(repository, 'src/tools.mjs'), 'export class WorkspaceTools {}');
  const commit = async value => {
    await writeFile(path.join(repository, 'src/agent.mjs'), `export const runTask=()=>${JSON.stringify(value)};export const createAgentSession=()=>({});`);
    await git('add', '--all'); await git('-c', 'user.name=TEA tests', '-c', 'user.email=tests@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', value);
    return git('rev-parse', 'HEAD');
  };
  return { root, repository, git, commit };
}

test('revision snapshots load exact independent committed engines and detect changed/extra files', async () => {
  const f = await fixture(), a = await f.commit('a'), b = await f.commit('b');
  await writeFile(path.join(f.repository, 'src/agent.mjs'), 'uncommitted invalid code');
  const first = await prepareRevisionEngine({ repository: f.repository, ref: a, directory: path.join(f.root, 'first') });
  const second = await prepareRevisionEngine({ repository: f.repository, ref: b, directory: path.join(f.root, 'second') });
  assert.equal(first.engine.runTask(), 'a'); assert.equal(second.engine.runTask(), 'b');
  assert.notEqual(first.metadata.sourceSha256, second.metadata.sourceSha256);
  assert.equal(await first.verify(), true); assert.equal(await second.verify(), true);
  await writeFile(path.join(f.root, 'first/src/extra.mjs'), 'export const extra=true;'); assert.equal(await first.verify(), false);
  await writeFile(path.join(f.root, 'second/src/agent.mjs'), 'changed'); assert.equal(await second.verify(), false);
});
test('revision references require a complete pair and reject option injection or missing commits', async () => {
  assert.throws(() => revisionPairOptions({ 'baseline-ref': 'HEAD' }), /Both/);
  assert.deepEqual(revisionPairOptions({ 'baseline-ref': 'HEAD', 'candidate-ref': 'HEAD~1' }), { baseline: 'HEAD', candidate: 'HEAD~1' });
  const f = await fixture(); await f.commit('a');
  await assert.rejects(prepareRevisionEngine({ repository: f.repository, ref: '--help', directory: path.join(f.root, 'bad') }), /Invalid/);
  await assert.rejects(prepareRevisionEngine({ repository: f.repository, ref: 'does-not-exist', directory: path.join(f.root, 'missing') }));
});
test('revision extraction refuses Git symlink entries without needing OS symlink privileges', async () => {
  const f = await fixture(); await f.commit('a');
  // execFile has no stdin input option; use an existing regular blob as the link content.
  const existing = await f.git('rev-parse', 'HEAD:src/tools.mjs');
  await f.git('update-index', '--cacheinfo', `120000,${existing},src/agent.mjs`);
  await f.git('-c', 'user.name=TEA tests', '-c', 'user.email=tests@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'symlink');
  await assert.rejects(prepareRevisionEngine({ repository: f.repository, ref: 'HEAD', directory: path.join(f.root, 'blocked') }), /regular/);
});

function sample() {
  const engines = { baseline: { commit: 'a', sourceSha256: 'a-hash', sourceUnchanged: true }, candidate: { commit: 'b', sourceSha256: 'b-hash', sourceUnchanged: true } };
  const controls = { model: 'test', maxTokens: 1200, thinking: { type: 'adaptive' }, outputConfig: { effort: 'low' } };
  const runs = ['baseline', 'candidate'].map(agent => ({ agent, engineCommit: engines[agent].commit, engineSha256: engines[agent].sourceSha256,
    taskId: 'small-one', caseId: 'small-one-r1', initialCommit: 'fixture', initialSha256: 'tree', requests: 1, usageComplete: true,
    inputTokens: agent === 'baseline' ? 100 : 70, outputTokens: 30, totalTokens: agent === 'baseline' ? 130 : 100, accepted: true }));
  return { mode: 'live', usageSource: 'provider-wire', commonProfile: { model: 'test', maxOutputTokens: 1200, thinkingMode: 'adaptive', effort: 'low' },
    sourceUnchanged: true, workspaceContextIsolated: true, engines, repeat: 1, tasks: [{ taskId: 'small-one', scale: 'small', family: 'one', commit: 'fixture', sha256: 'tree' }], runs,
    requests: runs.map(run => ({ ...run, complete: true, submitted: true, normalizedControls: controls })) };
}
test('revision reports compare candidate against parent and retain failed/unknown work', () => {
  const report = sample(); report.runs[1].accepted = false;
  let result = analyzeRevisionComparison(report);
  assert.equal(result.validComparison, true); assert.equal(result.overall.baselineAccepted, 1); assert.equal(result.overall.candidateAccepted, 0);
  assert.ok(result.overall.allPairsTokenReductionPercent > 23); assert.equal(result.overall.bothAcceptedTokenReductionPercent, null);
  report.runs[1].usageComplete = false; report.runs[1].totalTokens = null; report.requests[1].complete = false;
  result = analyzeRevisionComparison(report); assert.equal(result.overall.allPairsTokenReductionPercent, null);
});
test('revision reports withhold ratios after source mismatch or scripted loopback usage', () => {
  for (const mutate of [r => r.engines.candidate.sourceUnchanged = false, r => r.runs[0].engineCommit = 'wrong', r => { r.mode = 'contract'; r.usageSource = 'scripted-loopback'; }]) {
    const r = sample(); mutate(r); assert.equal(analyzeRevisionComparison(r).validComparison, false);
    assert.equal(analyzeRevisionComparison(r).overall.allPairsTokenReductionPercent, null);
  }
});
