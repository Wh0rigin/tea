import { randomUUID } from 'node:crypto';
import { SessionJournal, workspaceIdentity, digest } from './session-journal.mjs';
import { validateRunId } from './run-id.mjs';

export function memorySessionFields(config) {
  return { sessionId: validateRunId(config.resume || config.sessionId || randomUUID()), journal: null,
    persistent: Boolean(config.resume || config.sessionId || config.memoryPolicy === 'contextos'
      || (config.compaction === 'auto' && config.memoryGc !== 'off')),
    persisted: false, journalHead: null, restoredBudget: null, memoryDiagnostics: null, capabilities: null };
}

export async function attachSessionJournal(session, config) {
  if (!session.persistent) return;
  const journal = await SessionJournal.open({ workspace: config.workspace, id: session.sessionId,
    resume: session.persisted || Boolean(config.resume), maxStorageBytes: config.sessionStorageMaxBytes });
  session.journal = journal;
  try {
    if (session.persisted) {
      if (journal.rows.at(-1)?.sha256 !== session.journalHead) throw new Error('Session advanced in another process; explicitly resume it');
      const identity = await workspaceIdentity(config.workspace);
      if (session.lastIdentity && (session.lastIdentity.head !== identity.head || session.lastIdentity.filesSha256 !== identity.filesSha256)) invalidateSession(session);
      return;
    }
    const identity = await workspaceIdentity(config.workspace);
    if (!config.resume) {
      await journal.append('session_created', { identity, model: config.model,
        endpointSha256: digest(config.baseUrl), maxCostUsd: config.maxCostUsd,
        maxInputTokens: config.maxInputTokens ?? null, effort: config.effort, thinkingMode: config.thinkingMode });
      session.persisted = true; return;
    }
    const created = { kind: journal.rows[0]?.kind, value: await journal.get(journal.rows[0]?.artifact) };
    if (created?.kind !== 'session_created' || created.value.identity.workspace !== identity.workspace
      || created.value.model !== config.model || created.value.endpointSha256 !== digest(config.baseUrl)) throw new Error('Resume requires the original workspace, model and endpoint');
    const messages = [], inflight = new Map();
    let state = null, budget = { spentUsd: 0, spentInputBound: 0, actualInputTokens: 0, blockedUnknown: false };
    const checkpointRow = journal.rows.findLast(row => row.kind === 'memory_gc_checkpoint');
    const resetRow = journal.rows.findLast(row => row.kind === 'conversation_reset');
    const fullRestore = config.memoryGc === 'off' && config.memoryPolicy === 'full-history';
    const latestCut = fullRestore ? 0 : Math.max(checkpointRow?.seq || 0, resetRow?.seq || 0);
    for await (const event of journal.iterateEvents()) {
      if (event.kind === 'conversation_reset') { messages.length = 0; session.pinnedRequirements = []; session.protectedRuleRefs = []; session.archivedMessageCount = 0; }
      if (event.kind === 'memory_gc_checkpoint' && event.seq === latestCut) {
        if (event.value.schema !== 1 || !Array.isArray(event.value.suffixArtifacts) || !Array.isArray(event.value.pinnedRequirements)) throw new Error('Invalid GC checkpoint');
        messages.length = 0;
        for (const artifact of event.value.suffixArtifacts) messages.push(await journal.get(artifact));
        session.compaction = event.value.compaction;
        session.pinnedRequirements = event.value.pinnedRequirements;
        session.protectedRuleRefs = event.value.protectedRuleRefs || [];
        session.archivedMessageCount = event.value.archivedMessageCount;
        session.gcDiagnostics = event.value.outcome;
        state = { ...(state || {}), ...event.value.runtimeState, compaction: event.value.compaction,
          compactionCount: event.value.compactionCount, tools: null, memoryDiagnostics: null };
      }
      if (event.kind === 'memory_gc_checkpoint' && fullRestore) state = { ...(state || {}),
        ...event.value.runtimeState, compaction: null, compactionCount: event.value.compactionCount, tools: null };
      if (event.kind === 'message' && event.seq > latestCut) messages.push(event.value);
      if (event.kind === 'runtime_state') state = event.value;
      if (event.kind === 'request_intent') inflight.set(event.value.requestId, event.value);
      if (event.kind === 'request_settled') { inflight.delete(event.value.requestId); budget = event.value.budget; }
    }
    session.messages = messages;
    if (state) Object.assign(session, { pendingValidation: state.pendingValidation, validationPassed: state.validationPassed,
      validationAttempts: state.validationAttempts, validationFailures: state.validationFailures || [], changedFiles: state.changedFiles,
      compaction: state.compaction, compactionCount: state.compactionCount, autoCompactionBackoff: state.autoCompactionBackoff || null,
      restoredTools: state.tools, offline: state.offline });
    if (session.validationFailures?.length) { session.pendingValidation = true; session.validationPassed = false; }
    session.taskState = state?.taskState || null;
    session.capabilities = state?.capabilities || null;
    session.memoryDiagnostics = state?.memoryDiagnostics || null;
    if (fullRestore) { session.compaction = null; session.pinnedRequirements = []; }
    for (const intent of inflight.values()) {
      budget = { ...budget, spentUsd: budget.spentUsd + (intent.reservedUsd ?? 0), costKnown: budget.costKnown !== false && intent.reservedUsd !== null,
        spentInputBound: budget.spentInputBound + intent.inputBound, blockedUnknown: true };
    }
    const costCaps = [config.maxCostUsd, created.value.maxCostUsd].filter(value => value !== undefined && value !== null);
    if (costCaps.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid persisted cost cap');
    const maxCostUsd = costCaps.length ? Math.min(...costCaps) : null;
    const inputCaps = [config.maxInputTokens, created.value.maxInputTokens].filter(value => value !== undefined && value !== null);
    session.restoredBudget = { ...budget, maxCostUsd, maxInputTokens: inputCaps.length ? Math.min(...inputCaps) : undefined };
    session.budgetUnknown = budget.blockedUnknown;
    const previousIdentity = state?.identity || created.value.identity;
    const changed = previousIdentity.head !== identity.head || previousIdentity.filesSha256 !== identity.filesSha256;
    if (changed) invalidateSession(session);
    session.lastIdentity = identity;
    // Fill an interrupted response batch with explicit errors; never re-execute it.
    const last = messages.at(-1), calls = last?.role === 'assistant' && Array.isArray(last.content)
      ? last.content.filter(block => block.type === 'tool_use') : [];
    if (calls.length) {
      const results = calls.map(call => ({ type: 'tool_result', tool_use_id: call.id, is_error: true,
        content: 'Process interrupted before this tool batch was durably committed. Its effects are uncertain; inspect the workspace. Do not replay edits or commands automatically.' }));
      await appendSessionMessage(session, { role: 'user', content: results });
      session.pendingValidation = true; session.validationPassed = false;
    }
    session.persisted = true;
    if (inflight.size) await journal.append('recovery_unknown_billing', { requestIds: [...inflight.keys()], budget });
    await journal.append('session_resumed', { identity, changed, recoveredTailBytes: journal.recoveredTailBytes || 0,
      effort: config.effort, thinkingMode: config.thinkingMode });
  } catch (error) { await journal.close(); session.journal = null; throw error; }
}

export async function appendSessionMessage(session, message) {
  const event = session.journal ? await session.journal.append('message', message) : null;
  session.messages.push(message);
  return event;
}

export function restoreToolMemory(session, tools) {
  const memory = session.restoredTools;
  if (!memory) return;
  tools.sessionTerms = new Map(memory.sessionTerms || []);
  tools.unresolvedQueries = new Set(memory.unresolvedQueries || []);
  tools.discoveryWide = memory.discoveryWide;
  tools.searchCursorNeeded = Boolean(memory.searchCursorNeeded);
  tools.readEvidence = new Map(memory.readEvidence || []);
  tools.searchEvidence = new Map(memory.searchEvidence || []);
  tools.sourceEvidence = new Map(memory.sourceEvidence || []);
  tools.presentedSource = new Map((memory.presentedSource || []).map(([key, value]) =>
    [key, { ...value, lines: new Map(value.lines) }]));
  session.restoredTools = null;
}

export async function persistRuntimeState(session, state = session, extra = {}) {
  if (!session.journal) return;
  const tools = session.tools;
  const identity = await workspaceIdentity(session.workspace);
  await session.journal.append('runtime_state', {
    pendingValidation: state.pendingValidation, validationPassed: state.validationPassed,
    validationAttempts: state.validationAttempts, validationFailures: state.validationFailures || [], changedFiles: state.changedFiles,
    compaction: session.compaction, compactionCount: session.compactionCount, offline: session.offline,
    autoCompactionBackoff: session.autoCompactionBackoff || null,
    taskState: session.taskState || null, memoryDiagnostics: session.memoryDiagnostics || null,
    gcDiagnostics: session.gcDiagnostics || null,
    capabilities: session.capabilities || null,
    identity,
    tools: tools ? { sessionTerms: [...tools.sessionTerms], unresolvedQueries: [...tools.unresolvedQueries],
      discoveryWide: tools.discoveryWide, searchCursorNeeded: Boolean(tools.searchCursorNeeded),
      readEvidence: [...tools.readEvidence], searchEvidence: [...tools.searchEvidence], sourceEvidence: [...tools.sourceEvidence], presentedSource: [...tools.presentedSource].map(([key, value]) =>
        [key, { ...value, lines: [...value.lines] }]) } : null, ...extra });
  session.lastIdentity = identity;
}

function invalidateSession(session) {
  session.validationPassed = false; session.pendingValidation = true; session.compaction = null;
  session.restoredTools = null; session.tools?.readEvidence.clear(); session.tools?.presentedSource.clear();
  session.resumeNotice = 'Runtime notice: workspace content or Git HEAD changed since this checkpoint. Old source, decisions and tests are historical, not current evidence. Read current source and validate before claiming completion.';
}

export async function closeSessionJournal(session) {
  if (!session.journal) return;
  session.journalHead = session.journal.rows.at(-1)?.sha256 || null;
  await session.journal.close(); session.journal = null;
}

export async function resetPersistentConversation(session, config) {
  await attachSessionJournal(session, config);
  try {
    await session.journal?.append('conversation_reset', {});
    session.messages.length = 0; session.compaction = null; session.compactionCount = 0;
    session.autoCompactionBackoff = null;
    session.tools?.sessionTerms.clear(); session.tools?.unresolvedQueries.clear();
    session.tools?.readEvidence.clear(); session.tools?.presentedSource.clear();
    session.tools?.searchEvidence.clear();
    session.tools?.sourceEvidence.clear();
    session.contextMemory = null;
    if (session.tools) session.tools.contextMemory = null;
    session.taskState = null; session.memoryDiagnostics = null;
    session.pinnedRequirements = []; session.protectedRuleRefs = []; session.archivedMessageCount = 0; session.gcDiagnostics = null;
    session.contextArchive?.sweepCache(); session.contextArchive = null;
    session.capabilities = null;
    await persistRuntimeState(session);
  } finally { await closeSessionJournal(session); }
}

export async function inspectSession(config, id) {
  const journal = await SessionJournal.open({ workspace: config.workspace, id, resume: true });
  try {
    let state, requests = 0, messages = 0;
    const unresolved = new Set();
    for await (const event of journal.iterateEvents()) {
      if (event.kind === 'runtime_state') state = event.value;
      if (event.kind === 'message') messages++;
      if (event.kind === 'request_intent') unresolved.add(event.value.requestId);
      if (event.kind === 'request_settled') { requests++; unresolved.delete(event.value.requestId); }
    }
    return { sessionId: id, schema: 1, events: journal.rows.length, messages,
      pendingValidation: state?.pendingValidation ?? null, changedFiles: state?.changedFiles || [],
      validationFailures: state?.validationFailures || [],
      latestIdentity: state?.identity || null, memoryDiagnostics: state?.memoryDiagnostics || null,
      taskState: state?.taskState || null, gcDiagnostics: state?.gcDiagnostics || null,
      requests, unresolvedRequestIds: [...unresolved] };
  } finally { await journal.close(); }
}
