import { createHash } from 'node:crypto';

// Versioned descriptions of existing policy. This module grants no permissions.
export function runtimeCapabilities({ platform = process.platform, approveCommand,
  stdinIsTTY = Boolean(process.stdin.isTTY), stdoutIsTTY = Boolean(process.stdout.isTTY), fileCreation = false, editPermissions } = {}) {
  const approval = typeof approveCommand === 'function' ? 'handler' : stdinIsTTY && stdoutIsTTY ? 'interactive' : 'unavailable';
  const hints = Array.isArray(approveCommand?.commandHints) ? approveCommand.commandHints.filter(x=>typeof x==='string'&&x.length<=160&&!/[\r\n]/.test(x)).slice(0,4) : [];
  const identity = { schemaVersion: 1, policyVersion: 3, platform, approval,
    ...(/^[a-f0-9]{16}$/.test(approveCommand?.commandPolicyId || '') ? { commandPolicyId: approveCommand.commandPolicyId } : {}),
    ...(hints.length ? { commandHints: hints } : {}),
    ...(fileCreation ? { fileCreation: true } : {}),
    ...(editPermissions?.active ? { editPermissions: editPermissions.version } : {}) };
  return { ...identity, version: `v1-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 12)}` };
}

export function capabilityNotice(capabilities) {
  const approval = capabilities.approval === 'unavailable'
    ? 'Unlisted run_shell cannot obtain approval in this session; rephrasing cannot enable it.'
    : 'Unlisted run_shell needs explicit approval; approval can be refused.';
  const windows = capabilities.platform === 'win32' ? ' Windows npm allowlisted commands additionally reject CMD metacharacters; direct executables accept quoted arguments.' : '';
  const hints = capabilities.commandHints?.length ? ` Host-approved command examples (other restrictions still apply): ${capabilities.commandHints.join(' / ')}.` : '';
  const edits=capabilities.editPermissions ? ' File edits follow configured deny/ask/allow paths; a denial means keep that target unchanged, not write it through shell. These tool rules are not a subprocess filesystem sandbox.' : '';
  const creation = capabilities.fileCreation ? ' Create new files and missing parent directories with write_file; edit existing files with apply_patch. run_shell starts executables directly, not Bash or PowerShell: no cd, redirects or heredocs. On Windows, mkdir/md/cd/dir/type/echo are CMD built-ins and may not exist as executables. Do not create files via shell or encoded inline scripts. If no tests exist, create a small regression test with write_file and run it with run_tests.' : '';
  return `Runtime capabilities ${capabilities.version} (${capabilities.platform}, approval=${capabilities.approval}): workspace-relative paths only. run_tests command forms: node --test FILE; npm test/run test|lint|check|typecheck; python/python3 -m pytest|unittest; pytest; go test/build/vet; read-only git status/diff/log/show/rev-parse/ls-files and branch listing. Installed runners depend on the project. Shell operators and multiline text are blocked, including quoted JavaScript.${windows} ${approval}${hints} Use an existing permitted validation entry. If required checks cannot run, report which remain unverified. A capability denial gives no evidence that source code is wrong.${creation}${edits}`;
}

const actions = {
  EDIT_PERMISSION_DENIED: ['allowed-edit-target','Keep protected files unchanged. Use an allowed file or a new regression test; do not bypass via scripts.'],
  EDIT_APPROVAL_UNAVAILABLE: ['edit-approval','This edit requires explicit approval. Use an interactive session or report the protected edit as blocked.'],
  EDIT_APPROVAL_DENIED: ['edit-approval','Keep the refused target unchanged; do not retry variants or use scripts.'],
  TOOL_POLICY_DENIED: ['allowed-tool-call','Follow the host policy reason and choose an allowed operation.'],
  CAPABILITY_DENIED: ['operation-policy', 'Use workspace-relative files and an existing permitted validation entry; quoting cannot enable a blocked operation. A denial is not evidence of a source-code defect.'],
  APPROVAL_UNAVAILABLE: ['explicit-approval', 'This session cannot approve unlisted commands. Use an existing run_tests entry; report required checks that remain unverified.'],
  APPROVAL_DENIED: ['explicit-approval', 'The approval handler did not grant permission. Do not resubmit variants; use a permitted entry or report the verification limit.'],
  COMMAND_POLICY_DENIED: ['command-policy', 'The host command policy denied this operation. Follow its reason; use an allowed entry or report the missing capability.'],
  USER_APPROVAL_DENIED: ['explicit-approval', 'The user refused this command. Do not resubmit variants or bypass the refusal.'],
  APPROVAL_INVALID: ['valid-approval-decision', 'The host returned an invalid approval decision. Command was not executed; report the host configuration error.'],
  APPROVAL_HANDLER_FAILED: ['working-approval-handler', 'The host approval handler failed. Command was not executed; report the host configuration error.'],
  INPUT_INVALID: ['valid-input', 'Correct the input using workspace-relative paths and documented tool parameters.'],
  SOURCE_MISMATCH: ['current-source-evidence', 'Read the current target and construct a new unique patch from that evidence.'],
  FILE_EXISTS: ['edit-existing-file', 'Use apply_patch with current source evidence; read only if it is missing or stale. File existence alone does not invalidate a prior read.'],
  PATCH_NOT_FOUND: ['matching-search-text', 'Check the exact search text against current source; refresh the relevant range if needed. A missing match does not prove a version change.'],
  PATCH_AMBIGUOUS: ['unique-search-text', 'Use a unique search with more surrounding context from current evidence; read the relevant range only if needed.'],
  PATCH_OVERLAP: ['disjoint-edits', 'Merge overlapping replacements into one edit matched against the original file. No edits from this call were applied.'],
  VALIDATION_FAILED: ['passing-validation', 'Inspect the test failure, fix supported source defects, then rerun relevant validation.'],
  VALIDATION_UNAVAILABLE: ['installed-test-runner', 'The runner did not start; this is not a test assertion failure. Use an installed relevant runner with nonzero tests. Keep the original check explicitly unverified; an alternative does not prove equivalent coverage.'],
  EXECUTABLE_UNAVAILABLE: ['installed-executable', 'Check the available project validation entry; an unavailable executable is not a source-code failure.'],
  EXECUTION_FAILED: ['successful-execution', 'Inspect this command failure and its inputs; a failed diagnostic does not establish test failure or validation.'],
  EXECUTION_TRANSIENT: ['completed-execution', 'Inspect the execution failure before retrying; successful edits remain and this attempt proves no validation.'],
  EXECUTION_INCOMPLETE: ['complete-command-output', 'The direct process exited but inherited output remained open. Inspect background work and partial output; do not claim validation or blindly restart the command.'],
  EXECUTION_CANCELLED: ['completed-execution', 'The command was interrupted. Inspect effects and follow the next user instruction.'],
  TOOL_FAILED: ['successful-tool-result', 'Inspect the reported failure and obtain new evidence before another attempt.'],
};

export class ToolFeedbackError extends Error {
  constructor(code, message) { super(message); this.name = 'ToolFeedbackError'; this.feedbackCode = code; }
}

export function toolFailureFeedback({ error, output, toolName, validation = false, runnerUnavailable = false }) {
  let code = error?.feedbackCode;
  if (runnerUnavailable) code = 'VALIDATION_UNAVAILABLE';
  const text = String(output ?? error?.message ?? '');
  if (!code && /^Command denied by user\./.test(text)) code = 'APPROVAL_DENIED';
  if (!code && /^Command not approved by approval handler\./.test(text)) code = 'APPROVAL_DENIED';
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
