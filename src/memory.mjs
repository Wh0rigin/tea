import { createHash } from 'node:crypto';
import { isValidationCommand } from './tools.mjs';

const GIT_DIAGNOSTIC = /^git\s+(?:status(?:\s+--short)?|diff(?:\s+--check)?|log\s+-\d+(?:\s+--oneline)?)$/;
const ZERO_TESTS = /(?:^|\n)\s*(?:#|ℹ\uFE0F?)\s+(?:tests|pass)\s+0\s*(?:\n|$)/;

function successfulCommand(call, result) {
  if (!/^exit=0\b/.test(result.content) || ZERO_TESTS.test(result.content)) return false;
  const command = call.input?.command;
  if (typeof command !== 'string') return false;
  const gitDiagnostic = !/[;&|<>`\n\r]/.test(command) && GIT_DIAGNOSTIC.test(command.trim());
  return call.name === 'run_tests' ? isValidationCommand(command) || gitDiagnostic
    : call.name === 'run_shell' && gitDiagnostic;
}

function canCompact(call, result) {
  if (result.is_error || typeof result.content !== 'string') return false;
  return call.name === 'list_files' || call.name === 'search_code' || successfulCommand(call, result);
}

function resultRecord(call, result) {
  const sha256 = createHash('sha256').update(result.content).digest('hex');
  const commandStatus = ['run_tests', 'run_shell'].includes(call.name) ? 'exit=0\n' : '';
  return `${commandStatus}[Earlier ${call.name} result; call=${JSON.stringify(call.id)}; sha256=${sha256}; original_chars=${result.content.length}]\n`
    + `Details omitted from this earlier result. Re-run ${call.name} with the original arguments above for current evidence.`;
}

/**
 * Build a request-only view of old, rediscoverable tool output. The authoritative
 * history stays intact so read-file references and provider thinking signatures
 * remain valid. No model-written summary is added, and no message is reordered.
 */
export function compactToolHistory(messages, { keepRecentRounds = 2 } = {}) {
  if (!Array.isArray(messages)) throw new TypeError('messages must be an array');
  const requestedRounds = Number(keepRecentRounds);
  const keptRecentRounds = Number.isFinite(requestedRounds) ? Math.max(2, Math.floor(requestedRounds)) : 2;
  const originalJson = JSON.stringify(messages);
  const toolRounds = [];
  const calls = new Map();
  const duplicateIds = new Set();
  const seenResultIds = new Set();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!Array.isArray(message?.content)) continue;
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block?.type !== 'tool_use' || typeof block.id !== 'string' || !block.id) continue;
        if (calls.has(block.id)) duplicateIds.add(block.id);
        else calls.set(block.id, { call: block, index });
      }
    } else if (message.role === 'user' && message.content.some((block) => block?.type === 'tool_result')) {
      toolRounds.push(index);
      for (const block of message.content) {
        if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        if (seenResultIds.has(block.tool_use_id)) duplicateIds.add(block.tool_use_id);
        else seenResultIds.add(block.tool_use_id);
      }
    }
  }

  const oldRoundIndexes = new Set(toolRounds.slice(0, Math.max(0, toolRounds.length - keptRecentRounds)));
  let compactedResults = 0;
  let eligibleResults = 0;
  const compactedMessages = messages.map((message, index) => {
    if (!oldRoundIndexes.has(index)) return message;
    let changed = false;
    const content = message.content.map((block) => {
      if (block?.type !== 'tool_result' || duplicateIds.has(block.tool_use_id)) return block;
      const entry = calls.get(block.tool_use_id);
      // A valid result immediately follows its assistant tool-use message. Keep
      // malformed, orphaned, or ambiguous history rather than guessing a link.
      if (!entry || entry.index !== index - 1 || !canCompact(entry.call, block)) return block;
      eligibleResults += 1;
      const record = resultRecord(entry.call, block);
      const before = JSON.stringify(block.content);
      const after = JSON.stringify(record);
      if (after.length >= before.length || Buffer.byteLength(after) >= Buffer.byteLength(before)) return block;
      changed = true;
      compactedResults += 1;
      return { ...block, content: record };
    });
    return changed ? { ...message, content } : message;
  });
  const resultMessages = compactedResults ? compactedMessages : messages;
  const compactedJson = compactedResults ? JSON.stringify(compactedMessages) : originalJson;
  const originalBytes = Buffer.byteLength(originalJson);
  const compactedBytes = Buffer.byteLength(compactedJson);
  return {
    messages: resultMessages,
    diagnostics: {
      compactedResults, eligibleResults, keptRecentRounds,
      originalChars: originalJson.length, compactedChars: compactedJson.length,
      savedChars: originalJson.length - compactedJson.length,
      originalBytes, compactedBytes, savedBytes: originalBytes - compactedBytes,
    },
  };
}
