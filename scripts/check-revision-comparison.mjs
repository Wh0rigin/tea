import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), execute = promisify(execFile);
const baseline = process.argv[2] || '97e8d5bdcd7e8e339247ad5ffb659bbb9c7683d9', candidate = process.argv[3] || 'HEAD';
const runId = `s0-contract-${Date.now()}`, counters = new Map(), bodies = [];
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const server = createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); bodies.push(body);
    assert.equal(request.headers['x-api-key'], 'loopback-only-no-real-key');
    const user = body.messages.find(message => typeof message.content === 'string').content;
    const role = user.match(/Workspace: [^\n]+[\\/](baseline|candidate)(?:\n|$)/)?.[1];
    const task = user.includes('cache key collisions') ? 'cache-key' : user.includes('retry budget logic') ? 'retry-budget' : 'unicode';
    const caseId = user.match(/small-(?:cache-key|retry-budget|unicode)-r\d+/)[0];
    assert.ok(role);
    const key = `${caseId}/${role}`, round = counters.get(key) || 0; counters.set(key, round + 1);
    const entry = task === 'unicode' ? 'src/services/text.mjs' : `src/services/${task}.mjs`;
    const call = (name, input, index) => ({ type: 'tool_use', id: `s0-${caseId}-${round}-${index}`, name, input });
    const patches = {
      'cache-key': { search: 'return String(value);', replace: 'return typeof value + ":" + String(value);' },
      'retry-budget': { search: 'attempt < retries', replace: 'attempt <= retries' },
      unicode: { search: 'return text.slice(0,Math.max(0,limit));', replace: 'return Array.from(text).slice(0,Math.max(0,limit)).join("");' },
    };
    const blocks = round === 0 ? ['AGENTS.md', entry, 'tests/public.test.mjs'].map((file, n) => call('read_file', { path: file }, n))
      : round === 1 ? [call('apply_patch', { path: entry, ...patches[task] }, 0)]
      : round === 2 ? [call('run_tests', { command: role === 'baseline' ? 'npm test' : 'node --test --test-reporter=spec ./tests/public.test.mjs' }, 0)]
      : [{ type: 'text', text: 'Finished with public validation.' }];
    if (round > 3) throw new Error('Unexpected repeated request');
    let payload = event({ type: 'message_start', message: { id: `local-${round}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null,
      usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 20 } } });
    for (let n = 0; n < blocks.length; n++) {
      const block = blocks[n];
      payload += event({ type: 'content_block_start', index: n, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
      payload += event({ type: 'content_block_delta', index: n, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
      payload += event({ type: 'content_block_stop', index: n });
    }
    payload += event({ type: 'message_delta', delta: { stop_reason: round < 3 ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 20 } }) + event({ type: 'message_stop' });
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(payload);
  } catch (error) { response.writeHead(500); response.end(String(error.message)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const env = { ...process.env, ANTHROPIC_API_KEY: 'loopback-only-no-real-key', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    ANTHROPIC_MODEL: 'glm-5.3-flash', TEA_THINKING_MODE: 'enabled', TEA_REASONING_EFFORT: 'low', TEA_MAX_OUTPUT_TOKENS: '4096',
    TEA_INPUT_PRICE_USD_PER_MTOK: '.8', TEA_OUTPUT_PRICE_USD_PER_MTOK: '2.8', TEA_STORE_RAW: '0', TEA_MAX_TOOL_CALLS: '24', TEA_STREAM: '1' };
  const child = await execute(process.execPath, ['scripts/compare-contextos-pi.mjs', '--mode', 'contract', '--baseline-ref', baseline, '--candidate-ref', candidate,
    '--groups', 'fresh', '--scales', 'small', '--repeat', '3', '--run-id', runId, '--max-cost-usd', '1'], { cwd: ROOT, env, windowsHide: true, timeout: 180000, maxBuffer: 1_000_000 });
  const directory = path.join(ROOT, 'benchmarks/results', runId), report = JSON.parse(await readFile(path.join(directory, 'comparison.json'), 'utf8'));
  assert.equal(report.complete, true); assert.equal(report.paidProviderRequests, 0); assert.equal(report.usageSource, 'scripted-loopback');
  assert.equal(report.runs.length, 18); assert.ok(report.runs.every(run => run.accepted));
  assert.equal(report.requests.length, 72); assert.ok(report.requests.every(row => row.complete && row.totalTokens === 140));
  assert.equal(report.analysis.overall.allPairsTokenReductionPercent, null);
  assert.equal(report.analysis.validComparison, false, 'Scripted wire data must remain ineligible for provider ratios');
  assert.ok(Object.values(report.engines).every(engine => engine.sourceUnchanged));
  const controls = bodies.map(body => JSON.stringify({ model: body.model, thinking: body.thinking, output: body.max_tokens, effort: body.output_config }));
  assert.equal(new Set(controls).size, 1);
  const quality = report.runs.map(run => ({ caseId: run.caseId, agent: run.agent, accepted: run.accepted, dimensions: run.qualityDimensions,
    commands: run.turns[0].requirements.calls.filter(call => call.kind === 'shell').map(call => ({ execution: call.execution, evidence: call.validationEvidence,
      sourceVersionsBefore: call.sourceVersionsBefore, sourceVersionsAfter: call.sourceVersionsAfter })) }));
  const evidence = { kind: 'native frozen-revision loopback contract', usageSource: 'scripted-loopback', paidProviderRequests: 0,
    runId, runs: 18, requests: 72, accepted: 18, scriptedTokensPerArm: 5040, providerTokenImprovement: null,
    commonControlsMatched: true, allSourcesStable: true, ratiosWithheld: true,
    engines: Object.fromEntries(Object.entries(report.engines).map(([role, engine]) => [role, { commit: engine.commit, sourceSha256: engine.sourceSha256 }])), quality };
  await writeFile(path.join(directory, 'contract.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ runId, accepted: '18/18', requests: 72, paidProviderRequests: 0, providerTokenImprovement: null, ratiosWithheld: true }));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
