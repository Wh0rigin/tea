import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { AnthropicMessagesAdapter as CandidateAdapter } from '../src/model.mjs';
import { PROJECT_ROOT, RESULT_ROOT } from '../src/benchmark.mjs';
import { validateRunId } from '../src/run-id.mjs';

// A loopback protocol contract experiment. This server is not an LLM provider.
// Its synthetic zero usage allows parsing checks only; never publish it as usage.
const runId = process.argv[2] || `request-budget-${Date.now()}`;
validateRunId(runId);
const outputDir = path.join(RESULT_ROOT, runId);
await mkdir(RESULT_ROOT, { recursive: true });
await mkdir(outputDir);
const git = promisify(execFile);
const { stdout: parentCommit } = await git('git', ['rev-parse', 'v2'], { cwd: PROJECT_ROOT, windowsHide: true });
const { stdout: parentModel } = await git('git', ['show', `${parentCommit.trim()}:src/model.mjs`], { cwd: PROJECT_ROOT, windowsHide: true });
const { stdout: parentUsage } = await git('git', ['show', `${parentCommit.trim()}:src/usage.mjs`], { cwd: PROJECT_ROOT, windowsHide: true });
const parentRoot = await mkdtemp(path.join(os.tmpdir(), 'tea-parent-model-'));
let active;
const captured = [];
const server = createServer(async (request, response) => {
  let text = '';
  for await (const chunk of request) text += chunk;
  const body = JSON.parse(text);
  const errors = [];
  if (!Number.isSafeInteger(body.max_tokens) || body.max_tokens <= 0) errors.push('positive integer output');
  if (body.max_tokens > active.config.maxOutputTokens) errors.push('configured output ceiling');
  if (active.maxTokens !== undefined && body.max_tokens !== active.maxTokens) errors.push('explicit override');
  if (body.thinking.type === 'enabled' && (!Number.isSafeInteger(body.thinking.budget_tokens)
    || body.thinking.budget_tokens < 1024 || body.thinking.budget_tokens >= body.max_tokens)) errors.push('manual thinking budget');
  captured.push({ arm: active.arm, caseId: active.id, maxTokens: body.max_tokens,
    thinking: body.thinking, effort: body.output_config.effort, contractPassed: errors.length === 0, errors });
  response.writeHead(errors.length ? 400 : 200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(errors.length ? { error: { message: errors.join(', ') } }
    : { content: [{ type: 'text', text: 'Local contract accepted.' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }));
});
const sha256 = text => createHash('sha256').update(text).digest('hex');
try {
  await writeFile(path.join(parentRoot, 'model.mjs'), parentModel);
  await writeFile(path.join(parentRoot, 'usage.mjs'), parentUsage);
  const { AnthropicMessagesAdapter: ParentAdapter } = await import(pathToFileURL(path.join(parentRoot, 'model.mjs')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseConfig = { apiKey: 'test-only-inert', baseUrl: `http://127.0.0.1:${server.address().port}`,
    model: 'local-contract-only', apiVersion: '2023-06-01', maxOutputTokens: 1200, maxRequestInputTokens: 20000,
    maxCostUsd: 1, inputRateUsdPerMillion: 1, outputRateUsdPerMillion: 1, effort: 'low', thinkingMode: 'adaptive', stream: false, timeoutMs: 3000 };
  const cases = [
    { id: 'adaptive-default', valid: true },
    { id: 'manual-default', valid: true, config: { thinkingMode: 'enabled' } },
    { id: 'manual-lower-cap', valid: true, config: { thinkingMode: 'enabled', maxOutputTokens: 12000 }, maxTokens: 1100 },
    { id: 'manual-minimum-cap', valid: true, config: { thinkingMode: 'enabled', maxOutputTokens: 12000 }, maxTokens: 1025 },
    { id: 'manual-too-small', valid: false, config: { thinkingMode: 'enabled' }, maxTokens: 1024 },
    { id: 'explicit-zero', valid: false, maxTokens: 0 },
    { id: 'over-configured-cap', valid: false, maxTokens: 12000 },
    { id: 'fractional-cap', valid: false, maxTokens: 1100.5 },
    { id: 'budget-block-negative-control', valid: false, config: { maxCostUsd: 0.0001 } },
  ];
  const outcomes = [];
  for (const [arm, Adapter] of [['parent', ParentAdapter], ['candidate', CandidateAdapter]]) {
    for (const item of cases) {
      active = { ...item, arm, config: { ...baseConfig, ...item.config } };
      const countBefore = captured.length;
      let status, error;
      try {
        await new Adapter(active.config).complete({ system: 'Local test only.', messages: [{ role: 'user', content: 'Check request bounds.' }], tools: [],
          ...(item.maxTokens === undefined ? {} : { maxTokens: item.maxTokens }) });
        status = 'accepted';
      } catch (failure) { status = captured.length === countBefore ? 'preflight-blocked' : 'http-rejected'; error = failure.message; }
      const row = { arm, caseId: item.id, expectedValid: item.valid, status, transmitted: captured.length !== countBefore, ...(error ? { error } : {}) };
      outcomes.push(row);
      if (arm === 'candidate') assert.equal(status, item.valid ? 'accepted' : 'preflight-blocked', `${item.id} contract regression`);
    }
  }
  const candidateModel = await readFile(path.join(PROJECT_ROOT, 'src', 'model.mjs'), 'utf8');
  const run = { runId, mode: 'loopback-request-contract', parentCommit: parentCommit.trim(), parentModelSha256: sha256(parentModel), candidateModelSha256: sha256(candidateModel),
    caseCount: cases.length, gateEligible: false, providerActualTokens: null, modelTaskSuccessRate: null, billedUsd: null,
    metric: 'invalid local HTTP contract submissions, not provider tokens; responses contain synthetic usage counters',
    parentInvalidSubmissions: captured.filter(row => row.arm === 'parent' && !row.contractPassed).length,
    candidateInvalidSubmissions: captured.filter(row => row.arm === 'candidate' && !row.contractPassed).length,
    candidateExpectedOutcomeChecksPassed: true, outcomes, captured };
  await writeFile(path.join(outputDir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  console.log(JSON.stringify({ runId, outputDir, caseCount: run.caseCount, parentInvalidSubmissions: run.parentInvalidSubmissions,
    candidateInvalidSubmissions: run.candidateInvalidSubmissions, candidateExpectedOutcomeChecksPassed: true, providerActualTokens: null, gateEligible: false }, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  // Verify the exact mkdtemp target before recursive deletion on Windows.
  assert.equal(path.dirname(path.resolve(parentRoot)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(parentRoot).startsWith('tea-parent-model-'));
  await rm(parentRoot, { recursive: true, force: true });
}
