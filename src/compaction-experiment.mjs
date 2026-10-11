import { WorkspaceTools } from './tools.mjs';
import { createHash } from 'node:crypto';

// Scripted setup executes real read-only tools, but is NOT model-generated history.
// Identical seed messages are supplied to both sides of each stress-test pair.
export async function seedHistory(workspace, definition, shape) {
  if (shape === 'empty') return [];
  const tools = new WorkspaceTools({ workspace, deduplicateReads: false }); await tools.init();
  const messages = [{ role: 'user', content: 'Inspect the project inventory and unrelated utilities without editing. Preserve the API, tests and project instructions.' }];
  let serial = 0;
  const read = async (name, input, output) => {
    const id = `setup-${++serial}`;
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] });
  };
  for (const filename of ['AGENTS.md', 'README.md']) await read('read_file', { path: filename }, await tools.readFile({ path: filename }));
  if (shape === 'reads') {
    const files = await tools.listFilePaths({ path: 'src/generated', maxFiles: 48 });
    for (const filename of files) await read('read_file', { path: filename }, await tools.readFile({ path: filename }));
  } else if (shape === 'inventory') {
    for (let offset = 0; offset < definition.targetFileCount; offset += 250) {
      const input = { maxFiles: 250, offset };
      await read('list_files', input, await tools.listFiles(input));
    }
  } else throw new Error('Unknown stress history shape');
  messages.push({ role: 'assistant', content: 'The requested read-only inspection is complete. No source or tests were modified.' });
  return messages;
}

export function historyFingerprint(messages) {
  return { bytes: Buffer.byteLength(JSON.stringify(messages), 'utf8'),
    sha256: createHash('sha256').update(JSON.stringify(messages)).digest('hex'), messages: messages.length };
}

export function analyzeCompaction(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = `${run.caseId}/${run.repeat}`;
    if (!groups.has(key)) groups.set(key, {});
    if (groups.get(key)[run.variant]) throw new Error('Duplicate experiment run');
    groups.get(key)[run.variant] = run;
  }
  const pairs = [...groups].map(([pairId, group]) => {
    const { off, auto } = group;
    const known = Boolean(off && auto && Number.isSafeInteger(off.totalTokens) && Number.isSafeInteger(auto.totalTokens)
      && off.usageComplete && auto.usageComplete);
    const eligible = Boolean(known && off.accepted && auto.accepted);
    return { pairId, category: off?.category || auto?.category, caseId: off?.caseId || auto?.caseId,
      completePair: Boolean(off && auto), knownUsage: known, acceptedBoth: Boolean(off?.accepted && auto?.accepted),
      eligible, offTokens: known ? off.totalTokens : null, autoTokens: known ? auto.totalTokens : null,
      savedTokens: known ? off.totalTokens - auto.totalTokens : null,
      savingsPercent: eligible && off.totalTokens > 0 ? 100 * (off.totalTokens - auto.totalTokens) / off.totalTokens : null };
  });
  const categories = {};
  for (const category of [...new Set(pairs.map(p => p.category))]) {
    const all = pairs.filter(p => p.category === category), valid = all.filter(p => p.eligible);
    const offTokens = valid.reduce((n, p) => n + p.offTokens, 0), autoTokens = valid.reduce((n, p) => n + p.autoTokens, 0);
    categories[category] = { pairs: all.length, eligiblePairs: valid.length, offTokens, autoTokens,
      savingsPercent: offTokens > 0 ? 100 * (offTokens - autoTokens) / offTokens : null };
  }
  return { pairs, categories, acceptedRuns: runs.filter(r => r.accepted).length, totalRuns: runs.length,
    unknownUsageRuns: runs.filter(r => !r.usageComplete).length,
    conservativeSpendUsd: runs.reduce((n, r) => n + r.conservativeSpendUsd, 0) };
}
