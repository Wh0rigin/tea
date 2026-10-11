import { createHash } from 'node:crypto';
import { TokenLedger } from './ledger.mjs';
import { AnthropicMessagesAdapter, ModelError } from './model.mjs';
import { TOOL_DEFINITIONS, WorkspaceTools, dispatchTool, isValidationCommand } from './tools.mjs';
import { assertLiveConfig } from './config.mjs';
import { compactToolHistory } from './memory.mjs';
import { estimateTextTokens } from './benchmark.mjs';

const SYSTEM_PROMPT = `You are tea, an independent coding agent operating only inside the supplied workspace. Read applicable AGENTS.md instructions before editing. The initial file inventory may be partial and ranked by task terms; it is not proof that omitted files are irrelevant. Use list_files or search_code to discover more files when needed. Inspect before editing. Use exact, narrow patches. Never read secrets or environment files. Never claim success without verification. After any file edit, run the relevant tests and fix failures; preserve all user changes. Use run_shell only for commands that are not on the safe validation allowlist; the terminal may ask the user to approve them. Do not repeat whole files or prior tool output when a short evidence-backed summary is enough. When finished, state the changes and tests actually run.`;
const HISTORY_GUIDANCE = ` Older discovery or successful-command results may be replaced by explicit history records. A record identifies past output; it is not current source or test evidence. Repeat the original tool with its parameters if the omitted details are needed. Source reads, errors, and recent results remain available.`;

function validationSucceeded(output) {
  const text = String(output);
  return /^exit=0\b/.test(text) && !/(?:^|\n)\s*(?:#|ℹ\uFE0F?)\s+(?:tests|pass)\s+0\s*(?:\n|$)/.test(text);
}

export async function runTask(task, config, { onText = () => {}, adapterFactory } = {}) {
  // Injected adapters are for deterministic integration checks, never live usage evidence.
  const offline = adapterFactory !== undefined;
  if (offline && typeof adapterFactory !== 'function') throw new TypeError('adapterFactory must be a function');
  if (!offline) assertLiveConfig(config);
  const ledger = new TokenLedger({ workspace: config.workspace, runId: config.runId, model: config.model, storeRaw: config.storeRaw });
  const wallStarted = Date.now();
  await ledger.init({ workspace: config.workspace, taskSha256: createTaskHash(task), effort: config.effort,
    runType: offline ? 'offline-runtime' : 'live', usageSource: offline ? 'scripted' : 'provider' });
  const deduplicateReads = ['v1-dedup', 'v1', 'v1-expanded', 'v1-auto'].includes(config.contextStrategy);
  const tools = new WorkspaceTools({ workspace: config.workspace, ledger, deduplicateReads });
  await tools.init();
  const adapter = offline ? await adapterFactory(config) : new AnthropicMessagesAdapter(config);
  if (!adapter || typeof adapter.complete !== 'function') throw new TypeError('Adapter must implement complete');
  adapter.onRequest = (event) => ledger.request(event);
  const inventory = await tools.initialInventory({ task, strategy: config.contextStrategy, limit: config.initialFileLimit });
  const selectedHash = createHash('sha256').update(inventory.selectedFiles.join('\n')).digest('hex');
  await ledger.event({
    type: 'initial_inventory', strategy: config.contextStrategy, totalFiles: inventory.totalFiles,
    selectedFileCount: inventory.selectedFiles.length, selectedPathsSha256: selectedHash,
    queryExpansionApplied: inventory.queryExpansionApplied ?? false,
  });
  const userMessage = `${task}\n\nWorkspace: ${config.workspace}\n${inventory.text}`;
  const messages = [{ role: 'user', content: userMessage }];
  let pendingValidation = false;
  let validationPassed = false;
  let validationAttempts = 0;
  let changedFiles = [];
  let status = 'running';
  let finalText = '';
  let toolCalls = 0;
  let forcedValidationNudges = 0;
  const contextDiagnostics = { requestCount: 0, fullRequestPayloadBytes: 0, sentRequestPayloadBytes: 0,
    fullRequestPayloadChars: 0, sentRequestPayloadChars: 0, fullHeuristicTokens: 0, sentHeuristicTokens: 0, compactedResultOccurrences: 0 };

  try {
    while (toolCalls <= config.maxToolCalls) {
      let result;
      try {
        let memory = config.historyStrategy === 'compact-tools'
          ? compactToolHistory(messages, { keepRecentRounds: config.historyKeepRecent ?? 2 })
          : { messages, diagnostics: { compactedResults: 0 } };
        const fullRequest = { system: SYSTEM_PROMPT, messages, tools: TOOL_DEFINITIONS };
        const fullPayload = JSON.stringify(fullRequest);
        let request = { system: SYSTEM_PROMPT + (memory.diagnostics.compactedResults ? HISTORY_GUIDANCE : ''), messages: memory.messages, tools: TOOL_DEFINITIONS };
        let sentPayload = JSON.stringify(request);
        // Include the recovery guidance cost. Small turns fall back to unchanged V1 input.
        if (memory.diagnostics.compactedResults && (Buffer.byteLength(sentPayload, 'utf8') >= Buffer.byteLength(fullPayload, 'utf8')
          || sentPayload.length >= fullPayload.length || estimateTextTokens(sentPayload) >= estimateTextTokens(fullPayload))) {
          memory = { messages, diagnostics: { compactedResults: 0 } };
          request = fullRequest;
          sentPayload = fullPayload;
        }
        const fullBytes = Buffer.byteLength(fullPayload, 'utf8');
        const sentBytes = Buffer.byteLength(sentPayload, 'utf8');
        contextDiagnostics.requestCount += 1;
        contextDiagnostics.fullRequestPayloadBytes += fullBytes;
        contextDiagnostics.sentRequestPayloadBytes += sentBytes;
        contextDiagnostics.fullRequestPayloadChars += fullPayload.length;
        contextDiagnostics.sentRequestPayloadChars += sentPayload.length;
        contextDiagnostics.fullHeuristicTokens += estimateTextTokens(fullPayload);
        contextDiagnostics.sentHeuristicTokens += estimateTextTokens(sentPayload);
        contextDiagnostics.compactedResultOccurrences += memory.diagnostics.compactedResults;
        await ledger.event({ type: 'context_request', requestIndex: contextDiagnostics.requestCount,
          historyStrategy: config.historyStrategy ?? 'full', fullPayloadBytes: fullBytes, sentPayloadBytes: sentBytes,
          compactedResults: memory.diagnostics.compactedResults, payloadSha256: createHash('sha256').update(sentPayload).digest('hex'),
          metricSource: 'serialized adapter input (system/messages/tools), not provider tokens' });
        result = await adapter.complete(request);
      } catch (error) {
        status = 'failed';
        if (error instanceof ModelError) onText(`Agent stopped: ${error.message}`);
        else throw error;
        break;
      }
      const content = Array.isArray(result.content) ? result.content : [];
      const assistantMessage = { role: 'assistant', content };
      messages.push(assistantMessage);
      const textBlocks = content.filter((block) => block.type === 'text').map((block) => block.text || '');
      if (textBlocks.length) { finalText = textBlocks.join('\n'); onText(finalText); }
      const toolUses = content.filter((block) => block.type === 'tool_use');
      if (!toolUses.length) {
        if (result.stop_reason === 'max_tokens') {
          status = 'incomplete';
          onText('\nAgent stopped because the response reached its output-token limit.');
          break;
        }
        if (pendingValidation && forcedValidationNudges < 2 && toolCalls < config.maxToolCalls) {
          forcedValidationNudges += 1;
          messages.push({ role: 'user', content: `You changed files (${changedFiles.join(', ')}) but no relevant test command has passed after the latest edit. Run the appropriate test now. If validation cannot be completed, explain that clearly and do not claim the task is complete.` });
          continue;
        }
        status = pendingValidation ? 'needs_validation' : 'completed';
        break;
      }

      const toolResults = [];
      for (const call of toolUses) {
        toolCalls += 1;
        if (toolCalls > config.maxToolCalls) {
          status = 'tool_limit_reached';
          break;
        }
        const started = Date.now();
        let output;
        let isError = false;
        try {
          output = await dispatchTool(tools, call.name, call.input || {});
          if (call.name === 'apply_patch') {
            pendingValidation = true;
            validationPassed = false;
            const filename = call.input?.path || '(unknown file)';
            if (!changedFiles.includes(filename)) changedFiles.push(filename);
          } else if (['run_tests', 'run_shell'].includes(call.name) && isValidationCommand(call.input?.command)) {
            validationAttempts += 1;
            validationPassed = validationSucceeded(output);
            if (changedFiles.length) pendingValidation = !validationPassed;
          }
        } catch (error) {
          isError = true;
          output = error.message;
          if (['run_tests', 'run_shell'].includes(call.name) && isValidationCommand(call.input?.command)) {
            validationAttempts += 1;
            validationPassed = false;
            if (changedFiles.length) pendingValidation = true;
          }
        }
        await ledger.tool({ name: call.name, input: call.input, output, elapsedMs: Date.now() - started, error: isError ? output : undefined });
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: String(output), is_error: isError });
      }
      messages.push({ role: 'user', content: toolResults });
      if (status === 'tool_limit_reached') break;
    }
    if (status === 'running') status = pendingValidation ? 'needs_validation' : 'tool_limit_reached';
  } catch (error) {
    status = 'failed';
    onText(`Agent error: ${error.message}`);
  }

  const summary = await ledger.finish({ status, prompt: userMessage, contextDiagnostics });
  return { status, text: finalText, summary, toolCalls, changedFiles, validationPassed, validationAttempts,
    runType: offline ? 'offline-runtime' : 'live', contextDiagnostics, wallElapsedMs: Date.now() - wallStarted, runDirectory: ledger.directory };
}

function createTaskHash(task) {
  return createHash('sha256').update(String(task)).digest('hex');
}
