import { redactText } from './tools.mjs';

const clipped = (value, limit) => redactText(String(value ?? '')).slice(0, limit);

export function requirementReviewOperation(call, isError) {
  return { id: clipped(call.id, 80), name: clipped(call.name, 32),
    subject: clipped(call.input?.path || call.input?.command || '', 180), isError: Boolean(isError) };
}

// A bounded diagnostic prompt, not a new acceptance oracle or a passing-test signal.
export function requirementReviewMessage({ state, operations = [], unresolved = [], unavailable = '' }) {
  const recent = operations.slice(-8).map(op =>
    `${clipped(op.id, 80)} ${clipped(op.name, 32)} ${op.isError ? 'failed' : 'returned'}: ${clipped(op.subject, 180)}`);
  return [
    '[requirement_review] One review for this turn; existing validation obligations remain unchanged.',
    'Compare the original user requirements with current evidence. Briefly map requested observable outcomes to executed checks/results; mark missing evidence unverified. Operation metadata below is not proof of correct behavior.',
    'Inspect whether test setup or your tools supplied an output/precondition the program itself must produce. Exercise an uncovered interaction through the real entry point from fresh inputs when supported. Derive expected locations/content from requirements, independently of implementation helpers. Inspect persisted results as well as command status.',
    'Reuse sufficient evidence. For a concrete gap, add/run a focused assertion and repair supported defects; do not invent requirements, weaken existing checks, repeat broad tests without new evidence, or change correct code merely to satisfy this review. Report remaining uncertainty. A checklist alone does not establish coverage.',
    `Validation pending: ${Boolean(state.pendingValidation)}. Unresolved commands: ${JSON.stringify(unresolved.slice(0, 6).map(command => clipped(command, 240)))}. A different pass cannot clear them; edits still require fresh validation.`,
    ...(unavailable ? [`Unavailable checks: ${clipped(unavailable, 800)}`] : []),
    ...(recent.length ? ['Recent operations (bounded metadata; consult actual results):', ...recent] : []),
  ].join('\n');
}
