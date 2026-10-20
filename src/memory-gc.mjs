import { ContextArchive } from './context-archive.mjs';
import { digest } from './session-journal.mjs';

export const residentHistoryBytes = session => Buffer.byteLength(JSON.stringify({ messages: session.messages,
  pinnedRequirements: session.pinnedRequirements || [] }), 'utf8');

export function collectUserRequirements(messages, prior = []) {
  const requirements = [...prior];
  for (const message of messages) if (message.role === 'user' && typeof message.content === 'string'
    && !requirements.some(item => item.content === message.content)) requirements.push(message);
  return requirements;
}

export function attachContextArchive(session, config, signal) {
  if (!session.journal || !session.contextMemory) return;
  session.contextArchive?.sweepCache();
  session.contextArchive = new ContextArchive(session.journal, { cacheBytes: config.memoryCacheBytes, signal });
  session.contextMemory.archive = session.contextArchive;
  session.contextMemory.protectedRuleRefs = session.protectedRuleRefs || [];
}

/** Commit the replacement before releasing any reachable original message. */
export async function collectCompactedHistory(session, config, state = session) {
  const checkpoint = session.compaction, cut = checkpoint?.firstKeptIndex;
  if (config.memoryGc === 'off' || !session.journal || !cut) return { status: 'not_needed' };
  const beforeBytes = residentHistoryBytes(session);
  session.contextMemory?.rebuild(session.messages);
  const ruleRefs = new Map(session.protectedRuleRefs || []);
  if (session.contextArchive) {
    for (const unit of session.contextMemory.units.values()) {
      if ((unit.messageIndex ?? Infinity) < cut) {
        await session.contextArchive.store(unit);
        if (/(?:^|[\\/])AGENTS(?:\.override)?\.md$/i.test(unit.path || '')) ruleRefs.set(unit.path,unit.ref);
      }
    }
  }
  const requirements = collectUserRequirements(session.messages.slice(0, cut), session.pinnedRequirements);
  const retained = session.messages.slice(cut);
  const compacted = { ...checkpoint, firstKeptIndex: 0, collectedMessages: cut,
    archivedMessageCount: (session.archivedMessageCount || 0) + cut };
  // Message artifacts are already committed, including seeded histories below.
  // The checkpoint selects the suffix by artifact identity, not a fragile line offset.
  const coveredArtifacts = [];
  for (const message of session.messages.slice(0, cut)) coveredArtifacts.push(await session.journal.put(message));
  const suffixArtifacts = [];
  for (const message of retained) suffixArtifacts.push(await session.journal.put(message));
  const outcome = { status: 'collected', removedMessages: cut, beforeBytes,
    afterBytes: residentHistoryBytes({ messages: retained, pinnedRequirements: requirements }) };
  await session.journal.append('memory_gc_checkpoint', { schema: 1, compaction: compacted,
    pinnedRequirements: requirements, coveredArtifacts, suffixArtifacts, archivedMessageCount: compacted.archivedMessageCount,
    protectedRuleRefs: [...ruleRefs], compactionCount: session.compactionCount || 0, runtimeState: { pendingValidation: state.pendingValidation,
      validationPassed: state.validationPassed, validationAttempts: state.validationAttempts,
      validationFailures: state.validationFailures || [], changedFiles: state.changedFiles,
      autoCompactionBackoff: session.autoCompactionBackoff || null }, outcome });
  session.messages.splice(0, cut);
  session.pinnedRequirements = requirements; session.compaction = compacted;
  session.protectedRuleRefs = [...ruleRefs];
  if (session.contextMemory) session.contextMemory.protectedRuleRefs = session.protectedRuleRefs;
  session.archivedMessageCount = compacted.archivedMessageCount; session.gcDiagnostics = outcome;
  session.contextMemory?.rebuild(session.messages);
  session.contextMemory?.evicted.clear();
  session.contextArchive?.sweepCache();
  // These are caches of old evidence, not current validation obligations.
  session.tools?.readEvidence.clear(); session.tools?.presentedSource.clear();
  const hashes = new Set(retained.flatMap(message => Array.isArray(message.content)
    ? message.content.filter(block => block.type === 'tool_result' && typeof block.content === 'string').map(block => digest(block.content)) : []));
  for (const map of [session.tools?.sourceEvidence,session.tools?.searchEvidence]) {
    if (map) for (const key of map.keys()) if (!hashes.has(key)) map.delete(key);
  }
  session.memoryDiagnostics = null;
  if (session.taskState) session.taskState.evidence_refs = [...(session.contextMemory?.units.keys() || [])];
  return outcome;
}
