import assert from 'node:assert/strict';
import {readFile, writeFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {resolveUserEnvironment} from '../src/user-config.mjs';
import {loadCliConfig} from '../src/config.mjs';
import {AnthropicMessagesAdapter, buildMessagesRequest} from '../src/model.mjs';
import {TokenLedger} from '../src/ledger.mjs';

// This one-completion probe checks parameter acceptance, not 128K generation.
// The separate frozen DeepSWE schedule owns all coding-quality measurements.
const root = path.resolve('.tea/evidence-stage2-128k');
const protocol = JSON.parse(await readFile(path.join(root, 'protocol.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const live = process.argv.includes('--live');
const config = loadCliConfig({workspace: root, runId: '128k-output-compatibility-probe'}, {
  ...(live ? resolveUserEnvironment() : {ANTHROPIC_API_KEY: 'offline-only'}),
  ANTHROPIC_MODEL: 'glm-5.3-flash', TEA_MAX_OUTPUT_TOKENS: '131072',
  TEA_THINKING_MODE: 'enabled', TEA_REASONING_EFFORT: 'low', TEA_STREAM: '1',
  TEA_CONTEXT_WINDOW_TOKENS: '216000', TEA_MAX_REQUEST_INPUT_BYTES: '65536',
  TEA_REQUEST_TIMEOUT_MS: '900000', TEA_MAX_COST_USD: '1',
  TEA_INPUT_PRICE_USD_PER_MTOK: '0.8', TEA_OUTPUT_PRICE_USD_PER_MTOK: '2.8',
});
const request = {system: 'Reply with exactly READY. No tools or explanation.',
  messages: [{role: 'user', content: 'Return READY.'}]};
const body = buildMessagesRequest(config, request);
assert.equal(body.max_tokens, protocol.maxOutputTokens);
assert.deepEqual(body.thinking, {type: 'enabled', budget_tokens: 8000});
assert.equal(body.stream, true);
assert.equal(body.output_config.effort, 'low');
assert.equal(protocol.probeMaxCostUsd, config.maxCostUsd);
assert.equal(protocol.probeScriptSha256,
  hash((await readFile(fileURLToPath(import.meta.url), 'utf8')).replaceAll('\r\n', '\n')));
if (!live) {
  console.log('128K probe preflight passed; zero provider calls. --live submits one paid completion.');
  process.exit(0);
}
const output = path.join(root, 'provider-probe.json');
try {await access(output); throw new Error('Refusing to overwrite provider probe');}
catch (error) {if (error.code !== 'ENOENT') throw error;}
const report = {status: 'running', accepted: false,
  protocolSha256: hash(await readFile(path.join(root, 'protocol.json'))),
  model: config.model, maxOutputTokens: config.maxOutputTokens,
  thinkingBudgetTokens: body.thinking.budget_tokens,
  scope: 'One short streaming response checks parameter acceptance; it does not prove 128K-length generation or coding quality.'};
await writeFile(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
const ledger = new TokenLedger({workspace: root, runId: config.runId, model: config.model});
await ledger.init({runType: 'output-capability-probe', usageSource: 'provider'});
const adapter = new AnthropicMessagesAdapter(config);
adapter.onRequest = row => ledger.request(row);
let response, error;
try {response = await adapter.complete({...request, signal: AbortSignal.timeout(930000)});}
catch (caught) {error = caught;}
const summary = await ledger.finish({status: error ? 'failed' : 'completed'});
const text = (response?.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n').trim();
Object.assign(report, {
  status: error ? 'failed' : 'completed',
  accepted: Boolean(!error && response?.stop_reason === 'end_turn' && text === 'READY'
    && summary.providerUsageComplete && summary.requests === 1),
  stopReason: response?.stop_reason || null, errorType: error?.name || null,
  providerUsageComplete: summary.providerUsageComplete, providerCalls: summary.requests,
  inputTokensIncludingCache: summary.inputTokens, outputTokens: summary.outputTokens,
  totalTokens: summary.totalActualTokens, reportedTokenLowerBound: summary.reportedTotalTokens,
  reservationUsd: summary.providerUsageComplete ? 0 : 1,
});
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (!report.accepted) process.exitCode = 1;
