import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compactToolHistory } from '../src/memory.mjs';

const longOutput = (label = 'detail') => Array.from({ length: 120 }, (_, index) => `${label} ${index}: original evidence and information`).join('\n');
function round(id, name = 'list_files', output = longOutput(), input = {}, extra = {}) {
  return [
    { role: 'assistant', content: [
      { type: 'thinking', thinking: `Thinking for ${id}`, signature: `opaque-${id}` },
      { type: 'tool_use', id, name, input },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output, is_error: false, ...extra }] },
  ];
}
function history(...rounds) {
  return [{ role: 'user', content: 'Original task. Read AGENTS.md before changing code.' }, ...rounds.flat()];
}
function trailingRounds() { return [round('recent-1'), round('recent-2')]; }
function freezeTree(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeTree(child);
  }
  return value;
}

test('compacts only old rediscoverable output and leaves original history intact', () => {
  const search = longOutput('src/module.mjs:42: matching code');
  const source = '[evidence ref=AGENTS.md#L1-L120@123 sha256=123]\n' + longOutput('instruction');
  const failed = 'exit=1\nstdout:\n' + longOutput('failure evidence') + '\nstderr:\nAssertionError';
  const input = history(
    round('old-list'),
    round('old-search', 'search_code', search, { query: 'matching' }),
    round('old-read', 'read_file', source, { path: 'AGENTS.md' }),
    round('old-pass', 'run_tests', 'exit=0\nstdout:\n' + longOutput('passing test'), { command: 'node --test' }),
    round('old-fail', 'run_tests', failed, { command: 'node --test' }),
    round('old-error', 'search_code', longOutput('tool error'), { query: 'bad' }, { is_error: true }),
    round('old-git', 'run_shell', 'exit=0\nstdout:\n' + longOutput('git diff'), { command: 'git diff' }),
    ...trailingRounds(),
  );
  const snapshot = structuredClone(input);
  freezeTree(input);
  const result = compactToolHistory(input);
  assert.deepEqual(input, snapshot);
  assert.equal(result.messages.length, input.length);
  assert.equal(result.diagnostics.compactedResults, 4);
  assert.equal(result.diagnostics.eligibleResults, 4);
  assert.equal(result.diagnostics.keptRecentRounds, 2);
  assert.equal(result.messages[0], input[0]);
  for (let index = 1; index < input.length; index += 2) assert.equal(result.messages[index], input[index]);
  for (const id of ['old-read', 'old-fail', 'old-error', 'recent-1', 'recent-2']) {
    const index = input.findIndex((message) => message.content?.[0]?.tool_use_id === id);
    assert.equal(result.messages[index], input[index]);
  }
  assert.match(result.messages[4].content[0].content, new RegExp(createHash('sha256').update(search).digest('hex')));
  assert.match(result.messages[4].content[0].content, /call="old-search"/);
  assert.match(result.messages[4].content[0].content, /Re-run search_code with the original arguments above for current evidence/);
  assert.match(result.messages[8].content[0].content, /^exit=0\n/);
  assert.equal(result.diagnostics.savedChars, result.diagnostics.originalChars - result.diagnostics.compactedChars);
  assert.equal(result.diagnostics.savedBytes, result.diagnostics.originalBytes - result.diagnostics.compactedBytes);
  assert.ok(result.diagnostics.savedChars > 0);
  assert.ok(result.diagnostics.savedBytes > 0);
});

test('never changes tool-call ids, inputs, roles, positions, or non-tool user instructions', () => {
  const input = history(round('old'), ...trailingRounds());
  input[2].content.push({ type: 'text', text: 'User instruction inside a tool-result message.' });
  const result = compactToolHistory(input).messages;
  for (let index = 0; index < input.length; index += 1) {
    assert.equal(result[index].role, input[index].role);
    if (input[index].role === 'assistant') assert.equal(result[index], input[index]);
  }
  assert.deepEqual(result[2].content[0], { ...input[2].content[0], content: result[2].content[0].content });
  assert.equal(result[2].content[1], input[2].content[1]);
});

test('never removes original reads, read references, patches, or non-allowlisted shell evidence', () => {
  const input = history(
    round('read', 'read_file'),
    round('ref', 'read_file', 'Evidence unchanged; ref=value.mjs#L1-L120@123. Original lines remain in history.'),
    round('patch', 'apply_patch'),
    round('shell', 'run_shell', 'exit=0\n' + longOutput(), { command: 'node --test' }),
    round('unknown', 'unknown_tool'),
    ...trailingRounds(),
  );
  assert.equal(compactToolHistory(input).messages, input);
});

test('small results and structured tool content do not expand', () => {
  const input = history(round('short', 'list_files', 'README.md\nsrc/index.mjs'), round('structured', 'search_code', [{ type: 'text', text: longOutput() }]), ...trailingRounds());
  const result = compactToolHistory(input);
  assert.equal(result.messages, input);
  assert.equal(result.diagnostics.compactedResults, 0);
  assert.equal(result.diagnostics.eligibleResults, 1);
  assert.equal(result.diagnostics.savedBytes, 0);
});

test('keeps zero-test, failed, help-only and unapproved command output', () => {
  const input = history(
    round('zero', 'run_tests', 'exit=0\nstdout:\n# tests 1\n# pass 0\n' + longOutput(), { command: 'node --test' }),
    round('failed', 'run_tests', 'exit=1\n' + longOutput(), { command: 'node --test' }),
    round('signal', 'run_tests', 'exit=SIGTERM\n' + longOutput(), { command: 'node --test' }),
    round('help', 'run_tests', 'exit=0\n' + longOutput(), { command: 'node --test --help' }),
    round('unsafe', 'run_tests', 'exit=0\n' + longOutput(), { command: 'git\nstatus' }),
    round('unapproved', 'run_tests', 'exit=0\n' + longOutput(), { command: 'echo success' }),
    ...trailingRounds(),
  );
  assert.equal(compactToolHistory(input).messages, input);
});

test('preserves all results linked to duplicate call ids', () => {
  const input = history(round('duplicate'), round('duplicate'), round('unique'), ...trailingRounds());
  const result = compactToolHistory(input);
  assert.equal(result.messages[2], input[2]);
  assert.equal(result.messages[4], input[4]);
  assert.equal(result.diagnostics.compactedResults, 1);
});

test('preserves duplicate result ids and orphaned or nonadjacent results', () => {
  const input = history(round('twice'), round('other'), ...trailingRounds());
  input[2].content.push({ ...input[2].content[0] });
  input[4].content[0].tool_use_id = 'orphan';
  assert.equal(compactToolHistory(input).messages, input);
  const separated = history(round('separated'), ...trailingRounds());
  separated.splice(2, 0, { role: 'user', content: 'Additional instruction.' });
  assert.equal(compactToolHistory(separated).messages, separated);
});

test('retains at least two complete tool-result rounds regardless of requested count', () => {
  const input = history(round('old'), ...trailingRounds());
  for (const keepRecentRounds of [0, -3, 1, '1', NaN, Infinity]) {
    const result = compactToolHistory(input, { keepRecentRounds });
    assert.equal(result.diagnostics.keptRecentRounds, 2);
    assert.equal(result.diagnostics.compactedResults, 1);
    assert.equal(result.messages[4], input[4]);
    assert.equal(result.messages[6], input[6]);
  }
  assert.equal(compactToolHistory(input, { keepRecentRounds: 3 }).messages, input);
});

test('handles Chinese content and escaped wire strings without increasing bytes or chars', () => {
  for (const output of [longOutput('中文匹配内容'), longOutput('quoted \\" line\\t control')]) {
    const input = history(round('unicode-引用', 'search_code', output, { query: '中文' }), ...trailingRounds());
    const result = compactToolHistory(input);
    assert.ok(result.diagnostics.savedChars > 0);
    assert.ok(result.diagnostics.savedBytes > 0);
    assert.equal(result.diagnostics.originalBytes, Buffer.byteLength(JSON.stringify(input)));
    assert.equal(result.diagnostics.compactedBytes, Buffer.byteLength(JSON.stringify(result.messages)));
  }
});

test('empty or short histories are unchanged and malformed messages are retained', () => {
  const empty = [];
  assert.equal(compactToolHistory(empty).messages, empty);
  const input = [{ role: 'user', content: 'task' }, null, { role: 'assistant', content: 'text' }];
  assert.equal(compactToolHistory(input).messages, input);
  assert.throws(() => compactToolHistory({}), /messages must be an array/);
});

test('keeps complete recent tool batches and preserves protected results in an older batch', () => {
  const oldBatch = round('batch-list');
  for (const [id, name, content, is_error] of [
    ['batch-search', 'search_code', longOutput('search match'), false],
    ['batch-read', 'read_file', '[evidence ref=module.mjs#L1-L120@aaa]\n' + longOutput('source line'), false],
    ['batch-error', 'search_code', longOutput('tool failure'), true],
  ]) {
    oldBatch[0].content.push({ type: 'tool_use', id, name, input: {} });
    oldBatch[1].content.push({ type: 'tool_result', tool_use_id: id, content, is_error });
  }
  const recentBatch = round('recent-batch-1');
  recentBatch[0].content.push({ type: 'tool_use', id: 'recent-batch-2', name: 'search_code', input: { query: 'match' } });
  recentBatch[1].content.push({ type: 'tool_result', tool_use_id: 'recent-batch-2', content: longOutput(), is_error: false });
  const input = history(oldBatch, recentBatch, round('last-batch'));
  const result = compactToolHistory(freezeTree(input));
  assert.equal(result.diagnostics.compactedResults, 2);
  assert.equal(result.messages[1], input[1]);
  assert.equal(result.messages[2].content[2], input[2].content[2]);
  assert.equal(result.messages[2].content[3], input[2].content[3]);
  assert.equal(result.messages[4], input[4]);
  assert.equal(result.messages[6], input[6]);
  assert.deepEqual(result.messages[2].content.map((block) => block.tool_use_id), input[2].content.map((block) => block.tool_use_id));
});

test('retains both source generations and every read reference across a patch', () => {
  const before = '[evidence ref=module.mjs#L1-L120@before sha256=before]\n' + longOutput('original source');
  const after = '[evidence ref=module.mjs#L1-L120@after sha256=after]\n' + longOutput('updated source');
  const input = history(
    round('read-before', 'read_file', before, { path: 'module.mjs' }),
    round('discovery'),
    round('ref-before', 'read_file', 'Evidence unchanged; ref=module.mjs#L1-L120@before. Original lines remain in history.', { path: 'module.mjs' }),
    round('patch-between', 'apply_patch', 'Updated module.mjs', { path: 'module.mjs', search: 'before', replace: 'after' }),
    round('read-after', 'read_file', after, { path: 'module.mjs' }),
    round('ref-after', 'read_file', 'Evidence unchanged; ref=module.mjs#L1-L120@after. Original lines remain in history.', { path: 'module.mjs' }),
    ...trailingRounds(),
  );
  const result = compactToolHistory(input);
  assert.equal(result.diagnostics.compactedResults, 1);
  for (const id of ['read-before', 'ref-before', 'patch-between', 'read-after', 'ref-after']) {
    const index = input.findIndex((message) => message.content?.[0]?.tool_use_id === id);
    assert.equal(result.messages[index], input[index]);
  }
});
