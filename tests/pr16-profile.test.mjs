import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCliConfig, loadPr16BenchmarkConfig, PR16_PROFILE } from '../src/config.mjs';
import { contextBudget } from '../src/context-budget.mjs';
import { userConfigEnvironment } from '../src/user-config.mjs';

test('frozen PR16 benchmark matches every original exported field', () => {
  const config = loadPr16BenchmarkConfig();
  for (const [key, value] of Object.entries(PR16_PROFILE.expectedConfig)) assert.deepEqual(config[key], value, key);
  assert.deepEqual(config.configurationProfileOverrides, []);
  assert(Object.isFrozen(PR16_PROFILE.expectedConfig));
  assert.equal(PR16_PROFILE.historicalRuntimeCommit, '8ed56262b3c41d701f8a3a55834683af2e1331ef');
  assert.equal(config.apiKey, '');
});

test('daily quality profile preserves algorithms without imposing benchmark spending controls', () => {
  const config = loadCliConfig({}, {});
  assert.equal(config.configurationProfile, 'pr16-quality');
  assert.deepEqual(config.configurationProfileOverrides, ['internalNetworkRetries']);
  assert.equal(config.internalNetworkRetries, 5);
  assert.equal(config.maxCostUsd, null);
  assert.equal(config.maxToolCalls, null);
  assert.equal(config.inputRateUsdPerMillion, undefined);
  assert.equal(config.outputRateUsdPerMillion, undefined);
  assert.equal(config.contextosWorkingSetBytes, 24000);
  assert.equal(config.maxOutputTokens, 131072);
  assert.equal(config.compactionKeepRecentBytes, 16000);
  assert.equal(config.compactionMaxPerTurn, 2);
  assert.equal(config.fitOutputBudget, false);
  const budget = contextBudget(config, { messages: [] });
  assert.equal(budget.inputLimit, 80832);
  assert.equal(budget.triggerTokens, 64665);
});

test('explicit overrides stay effective and visible; Pi and other models remain selectable', () => {
  const custom = loadCliConfig({ contextosWorkingSetBytes: 0 }, {});
  assert.equal(custom.contextosWorkingSetBytes, 0);
  assert.equal(loadCliConfig({}, { TEA_MAX_REQUEST_INPUT_TOKENS: '24000' }).maxRequestInputBytes, 24000);
  assert(loadCliConfig({ configurationProfile: 'pr16-quality', contextBudgetPolicy: 'pi' }, {}).configurationProfileOverrides.includes('contextBudgetPolicy'));
  assert(custom.configurationProfileOverrides.includes('contextosWorkingSetBytes'));
  const pi = loadCliConfig({ configurationProfile: 'pi' }, {});
  assert.equal(pi.contextBudgetPolicy, 'pi');
  assert.equal(pi.contextosWorkingSetBytes, 0);
  assert.equal(loadCliConfig({}, { ANTHROPIC_MODEL: 'another-model' }).configurationProfile, 'pi');
  assert.equal(loadCliConfig({ historyStrategy: 'compact-tools' }, {}).memoryPolicy, 'compact-tools');
  assert.throws(() => loadCliConfig({ configurationProfile: 'unknown' }, {}), /Configuration profile/);
});

test('user settings select the profile and expose working-set and compaction overrides', () => {
  const env = userConfigEnvironment({ configurationProfile: 'pr16-quality', contextosWorkingSetBytes: 12000, compactionMaxPerTurn: 3 });
  const config = loadCliConfig({}, env);
  assert.equal(config.contextosWorkingSetBytes, 12000);
  assert.equal(config.compactionMaxPerTurn, 3);
  assert(config.configurationProfileOverrides.includes('compactionMaxPerTurn'));
});
