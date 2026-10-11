// A data contract for a future model/effort handoff. No routing, provider call,
// or automatic acceptance of inferred claims is performed here.
export function memoryHandoff(session) {
  const task = session.taskState;
  const budget = session.restoredBudget || session.adapter || {};
  return structuredClone({ schema: 1, kind: 'contextos-handoff', sourceModel: session.model,
    workspaceIdentity: session.lastIdentity || null,
    userRequirements: task?.goal || null, constraints: task?.constraints || null,
    retainedUserMessages: (session.messages || []).filter(message=>message.role==='user'&&typeof message.content==='string').map(message=>message.content),
    activeFiles: task?.active_files || [], observedFindings: task?.confirmed_findings || [],
    inferredDecisions: task?.decisions || [], failedAttempts: task?.failed_attempts || [],
    evidenceRefs: task?.evidence_refs || [], pendingSteps: task?.pending_steps || [],
    validation: { pending: Boolean(session.pendingValidation), passed: Boolean(session.validationPassed),
      attempts: session.validationAttempts || 0, changedFiles: session.changedFiles || [] },
    accounting: { spentUsd: Number.isFinite(budget.spentUsd) ? budget.spentUsd : null,
      actualInputTokens: Number.isSafeInteger(budget.actualInputTokens) ? budget.actualInputTokens : null,
      unresolved: Boolean(session.budgetUnknown) },
    instructions: 'Revalidate source identity. Inferred decisions are unverified; only fresh relevant tool validation can certify completion. Preserve the original budget and all user messages.' });
}
