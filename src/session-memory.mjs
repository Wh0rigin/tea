import { randomUUID } from 'node:crypto';
import { SessionJournal, workspaceIdentity, digest } from './session-journal.mjs';
import { validateRunId } from './run-id.mjs';

export function memorySessionFields(config) {
  return { sessionId: validateRunId(config.resume || config.sessionId || randomUUID()), journal: null,
    persistent: Boolean(config.resume || config.sessionId || config.memoryPolicy === 'contextos'),
    persisted: false, journalHead: null, restoredBudget: null, memoryDiagnostics: null };
}

export async function attachSessionJournal(session, config) {
  if (!session.persistent) return;
  const journal = await SessionJournal.open({ workspace: config.workspace, id: session.sessionId,
    resume: session.persisted || Boolean(config.resume) });
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
    const events = await journal.events(), created = events[0];
    if (created?.kind !== 'session_created' || created.value.identity.workspace !== identity.workspace
      || created.value.model !== config.model || created.value.endpointSha256 !== digest(config.baseUrl)) throw new Error('Resume requires the original workspace, model and endpoint');
    const messages = [], inflight = new Map();
    let state = null, budget = { spentUsd: 0, spentInputBound: 0, actualInputTokens: 0, blockedUnknown: false };
    for (const event of events) {
      if (event.kind === 'conversation_reset') messages.length = 0;
      if (event.kind === 'message') messages.push(event.value);
      if (event.kind === 'runtime_state') state = event.value;
      if (event.kind === 'request_intent') inflight.set(event.value.requestId, event.value);
      if (event.kind === 'request_settled') { inflight.delete(event.value.requestId); budget = event.value.budget; }
    }
    session.messages = messages;
    if (state) Object.assign(session, { pendingValidation: state.pendingValidation, validationPassed: state.validationPassed,
      validationAttempts: state.validationAttempts, changedFiles: state.changedFiles,
      compaction: state.compaction, compactionCount: state.compactionCount, restoredTools: state.tools, offline: state.offline });
    session.taskState = state?.taskState || null;
    session.memoryDiagnostics = state?.memoryDiagnostics || null;
    for (const intent of inflight.values()) {
      budget = { ...budget, spentUsd: budget.spentUsd + intent.reservedUsd,
        spentInputBound: budget.spentInputBound + intent.inputBound, blockedUnknown: true };
    }
    const maxCostUsd = Math.min(config.maxCostUsd, created.value.maxCostUsd);
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
  tools.readEvidence = new Map(memory.readEvidence || []);
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
    validationAttempts: state.validationAttempts, changedFiles: state.changedFiles,
    compaction: session.compaction, compactionCount: session.compactionCount, offline: session.offline,
    taskState: session.taskState || null, memoryDiagnostics: session.memoryDiagnostics || null,
    identity,
    tools: tools ? { sessionTerms: [...tools.sessionTerms], unresolvedQueries: [...tools.unresolvedQueries],
      readEvidence: [...tools.readEvidence], presentedSource: [...tools.presentedSource].map(([key, value]) =>
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
    session.tools?.sessionTerms.clear(); session.tools?.unresolvedQueries.clear();
    session.tools?.readEvidence.clear(); session.tools?.presentedSource.clear();
    session.contextMemory = null;
    if (session.tools) session.tools.contextMemory = null;
    session.taskState = null; session.memoryDiagnostics = null;
    await persistRuntimeState(session);
  } finally { await closeSessionJournal(session); }
}

export async function inspectSession(config, id) {
  const journal = await SessionJournal.open({ workspace: config.workspace, id, resume: true });
  try {
    const events = await journal.events(), state = events.filter(event => event.kind === 'runtime_state').at(-1)?.value;
    return { sessionId: id, schema: 1, events: events.length, messages: events.filter(event => event.kind === 'message').length,
      pendingValidation: state?.pendingValidation ?? null, changedFiles: state?.changedFiles || [],
      latestIdentity: state?.identity || null, memoryDiagnostics: state?.memoryDiagnostics || null,
      taskState: state?.taskState || null,
      requests: events.filter(event => event.kind === 'request_settled').length,
      unresolvedRequestIds: events.filter(event => event.kind === 'request_intent' && !events.some(other => other.kind === 'request_settled' && other.value.requestId === event.value.requestId)).map(event => event.value.requestId) };
  } finally { await journal.close(); }
}
