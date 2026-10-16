import { createHash } from 'node:crypto';

// Versioned descriptions of existing policy. This module grants no permissions.
export function runtimeCapabilities({ platform = process.platform, approveCommand,
  stdinIsTTY = Boolean(process.stdin.isTTY), stdoutIsTTY = Boolean(process.stdout.isTTY), fileCreation = false } = {}) {
  const approval = typeof approveCommand === 'function' ? 'handler' : stdinIsTTY && stdoutIsTTY ? 'interactive' : 'unavailable';
  const identity = { schemaVersion: 1, policyVersion: fileCreation ? 2 : 1, platform, approval,
    ...(fileCreation ? { fileCreation: true } : {}) };
  return { ...identity, version: `v1-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 12)}` };
}

export function capabilityNotice(capabilities) {
  const approval = capabilities.approval === 'unavailable'
    ? 'Unlisted run_shell cannot obtain approval in this session; rephrasing cannot enable it.'
    : 'Unlisted run_shell needs explicit approval; approval can be refused.';
  const windows = capabilities.platform === 'win32' ? ' Windows allowlisted commands also reject quotes, parentheses, %, ! and ^.' : '';
  const creation = capabilities.fileCreation ? ' Create new files and missing parent directories with write_file; edit existing files with apply_patch. run_shell starts executables directly, not Bash or PowerShell: no cd, redirects or heredocs. On Windows, mkdir/md/cd/dir/type/echo are CMD built-ins and may not exist as executables. Do not create files via shell or encoded inline scripts. If no tests exist, create a small regression test with write_file and run it with run_tests.' : '';
  return `Runtime capabilities ${capabilities.version} (${capabilities.platform}, approval=${capabilities.approval}): workspace-relative paths only. run_tests command forms: node --test FILE; npm test/run test|lint|check|typecheck; python -m pytest|unittest; pytest; read-only git status/diff/log. Installed runners depend on the project. Shell operators and multiline text are blocked, including quoted JavaScript.${windows} ${approval} Use an existing permitted validation entry. If required checks cannot run, report which remain unverified. A capability denial gives no evidence that source code is wrong.${creation}`;
}

const actions = {
  CAPABILITY_DENIED: ['operation-policy', 'Use workspace-relative files and an existing permitted validation entry; quoting cannot enable a blocked operation. A denial is not evidence of a source-code defect.'],
  APPROVAL_UNAVAILABLE: ['explicit-approval', 'This session cannot approve unlisted commands. Use an existing run_tests entry; report required checks that remain unverified.'],
  APPROVAL_DENIED: ['explicit-approval', 'The user refused this command. Do not resubmit variants; use a permitted entry or report the verification limit.'],
  INPUT_INVALID: ['valid-input', 'Correct the input using workspace-relative paths and documented tool parameters.'],
  SOURCE_MISMATCH: ['current-source-evidence', 'Read the current target and construct a new unique patch from that evidence.'],
  VALIDATION_FAILED: ['passing-validation', 'Inspect the test failure, fix supported source defects, then rerun relevant validation.'],
  VALIDATION_TIMEOUT: ['bounded-validation', 'Validation exceeded its command deadline; no pass was established. Inspect the runner, control flow and test cleanup for hangs or unfinished work before retrying. A timeout alone does not identify a code or environment defect. Do not rerun the unchanged command without new evidence or a relevant change.'],
  EXECUTABLE_UNAVAILABLE: ['installed-executable', 'Check the available project validation entry; an unavailable executable is not a source-code failure.'],
  EXECUTION_FAILED: ['successful-execution', 'Inspect this command failure and its inputs; a failed diagnostic does not establish test failure or validation.'],
  EXECUTION_TRANSIENT: ['completed-execution', 'Inspect the execution failure before retrying; successful edits remain and this attempt proves no validation.'],
  EXECUTION_CANCELLED: ['completed-execution', 'The command was interrupted. Inspect effects and follow the next user instruction.'],
  TOOL_FAILED: ['successful-tool-result', 'Inspect the reported failure and obtain new evidence before another attempt.'],
};

export class ToolFeedbackError extends Error {
  constructor(code, message) { super(message); this.name = 'ToolFeedbackError'; this.feedbackCode = code; }
}

export function toolFailureFeedback({ error, output, toolName, validation = false, repairGuidance = false }) {
  let code = error?.feedbackCode;
  const text = String(output ?? error?.message ?? '');
  if (!code && /^Command denied by user\./.test(text)) code = 'APPROVAL_DENIED';
  if (!code && /^exit=(?!0\b)-?\d+\b/.test(text)) code = validation ? 'VALIDATION_FAILED' : 'EXECUTION_FAILED';
  if (!code && error?.code === 'ENOENT') code = ['run_tests', 'run_shell'].includes(toolName) ? 'EXECUTABLE_UNAVAILABLE' : 'INPUT_INVALID';
  if (!code && error && /cancelled|AbortError/i.test(text)) code = 'EXECUTION_CANCELLED';
  const repair = repairGuidance && validation && ['run_tests', 'run_shell'].includes(toolName);
  if (!code && repair && error && /^Command timed out after \d+ ms$/.test(text)) code = 'VALIDATION_TIMEOUT';
  if (!code && error && (/timed out/.test(text) || ['EAGAIN', 'EBUSY', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code))) code = 'EXECUTION_TRANSIENT';
  if (!code && error) code = 'TOOL_FAILED';
  if (!code) return null;
  const [missingCapability, originalNext] = actions[code] || actions.TOOL_FAILED;
  const next = repair && code === 'VALIDATION_FAILED'
    ? 'Compare the failing assertion with the task contract and existing tests. Fix the implementation or an incorrect newly added test expectation only with evidence; preserve existing tests and user changes unless the task requires modifying them. Never weaken required checks just to pass. Rerun the smallest relevant check, then the required suite.'
    : originalNext;
  return { version: 1, code, retryable: code === 'EXECUTION_TRANSIENT', missingCapability, next };
}

export function appendFailureFeedback(output, feedback) {
  return feedback ? `${output}\n[tool_feedback] ${JSON.stringify(feedback)}` : output;
}
