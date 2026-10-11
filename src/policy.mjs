import { createHash } from 'node:crypto';
import { isValidationCommand } from './tools.mjs';

export const POLICY_EFFORTS = Object.freeze(['low', 'high', 'max']);
export const POLICY_STRATEGIES = Object.freeze(['fixed-strong', 'fixed-weak', 'upgrade-only', 'bidirectional']);
const ZERO_TESTS = /(?:^|\n)\s*(?:#|ℹ\uFE0F?)\s+(?:tests|pass)\s+0\s*(?:\n|$)/;
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${label} must be a safe integer >= ${minimum}`);
  return value;
}

function amount(value, label, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) throw new TypeError(`${label} must be a finite number >= ${minimum}`);
  return value;
}

function effort(value) {
  if (!POLICY_EFFORTS.includes(value)) throw new TypeError('effort must be low, high, or max');
  return value;
}

function validateState(state) {
  if (!state || !POLICY_STRATEGIES.includes(state.strategy)) throw new TypeError('A policy state is required');
  effort(state.effort);
  integer(state.lastStep, 'state.lastStep', -1);
  for (const key of ['stepsAtEffort', 'lastEvidenceAttempt', 'lastDeclaredValidationAttempts', 'consecutiveFailures', 'consecutiveSuccesses', 'switchCount']) integer(state[key], `state.${key}`);
  if (typeof state.stopped !== 'boolean') throw new TypeError('state.stopped must be a boolean');
  if (state.lastEvidenceAttempt > state.lastDeclaredValidationAttempts) throw new TypeError('Observed attempts cannot exceed declared validation attempts');
  if (state.lastSwitchStep !== null && (!Number.isSafeInteger(state.lastSwitchStep) || state.lastSwitchStep < 0 || state.lastSwitchStep > state.lastStep)) throw new TypeError('Invalid state.lastSwitchStep');
  if (state.sourceRevision !== null && (typeof state.sourceRevision !== 'string' || !state.sourceRevision || state.sourceRevision.length > 256)) throw new TypeError('Invalid state.sourceRevision');
  if (state.lastFailureKey !== null && !/^[a-f0-9]{64}$/.test(state.lastFailureKey)) throw new TypeError('Invalid state.lastFailureKey');
  const fixedEffort = state.strategy === 'fixed-strong' ? 'max' : state.strategy === 'fixed-weak' ? 'low' : undefined;
  if (fixedEffort && state.effort !== fixedEffort) throw new TypeError('Fixed policy state cannot change effort');
}

export function createPolicyState({ strategy = 'bidirectional', initialEffort } = {}) {
  if (!POLICY_STRATEGIES.includes(strategy)) throw new TypeError('Unknown policy strategy');
  const fixed = strategy === 'fixed-strong' ? 'max' : strategy === 'fixed-weak' ? 'low' : undefined;
  if (fixed && initialEffort !== undefined && initialEffort !== fixed) throw new TypeError('Fixed strategy cannot change its initial effort');
  return { strategy, effort: effort(fixed ?? initialEffort ?? 'low'), lastStep: -1, stepsAtEffort: 0,
    sourceRevision: null, lastEvidenceAttempt: 0, lastDeclaredValidationAttempts: 0, lastFailureKey: null,
    consecutiveFailures: 0, consecutiveSuccesses: 0, lastSwitchStep: null, switchCount: 0, stopped: false };
}

function policyOptions(config = {}) {
  const minimumHoldSteps = integer(config.minimumHoldSteps ?? 2, 'minimumHoldSteps', 2);
  const successesBeforeDowngrade = integer(config.successesBeforeDowngrade ?? 2, 'successesBeforeDowngrade', 2);
  const failuresBeforeUpgrade = integer(config.failuresBeforeUpgrade ?? 2, 'failuresBeforeUpgrade', 2);
  const validationReserve = amount(config.validationReserve ?? 20, 'validationReserve', Number.MIN_VALUE);
  const requestReserveByEffort = config.requestReserveByEffort ?? { low: 8, high: 20, max: 40 };
  for (const key of POLICY_EFFORTS) amount(requestReserveByEffort[key], `requestReserveByEffort.${key}`, Number.MIN_VALUE);
  if (!(requestReserveByEffort.low <= requestReserveByEffort.high && requestReserveByEffort.high <= requestReserveByEffort.max)) throw new TypeError('Effort reservations must be nondecreasing');
  return { minimumHoldSteps, successesBeforeDowngrade, failuresBeforeUpgrade, validationReserve, requestReserveByEffort };
}

/** Inspect runtime tool evidence. Caller booleans alone are never successful validation evidence. */
function validationObservation(observation, state) {
  const evidence = observation.latestToolEvidence;
  if (!evidence || typeof evidence !== 'object') return { status: 'no-tool-evidence' };
  const command = evidence.input?.command;
  const output = typeof evidence.output === 'string' ? evidence.output : '';
  const outputSha256 = hash(output);
  if (!['run_tests', 'run_shell'].includes(evidence.name) || !isValidationCommand(command)) return { status: 'non-validation-tool', outputSha256 };
  const knownAttempt = Number.isSafeInteger(evidence.attempt) && evidence.attempt >= 1 && evidence.attempt <= observation.validationAttempts
    ? evidence.attempt : undefined;
  if (knownAttempt !== observation.validationAttempts) return { status: 'unaligned-validation-attempt', outputSha256,
    ...(knownAttempt !== undefined ? { attempt: knownAttempt } : {}) };
  if (evidence.sourceRevision !== observation.sourceRevision) return { status: 'stale-source-evidence', outputSha256, attempt: evidence.attempt };
  if (evidence.attempt <= state.lastEvidenceAttempt) return { status: 'already-observed-attempt', outputSha256 };
  const exit = /^exit=(\d+)\b/.exec(output);
  if (evidence.is_error || !exit) return { status: 'unclassified-validation-result', outputSha256, attempt: evidence.attempt };
  if (Number(exit[1]) !== 0) return { status: 'failure', outputSha256, attempt: evidence.attempt,
    failureKey: hash(`${observation.sourceRevision}\n${command.trim()}`) };
  if (ZERO_TESTS.test(output)) return { status: 'zero-test-result', outputSha256, attempt: evidence.attempt };
  if (observation.pendingValidation || observation.validationPassed !== true) return { status: 'success-not-currently-validated', outputSha256, attempt: evidence.attempt };
  return { status: 'success', outputSha256, attempt: evidence.attempt };
}

/**
 * Pure candidate policy. It observes existing tool calls and never creates a
 * retry, runs a test, mutates messages, or calls a provider. State supplied by
 * the caller is an assumed trusted runtime snapshot, not an independent proof.
 * Budget values are abstract simulation units, not token or provider prices.
 */
export function decideEffort(prior, observation, config = {}) {
  validateState(prior);
  if (!observation || typeof observation !== 'object') throw new TypeError('An observation is required');
  integer(observation.step, 'observation.step');
  if (observation.step <= prior.lastStep) throw new TypeError('Observations must have strictly increasing steps');
  if (typeof observation.sourceRevision !== 'string' || !observation.sourceRevision || observation.sourceRevision.length > 256) throw new TypeError('sourceRevision must be a nonempty runtime identity');
  if (typeof observation.pendingValidation !== 'boolean' || typeof observation.validationPassed !== 'boolean') throw new TypeError('Validation state must be explicit booleans');
  integer(observation.validationAttempts, 'validationAttempts');
  if (observation.validationAttempts < prior.lastDeclaredValidationAttempts) throw new TypeError('Validation attempts cannot decrease');
  amount(observation.remainingBudget, 'remainingBudget');
  const options = policyOptions(config);
  const next = { ...prior, lastStep: observation.step, stepsAtEffort: prior.stepsAtEffort + 1,
    sourceRevision: observation.sourceRevision, lastDeclaredValidationAttempts: observation.validationAttempts };
  const changedSource = prior.sourceRevision !== null && prior.sourceRevision !== observation.sourceRevision;
  const newEdit = observation.latestToolEvidence?.name === 'apply_patch';
  if (changedSource || newEdit) {
    next.consecutiveSuccesses = 0;
    next.consecutiveFailures = 0;
    next.lastFailureKey = null;
    // Editing expires every validation attempt already reported by this
    // snapshot. A changed source without an edit receipt expires the prior
    // snapshot's attempts, allowing a new validation from this same turn.
    const expiredThrough = newEdit ? observation.validationAttempts : prior.lastDeclaredValidationAttempts;
    next.lastEvidenceAttempt = Math.max(next.lastEvidenceAttempt, expiredThrough);
  }
  const evidence = validationObservation(observation, next);
  // Consume non-success results once too, so stale flags cannot make a repeated
  // attempt become a later success without a new real validation invocation.
  if (evidence.attempt !== undefined) next.lastEvidenceAttempt = Math.max(next.lastEvidenceAttempt, evidence.attempt);
  if (evidence.status === 'failure') {
    next.consecutiveSuccesses = 0;
    next.consecutiveFailures = next.lastFailureKey === evidence.failureKey ? next.consecutiveFailures + 1 : 1;
    next.lastFailureKey = evidence.failureKey;
  } else if (evidence.status === 'success') {
    next.consecutiveFailures = 0;
    next.lastFailureKey = null;
    next.consecutiveSuccesses += 1;
  } else if (['zero-test-result', 'unclassified-validation-result', 'success-not-currently-validated'].includes(evidence.status)) {
    next.consecutiveSuccesses = 0;
  }
  const observedSuccessStreak = next.consecutiveSuccesses;
  const observedFailureStreak = next.consecutiveFailures;

  let selectedEffort = prior.effort;
  let action = 'hold';
  let reason = 'no-route-evidence';
  const adaptive = ['upgrade-only', 'bidirectional'].includes(prior.strategy);
  const level = POLICY_EFFORTS.indexOf(prior.effort);
  if (prior.stopped) {
    action = 'stop'; reason = 'already-stopped';
  } else if (!adaptive) reason = 'fixed-policy';
  else if (evidence.status === 'failure' && next.consecutiveFailures >= options.failuresBeforeUpgrade) {
    if (next.stepsAtEffort < options.minimumHoldSteps) reason = 'minimum-hold-before-upgrade';
    else if (level === POLICY_EFFORTS.length - 1) reason = 'maximum-effort-reached';
    else { selectedEffort = POLICY_EFFORTS[level + 1]; action = 'up'; reason = 'repeated-validation-failure-on-current-source'; }
  } else if (prior.strategy === 'bidirectional' && evidence.status === 'success' && next.consecutiveSuccesses >= options.successesBeforeDowngrade) {
    if (next.stepsAtEffort < options.minimumHoldSteps) reason = 'minimum-hold-before-downgrade';
    else if (level === 0) reason = 'minimum-effort-reached';
    else { selectedEffort = POLICY_EFFORTS[level - 1]; action = 'down'; reason = 'consecutive-current-source-validation-successes'; }
  } else if (evidence.status === 'failure') reason = 'await-repeated-validation-failure';
  else if (evidence.status === 'success') reason = prior.strategy === 'upgrade-only' ? 'upgrade-only-never-downgrades' : 'await-consecutive-validation-successes';
  else reason = evidence.status;

  const requestReserve = options.requestReserveByEffort[selectedEffort];
  const requestedEffort = selectedEffort;
  const totalRequired = requestReserve + options.validationReserve;
  if (!prior.stopped && observation.remainingBudget < totalRequired) {
    action = 'stop';
    reason = observation.remainingBudget < options.validationReserve ? 'cannot-preserve-validation-reserve' : 'cannot-reserve-request-and-validation';
  }
  if (action === 'stop') {
    next.stopped = true;
    selectedEffort = prior.effort;
  } else if (action !== 'hold') {
    next.effort = selectedEffort;
    next.stepsAtEffort = 0;
    next.lastSwitchStep = observation.step;
    next.switchCount += 1;
    next.consecutiveSuccesses = 0;
    next.consecutiveFailures = 0;
    next.lastFailureKey = null;
  }
  const decision = { step: observation.step, strategy: prior.strategy, action, effortBefore: prior.effort,
    effort: selectedEffort, requestedEffort, reason, evidence, sourceRevision: observation.sourceRevision,
    pendingValidation: observation.pendingValidation, validationPassed: observation.validationPassed,
    validationAttempts: observation.validationAttempts, stepsAtEffortBeforeDecision: prior.stepsAtEffort + 1,
    validationAttemptWatermarkBefore: prior.lastEvidenceAttempt,
    validationAttemptWatermarkAfter: next.lastEvidenceAttempt,
    observedSuccessStreak, observedFailureStreak,
    requestAllowed: action !== 'stop', createsRetry: false, createsValidationCall: false,
    budget: { unit: 'abstract-simulation-unit', remaining: observation.remainingBudget, requestReserve,
      validationReserve: options.validationReserve, totalRequired,
      validationReservePreserved: action === 'stop' || observation.remainingBudget >= totalRequired },
    stateTrust: 'Caller-supplied runtime identity and tool evidence; not independently authenticated.' };
  return { state: next, decision };
}
