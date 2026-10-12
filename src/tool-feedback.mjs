import { createHash } from 'node:crypto';

// Versioned descriptions of existing policy. This module grants no permissions.
export function runtimeCapabilities({ platform = process.platform, approveCommand,
  stdinIsTTY = Boolean(process.stdin.isTTY), stdoutIsTTY = Boolean(process.stdout.isTTY) } = {}) {
  const approval = typeof approveCommand === 'function' ? 'handler' : stdinIsTTY && stdoutIsTTY ? 'interactive' : 'unavailable';
  const identity = { schemaVersion: 1, policyVersion: 1, noticeVersion: 2, platform, approval };
  return { ...identity, version: `v1-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 12)}` };
}

export function capabilityNotice(capabilities) {
  const approval = capabilities.approval === 'unavailable'
    ? 'Unlisted run_shell cannot obtain approval; no retry variants.'
    : 'Unlisted run_shell needs explicit approval; it may be refused.';
  const windows = capabilities.platform === 'win32' ? ' Windows blocks quotes, (), %, !, ^.' : '';
  return `Runtime capabilities ${capabilities.version} (${capabilities.platform}, approval=${capabilities.approval}): workspace-relative paths. Tests (if installed): node --test; npm test/run test|lint|check|typecheck; python -m pytest|unittest; pytest. No shell operators/newlines, even quoted.${windows} ${approval} Denial is not a code defect; report unverified checks.`;
}

const actions = {
  CAPABILITY_DENIED: ['operation-policy', 'Use workspace-relative files and an existing permitted validation entry; quoting cannot enable a blocked operation. A denial is not evidence of a source-code defect.'],
  APPROVAL_UNAVAILABLE: ['explicit-approval', 'This session cannot approve unlisted commands. Use an existing run_tests entry; report required checks that remain unverified.'],
  APPROVAL_DENIED: ['explicit-approval', 'The user refused this command. Do not resubmit variants; use a permitted entry or report the verification limit.'],
  INPUT_INVALID: ['valid-input', 'Correct the input using workspace-relative paths and documented tool parameters.'],
  SOURCE_MISMATCH: ['current-source-evidence', 'Read the current target and construct a new unique patch from that evidence.'],
  VALIDATION_FAILED: ['passing-validation', 'Inspect the test failure, fix supported source defects, then rerun relevant validation.'],
  EXECUTABLE_UNAVAILABLE: ['installed-executable', 'Check the available project validation entry; an unavailable executable is not a source-code failure.'],
  EXECUTION_FAILED: ['successful-execution', 'Inspect this command failure and its inputs; a failed diagnostic does not establish test failure or validation.'],
  EXECUTION_TRANSIENT: ['completed-execution', 'Inspect the execution failure before retrying; successful edits remain and this attempt proves no validation.'],
  EXECUTION_CANCELLED: ['completed-execution', 'The command was interrupted. Inspect effects and follow the next user instruction.'],
  TOOL_FAILED: ['successful-tool-result', 'Inspect the reported failure and obtain new evidence before another attempt.'],
};

export class ToolFeedbackError extends Error {
  constructor(code, message) { super(message); this.name = 'ToolFeedbackError'; this.feedbackCode = code; }
}

export function toolFailureFeedback({ error, output, toolName, validation = false }) {
  let code = error?.feedbackCode;
  const text = String(output ?? error?.message ?? '');
  if (!code && /^Command denied by user\./.test(text)) code = 'APPROVAL_DENIED';
  if (!code && /^exit=(?!0\b)-?\d+\b/.test(text)) code = validation ? 'VALIDATION_FAILED' : 'EXECUTION_FAILED';
  if (!code && error?.code === 'ENOENT') code = ['run_tests', 'run_shell'].includes(toolName) ? 'EXECUTABLE_UNAVAILABLE' : 'INPUT_INVALID';
  if (!code && error && /cancelled|AbortError/i.test(text)) code = 'EXECUTION_CANCELLED';
  if (!code && error && (/timed out/.test(text) || ['EAGAIN', 'EBUSY', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code))) code = 'EXECUTION_TRANSIENT';
  if (!code && error) code = 'TOOL_FAILED';
  if (!code) return null;
  const [missingCapability, next] = actions[code] || actions.TOOL_FAILED;
  return { version: 1, code, retryable: code === 'EXECUTION_TRANSIENT', missingCapability, next };
}

export function appendFailureFeedback(output, feedback) {
  return feedback ? `${output}\n[tool_feedback] ${JSON.stringify(feedback)}` : output;
}
