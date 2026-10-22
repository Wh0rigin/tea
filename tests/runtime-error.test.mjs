import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeError } from '../src/runtime-error.mjs';

test('runtime diagnostics redact configured credentials and omit bodies, stacks and unknown budget fields', () => {
  const apiKey = 'opaque-test-credential';
  const error = new Error(`Failed ${apiKey}; x-api-key: other-secret; authorization: Bearer third-secret`);
  error.submitted = false;
  const record = runtimeError(error, { config: { apiKey }, stage: 'model',
    budget: { inputLimit: 42, apiKey, body: 'private conversation' } });
  assert.doesNotMatch(JSON.stringify(record), /opaque-test-credential|other-secret|third-secret|private conversation/);
  assert.deepEqual(record.budget, { inputLimit: 42 });
  assert.equal(record.requestSubmitted, false);
  assert.equal(record.stack, undefined);
});
