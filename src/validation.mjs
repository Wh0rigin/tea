import { parseCommand } from './commands.mjs';

export function validationSucceeded(output) {
  const text = String(output);
  const ran = text.match(/\bRan (\d+) tests?\b/), skipped = text.match(/(?:^|\n)OK \(skipped=(\d+)\)/);
  if (ran && skipped && Number(skipped[1]) >= Number(ran[1])) return false;
  return /^exit=0\b/.test(String(output))
    && !/(?:^|\n)\s*(?:#|ℹ\uFE0F?)\s+(?:tests|pass)\s+0\s*(?:\n|$)/.test(String(output))
    && !/\bRan 0 tests?\b|\bno tests ran\b|\bcollected 0 items\b/i.test(String(output));
}

export function invalidateUnavailableValidation(state) {
  return (state.validationUnavailable || []).map(({ alternativeCommand, ...item }) => item);
}

function runnerFamily(command) {
  try {
    const { executable } = parseCommand(command);
    const name = executable.replace(/\.exe$/i, '').toLowerCase();
    if (['python', 'python3', 'pytest'].includes(name)) return 'python';
    if (['node', 'npm'].includes(name)) return 'node';
    return null;
  } catch { return null; }
}

// Only startup evidence, never an import failure inside a running test suite.
export function validationRunnerUnavailable(command, output, error) {
  if (error?.feedbackCode === 'EXECUTABLE_UNAVAILABLE' && error.code === 'ENOENT') return true;
  let parsed;
  try { parsed = parseCommand(command); } catch { return false; }
  if (!/^python3?(?:\.exe)?$/.test(parsed.executable) || parsed.args[0] !== '-m'
    || !['pytest', 'unittest'].includes(parsed.args[1])) return false;
  const match = String(output).match(/^exit=[1-9]\d*\nstdout:\n([\s\S]*?)\nstderr:\n([^\r\n]+)\s*$/);
  return Boolean(match && !match[1].trim()
    && match[2].endsWith(`: No module named ${parsed.args[1]}`));
}

function nonemptyTestPass(output) {
  const text = String(output);
  return /(?:^|\n)\s*(?:#|ℹ\uFE0F?)\s+pass\s+[1-9]\d*\s*(?:\n|$)/.test(text)
    || /\b[1-9]\d* passed\b/.test(text)
    || /\bRan [1-9]\d* tests?\b/.test(text) && /(?:^|\n)OK(?:\s|$)/.test(text);
}

export function validationCommandKey(command) {
  // Match the execution grammar, preserving quoted whitespace and argument
  // order. Do not infer that a narrower or differently configured run covers it.
  try { return JSON.stringify(parseCommand(command)); }
  catch { return JSON.stringify({ invalid: String(command) }); }
}

export function observeValidation(state, command, output, failed = false, error) {
  const key = validationCommandKey(command);
  const success = !failed && validationSucceeded(output);
  const failures = (state.validationFailures || []).filter(item => !success || item.key !== key);
  let unavailable = (state.validationUnavailable || []).filter(item => !success || item.key !== key);
  const missingRunner = !success && validationRunnerUnavailable(command, output, error);
  if (missingRunner) {
    const item = { key, command: String(command).trim(), family: runnerFamily(command) };
    unavailable = [...unavailable.filter(entry => entry.key !== key), item];
  } else if (!success && !failures.some(item => item.key === key)) {
    failures.push({ key, command: String(command).trim() });
  }
  // An executed nonempty alternative can establish fresh validation, but cannot
  // clear any observed source failure or claim the unavailable check ran.
  if (success && nonemptyTestPass(output)) {
    const family = runnerFamily(command);
    unavailable = unavailable.map(item => family && item.family === family
      ? { ...item, alternativeCommand: String(command).trim() } : item);
  }
  const pending = !success || failures.length > 0 || unavailable.some(item => !item.alternativeCommand);
  return { validationFailures: failures, validationUnavailable: unavailable,
    validationPassed: !pending, pendingValidation: pending };
}

export function unavailableValidationNotice(state) {
  const entries = state.validationUnavailable || [];
  if (!entries.length) return '';
  return 'Unavailable checks remain unverified: ' + JSON.stringify(entries.map(({ command, alternativeCommand }) =>
    ({ command, ...(alternativeCommand ? { alternativeCommand } : {}) })))
    + '. Use an installed relevant runner with nonzero tests; an alternative pass does not prove equivalent coverage. Report this limitation.';
}

export function unresolvedValidationCommands(state) {
  return (state.validationFailures || []).map(item => item.command);
}
