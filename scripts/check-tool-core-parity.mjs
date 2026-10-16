// Offline compatibility check. Scripted model responses and validation output;
// no provider calls, provider token claims or real model quality claims.
import { mkdtemp, realpath, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { prepareRevisionEngine } from '../src/comparison-revisions.mjs';
import { loadCliConfig } from '../src/config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidate = process.argv[2]; assert(/^[a-f0-9]{40}$/.test(candidate || ''), 'Supply the frozen candidate commit');
const base = await realpath(os.tmpdir()), temporary = await realpath(await mkdtemp(path.join(base, 'tea-core-parity-')));
const hash = value => createHash('sha256').update(value).digest('hex');
const report = { kind: 'offline-tool-core-parity', paidCalls: 0, providerTokensMeasured: false, definitions: [], conversations: [] };
try {
  const engines = {};
  for (const arm of ['baseline', 'candidate']) engines[arm] = await prepareRevisionEngine({ repository: root,
    ref: arm === 'baseline' ? '6a50dc5' : candidate, directory: path.join(temporary, arm) });
  report.engines = Object.fromEntries(Object.entries(engines).map(([arm, engine]) => [arm, { commit: engine.metadata.commit, sourceSha256: engine.metadata.sourceSha256 }]));
  const workspace = path.join(temporary, 'workspace'); await mkdir(workspace);
  const binaries = [false, true];
  for (const discoveryWide of binaries) for (const searchCursorNeeded of binaries) for (const creation of binaries)
    for (const terms of binaries) for (const memory of binaries) for (const includeMemory of binaries) {
      const payloads = {};
      for (const [arm, engine] of Object.entries(engines)) {
        const tools = new engine.tools.WorkspaceTools({ workspace, enableFileCreation: creation }); await tools.init();
        Object.assign(tools, { discoveryWide, searchCursorNeeded }); if (terms) tools.unresolvedQueries.add('missing');
        const { ContextMemory } = await import(pathToFileURL(path.join(temporary, arm, 'src/context-assembler.mjs')).href);
        tools.contextMemory = new ContextMemory(tools); if (memory) tools.contextMemory.evicted.add('ctx-fixed');
        payloads[arm] = JSON.stringify(tools.modelToolDefinitions({ includeMemory }));
      }
      assert.equal(payloads.candidate, payloads.baseline, 'Model tool definition changed');
      report.definitions.push({ discoveryWide, searchCursorNeeded, creation, terms, memory, includeMemory,
        identical: true, bytes: Buffer.byteLength(payloads.baseline), sha256: hash(payloads.baseline) });
    }
  for (const policy of ['full-history', 'contextos']) {
    const captures = {}, observations = {};
    for (const [arm, engine] of Object.entries(engines)) {
      await writeFile(path.join(workspace, 'value.mjs'), 'export const value = 1;\n');
      const config = loadCliConfig({ workspace, runId: `parity-${arm}-${policy}`, memoryPolicy: policy,
        compaction: 'off', memoryGc: 'off', contextosTargetBytes: 4000 }, {});
      const session = engine.engine.createAgentSession(config);
      if (policy === 'contextos') for (let i = 0; i < 8; i++) {
        session.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `seed-${i}`, name: 'list_files', input: {} }] });
        session.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `seed-${i}`, content: `fixed archive ${i}\n`.repeat(500) }] });
      }
      captures[arm] = []; let step = policy === 'contextos' ? -1 : 0, serial = 0, recalls = 0;
      const call = (name, input) => ({ content: [{ type: 'tool_use', id: `actual-${++serial}`, name, input }], stop_reason: 'tool_use' });
      const result = await engine.engine.runTask('Read value.mjs, change value to 2, inspect it and validate.', config, { session,
        adapterFactory: () => {
          // Deterministic validation text makes whole-request byte comparison possible.
          // Separate tests run real Node validation and cover its classification.
          session.tools.runTests = async () => 'exit=0\n# tests 1\n# pass 1\n';
          return { complete: async request => {
            captures[arm].push(JSON.stringify(request));
            if (step === -1) { step++; const ref = session.contextMemory.evicted.values().next().value; assert(ref, 'Expected ContextOS eviction'); recalls++; return call('recall_context', { ref, maxBytes: 256 }); }
            if (step++ === 0) return call('read_file', { path: 'value.mjs' });
            if (step === 2) return call('apply_patch', { path: 'value.mjs', search: 'value = 1', replace: 'value = 2' });
            if (step === 3) return call('read_file', { path: 'value.mjs' });
            if (step === 4) return call('run_tests', { command: 'node --test fixed.test.mjs' });
            return { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' };
          } };
        } });
      assert.equal(result.status, 'completed'); assert(result.validationPassed);
      assert.equal(await readFile(path.join(workspace, 'value.mjs'), 'utf8'), 'export const value = 2;\n');
      observations[arm] = { status: result.status, scriptedValidationPassed: result.validationPassed,
        toolCalls: result.toolCalls, scriptedRecalls: recalls };
    }
    assert.deepEqual(captures.candidate, captures.baseline, `Conversation payload changed for ${policy}`);
    assert.deepEqual(observations.candidate, observations.baseline);
    report.conversations.push({ policy, identical: true, observations: observations.baseline,
      requests: captures.baseline.map((wire, index) => ({ index, bytes: Buffer.byteLength(wire), sha256: hash(wire) })) });
  }
  for (const engine of Object.values(engines)) assert(await engine.verify());
  await mkdir(path.join(root, '.tea'), { recursive: true });
  await writeFile(path.join(root, '.tea/tool-core-parity.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ definitionViews: report.definitions.length, conversations: report.conversations.map(({ policy, requests, identical }) => ({ policy, requests: requests.length, identical })), paidCalls: 0 }));
} finally {
  const relative = path.relative(base, temporary); assert(relative.startsWith('tea-core-parity-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
  await rm(temporary, { recursive: true, force: true });
}
