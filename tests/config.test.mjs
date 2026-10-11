import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLiveConfig, ConfigError, loadConfig } from '../src/config.mjs';

test('loads supported GLM-5.3-Flash effort levels and defaults to a zero live budget', () => {
  for (const effort of ['low', 'high', 'max']) assert.equal(loadConfig({ effort }, {}).effort, effort);
  assert.equal(loadConfig({}, {}).maxCostUsd, 0);
  assert.throws(() => loadConfig({ effort: 'medium' }, {}), ConfigError);
});

test('configures progressive inventory and evidence de-dup strategies with bounded path counts', () => {
  assert.equal(loadConfig({}, {}).contextStrategy, 'v1');
  assert.equal(loadConfig({}, {}).initialFileLimit, 8);
  assert.equal(loadConfig({}, { TEA_CONTEXT_STRATEGY: 'v1-inventory', TEA_INITIAL_FILE_LIMIT: '24' }).contextStrategy, 'v1-inventory');
  assert.equal(loadConfig({}, { TEA_CONTEXT_STRATEGY: 'v1-inventory', TEA_INITIAL_FILE_LIMIT: '24' }).initialFileLimit, 24);
  assert.equal(loadConfig({ contextStrategy: 'v1-expanded', initialFileLimit: '16' }, {}).initialFileLimit, 16);
  assert.equal(loadConfig({ contextStrategy: 'v1-expanded' }, {}).contextStrategy, 'v1-expanded');
  assert.equal(loadConfig({ contextStrategy: 'v1-auto' }, {}).contextStrategy, 'v1-auto');
  assert.throws(() => loadConfig({}, { TEA_CONTEXT_STRATEGY: 'unknown' }), ConfigError);
  assert.throws(() => loadConfig({}, { TEA_INITIAL_FILE_LIMIT: '0' }), ConfigError);
  assert.throws(() => loadConfig({}, { TEA_INITIAL_FILE_LIMIT: '0.5' }), ConfigError);
  assert.throws(() => loadConfig({}, { TEA_INITIAL_FILE_LIMIT: '2.9' }), ConfigError);
  assert.throws(() => loadConfig({}, { TEA_INITIAL_FILE_LIMIT: '251' }), ConfigError);
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

test('direct live config cannot bypass finite prices, budget, and integer caps', () => {
  const configured = loadConfig({}, { ANTHROPIC_API_KEY: 'test-only', TEA_MAX_COST_USD: '1', TEA_INPUT_PRICE_USD_PER_MTOK: '1', TEA_OUTPUT_PRICE_USD_PER_MTOK: '1' });
  for (const outputRateUsdPerMillion of [-1, NaN, Infinity]) assert.throws(() => assertLiveConfig({ ...configured, outputRateUsdPerMillion }), ConfigError);
  assert.throws(() => assertLiveConfig({ ...configured, maxCostUsd: Infinity }), ConfigError);
  assert.throws(() => assertLiveConfig({ ...configured, maxToolCalls: 2.5 }), ConfigError);
});
