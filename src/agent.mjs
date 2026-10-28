import { createHash } from 'node:crypto';
import path from 'node:path';
import { TokenLedger } from './ledger.mjs';
import { AnthropicMessagesAdapter, ModelError } from './model.mjs';
import { WorkspaceTools, isValidationCommand, redactText } from './tools.mjs';
import { assertLiveConfig } from './config.mjs';
import { compactToolHistory } from './memory.mjs';
import { estimateTextTokens } from './benchmark.mjs';
import { compactConversation, requestBytes, sessionContext } from './compaction.mjs';
import { contextBudget } from './context-budget.mjs';
import { memorySessionFields, attachSessionJournal, appendSessionMessage, restoreToolMemory,
  persistRuntimeState, closeSessionJournal, resetPersistentConversation } from './session-memory.mjs';
import { ContextMemory } from './context-assembler.mjs';
import { attachContextArchive, collectCompactedHistory, residentHistoryBytes } from './memory-gc.mjs';
import { runtimeCapabilities, capabilityNotice, toolFailureFeedback, appendFailureFeedback } from './tool-feedback.mjs';
import { runtimeError } from './runtime-error.mjs';
import { buildSystemPrompt } from './prompts.mjs';
import { RetrievalProgress, RETRIEVAL_NOTICE } from './retrieval-progress.mjs';
import { observeValidation, observeEntryPoint, entryPointNeedsValidation, unresolvedValidationCommands, unavailableValidationNotice, validationRunnerUnavailable, invalidateUnavailableValidation } from './validation.mjs';

const HISTORY_GUIDANCE = ` Older discovery or successful-command results may be replaced by explicit history records. A record identifies past output; it is not current source or test evidence. Repeat the original tool with its parameters if the omitted details are needed. Source reads, errors, and recent results remain available.`;

function prepareContextRequest(messages, config, requestTools, system) {
  let memory = config.historyStrategy === 'compact-tools'
    ? compactToolHistory(messages, { keepRecentRounds: config.historyKeepRecent ?? 2 })
    : { messages, diagnostics: { compactedResults: 0 } };
  const baseRequest = { system, messages, tools: requestTools };
  const basePayload = JSON.stringify(baseRequest);
  let request = { system: system + (memory.diagnostics.compactedResults ? HISTORY_GUIDANCE : ''), messages: memory.messages, tools: requestTools };
  let sentPayload = JSON.stringify(request);
  if (memory.diagnostics.compactedResults && (Buffer.byteLength(sentPayload, 'utf8') >= Buffer.byteLength(basePayload, 'utf8')
    || sentPayload.length >= basePayload.length || estimateTextTokens(sentPayload) >= estimateTextTokens(basePayload))) {
    memory = { messages, diagnostics: { compactedResults: 0 } };
    request = baseRequest;
    sentPayload = basePayload;
  }
  return { memory, request, sentPayload };
}

export function createAgentSession(config) {
  return { workspace: path.resolve(config.workspace), model: config.model, messages: [], adapter: null, tools: null,
    running: false, pendingValidation: false, validationPassed: false, validationAttempts: 0, validationFailures: [], validationUnavailable: [], changedFiles: [],
    compaction: null, compactionCount: 0, autoCompactionBackoff: null, ...memorySessionFields(config) };
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
  session.autoCompactionBackoff = null;
  session.tools?.sessionTerms.clear();
  session.tools?.unresolvedQueries.clear();
  session.tools?.readEvidence.clear();
  session.tools?.searchEvidence.clear();
  session.tools?.sourceEvidence.clear();
  session.tools?.presentedSource.clear();
  session.contextMemory = null;
  if (session.tools) session.tools.contextMemory = null;
  session.taskState = null; session.memoryDiagnostics = null;
  session.capabilities = null;
  session.pinnedRequirements = []; session.protectedRuleRefs = []; session.archivedMessageCount = 0; session.gcDiagnostics = null;
  session.contextArchive?.sweepCache(); session.contextArchive = null;
  // Keep adapter spending and outstanding edits across /new.
}

export async function runTask(task, config, options = {}) {
  for(const name of ['approveEdit','beforeToolUse'])if(options[name]!==undefined&&typeof options[name]!=='function')throw new TypeError(`${name} must be a function`);
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

async function runTurn(task, config, { onText = () => {}, onDelta, onEvent = () => {}, adapterFactory, session, signal, approveCommand, approveEdit, beforeToolUse, compactionOnly = false } = {}) {
  // Presentation observers must not change execution or accounting.
  const emit = (event) => { try { onEvent(event); } catch { /* UI is observational. */ } };
  const textObserver = onText;
  onText = text => { try { textObserver(text); } catch { /* UI is observational. */ } };
  // Injected adapters are for deterministic integration checks, never live usage evidence.
  const offline = adapterFactory !== undefined;
  if (offline && typeof adapterFactory !== 'function') throw new TypeError('adapterFactory must be a function');
  if (!offline) assertLiveConfig(config);
  const ledger = new TokenLedger({ workspace: config.workspace, runId: config.runId, model: config.model, storeRaw: config.storeRaw });
  const wallStarted = Date.now();
  await ledger.init({ workspace: config.workspace, taskSha256: createTaskHash(task), effort: config.effort,
    runType: offline ? 'offline-runtime' : 'live', usageSource: offline ? 'scripted' : 'provider' });
  const deduplicateReads = ['v1-dedup', 'v1', 'v1-expanded', 'v1-auto'].includes(config.contextStrategy);
  const tools = session.tools || new WorkspaceTools({ workspace: config.workspace, ledger, deduplicateReads,
    enableFileCreation: config.enableFileCreation ?? true });
  await tools.init();
  tools.ledger = ledger;
  tools.signal = signal;
  tools.approveCommand = approveCommand;
  tools.approveEdit = approveEdit;
  tools.beforeToolUse = beforeToolUse;
  tools.setEditPermissions(config.editPermissions);
  tools.enableFileCreation = config.enableFileCreation ?? true;
  session.tools = tools;
  restoreToolMemory(session, tools);
  const toolService = tools.toolService;
  const systemPrompt = buildSystemPrompt(tools.modelToolDefinitions({ includeMemory: false }));
  toolService.context.bindSession(session);
  if (config.memoryPolicy === 'contextos') {
    session.contextMemory ||= new ContextMemory(tools);
    session.contextMemory.rebuild(session.messages);
    for (const unit of session.memoryDiagnostics?.units || []) if (unit.decision === 'reference') session.contextMemory.evicted.add(unit.ref);
    tools.contextMemory = session.contextMemory;
    attachContextArchive(session, config, signal);
  } else {
    tools.contextMemory = null; session.contextMemory = null;
    session.contextArchive?.sweepCache(); session.contextArchive = null;
  }
  if (session.budgetUnknown && !offline) throw new ModelError('Session has unresolved billing from an interrupted request; no automatic retry is allowed');
  if (session.adapter && session.offline !== offline) throw new Error('A session cannot mix scripted and provider adapters');
  const adapterConfig = session.restoredBudget ? { ...config, maxCostUsd: session.restoredBudget.maxCostUsd,
    maxInputTokens: session.restoredBudget.maxInputTokens } : config;
  const adapter = session.adapter || (offline ? await adapterFactory(adapterConfig) : new AnthropicMessagesAdapter(adapterConfig));
  if (!adapter || typeof adapter.complete !== 'function') throw new TypeError('Adapter must implement complete');
  session.adapter = adapter;
  if (session.restoredBudget) {
    for (const field of ['spentUsd', 'spentInputBound', 'actualInputTokens', 'costKnown', 'contextTokenScale']) if (session.restoredBudget[field] !== undefined) adapter[field] = session.restoredBudget[field];
    session.restoredBudget = null;
  }
  session.offline = offline;
  let requestPurpose = 'task';
  adapter.onBeforeRequest = session.journal ? event => session.journal.append('request_intent', event) : undefined;
  const recoveryBlockedRequests = new Set(session.budgetUnknown ? ['historical-unknown'] : []);
  adapter.onRetry = async event => {
    await ledger.event(event);
    emit(event);
    onText(`Model retry ${event.retry}/${event.maxRetries}: Internal Network Failure; failed response discarded, retrying in ${event.delayMs / 1000}s.`);
  };
  adapter.onRequest = async (event) => {
    // Only a successful explicitly authorized retry releases its recovery block.
    // Unknown token usage and retained monetary reservations remain in the ledger.
    if (event.usageStatus !== 'complete') recoveryBlockedRequests.add(event.requestId || 'unknown');
    else for (const id of event.recoveredRequestIds || []) recoveryBlockedRequests.delete(id);
    session.budgetUnknown = recoveryBlockedRequests.size > 0;
    if (session.journal) {
      await session.journal.append('request_settled', { requestId: event.requestId, purpose: requestPurpose,
        retryAttempt: event.retryAttempt || 0, recoveredRequestIds: event.recoveredRequestIds || [],
        usage: event.usage, usageStatus: event.usageStatus, costBasis: event.costBasis,
        requestSha256: createTaskHash(JSON.stringify(event.payload)), responseSha256: createTaskHash(JSON.stringify(event.response)),
        budget: { spentUsd: adapter.spentUsd, costKnown: adapter.costKnown, contextTokenScale: adapter.contextTokenScale || 1, spentInputBound: adapter.spentInputBound,
          actualInputTokens: adapter.actualInputTokens, blockedUnknown: session.budgetUnknown } });
    }
    await ledger.request({ ...event, purpose: requestPurpose });
    emit({ type: 'usage', totals: { ...ledger.totals }, usageComplete: ledger.completeUsageRequests === ledger.totals.requests,
      spentUsd: adapter.costKnown === false ? null : adapter.spentUsd, reserved: event.costBasis === 'full-preflight-reservation' });
  };
  const summarize = async (state, reason, instructions = '') => {
    requestPurpose = 'compaction';
    try {
      const outcome = await compactConversation(session, config, { adapter, ledger, state, reason, instructions,
        system: systemPrompt, tools: tools.modelToolDefinitions(), signal, onEvent: emit,
        measureContext: async (context, { willArchive = false } = {}) => {
          if (config.memoryPolicy !== 'contextos') return requestBytes(config, prepareContextRequest(context, config, tools.modelToolDefinitions(), systemPrompt).request);
          const plan = await session.contextMemory.assemble({ messages: context, canonical: session.messages,
            system: systemPrompt, tools: tools.modelToolDefinitions({ includeMemory: false }), config, state, goal: task,
            commit: false, additionalArchive: willArchive });
          return requestBytes(config, plan.request);
        } });
      if (outcome.status === 'compacted') {
        session.autoCompactionBackoff = null;
        const gc = await collectCompactedHistory(session, config, state);
        emit({ type: 'memory_gc', ...gc });
        if (gc.status === 'collected') {
          const disk = await session.journal.collectOrphans();
          await ledger.event({ type: 'memory_gc', ...gc, orphanCollection: disk });
        }
      }
      return outcome;
    } catch (error) {
      const failure = runtimeError(error, { config, stage: 'compaction', budget: error?.budget });
      emit({ type: 'compaction_end', reason, status: signal?.aborted ? 'cancelled' : 'failed', error: failure, detail: failure.message });
      await ledger.event({ type: 'compaction_failed', reason, cancelled: Boolean(signal?.aborted),
        error: failure,
        errorSha256: createHash('sha256').update(String(error?.message || error)).digest('hex') });
      throw error;
    } finally { requestPurpose = 'task'; }
  };
  await persistRuntimeState(session);
  if (compactionOnly) {
    let outcome;
    try { outcome = await summarize(session, 'manual', task); }
    catch (error) {
      const failure = runtimeError(error, { config, stage: 'compaction', budget: error?.budget });
      outcome = { status: signal?.aborted ? 'cancelled' : 'failed', detail: failure.message, error: failure };
    }
    const summary = await ledger.finish({ status: outcome.status, prompt: task, error: outcome.error });
    await persistRuntimeState(session);
    onText(`Conversation compaction: ${outcome.status}.${outcome.detail ? ` ${outcome.detail}` : ''}`);
    emit({ type: 'turn_end', status: outcome.status, summary, spentUsd: adapter.costKnown === false ? null : adapter.spentUsd,
      changedFiles: session.changedFiles, pendingValidation: session.pendingValidation, runDirectory: ledger.directory,
      ...(outcome.error ? { error: outcome.error } : {}) });
    return { ...outcome, summary, toolCalls: 0, changedFiles: [...session.changedFiles],
      validationPassed: session.validationPassed, validationAttempts: session.validationAttempts,
      validationFailures: session.validationFailures || [], validationUnavailable: session.validationUnavailable || [],
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
  const capabilities = config.capabilityFeedback ? runtimeCapabilities({ approveCommand, fileCreation: tools.enableFileCreation, editPermissions: tools.editPermissions }) : null;
  const capabilitiesChanged = Boolean(capabilities && session.capabilities?.version !== capabilities.version);
  const userMessage = (firstTurn ? `${task}\n\nWorkspace: ${config.workspace}\n${inventory.text}`
    + (session.pendingValidation ? `\nOutstanding validation: ${session.changedFiles.join(', ') || 'workspace checks'}.`
      + (session.validationFailures?.length ? ` Rerun unresolved commands: ${JSON.stringify(unresolvedValidationCommands(session))}.` : '') : '') : task)
    + (capabilities && (firstTurn || capabilitiesChanged) ? `\n\n${capabilityNotice(capabilities)}` : '');
  if (session.validationUnavailable?.length) await appendSessionMessage(session, { role: 'user', content: unavailableValidationNotice(session) });
  session.capabilities = capabilities;
  if (capabilities && (firstTurn || capabilitiesChanged)) await session.journal?.append('capabilities_declared', capabilities);
  const messages = session.messages;
  if (session.resumeNotice) {
    await appendSessionMessage(session, { role: 'user', content: session.resumeNotice });
    session.resumeNotice = null;
  }
  const goalEvent = await appendSessionMessage(session, { role: 'user', content: userMessage });
  session.taskState = { taskId: `task-${goalEvent?.eventId || session.messages.length}`,
    goal: { text: task, provenance: 'user_confirmed', sourceEventId: goalEvent?.eventId || null }, phase: 'locate',
    constraints: 'Original user messages remain pinned; read applicable instructions; validate all edits.',
    active_files: [], confirmed_findings: [], decisions: [], pending_steps: [], failed_attempts: [], evidence_refs: [] };
  let pendingValidation = session.pendingValidation;
  let validationPassed = session.validationPassed;
  let validationAttempts = session.validationAttempts;
  let validationFailures = [...(session.validationFailures || [])];
  let validationUnavailable = [...(session.validationUnavailable || [])];
  let changedFiles = [...session.changedFiles];
  let status = 'running';
  let finalText = '';
  let toolCalls = 0;
  let forcedValidationNudges = 0;
  const contextDiagnostics = { requestCount: 0, fullRequestPayloadBytes: 0, sentRequestPayloadBytes: 0,
    fullRequestPayloadChars: 0, sentRequestPayloadChars: 0, fullHeuristicTokens: 0, sentHeuristicTokens: 0, compactedResultOccurrences: 0 };
  const runtimeState = () => ({ pendingValidation, validationPassed, validationAttempts, validationFailures, validationUnavailable, changedFiles });
  const prepareRequest = async () => {
    const activeMessages = sessionContext(session, runtimeState());
    const requestTools = tools.modelToolDefinitions({ includeMemory: false });
    const fullPayload = JSON.stringify({ system: systemPrompt, messages, tools: requestTools });
    if (config.memoryPolicy === 'contextos') {
      const plan = await session.contextMemory.assemble({ messages: activeMessages, canonical: messages,
        system: systemPrompt, tools: requestTools, config, state: runtimeState(), goal: task });
      session.memoryDiagnostics = plan.diagnostics;
      await session.journal?.append('memory_assembly', plan.diagnostics);
      return { memory: { diagnostics: { compactedResults: plan.diagnostics.evictedUnits } },
        request: plan.request, sentPayload: JSON.stringify(plan.request), fullPayload };
    }
    return { ...prepareContextRequest(activeMessages, config, requestTools, systemPrompt), fullPayload };
  };
  let autoCompactionAttempts = 0;
  const retrievalProgress = config.retrievalProgressFeedback ? new RetrievalProgress() : null;
  const attemptedContexts = new Set();
  let autoCompactionFailedThisTurn = false;
  let terminalError, lastBudget;
  let failureStage = 'context';
  const pressure = prepared => {
    const budget = contextBudget(config, prepared.request, adapter.contextTokenScale);
    return { ...budget, requestBytes: requestBytes(config, prepared.request), maxWireBytes: config.maxRequestInputTokens,
      residentBytes: residentHistoryBytes(session), residentLimit: config.memoryGcMaxResidentBytes,
      automaticCompactions: autoCompactionAttempts, emergencyCompactions: 0 };
  };
  try {
    while (toolCalls <= (config.maxToolCalls ?? Infinity)) {
      if (signal?.aborted) { status = 'cancelled'; break; }
      let result;
      try {
        failureStage = 'context';
        let prepared = await prepareRequest();
        lastBudget = pressure(prepared);
        const backoff = session.autoCompactionBackoff;
        const currentBytes = requestBytes(config, prepared.request), currentResidentBytes = residentHistoryBytes(session);
        const cooledDown = !backoff || currentBytes >= backoff.requestBytes + Math.max(4096, backoff.requestBytes * 0.25)
          || currentResidentBytes >= backoff.residentBytes + Math.max(4096, backoff.residentBytes * 0.25);
        while (config.compaction === 'auto' && !session.budgetUnknown && (!autoCompactionFailedThisTurn || config.contextBudgetPolicy === 'pi') && cooledDown && autoCompactionAttempts < (config.compactionMaxPerTurn ?? (config.contextBudgetPolicy === 'pi' ? Infinity : 2))
          && ((contextBudget(config, prepared.request, adapter.contextTokenScale)?.estimatedInputTokens ?? 0) >=
              (contextBudget(config, prepared.request, adapter.contextTokenScale)?.triggerTokens ?? Infinity)
            || requestBytes(config, prepared.request) >= config.maxRequestInputTokens * (config.contextWindowTokens ? 0.95 : (config.compactionTriggerRatio ?? 0.8))
            || (config.memoryGc !== 'off' && residentHistoryBytes(session) >= config.memoryGcMaxResidentBytes))) {
          const fingerprint = createHash('sha256').update(prepared.sentPayload).digest('hex');
          if (attemptedContexts.has(fingerprint)) break;
          attemptedContexts.add(fingerprint);
          autoCompactionAttempts += 1;
          failureStage = 'compaction';
          const outcome = await summarize(runtimeState(), 'threshold');
          if (outcome.status === 'unchanged') {
            autoCompactionFailedThisTurn = true;
            session.autoCompactionBackoff = { requestBytes: requestBytes(config, prepared.request), residentBytes: residentHistoryBytes(session) };
            await persistRuntimeState(session, runtimeState());
          }
          if (outcome.status !== 'compacted') break;
          prepared = await prepareRequest();
        }
        lastBudget = pressure(prepared);
        if (config.memoryGc !== 'off' && residentHistoryBytes(session) >= config.memoryGcMaxResidentBytes) {
          status = 'memory_limit_reached';
          onText('Resident history limit reached; compaction could not free enough protected content. Start a new conversation or raise the explicit memory limit.');
          break;
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
          budget: lastBudget,
          historyStrategy: config.historyStrategy ?? 'full', fullPayloadBytes: fullBytes, sentPayloadBytes: sentBytes,
          conversationCompaction: config.compaction ?? 'off', checkpointId: session.compaction?.id || null,
          compactedResults: memory.diagnostics.compactedResults, payloadSha256: createHash('sha256').update(sentPayload).digest('hex'),
          metricSource: 'serialized adapter input (system/messages/tools), not provider tokens' });
        emit({ type: 'model_start', requestIndex: contextDiagnostics.requestCount, budget: lastBudget });
        failureStage = 'model';
        let streamed = false;
        result = await adapter.complete({ ...request, signal, onTextDelta: onDelta ? (text) => {
          streamed = true;
          try { onDelta(text); } catch { /* Presentation only. */ }
        } : undefined });
        emit({ type: 'model_end', streamed });
        result = { ...result, displayedAsStream: streamed };
      } catch (error) {
        emit({ type: 'model_end', interrupted: true });
        throw error;
      }
      const content = Array.isArray(result.content) ? result.content : [];
      const assistantMessage = { role: 'assistant', content };
      const assistantEvent = await appendSessionMessage(session, assistantMessage);
      const textBlocks = content.filter((block) => block.type === 'text').map((block) => block.text || '');
      if (textBlocks.length) { finalText = textBlocks.join('\n'); if (!result.displayedAsStream) onText(finalText); }
      if (textBlocks.length && session.taskState) session.taskState.decisions.push({ text: finalText,
        provenance: 'inferred', sourceEventId: assistantEvent?.eventId || null });
      const toolUses = content.filter((block) => block.type === 'tool_use');
      if (!toolUses.length) {
        if (signal?.aborted) { status = 'cancelled'; break; }
        if (result.stop_reason === 'max_tokens') {
          status = 'incomplete';
          onText('\nAgent stopped because the response reached its output-token limit.');
          break;
        }
        if (pendingValidation && forcedValidationNudges < 2 && toolCalls < (config.maxToolCalls ?? Infinity)) {
          forcedValidationNudges += 1;
          const unresolved = unresolvedValidationCommands(runtimeState());
          await appendSessionMessage(session, { role: 'user', content: `Runtime validation is pending (${changedFiles.join(', ') || 'workspace checks'}). ${unresolved.length ? `Rerun unresolved commands: ${JSON.stringify(unresolved)}. A different passing command cannot clear them.` : 'No relevant check has passed after the latest edit or workspace change.'} ${unavailableValidationNotice(runtimeState())} If validation cannot be completed, report the outstanding checks; do not claim completion.` });
          continue;
        }
        status = pendingValidation ? 'needs_validation' : 'completed';
        break;
      }

      const toolResults = [];
      retrievalProgress?.beginBatch(session.compaction?.id ?? null);
      for (const call of toolUses) {
        if (signal?.aborted || status === 'tool_limit_reached') {
          toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: 'Tool not executed: turn stopped. Do not assume it succeeded.', is_error: true });
          if (signal?.aborted) status = 'cancelled';
          continue;
        }
        toolCalls += 1;
        if (toolCalls > (config.maxToolCalls ?? Infinity)) {
          status = 'tool_limit_reached';
          toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: 'Tool not executed: tool-call limit reached.', is_error: true });
          continue;
        }
        const started = Date.now();
        let output;
        let isError = false;
        let toolError;
        let entryValidation = false;
        const effects = toolService.effects(call.name, call.input);
        failureStage = 'tool';
        emit({ type: 'tool_start', name: call.name, input: call.input, number: toolCalls });
        await session.journal?.append('tool_intent', { id: call.id, name: call.name, input: call.input });
        try {
          output = await toolService.execute(call.name, call.input || {});
          if (effects.mutatesWorkspace) {
            pendingValidation = true;
            validationPassed = false;
            validationUnavailable = invalidateUnavailableValidation(runtimeState());
            const filename = call.input?.path || '(unknown file)';
            if (!changedFiles.includes(filename)) changedFiles.push(filename);
          } else if (effects.validatesSource) {
            validationAttempts += 1;
            ({ validationFailures, validationUnavailable, validationPassed, pendingValidation } = observeValidation(runtimeState(), call.input?.command, output));
          } else if (call.name === 'run_shell' && entryPointNeedsValidation(runtimeState(), call.input?.command, output, call.input?.expected_exit_code)) {
            entryValidation = true;
            validationAttempts += 1;
            ({ validationFailures, validationUnavailable, validationPassed, pendingValidation } = observeEntryPoint(runtimeState(), call.input?.command, output));
          }
        } catch (error) {
          isError = true;
          toolError = error;
          output = error.message;
          if (effects.validatesSource || call.name === 'run_shell' && entryPointNeedsValidation(runtimeState(), call.input?.command, output)) {
            entryValidation = !effects.validatesSource;
            validationAttempts += 1;
            ({ validationFailures, validationUnavailable, validationPassed, pendingValidation } = entryValidation
              ? observeEntryPoint(runtimeState(), call.input?.command, output, true)
              : observeValidation(runtimeState(), call.input?.command, output, true, error));
          }
        }
        const feedback = config.capabilityFeedback ? toolFailureFeedback({ error: toolError, output, toolName: call.name, validation: isValidationCommand(call.input?.command), runnerUnavailable: effects.validatesSource && validationRunnerUnavailable(call.input?.command, output, toolError) }) : null;
        output = appendFailureFeedback(output, feedback);
        if ((effects.validatesSource || entryValidation) && validationFailures.length) {
          output += '\n[validation_pending] Rerun unresolved commands; a different pass does not clear them: '
            + JSON.stringify(unresolvedValidationCommands(runtimeState()).map(redactText));
        }
        if (effects.validatesSource && validationUnavailable.length) output += '\n[validation_unavailable] ' + unavailableValidationNotice(runtimeState());
        if (feedback) isError = true;
        retrievalProgress?.observe(call.name, call.input || {}, output, isError);
        const commandTiming = effects.commandTiming && tools.lastCommandTiming ? { ...tools.lastCommandTiming } : {};
        await ledger.tool({ name: call.name, input: call.input, output, elapsedMs: Date.now() - started, ...commandTiming, error: isError ? output : undefined });
        const observedEvent = await session.journal?.append('tool_completed', { id: call.id, name: call.name, output: String(output), isError, ...(feedback ? { feedback } : {}) });
        if (session.taskState) {
          const taskState = session.taskState;
          taskState.phase = effects.phase;
          if (call.input?.path && !taskState.active_files.includes(call.input.path)) taskState.active_files.push(call.input.path);
          const finding = { toolId: call.id, tool: call.name, provenance: 'observed', sourceEventId: observedEvent?.eventId || null,
            outputSha256: createTaskHash(output), fileVersion: String(output).match(/^\[evidence ref=[^\n]+ sha256=([a-f0-9]{64})\]/)?.[1] || null, isError, ...(feedback ? { feedback } : {}) };
          taskState.confirmed_findings.push(finding);
          if (isError || /^exit=[^0]/.test(output) || feedback) taskState.failed_attempts.push(finding);
          taskState.validation = runtimeState();
          taskState.pending_steps = pendingValidation ? [{ action: 'Run relevant validation on current source', provenance: 'observed', sourceEventId: observedEvent?.eventId || null }] : [];
          const costCap = adapter.config ? adapter.config.maxCostUsd : config.maxCostUsd;
          taskState.budget_remaining = costCap == null ? null : Math.max(0, costCap - (adapter.spentUsd || 0));
          taskState.evidence_refs = [...(session.contextMemory?.units.keys() || [])];
        }
        await persistRuntimeState(session, runtimeState());
        emit({ type: 'tool_end', name: call.name, input: call.input, output: String(output), elapsedMs: Date.now() - started, ...commandTiming, isError });
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: String(output), is_error: isError });
      }
      const retrievalNotice = retrievalProgress?.notice();
      if (retrievalNotice && !signal?.aborted && status === 'running') {
        await ledger.event(retrievalNotice);
        emit(retrievalNotice);
        // Keep raw tool-result strings and their evidence hashes unchanged. Text
        // follows all results, so it is neither a tool failure nor a user goal.
        toolResults.push({ type: 'text', text: RETRIEVAL_NOTICE });
      }
      await appendSessionMessage(session, { role: 'user', content: toolResults });
      if (signal?.aborted) status = 'cancelled';
      if (['tool_limit_reached', 'cancelled'].includes(status)) break;
    }
    if (status === 'running') status = pendingValidation ? 'needs_validation' : 'tool_limit_reached';
  } catch (error) {
    status = signal?.aborted ? 'cancelled' : 'failed';
    terminalError = runtimeError(error, { config, stage: failureStage,
      budget: { ...lastBudget, ...error?.budget, automaticCompactions: autoCompactionAttempts,
        emergencyCompactions: 0 } });
    await ledger.event({ type: 'agent_error', error: terminalError });
    await session.journal?.append('runtime_error', terminalError);
    emit({ type: 'agent_error', error: terminalError });
    onText(`${error instanceof ModelError ? 'Agent stopped' : 'Agent error'}: ${terminalError.message}`);
  }

  Object.assign(session, { pendingValidation, validationPassed, validationAttempts, validationFailures, validationUnavailable, changedFiles });
  if (session.taskState) { session.taskState.phase = status === 'completed' ? 'finish' : session.taskState.phase; session.taskState.validation = runtimeState(); }
  if (status === 'cancelled') await appendSessionMessage(session, { role: 'user', content: 'Runtime notice: the previous turn was interrupted by the user. Completed edits remain; skipped or interrupted operations did not establish success. Follow the next user instruction rather than resuming automatically.' });
  await persistRuntimeState(session);
  if (lastBudget) contextDiagnostics.finalBudget = lastBudget;
  if (validationUnavailable.length) {
    const limitation = `\nValidation limitation: ${redactText(unavailableValidationNotice(runtimeState()))}`;
    finalText += limitation; onText(limitation);
  }
  const summary = await ledger.finish({ status, prompt: userMessage, contextDiagnostics, error: terminalError });
  emit({ type: 'turn_end', status, summary, spentUsd: adapter.costKnown === false ? null : adapter.spentUsd, changedFiles, pendingValidation, runDirectory: ledger.directory,
    ...(terminalError ? { error: terminalError } : {}) });
  return { status, text: finalText, summary, toolCalls, changedFiles, validationPassed, validationAttempts, validationFailures, validationUnavailable,
    ...(terminalError ? { error: terminalError } : {}),
    runType: offline ? 'offline-runtime' : 'live', contextDiagnostics, sessionId: session.persistent ? session.sessionId : null,
    wallElapsedMs: Date.now() - wallStarted, runDirectory: ledger.directory };
}

function createTaskHash(task) {
  return createHash('sha256').update(String(task)).digest('hex');
}
