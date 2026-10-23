import os from 'node:os';
import path from 'node:path';
import { readFileSync, lstatSync } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { ConfigError, loadConfig } from './config.mjs';
import { redactText } from './tools.mjs';

const MAX_CONFIG_BYTES = 65536;
const FIELDS = {
  editPermissions: ['TEA_EDIT_PERMISSIONS', 'json'],
  apiKey: ['ANTHROPIC_API_KEY', 'string'], baseUrl: ['ANTHROPIC_BASE_URL', 'string'],
  model: ['ANTHROPIC_MODEL', 'string'], apiVersion: ['ANTHROPIC_VERSION', 'string'],
  thinkingMode: ['TEA_THINKING_MODE', 'string'], effort: ['TEA_REASONING_EFFORT', 'string'],
  memoryPolicy: ['TEA_MEMORY_POLICY', 'string'], historyStrategy: ['TEA_HISTORY_STRATEGY', 'string'],
  compaction: ['TEA_COMPACTION', 'string'], memoryGc: ['TEA_MEMORY_GC', 'string'],
  stream: ['TEA_STREAM', 'boolean'], capabilityFeedback: ['TEA_CAPABILITY_FEEDBACK', 'boolean'],
  enableFileCreation: ['TEA_ENABLE_FILE_CREATION', 'boolean'],
  maxCostUsd: ['TEA_MAX_COST_USD', 'cap'], maxOutputTokens: ['TEA_MAX_OUTPUT_TOKENS', 'number'],
  maxRequestInputBytes: ['TEA_MAX_REQUEST_INPUT_BYTES', 'number'], maxToolCalls: ['TEA_MAX_TOOL_CALLS', 'number'],
  contextWindowTokens: ['TEA_CONTEXT_WINDOW_TOKENS', 'number'], contextReserveTokens: ['TEA_CONTEXT_RESERVE_TOKENS', 'number'],
  timeoutMs: ['TEA_REQUEST_TIMEOUT_MS', 'number'], contextosTargetBytes: ['TEA_CONTEXTOS_TARGET_BYTES', 'number'],
  historyKeepRecent: ['TEA_HISTORY_KEEP_RECENT', 'number'], initialFileLimit: ['TEA_INITIAL_FILE_LIMIT', 'number'],
  contextStrategy: ['TEA_CONTEXT_STRATEGY', 'string'], compactionTriggerRatio: ['TEA_COMPACTION_TRIGGER_RATIO', 'number'],
  compactionKeepRecentBytes: ['TEA_COMPACTION_KEEP_RECENT_BYTES', 'number'],
  compactionKeepRecentTokens: ['TEA_COMPACTION_KEEP_RECENT_TOKENS', 'number'],
  compactionReserveTokens: ['TEA_COMPACTION_RESERVE_TOKENS', 'number'],
  contextBudgetPolicy: ['TEA_CONTEXT_BUDGET_POLICY', 'string'],
  inputPriceUsdPerMillion: ['TEA_INPUT_PRICE_USD_PER_MTOK', 'number'],
  outputPriceUsdPerMillion: ['TEA_OUTPUT_PRICE_USD_PER_MTOK', 'number'],
};

export const userConfigPath = (home = os.homedir()) => path.join(home, '.tea', 'config.json');

export function userConfigEnvironment(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new ConfigError('TEA user config must be a JSON object');
  const env = {};
  for (const [name, value] of Object.entries(settings)) {
    if (!Object.hasOwn(FIELDS, name)) throw new ConfigError('TEA user config contains an unsupported field; see docs/CONFIGURATION.md');
    const [variable, type] = FIELDS[name];
    if(type==='json'){env[variable]=JSON.stringify(value);continue;}
    if (type === 'cap' && value === null) { env[variable] = 'none'; continue; }
    if (typeof value !== (type === 'cap' ? 'number' : type) || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new ConfigError(`Invalid type for user config field ${name}`);
    }
    if (name === 'apiKey' && /[^\x21-\x7e]/.test(value)) throw new ConfigError('User config apiKey must contain printable ASCII without whitespace');
    if (name === 'baseUrl') {
      let url; try { url = new URL(value); } catch { throw new ConfigError('User config baseUrl must be an HTTP(S) URL'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new ConfigError('User config baseUrl must be HTTP(S) without embedded credentials, query or fragment');
      }
    }
    env[variable] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  }
  // Validate file values independently so an environment override cannot hide bad configuration.
  loadConfig({}, env);
  return env;
}

export function readUserConfig(filename = userConfigPath()) {
  let bytes;
  try {
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_BYTES) throw new ConfigError('TEA user config must be a regular file of at most 64 KiB');
    bytes = readFileSync(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof ConfigError) throw error;
    throw new ConfigError('Cannot read TEA user config; check the file permissions');
  }
  if (bytes.length > MAX_CONFIG_BYTES) throw new ConfigError('TEA user config exceeds 64 KiB');
  let settings;
  try { settings = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')); }
  catch { throw new ConfigError('Invalid JSON in TEA user config; check its syntax (contents are not displayed)'); }
  userConfigEnvironment(settings);
  return settings;
}

export function resolveUserEnvironment(env = process.env, filename = userConfigPath()) {
  const settings = readUserConfig(filename);
  const merged = { ...(settings ? userConfigEnvironment(settings) : {}), ...env };
  if (env.TEA_MAX_REQUEST_INPUT_BYTES === undefined && env.TEA_MAX_REQUEST_INPUT_TOKENS !== undefined) {
    merged.TEA_MAX_REQUEST_INPUT_BYTES = env.TEA_MAX_REQUEST_INPUT_TOKENS;
  }
  // Either credential environment variable overrides the file key, including explicit empty values.
  if (env.ANTHROPIC_API_KEY !== undefined || env.ANTHROPIC_AUTH_TOKEN !== undefined) {
    delete merged.ANTHROPIC_API_KEY;
    delete merged.ANTHROPIC_AUTH_TOKEN;
    if (env.ANTHROPIC_API_KEY !== undefined) merged.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
    if (env.ANTHROPIC_AUTH_TOKEN !== undefined) merged.ANTHROPIC_AUTH_TOKEN = env.ANTHROPIC_AUTH_TOKEN;
  }
  return merged;
}

export async function saveUserConfig(settings, { filename = userConfigPath(), createOnly = false } = {}) {
  userConfigEnvironment(settings);
  const bytes = Buffer.from(JSON.stringify(settings, null, 2) + '\n');
  if (bytes.length > MAX_CONFIG_BYTES) throw new ConfigError('TEA user config exceeds 64 KiB');
  const directory = path.dirname(filename), lockPath = filename + '.lock';
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new ConfigError('Another configuration writer is active; close it before retrying'); throw error; }
  const temporary = path.join(directory, `.config-${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    const existing = readUserConfig(filename);
    if (createOnly && existing !== null) return false;
    const file = await open(temporary, 'wx', 0o600); temporaryCreated = true;
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, filename); temporaryCreated = false;
    return true;
  } finally {
    try { if (temporaryCreated) await unlink(temporary); }
    finally { await lock.close(); await unlink(lockPath); }
  }
}

export async function userConfigCommand(args, { input = process.stdin, output = process.stdout } = {}) {
  const filename = userConfigPath();
  if (args.length > 1 || (args[0] && !['init', 'show', 'path'].includes(args[0]))) throw new ConfigError('Use tea config [init|show|path]');
  if (args[0] === 'path') { output.write(filename + '\n'); return; }
  if (args[0] === 'show') {
    const settings = readUserConfig(filename);
    output.write(filename + '\n' + (settings ? redactText(JSON.stringify({ ...settings, apiKey: settings.apiKey ? '[configured, hidden]' : '' }, null, 2)) : 'No user config; run tea config.') + '\n');
    return;
  }
  if (args[0] === 'init') {
    const created = await saveUserConfig({ apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5',
      thinkingMode: 'adaptive', effort: 'low' }, { filename, createOnly: true });
    output.write(`${created ? 'Created' : 'Existing config preserved'}: ${filename}\nRun tea config for masked setup, or edit this file.\n`);
    return;
  }
  if (!input.isTTY || !output.isTTY) throw new ConfigError('Configuration wizard requires a terminal; use tea config init to create a file');
  const existing = readUserConfig(filename) || {}, defaults = loadConfig({}, resolveUserEnvironment(process.env, filename));
  let hidden = false;
  const sink = new Writable({ write(chunk, encoding, callback) { if (!hidden) output.write(chunk, encoding); callback(); } });
  sink.isTTY = true; sink.columns = output.columns || 80;
  const rl = createInterface({ input, output: sink, terminal: true, historySize: 0 });
  const controller = new AbortController();
  rl.on('SIGINT', () => controller.abort()); rl.on('close', () => controller.abort());
  const ask = async (label, fallback, secret = false) => {
    const pending = rl.question(secret ? `${label} (hidden; Enter keeps current key): ` : `${label} [${fallback}]: `, { signal: controller.signal });
    hidden = secret;
    try { return (await pending).trim() || fallback; }
    finally { hidden = false; if (secret) output.write('\n'); }
  };
  output.write(`TEA user configuration\n${filename}\n`);
  try {
    const baseUrl = await ask('Messages API base URL', existing.baseUrl || defaults.baseUrl);
    const model = await ask('Model', existing.model || defaults.model);
    const thinkingMode = await ask('Thinking mode (adaptive/enabled)', existing.thinkingMode || (model.toLowerCase().startsWith('glm-') ? 'enabled' : defaults.thinkingMode));
    const effort = await ask('Reasoning effort (low/high/max)', existing.effort || defaults.effort);
    const apiKey = await ask('API key', existing.apiKey || defaults.apiKey, true);
    if (!apiKey) throw new ConfigError('No API key supplied; configuration was not saved');
    await saveUserConfig({ ...existing, baseUrl, model, thinkingMode, effort, apiKey }, { filename });
    output.write('Saved. API key is hidden. Environment and CLI options can override this file. Restart tea to load changes.\n');
  } catch (error) {
    if (controller.signal.aborted) throw new ConfigError('Configuration cancelled; no completed save');
    throw error;
  } finally { hidden = false; rl.close(); }
}
