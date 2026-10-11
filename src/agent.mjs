import { createHash } from 'node:crypto';
import path from 'node:path';
import { TokenLedger } from './ledger.mjs';
import { AnthropicMessagesAdapter, ModelError } from './model.mjs';
import { WorkspaceTools, dispatchTool, isValidationCommand } from './tools.mjs';
import { assertLiveConfig } from './config.mjs';
import { compactToolHistory } from './memory.mjs';
import { estimateTextTokens } from './benchmark.mjs';
import { compactConversation, requestBytes, sessionContext } from './compaction.mjs';
import { memorySessionFields, attachSessionJournal, appendSessionMessage, restoreToolMemory,
  persistRuntimeState, closeSessionJournal, resetPersistentConversation } from './session-memory.mjs';

const SYSTEM_PROMPT = `You are tea, an independent coding agent operating only inside the supplied workspace. Read applicable AGENTS.md instructions before editing. The initial file inventory may be partial and ranked by task terms; it is not proof that omitted files are irrelevant. Use list_files or search_code to discover more files when needed. Inspect before editing. Use exact, narrow patches. Never read secrets or environment files. Never claim success without verification. After any file edit, run the relevant tests and fix failures; preserve all user changes. Use run_shell only for commands that are not on the safe validation allowlist; the terminal may ask the user to approve them. Do not repeat whole files or prior tool output when a short evidence-backed summary is enough. When finished, state the changes and tests actually run.`;
const HISTORY_GUIDANCE = ` Older discovery or successful-command results may be replaced by explicit history records. A record identifies past output; it is not current source or test evidence. Repeat the original tool with its parameters if the omitted details are needed. Source reads, errors, and recent results remain available.`;

function prepareContextRequest(messages, config, requestTools) {
  let memory = config.historyStrategy === 'compact-tools'
    ? compactToolHistory(messages, { keepRecentRounds: config.historyKeepRecent ?? 2 })
    : { messages, diagnostics: { compactedResults: 0 } };
  const baseRequest = { system: SYSTEM_PROMPT, messages, tools: requestTools };
  const basePayload = JSON.stringify(baseRequest);
  let request = { system: SYSTEM_PROMPT + (memory.diagnostics.compactedResults ? HISTORY_GUIDANCE : ''), messages: memory.messages, tools: requestTools };
  let sentPayload = JSON.stringify(request);
  if (memory.diagnostics.compactedResults && (Buffer.byteLength(sentPayload, 'utf8') >= Buffer.byteLength(basePayload, 'utf8')
    || sentPayload.length >= basePayload.length || estimateTextTokens(sentPayload) >= estimateTextTokens(basePayload))) {
    memory = { messages, diagnostics: { compactedResults: 0 } };
    request = baseRequest;
    sentPayload = basePayload;
  }
  return { memory, request, sentPayload };
}

function validationSucceeded(output) {
  const text = String(output);
  return /^exit=0\b/.test(text) && !/(?:^|\n)\s*(?:#|ℹ\uFE0F?)\s+(?:tests|pass)\s+0\s*(?:\n|$)/.test(text);
}

export function createAgentSession(config) {
  return { workspace: path.resolve(config.workspace), model: config.model, messages: [], adapter: null, tools: null,
    running: false, pendingValidation: false, validationPassed: false, validationAttempts: 0, changedFiles: [],
    compaction: null, compactionCount: 0, ...memorySessionFields(config) };
}

export function resetConversation(session, config) {
  if (session.running) throw new Error('Stop the current turn before starting a new conversation');
  if (session.persistent) {
    if (!config) throw new Error('Persistent reset requires configuration');
    return resetPersistentConversation(session, config);
  }
  session.messages.length = 0;
  session.compaction = null;
  session.compactionCount = 0;
  session.tools?.sessionTerms.clear();
  session.tools?.unresolvedQueries.clear();
  session.tools?.readEvidence.clear();
  session.tools?.presentedSource.clear();
  // Keep adapter spending and outstanding edits across /new.
}

export async function runTask(task, config, options = {}) {
  const session = options.session || createAgentSession(config);
  if (session.running) throw new Error('This session already has a running turn');
  if (session.workspace !== path.resolve(config.workspace) || session.model !== config.model) throw new Error('A session cannot change workspace or model');
  session.running = true;
  try {
    await attachSessionJournal(session, config);
    return await runTurn(task, config, { ...options, session });
  } finally { try { await closeSessionJournal(session); } finally { session.running = false; } }
}

export async function compactAgentSession(config, options = {}) {
  if (!options.session) throw new Error('Conversation compaction requires an existing session');
  return runTask(options.instructions || '', config, { ...options, compactionOnly: true });
}

async function runTurn(task, config, { onText = () => {}, onDelta, onEvent = () => {}, adapterFactory, session, signal, approveCommand, compactionOnly = false } = {}) {
  // Presentation observers must not change execution or accounting.
  const emit = (event) => { try { onEvent(event); } catch { /* UI is observational. */ } };
  // Injected adapters are for deterministic integration checks, never live usage evidence.
  const offline = adapterFactory !== undefined;
  if (offline && typeof adapterFactory !== 'function') throw new TypeError('adapterFactory must be a function');
  if (!offline) assertLiveConfig(config);
  const ledger = new TokenLedger({ workspace: config.workspace, runId: config.runId, model: config.model, storeRaw: config.storeRaw });
  const wallStarted = Date.now();
  await ledger.init({ workspace: config.workspace, taskSha256: createTaskHash(task), effort: config.effort,
    runType: offline ? 'offline-runtime' : 'live', usageSource: offline ? 'scripted' : 'provider' });
  const deduplicateReads = ['v1-dedup', 'v1', 'v1-expanded', 'v1-auto'].includes(config.contextStrategy);
  const tools = session.tools || new WorkspaceTools({ workspace: config.workspace, ledger, deduplicateReads });
  await tools.init();
  tools.ledger = ledger;
  tools.signal = signal;
  tools.approveCommand = approveCommand;
  session.tools = tools;
  restoreToolMemory(session, tools);
  if (session.budgetUnknown && !offline) throw new ModelError('Session has unresolved billing from an interrupted request; no automatic retry is allowed');
  if (session.adapter && session.offline !== offline) throw new Error('A session cannot mix scripted and provider adapters');
  const adapterConfig = session.restoredBudget ? { ...config, maxCostUsd: session.restoredBudget.maxCostUsd,
    maxInputTokens: session.restoredBudget.maxInputTokens } : config;
  const adapter = session.adapter || (offline ? await adapterFactory(adapterConfig) : new AnthropicMessagesAdapter(adapterConfig));
  if (!adapter || typeof adapter.complete !== 'function') throw new TypeError('Adapter must implement complete');
  session.adapter = adapter;
  if (session.restoredBudget) {
    for (const field of ['spentUsd', 'spentInputBound', 'actualInputTokens']) adapter[field] = session.restoredBudget[field];
    session.restoredBudget = null;
  }
  session.offline = offline;
  let requestPurpose = 'task';
  adapter.onBeforeRequest = session.journal ? event => session.journal.append('request_intent', event) : undefined;
  adapter.onRequest = async (event) => {
    if (session.journal) {
      session.budgetUnknown = Boolean(session.budgetUnknown || event.usageStatus !== 'complete');
      await session.journal.append('request_settled', { requestId: event.requestId, purpose: requestPurpose,
        usage: event.usage, usageStatus: event.usageStatus, costBasis: event.costBasis,
        requestSha256: createTaskHash(JSON.stringify(event.payload)), responseSha256: createTaskHash(JSON.stringify(event.response)),
        budget: { spentUsd: adapter.spentUsd, spentInputBound: adapter.spentInputBound,
          actualInputTokens: adapter.actualInputTokens, blockedUnknown: session.budgetUnknown } });
    }
    await ledger.request({ ...event, purpose: requestPurpose });
    emit({ type: 'usage', totals: { ...ledger.totals }, usageComplete: ledger.completeUsageRequests === ledger.totals.requests,
      spentUsd: adapter.spentUsd, reserved: event.costBasis === 'full-preflight-reservation' });
  };
  const summarize = async (state, reason, instructions = '') => {
    requestPurpose = 'compaction';
    try {
      return await compactConversation(session, config, { adapter, ledger, state, reason, instructions,
        system: SYSTEM_PROMPT, tools: tools.modelToolDefinitions(), signal, onEvent: emit,
        measureContext: context => requestBytes(config, prepareContextRequest(context, config, tools.modelToolDefinitions()).request) });
    } catch (error) {
      emit({ type: 'compaction_end', reason, status: signal?.aborted ? 'cancelled' : 'failed', detail: error.message });
      await ledger.event({ type: 'compaction_failed', reason, cancelled: Boolean(signal?.aborted),
        errorSha256: createHash('sha256').update(String(error.message)).digest('hex') });
      throw error;
    } finally { requestPurpose = 'task'; }
  };
  await persistRuntimeState(session);
  if (compactionOnly) {
    let outcome;
    try { outcome = await summarize(session, 'manual', task); }
    catch (error) {
      outcome = { status: signal?.aborted ? 'cancelled' : 'failed', detail: error.message };
    }
    const summary = await ledger.finish({ status: outcome.status, prompt: task });
    await persistRuntimeState(session);
    onText(`Conversation compaction: ${outcome.status}.${outcome.detail ? ` ${outcome.detail}` : ''}`);
    emit({ type: 'turn_end', status: outcome.status, summary, spentUsd: adapter.spentUsd,
      changedFiles: session.changedFiles, pendingValidation: session.pendingValidation, runDirectory: ledger.directory });
    return { ...outcome, summary, toolCalls: 0, changedFiles: [...session.changedFiles],
      validationPassed: session.validationPassed, validationAttempts: session.validationAttempts,
      runType: offline ? 'offline-runtime' : 'live', wallElapsedMs: Date.now() - wallStarted, runDirectory: ledger.directory };
  }
  const firstTurn = session.messages.length === 0;
  const inventory = firstTurn ? await tools.initialInventory({ task, strategy: config.contextStrategy, limit: config.initialFileLimit })
    : { text: '', selectedFiles: [], totalFiles: 0 };
  const selectedHash = createHash('sha256').update(inventory.selectedFiles.join('\n')).digest('hex');
  await ledger.event({
    type: 'initial_inventory', strategy: config.contextStrategy, totalFiles: inventory.totalFiles,
    selectedFileCount: inventory.selectedFiles.length, selectedPathsSha256: selectedHash,
    queryExpansionApplied: inventory.queryExpansionApplied ?? false,
  });
  const userMessage = firstTurn ? `${task}\n\nWorkspace: ${config.workspace}\n${inventory.text}`
    + (session.pendingValidation ? `\nOutstanding edits still require validation: ${session.changedFiles.join(', ')}.` : '') : task;
  const messages = session.messages;
  if (session.resumeNotice) {
    await appendSessionMessage(session, { role: 'user', content: session.resumeNotice });
    session.resumeNotice = null;
  }
  await appendSessionMessage(session, { role: 'user', content: userMessage });
  let pendingValidation = session.pendingValidation;
  let validationPassed = session.validationPassed;
  let validationAttempts = session.validationAttempts;
  let changedFiles = [...session.changedFiles];
  let status = 'running';
  let finalText = '';
  let toolCalls = 0;
  let forcedValidationNudges = 0;
  const contextDiagnostics = { requestCount: 0, fullRequestPayloadBytes: 0, sentRequestPayloadBytes: 0,
    fullRequestPayloadChars: 0, sentRequestPayloadChars: 0, fullHeuristicTokens: 0, sentHeuristicTokens: 0, compactedResultOccurrences: 0 };
  const runtimeState = () => ({ pendingValidation, validationPassed, validationAttempts, changedFiles });
  const prepareRequest = () => {
    const activeMessages = sessionContext(session, runtimeState());
    const requestTools = tools.modelToolDefinitions();
    const fullPayload = JSON.stringify({ system: SYSTEM_PROMPT, messages, tools: requestTools });
    return { ...prepareContextRequest(activeMessages, config, requestTools), fullPayload };
  };
  let autoCompactionAttempts = 0;
  const attemptedContexts = new Set();

  try {
    while (toolCalls <= config.maxToolCalls) {
      if (signal?.aborted) { status = 'cancelled'; break; }
      let result;
      try {
        let prepared = prepareRequest();
        while (config.compaction === 'auto' && autoCompactionAttempts < (config.compactionMaxPerTurn ?? 2)
          && requestBytes(config, prepared.request) >= config.maxRequestInputTokens * (config.compactionTriggerRatio ?? 0.8)) {
          const fingerprint = createHash('sha256').update(prepared.sentPayload).digest('hex');
          if (attemptedContexts.has(fingerprint)) break;
          attemptedContexts.add(fingerprint);
          autoCompactionAttempts += 1;
          const outcome = await summarize(runtimeState(), 'threshold');
          if (outcome.status !== 'compacted') break;
          prepared = prepareRequest();
        }
        const { memory, request, sentPayload, fullPayload } = prepared;
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
          conversationCompaction: config.compaction ?? 'off', checkpointId: session.compaction?.id || null,
          compactedResults: memory.diagnostics.compactedResults, payloadSha256: createHash('sha256').update(sentPayload).digest('hex'),
          metricSource: 'serialized adapter input (system/messages/tools), not provider tokens' });
        emit({ type: 'model_start', requestIndex: contextDiagnostics.requestCount });
        let streamed = false;
        result = await adapter.complete({ ...request, signal, onTextDelta: onDelta ? (text) => {
          streamed = true;
          try { onDelta(text); } catch { /* Presentation only. */ }
        } : undefined });
        emit({ type: 'model_end', streamed });
        result = { ...result, displayedAsStream: streamed };
      } catch (error) {
        emit({ type: 'model_end', interrupted: true });
        status = signal?.aborted ? 'cancelled' : 'failed';
        if (signal?.aborted) break;
        if (error instanceof ModelError) onText(`Agent stopped: ${error.message}`);
        else throw error;
        break;
      }
      const content = Array.isArray(result.content) ? result.content : [];
      const assistantMessage = { role: 'assistant', content };
      await appendSessionMessage(session, assistantMessage);
      const textBlocks = content.filter((block) => block.type === 'text').map((block) => block.text || '');
      if (textBlocks.length) { finalText = textBlocks.join('\n'); if (!result.displayedAsStream) onText(finalText); }
      const toolUses = content.filter((block) => block.type === 'tool_use');
      if (!toolUses.length) {
        if (signal?.aborted) { status = 'cancelled'; break; }
        if (result.stop_reason === 'max_tokens') {
          status = 'incomplete';
          onText('\nAgent stopped because the response reached its output-token limit.');
          break;
        }
        if (pendingValidation && forcedValidationNudges < 2 && toolCalls < config.maxToolCalls) {
          forcedValidationNudges += 1;
          await appendSessionMessage(session, { role: 'user', content: `Runtime validation is pending (${changedFiles.join(', ') || 'workspace changed'}) but no relevant test command has passed after the latest edit or workspace change. Run the appropriate test now. If validation cannot be completed, explain that clearly and do not claim the task is complete.` });
          continue;
        }
        status = pendingValidation ? 'needs_validation' : 'completed';
        break;
      }

      const toolResults = [];
      for (const call of toolUses) {
        if (signal?.aborted || status === 'tool_limit_reached') {
          toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: 'Tool not executed: turn stopped. Do not assume it succeeded.', is_error: true });
          if (signal?.aborted) status = 'cancelled';
          continue;
        }
        toolCalls += 1;
        if (toolCalls > config.maxToolCalls) {
          status = 'tool_limit_reached';
          toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: 'Tool not executed: tool-call limit reached.', is_error: true });
          continue;
        }
        const started = Date.now();
        let output;
        let isError = false;
        emit({ type: 'tool_start', name: call.name, input: call.input, number: toolCalls });
        await session.journal?.append('tool_intent', { id: call.id, name: call.name, input: call.input });
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
            if (changedFiles.length || pendingValidation) pendingValidation = !validationPassed;
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
        await session.journal?.append('tool_completed', { id: call.id, name: call.name, output: String(output), isError });
        await persistRuntimeState(session, runtimeState());
        emit({ type: 'tool_end', name: call.name, input: call.input, output: String(output), elapsedMs: Date.now() - started, isError });
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: String(output), is_error: isError });
      }
      await appendSessionMessage(session, { role: 'user', content: toolResults });
      if (signal?.aborted) status = 'cancelled';
      if (['tool_limit_reached', 'cancelled'].includes(status)) break;
    }
    if (status === 'running') status = pendingValidation ? 'needs_validation' : 'tool_limit_reached';
  } catch (error) {
    status = signal?.aborted ? 'cancelled' : 'failed';
    onText(`Agent error: ${error.message}`);
  }

  Object.assign(session, { pendingValidation, validationPassed, validationAttempts, changedFiles });
  if (status === 'cancelled') await appendSessionMessage(session, { role: 'user', content: 'Runtime notice: the previous turn was interrupted by the user. Completed edits remain; skipped or interrupted operations did not establish success. Follow the next user instruction rather than resuming automatically.' });
  await persistRuntimeState(session);
  const summary = await ledger.finish({ status, prompt: userMessage, contextDiagnostics });
  emit({ type: 'turn_end', status, summary, spentUsd: adapter.spentUsd, changedFiles, pendingValidation, runDirectory: ledger.directory });
  return { status, text: finalText, summary, toolCalls, changedFiles, validationPassed, validationAttempts,
    runType: offline ? 'offline-runtime' : 'live', contextDiagnostics, sessionId: session.persistent ? session.sessionId : null,
    wallElapsedMs: Date.now() - wallStarted, runDirectory: ledger.directory };
}

function createTaskHash(task) {
  return createHash('sha256').update(String(task)).digest('hex');
}
