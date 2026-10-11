import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ContextMemory, validToolProtocol } from '../src/context-assembler.mjs';
import { WorkspaceTools } from '../src/tools.mjs';
import { loadConfig } from '../src/config.mjs';

// No provider adapter or credentials are loaded. Synthetic thinking is retained
// to exercise protocol preservation, not to represent a model measurement.
const output = path.resolve(process.argv[2] || `benchmarks/results/contextos-replay-${Date.now()}`);
await mkdir(output, { recursive: false });
const root = await mkdtemp(path.join(tmpdir(), 'tea-replay-contextos-'));
const config = loadConfig({ workspace: root, memoryPolicy: 'contextos' }, {
  ANTHROPIC_MODEL: 'glm-5.3-flash', TEA_THINKING_MODE: 'enabled', TEA_MAX_OUTPUT_TOKENS: '4096',
  TEA_STREAM: '0', TEA_MAX_REQUEST_INPUT_TOKENS: '160000', TEA_CONTEXTOS_TARGET_BYTES: '32000',
});
const tools = new WorkspaceTools({ workspace: root, deduplicateReads: false });
await tools.init();
const pair = (id, name, input, content, is_error = false) => [
  { role: 'assistant', content: [
    { type: 'thinking', thinking: 'Scripted thought retained verbatim; not a provider response.', signature: 'synthetic-' + id },
    { type: 'tool_use', id, name, input },
  ] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] },
];
const rows = [];
try {
  for (let n = 0; n < 55; n++) await writeFile(path.join(root, `module-${n}.mjs`),
    `export const value${n}=${n};\n` + '// source observation: field names and behavior are preserved\n'.repeat(25));
  for (const scenario of ['short', '30-source-turns', '50-source-turns', 'repeated-reads', 'active-crossfile', 'long-failure', 'stale-source', 'task-switch']) {
    const messages = [{ role: 'user', content: 'Never change the API. Preserve user changes. Validate every edit.' }];
    const count = scenario === 'short' ? 1 : scenario === '50-source-turns' ? 50 : scenario === '30-source-turns' ? 30 : 35;
    for (let n = 0; n < count; n++) {
      const file = scenario === 'repeated-reads' ? 'module-0.mjs' : `module-${n}.mjs`;
      messages.push(...pair('r-' + n, 'read_file', { path: file }, await tools.readFile({ path: file })),
        { role: 'user', content: `Continue inspection ${n}; no edits.` });
    }
    if (scenario === 'long-failure') messages.splice(1, 0, ...pair('failure', 'run_tests',
      { command: 'node --test broken.test.mjs' }, 'exit=1\nAssertionError: preserve this failure\n' + 'trace\n'.repeat(1800), true));
    if (scenario === 'stale-source') await writeFile(path.join(root, 'module-0.mjs'), 'export const newVersion=123;');
    if (scenario === 'task-switch') messages.push({ role: 'user', content: 'Switch task: inspect module-0.mjs; earlier compatibility requirements remain.' });
    const memory = new ContextMemory(tools);
    const plan = await memory.assemble({ messages, canonical: messages, system: 'Fixed replay system',
      tools: tools.modelToolDefinitions({ includeMemory: false }), config,
      state: { pendingValidation: true, validationPassed: false, changedFiles: scenario === 'active-crossfile' ? ['module-0.mjs', 'module-1.mjs'] : [] },
      goal: scenario === 'task-switch' ? 'Inspect module-0.mjs' : 'Continue',
    });
    const unit = plan.diagnostics.units.find(unit => unit.decision === 'reference' && unit.validity !== 'stale');
    const recalled = unit ? await memory.recall({ ref: unit.ref, maxBytes: 8000 }) : null;
    rows.push({ scenario, source: 'deterministic actual-tool replay; synthetic assistant blocks; no model calls',
      messages: messages.length, fullWireBytes: plan.diagnostics.fullWireBytes, sentWireBytes: plan.diagnostics.sentWireBytes,
      byteSavingsPercent: 100 * (plan.diagnostics.fullWireBytes - plan.diagnostics.sentWireBytes) / plan.diagnostics.fullWireBytes,
      estimatedTokensBefore: plan.diagnostics.fullEstimatedTokens, estimatedTokensAfter: plan.diagnostics.sentEstimatedTokens,
      evictedUnits: plan.diagnostics.evictedUnits, staleUnits: plan.diagnostics.staleUnits,
      protocolValid: validToolProtocol(plan.request.messages),
      requirementsPreserved: messages.filter(message => message.role === 'user' && typeof message.content === 'string').every(message => plan.request.messages.includes(message)),
      failurePreserved: scenario !== 'long-failure' || JSON.stringify(plan.request).includes('AssertionError: preserve this failure'),
      recallReturnedExact: unit ? recalled.endsWith(memory.units.get(unit.ref).output) : null,
    });
  }
  const sourceCommit = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true })).stdout.trim();
  const result = { version: 1, kind: 'deterministic-contextos-replay', sourceCommit, providerRequests: 0,
    metric: 'native serialized UTF-8 request bytes and explicitly heuristic tokens; not provider savings',
    config: { model: config.model, thinkingMode: config.thinkingMode, effort: config.effort, maxOutputTokens: config.maxOutputTokens, stream: config.stream, wireGuard: 160000, targetBytes: 32000 }, rows };
  await writeFile(path.join(output, 'replay.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, providerRequests: 0, rows }, null, 2));
  if (rows.some(row => !row.protocolValid || !row.requirementsPreserved || !row.failurePreserved || row.recallReturnedExact === false)) process.exitCode = 2;
} finally {
  // root is the directory returned by mkdtemp under the OS temp directory.
  if (path.dirname(root) !== path.resolve(tmpdir())) throw new Error('Unexpected replay scratch directory');
  await rm(root, { recursive: true, force: true });
}
