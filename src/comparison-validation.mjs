import path from 'node:path';

/** Deliberately limited command grammar: ambiguous shell programs stay unconfirmed. */
export function commandArguments(command) {
  if (typeof command !== 'string' || /[\r\n\0]/.test(command)) return null;
  const words = []; let word = '', quote = null, active = false;
  for (const char of command.trim()) {
    if (quote) { if (char === quote) quote = null; else word += char; active = true; continue; }
    if (char === '"' || char === "'") { quote = char; active = true; continue; }
    if (/\s/.test(char)) { if (active) { words.push(word); word = ''; active = false; } continue; }
    if (/[;|<>`$]/.test(char) || char === '&' && (words.length || active)) return null;
    if (char === '&') { words.push('&'); continue; }
    word += char; active = true;
  }
  if (quote) return null;
  if (active) words.push(word);
  if (words[0] === '&') words.shift();
  return words.length ? words : null;
}

const base = value => value.replaceAll('\\', '/').split('/').at(-1).toLowerCase();
const relative = (workspace, value) => {
  const normalized = value.replaceAll('\\', '/');
  if (/^[a-z]:\//i.test(normalized) || path.isAbsolute(normalized)) {
    const root = workspace.replaceAll('\\', '/').replace(/\/$/, '');
    if (!normalized.toLowerCase().startsWith(root.toLowerCase() + '/')) return null;
    return path.posix.normalize(normalized.slice(root.length + 1));
  }
  const result = path.posix.normalize(normalized);
  return result === '..' || result.startsWith('../') ? null : result;
};

export function recognizeValidation(command, { workspace, targets = ['tests/public.test.mjs'], packageScripts = {}, depth = 0, extraArgs = [] } = {}) {
  const words = commandArguments(command);
  if (!words || depth > 4) return { recognized: false, reason: 'ambiguous-or-unresolved-command' };
  const executable = base(words[0]);
  let args = [...words.slice(1), ...extraArgs];
  if (['npm', 'npm.cmd', 'npm.exe'].includes(executable)) {
    let script;
    if (args[0] === 'test') { script = 'test'; args = args.slice(1); }
    else if (args[0] === 'run' && args[1]) { script = args[1]; args = args.slice(2); }
    if (!script || typeof packageScripts[script] !== 'string' || args.length && args[0] !== '--') return { recognized: false, reason: 'unresolved-package-script' };
    return recognizeValidation(packageScripts[script], { workspace, targets, packageScripts, depth: depth + 1, extraArgs: args.length ? args.slice(1) : [] });
  }
  if (!['node', 'node.exe'].includes(executable) || !args.includes('--test')) return { recognized: false, reason: 'not-declared-test-runner' };
  if (args.some(arg => /^(?:--test-(?:name-pattern|skip-pattern|only|shard)|--eval|--print|--list|-e|-p)(?:=|$)/.test(arg))) return { recognized: false, reason: 'filtered-or-nonexecuting-tests' };
  const paths = [];
  const valueFlags = new Set(['--test-reporter', '--test-reporter-destination', '--test-concurrency', '--test-timeout', '--import', '--require']);
  for (let n = 0; n < args.length; n++) {
    const arg = args[n];
    if (arg === '--') { paths.push(...args.slice(n + 1)); break; }
    if (valueFlags.has(arg)) { if (!args[++n]) return { recognized: false, reason: 'missing-option-value' }; continue; }
    if (arg === '--test' || arg === '--test-force-exit') continue;
    if (/^--(?:test-(?:reporter|reporter-destination|concurrency|timeout)|import|require)=/.test(arg)) continue;
    if (arg.startsWith('-')) return { recognized: false, reason: 'unknown-test-option' };
    paths.push(arg);
  }
  const actual = paths.map(value => relative(workspace, value));
  const expected = targets.map(value => relative(workspace, value));
  if (actual.some(value => !value) || !expected.length || expected.some(value => !actual.includes(value))) return { recognized: false, reason: 'required-suite-not-selected' };
  return { recognized: true, framework: 'node', targets: actual, reason: 'declared-node-test-suite' };
}

export function nodeTestSummary(output) {
  const text = String(output).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const counts = {};
  for (const match of text.matchAll(/(?:^|\n)\s*(?:#|ℹ\uFE0F?)\s+(tests|pass|fail)\s+(\d+)\s*(?=\n|$)/g)) counts[match[1]] = Number(match[2]);
  return { ...counts, positiveCompletion: Number.isSafeInteger(counts.tests) && counts.tests > 0
    && Number.isSafeInteger(counts.pass) && counts.pass > 0 && counts.fail === 0 && counts.pass === counts.tests };
}

export function acceptanceDimensions({ evaluation, turns, plannedTurns, status, usageComplete }) {
  const codeCorrect = Boolean(evaluation.publicPassed && evaluation.hiddenPassed && evaluation.hiddenCompleted);
  const scopeCorrect = Boolean(evaluation.scopePassed);
  const requiredTurnsComplete = turns.length === plannedTurns && turns.every(turn => turn.status === 'completed');
  const declaredReadRequirements = requiredTurnsComplete && turns.every(turn => turn.requirements?.passed);
  const nativePostEditValidation = Boolean(turns.at(-1)?.nativeValidationPassed && turns.at(-1)?.requirements?.validatedAfterEdit);
  const nativeCompleted = status === 'completed' && requiredTurnsComplete;
  const dimensions = { codeCorrect, scopeCorrect, declaredReadRequirements, nativePostEditValidation, nativeCompleted, usageComplete: Boolean(usageComplete) };
  return { dimensions, accepted: Object.values(dimensions).every(Boolean) };
}
