import { createHash } from 'node:crypto';
import path from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const names = { read_file: 'read', read: 'read', apply_patch: 'edit', edit: 'edit', write: 'edit', run_tests: 'shell', run_shell: 'shell', powershell: 'shell', bash: 'shell' };

/** Only settled native tool results establish source/validation evidence. */
export function createComparisonTurnAudit({ agent, workspace, requiredPath, expectedOutput, readOnly = false }) {
  const calls = [], pending = new Map();
  let validatedAfterEdit = false;
  const observe = event => {
    if (agent === 'pi' && event.type === 'tool_execution_start') pending.set(event.toolCallId, { name: event.toolName, input: event.args });
    const teaEnd = agent === 'tea' && event.type === 'tool_end';
    const piEnd = agent === 'pi' && event.type === 'tool_execution_end';
    if (!teaEnd && !piEnd) return;
    const call = teaEnd ? { name: event.name, input: event.input } : pending.get(event.toolCallId);
    if (!call) { calls.push({ malformed: true }); return; }
    const output = teaEnd ? String(event.output) : (event.result?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
    const kind = names[call.name] || 'other', input = call.input || {};
    let relativePath = null;
    if (typeof input.path === 'string') relativePath = path.relative(workspace, path.resolve(workspace, input.path)).replaceAll(path.sep, '/');
    const success = !event.isError;
    if (kind === 'edit') validatedAfterEdit = false;
    // All fixtures request this exact public suite; a shell tool must actually
    // complete it successfully after the latest edit. Failed tool results cannot count.
    const relevantValidation = typeof input.command === 'string' && /(?:^|[\s;&])node(?:\.exe)?\s+--test\s+tests[\\/]public\.test\.mjs(?:\s|$)/.test(input.command);
    if (kind === 'shell' && relevantValidation && success && (agent === 'pi' || /^exit=0\b/.test(output))
      && !/(?:tests|pass)\s+0\s*(?:\n|$)/.test(output)) validatedAfterEdit = true;
    calls.push({ name: call.name, kind, relativePath, success, outputSha256: hash(output), relevantValidation });
  };
  return { observe, finish() {
    const fullSourceRead = !requiredPath || calls.some(call => call.kind === 'read' && call.success && call.relativePath === requiredPath && call.outputSha256 === hash(expectedOutput));
    const readOnlyHonored = !readOnly || !calls.some(call => ['edit', 'shell'].includes(call.kind));
    return { calls, fullSourceRead, readOnlyHonored, passed: fullSourceRead && readOnlyHonored && !calls.some(call => call.malformed),
      expectedOutputSha256: requiredPath ? hash(expectedOutput) : null, validatedAfterEdit };
  } };
}
