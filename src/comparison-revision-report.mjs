import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeComparison } from './comparison-report.mjs';

const summary = row => ({ expectedPairs: row.expectedPairs, measuredPairs: row.measuredPairs, bothAcceptedPairs: row.bothAcceptedPairs,
  baselineAccepted: row.piAccepted, candidateAccepted: row.teaAccepted, baselineMeasuredTokens: row.piMeasuredTokens,
  candidateMeasuredTokens: row.teaMeasuredTokens, allPairsTokenReductionPercent: row.allPairsTokenReductionPercent,
  bothAcceptedBaselineTokens: row.bothAcceptedPiTokens, bothAcceptedCandidateTokens: row.bothAcceptedTeaTokens,
  bothAcceptedTokenReductionPercent: row.bothAcceptedTokenReductionPercent });

export function analyzeRevisionComparison(report) {
  const issues = [];
  for (const role of ['baseline', 'candidate']) {
    const identity = report.engines?.[role];
    if (!identity?.commit || !identity.sourceSha256 || identity.sourceUnchanged !== true) issues.push(`Frozen ${role} engine stability was not confirmed`);
    if ((report.runs || []).filter(run => run.agent === role).some(run => run.engineCommit !== identity?.commit || run.engineSha256 !== identity?.sourceSha256)) issues.push(`${role} run source identity mismatch`);
  }
  if ((report.runs || []).some(run => !['baseline', 'candidate'].includes(run.agent))) issues.push('Unknown revision arm');
  const aliases = { baseline: 'pi', candidate: 'tea' };
  const analysis = analyzeComparison({ ...report, sourceUnchanged: report.sourceUnchanged === true && issues.length === 0,
    runs: (report.runs || []).map(run => ({ ...run, agent: aliases[run.agent] })),
    requests: (report.requests || []).map(row => ({ ...row, agent: aliases[row.agent] })) });
  return { validComparison: analysis.validComparison && issues.length === 0, issues: [...new Set([...issues, ...analysis.issues])],
    expectedControls: analysis.expectedControls, pairs: analysis.pairs.map(pair => ({ ...pair, tea: undefined, pi: undefined,
      baseline: report.runs.find(run => run.caseId === pair.caseId && run.agent === 'baseline') ?? null,
      candidate: report.runs.find(run => run.caseId === pair.caseId && run.agent === 'candidate') ?? null })),
    overall: summary(analysis.overall), scales: analysis.scales.map(row => ({ scale: row.scale, ...summary(row) })) };
}

export async function writeRevisionComparisonReport(report, directory) {
  const analysis = analyzeRevisionComparison(report), overall = analysis.overall;
  const lines = ['# TEA direct-parent revision comparison', '', `Run: ${report.runId}`, '',
    `Baseline: ${report.engines.baseline.commit}; candidate: ${report.engines.candidate.commit}.`, '',
    `Acceptance: ${report.acceptanceVersion}. Model: ${report.commonProfile.model}; thinking ${report.commonProfile.thinkingMode}/${report.commonProfile.effort}.`, '',
    `Known paired usage: ${overall.measuredPairs}/${overall.expectedPairs}; accepted baseline/candidate ${overall.baselineAccepted}/${overall.candidateAccepted}.`, '',
    `All-attempt provider token reduction: ${overall.allPairsTokenReductionPercent === null ? 'unknown' : `${overall.allPairsTokenReductionPercent.toFixed(2)}%`}.`, '',
    'All cache input, reasoning output, retries and failures count. Missing usage is unknown; prepared/scripted data is not provider performance evidence.', '',
    analysis.validComparison ? 'Recorded controls, fixtures, source identities and sums agree.' : `Not eligible: ${analysis.issues.join('; ')}.`, '',
    'These are repeated self-authored fixtures, not independent production holdout projects. Quality dimensions remain separate from token totals.', ''];
  await writeFile(path.join(directory, 'summary.json'), JSON.stringify(analysis, null, 2) + '\n');
  await writeFile(path.join(directory, 'REPORT.md'), lines.join('\n'));
  return analysis;
}
