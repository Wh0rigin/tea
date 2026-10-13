import { createHash } from 'node:crypto';
import path from 'node:path';
import { commandArguments, recognizeValidation, nodeTestSummary } from './comparison-validation.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const names = { read_file: 'read', read: 'read', apply_patch: 'edit', edit: 'edit', write: 'edit', run_tests: 'shell', run_shell: 'shell', powershell: 'shell', bash: 'shell' };
const versionsEqual = (a, b) => a !== null && b !== null && Object.keys(a).length > 0 && JSON.stringify(a) === JSON.stringify(b) && Object.values(a).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));

/** Observe native events only; no changes to tools, prompts or execution policy. */
export function createComparisonTurnAudit({ agent, workspace, requiredPath, expectedOutput, readOnly = false,
  validationTargets = ['tests/public.test.mjs'], packageScripts = {}, captureSources, getPackageScripts }) {
  const calls = [], pending = new Map();
  let validatedAfterEdit = false, validatedSources = null, observerMs = 0;
  const sources = () => { try { return captureSources ? captureSources() : null; } catch { return null; } };
  const observe = event => {
    const startedObserver = performance.now();
    try {
      const tea = !['pi', 'claude'].includes(agent);
      const start = tea ? event.type === 'tool_start' : event.type === 'tool_execution_start';
      const end = tea ? event.type === 'tool_end' : event.type === 'tool_execution_end';
      const key = tea ? 'native-tea' : event.toolCallId;
      if (start) {
        if (!key || pending.has(key)) calls.push({ malformed: true });
        pending.set(key, { name: tea ? event.name : event.toolName, input: tea ? event.input : event.args,
          startedAt: new Date().toISOString(), startedMs: performance.now(), sourceVersions: sources() });
        return;
      }
      if (!end) return;
      const prior = pending.get(key); pending.delete(key);
      if (!prior) { calls.push({ malformed: true }); return; }
      const call = tea ? { ...prior, name: event.name, input: event.input } : prior;
      if (!call) { calls.push({ malformed: true }); return; }
      const output = tea ? String(event.output) : (event.result?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
      const kind = names[call.name] || 'other', input = call.input || {};
      let relativePath = null;
      if (typeof input.path === 'string') relativePath = path.relative(workspace, path.resolve(workspace, input.path)).replaceAll(path.sep, '/');
      if (relativePath === '..' || relativePath?.startsWith('../')) relativePath = '[OUTSIDE WORKSPACE]';
      const denied = /^(?:Command denied by user\.|Unlisted shell commands require|Shell operators and multiline commands are blocked)/.test(output);
      const success = !event.isError && !denied;
      const after = sources(), before = call.sourceVersions ?? (captureSources ? null : after);
      if (kind === 'edit' || captureSources && !versionsEqual(before, after)) { validatedAfterEdit = false; validatedSources = null; }
      const command = typeof input.command === 'string' ? input.command : null;
      let scripts = packageScripts;
      if (command && getPackageScripts) { try { scripts = getPackageScripts(); } catch { scripts = {}; } }
      const selection = command ? recognizeValidation(command, { workspace, targets: validationTargets, packageScripts: scripts }) : { recognized: false };
      const summary = selection.recognized ? nodeTestSummary(output) : null;
      const explicitExit = tea ? output.match(/^exit=(-?\d+)\b/) : null;
      const exitCode = explicitExit ? Number(explicitExit[1]) : Number.isSafeInteger(event.result?.details?.exitCode) ? event.result.details.exitCode : null;
      const stableSources = !captureSources || versionsEqual(before, after);
      const validationPassed = kind === 'shell' && selection.recognized && success && summary.positiveCompletion
        && (tea ? exitCode === 0 : exitCode === null || exitCode === 0) && stableSources;
      if (validationPassed) { validatedAfterEdit = true; validatedSources = after; }
      const words = command ? commandArguments(command) : null;
      const argumentShape = words?.slice(1).map(arg => arg.startsWith('-') && arg.length < 120 ? arg.split('=')[0]
        : arg.replaceAll('\\', '/').startsWith('tests/') || arg.replaceAll('\\', '/').startsWith('./tests/') ? 'test-path' : 'value');
      calls.push({ name: call.name, kind, relativePath, success, outputSha256: hash(output), relevantValidation: Boolean(selection.recognized),
        ...(agent === 'claude' ? { nativeOutputSha256: event.result?.details?.nativeOutputSha256 ?? null,
          readNumberingDecoded: Boolean(event.result?.details?.readNumberingDecoded) } : {}),
        startedAt: call.startedAt ?? null, completedAt: new Date().toISOString(), elapsedMs: event.elapsedMs ?? (call.startedMs ? performance.now() - call.startedMs : null),
        execution: command ? { commandSha256: hash(command), program: words?.[0]?.replaceAll('\\', '/').split('/').at(-1) || null,
          argumentShape: argumentShape ?? null, argumentsSha256: words ? hash(JSON.stringify(words.slice(1))) : null,
          approval: denied ? output.startsWith('Command denied') ? 'denied' : 'unavailable-or-blocked' : 'not-reported', exitCode, settled: true } : null,
        sourceVersionsBefore: before, sourceVersionsAfter: after,
        validationEvidence: selection.recognized ? { ...selection, summary, stableSources, passed: Boolean(validationPassed) } : { ...selection, passed: false } });
    } finally { observerMs += performance.now() - startedObserver; }
  };
  return { observe, finish() {
    if (captureSources && validatedAfterEdit && !versionsEqual(validatedSources, sources())) validatedAfterEdit = false;
    const fullSourceRead = !requiredPath || calls.some(call => call.kind === 'read' && call.success && call.relativePath === requiredPath && call.outputSha256 === hash(expectedOutput));
    const readOnlyHonored = !readOnly || !calls.some(call => ['edit', 'shell'].includes(call.kind));
    return { calls, fullSourceRead, readOnlyHonored, passed: fullSourceRead && readOnlyHonored && pending.size === 0 && !calls.some(call => call.malformed),
      expectedOutputSha256: requiredPath ? hash(expectedOutput) : null, validatedAfterEdit, observerMs };
  } };
}
