import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BoundedOutput } from '../src/output.mjs';

test('retains short output exactly across chunks', () => {
  const capture = new BoundedOutput({ maxChars: 512 });
  capture.append('first\n');
  capture.append('最后一行\n');
  assert.equal(capture.render(), 'first\n最后一行\n');
  assert.equal(capture.totalChars, 11);
});

test('bounded capture preserves complete head and tail lines with the full-stream hash', () => {
  const capture = new BoundedOutput({ maxChars: 512 });
  const text = `START\n${'middle-line\n'.repeat(2_000)}END_FAILURE\n`;
  for (let start = 0; start < text.length; start += 71) capture.append(text.slice(start, start + 71));
  const result = capture.render();
  assert.match(result, /^START\n/);
  assert.match(result, /END_FAILURE\n$/);
  assert.ok(result.length <= 512);
  assert.match(result, /chars omitted/);
  assert.ok(result.includes(createHash('sha256').update(text).digest('hex')));
  assert.ok(capture.head.length + capture.tail.length <= 512);
  assert.equal(capture.full, '');
  assert.equal(capture.totalChars, text.length);
});

test('a smaller render budget keeps stream ends without retaining partial boundary lines', () => {
  const capture = new BoundedOutput({ maxChars: 4_000 });
  capture.append(`FIRST\n${'repeated-safe-line\n'.repeat(150)}LAST\n`);
  const result = capture.render({ maxChars: 512 });
  assert.match(result, /^FIRST\n/);
  assert.match(result, /LAST\n$/);
  assert.ok(result.length <= 512);
  const longLine = new BoundedOutput({ maxChars: 512 });
  longLine.append(`HEADER\n${'sensitive-fragment'.repeat(300)}\nFINAL\n`);
  assert.doesNotMatch(longLine.render(), /sensitive-fragment/);
  assert.match(longLine.render(), /FINAL\n$/);
});

test('invalid capture and render budgets are rejected', () => {
  assert.throws(() => new BoundedOutput({ maxChars: 100 }), /at least 256/);
  const capture = new BoundedOutput({ maxChars: 512 });
  assert.throws(() => capture.render({ maxChars: 1_000 }), /capture budget/);
});
