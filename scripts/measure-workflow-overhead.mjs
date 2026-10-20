import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WorkspaceTools } from '../src/tools.mjs';
import { buildSystemPrompt } from '../src/prompts.mjs';
import { capabilityNotice, runtimeCapabilities } from '../src/tool-feedback.mjs';

// Offline serialization only: no configuration, credentials, provider, or edits.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv[2] || 'b400577185f0b224850540cc9289672f62450f33';
if (!/^[a-f0-9]{40}$/.test(baseline)) throw new Error('Expected a full baseline Git SHA');
const oldSource = file => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
const system = oldSource('src/agent.mjs').match(/const SYSTEM_PROMPT = `([^`]+)`;/)?.[1];
const source = oldSource('src/tools.mjs');
const from = source.indexOf('export const TOOL_DEFINITIONS');
const end = source.indexOf('export const TERM_MAPPING_TOOL');
if (!system || from < 0 || end <= from) throw new Error('Unsupported baseline format');
// This is a literal definition block from the explicitly pinned repository
// commit, not model/user code. The timeout bounds unexpected source changes.
const old = runInNewContext(source.slice(from, end).replaceAll('export const ', 'const ')
  + '\n({small:SMALL_DISCOVERY_DEFINITIONS,wide:TOOL_DEFINITIONS})', {}, { timeout: 1000 });
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
const capabilityBytes = bytes(capabilityNotice(runtimeCapabilities({ platform: 'win32', stdinIsTTY: true,
  stdoutIsTTY: true, fileCreation: true })));
const profiles = [false, true].map(wide => {
  const tools = new WorkspaceTools({ workspace: root }); tools.discoveryWide = wide;
  const definitions = tools.modelToolDefinitions({ includeMemory: false });
  const beforeSchemaBytes = bytes(wide ? old.wide : old.small), afterSchemaBytes = bytes(definitions);
  const beforeSystemBytes = bytes(system), afterSystemBytes = bytes(buildSystemPrompt(definitions));
  const beforeTotalBytes = beforeSystemBytes + beforeSchemaBytes + capabilityBytes;
  const afterTotalBytes = afterSystemBytes + afterSchemaBytes + capabilityBytes;
  return { inventory: wide ? 'wide' : 'small', beforeSystemBytes, afterSystemBytes,
    beforeSchemaBytes, afterSchemaBytes, capabilityBytes, beforeTotalBytes, afterTotalBytes,
    increasePct: (afterTotalBytes / beforeTotalBytes - 1) * 100 };
});
console.log(JSON.stringify({ unit: 'UTF-8 bytes, not provider tokens', baseline,
  scope: 'Win32 interactive, creation enabled; system + capability notice + tools; excludes task, inventory, history and wire envelope',
  profiles }, null, 2));
