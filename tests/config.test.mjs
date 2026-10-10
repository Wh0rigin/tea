import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLiveConfig, ConfigError, loadConfig } from '../src/config.mjs';

test('loads supported GLM-5.3-Flash effort levels and defaults to a zero live budget', () => {
  for (const effort of ['low', 'high', 'max']) assert.equal(loadConfig({ effort }, {}).effort, effort);
  assert.equal(loadConfig({}, {}).maxCostUsd, 0);
  assert.throws(() => loadConfig({ effort: 'medium' }, {}), ConfigError);
});

test('refuses live calls when key, positive budget, or both rates are absent', () => {
  const blank = loadConfig({}, {});
  assert.throws(() => assertLiveConfig(blank), /ANTHROPIC_API_KEY/);
  const withKey = loadConfig({}, { ANTHROPIC_API_KEY: 'test-only-key', TEA_MAX_COST_USD: '0.1' });
  assert.throws(() => assertLiveConfig(withKey), /TEA_INPUT_PRICE_USD_PER_MTOK/);
  const configured = loadConfig({}, {
    ANTHROPIC_API_KEY: 'test-only-key', TEA_MAX_COST_USD: '0.1',
    TEA_INPUT_PRICE_USD_PER_MTOK: '0.2', TEA_OUTPUT_PRICE_USD_PER_MTOK: '0.4',
  });
  assert.doesNotThrow(() => assertLiveConfig(configured));
});

test('rejects invalid prices and negative budgets', () => {
  assert.throws(() => loadConfig({}, { TEA_MAX_COST_USD: '-1' }), ConfigError);
  assert.throws(() => loadConfig({}, { TEA_INPUT_PRICE_USD_PER_MTOK: 'NaN' }), ConfigError);
});
