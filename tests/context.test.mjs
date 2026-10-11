import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBaselineInventory, buildProgressiveInventory, buildSyntheticInventory, rankFilesForTask, retrievalRecall } from '../src/context.mjs';

test('ranks task-matching implementation and test paths above unrelated repository history', () => {
  const decoys = Array.from({ length: 240 }, (_, index) => `archive/record-${String(index).padStart(4, '0')}.md`);
  const expected = ['src/session/expiration.js', 'tests/session/expiration.test.js'];
  const files = ['AGENTS.md', 'README.md', 'package.json', 'src/session/AGENTS.md', ...decoys, ...expected];
  const selected = rankFilesForTask('Correct session expiration handling and add a boundary test', files, 12);
  assert.ok(selected.includes('AGENTS.md'));
  assert.ok(selected.includes('src/session/AGENTS.md'));
  assert.ok(selected.includes('README.md'));
  assert.ok(selected.includes('package.json'));
  assert.deepEqual(retrievalRecall(expected, selected).missing, []);
  assert.ok(selected.indexOf(expected[0]) < selected.indexOf(decoys[0]));
});

test('uses Chinese task and path terms during ranking', () => {
  const selected = rankFilesForTask('修复认证令牌刷新逻辑', ['src/cache/store.ts', 'src/认证/令牌刷新.ts', 'docs/old.md'], 2);
  assert.equal(selected[0], 'src/认证/令牌刷新.ts');
});

test('query expansion recovers paraphrased paths that lexical overlap misses', () => {
  const prompt = 'Ensure an authenticated user cannot remain signed in after the allowed period.';
  const targets = ['src/session/expiration.js', 'tests/session/expiration.test.js'];
  const files = buildSyntheticInventory({ rootFiles: ['README.md', 'package.json'], decoyCount: 240, relevantFiles: targets });
  const lexical = buildProgressiveInventory(prompt, files, { limit: 32 });
  const expanded = buildProgressiveInventory(prompt, files, { limit: 32, queryExpansion: true });
  assert.equal(retrievalRecall(targets, lexical.selectedFiles).recall, 0);
  assert.equal(retrievalRecall(targets, expanded.selectedFiles).recall, 1);
  assert.equal(expanded.queryExpansionApplied, true);
  const direct = buildProgressiveInventory('Fix the session expiration bug', files, { limit: 32, queryExpansion: 'auto' });
  assert.equal(direct.queryExpansionApplied, false);
  assert.equal(retrievalRecall(targets, direct.selectedFiles).recall, 1);
  const paraphrase = buildProgressiveInventory(prompt, files, { limit: 32, queryExpansion: 'auto' });
  assert.equal(paraphrase.queryExpansionApplied, true);
  assert.equal(retrievalRecall(targets, paraphrase.selectedFiles).recall, 1);
});

test('progressive inventory preserves recall when the alphabetical baseline is crowded by decoys', () => {
  const spec = { rootFiles: ['README.md', 'package.json'], decoyCount: 240, relevantFiles: ['src/date/parse.ts', 'tests/date/parse.test.ts'] };
  const files = buildSyntheticInventory(spec);
  const baseline = buildBaselineInventory(files, 160);
  const candidate = buildProgressiveInventory('Add leap day boundaries to the date parser tests', files, { limit: 32 });
  assert.equal(retrievalRecall(spec.relevantFiles, baseline.selectedFiles).recall, 0);
  assert.equal(retrievalRecall(spec.relevantFiles, candidate.selectedFiles).recall, 1);
  assert.match(candidate.text, /partial/);
});
