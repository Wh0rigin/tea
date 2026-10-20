import { parseCommand } from './commands.mjs';

export function validationSucceeded(output) {
  return /^exit=0\b/.test(String(output))
    && !/(?:^|\n)\s*(?:#|ℹ\uFE0F?)\s+(?:tests|pass)\s+0\s*(?:\n|$)/.test(String(output));
}

export function validationCommandKey(command) {
  // Match the execution grammar, preserving quoted whitespace and argument
  // order. Do not infer that a narrower or differently configured run covers it.
  try { return JSON.stringify(parseCommand(command)); }
  catch { return JSON.stringify({ invalid: String(command) }); }
}

export function observeValidation(state, command, output, failed = false) {
  const key = validationCommandKey(command);
  const success = !failed && validationSucceeded(output);
  const failures = (state.validationFailures || []).filter(item => !success || item.key !== key);
  if (!success && !failures.some(item => item.key === key)) failures.push({ key, command: String(command).trim() });
  return { validationFailures: failures, validationPassed: success && failures.length === 0,
    pendingValidation: !success || failures.length > 0 };
}

export function unresolvedValidationCommands(state) {
  return (state.validationFailures || []).map(item => item.command);
}
