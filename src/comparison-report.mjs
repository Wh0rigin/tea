import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const total = (runs, field) => runs.reduce((sum, run) => sum + run[field], 0);
const delta = (tea, pi) => pi > 0 ? (1 - tea / pi) * 100 : null;
const percent = value => value === null ? 'unknown' : `${value.toFixed(2)}%`;

/** Ratios require recorded common controls and identical initial repository contents. */
export function analyzeComparison(report) {
  const issues = [];
  const profile = report.commonProfile || {};
  const expectedControls = { model: profile.model, maxTokens: profile.maxOutputTokens,
    thinking: profile.thinkingMode === 'adaptive' ? { type: 'adaptive' }
      : { type: 'enabled', budget_tokens: Math.min(profile.maxOutputTokens - 1, 8000) },
    outputConfig: { effort: profile.effort } };
  const submitted = (report.requests || []).filter(row => row.submitted);
  if (report.mode !== 'live' || report.usageSource !== 'provider-wire') issues.push('No live provider-wire experiment');
  if (!submitted.length) issues.push('No submitted provider requests');
  if (report.sourceUnchanged !== true) issues.push('TEA source stability was not confirmed');
  if (report.workspaceContextIsolated !== true || report.invalidated) issues.push('External instruction isolation was not confirmed');
  if (submitted.some(row => JSON.stringify(row.normalizedControls) !== JSON.stringify(expectedControls))) issues.push('Missing or mismatched common request controls');
  const runs = report.runs || [];
  if (new Set(runs.map(run => `${run.caseId}/${run.agent}`)).size !== runs.length) issues.push('Duplicate agent runs');
  for (const run of runs) {
    const task = (report.tasks || []).find(task => task.taskId === run.taskId);
    if (!task || run.initialSha256 !== task.sha256 || run.initialCommit !== task.commit) issues.push(`Initial repository mismatch: ${run.caseId}/${run.agent}`);
    const requests = submitted.filter(row => row.caseId === run.caseId && row.agent === run.agent);
    const known = requests.length > 0 && requests.every(row => row.complete && ['inputTokens','outputTokens','totalTokens'].every(field => Number.isSafeInteger(row[field]) && row[field] >= 0) && row.totalTokens === row.inputTokens + row.outputTokens);
    if (run.usageComplete !== known || run.requests !== requests.length) issues.push(`Request completeness mismatch: ${run.caseId}/${run.agent}`);
    if (known && ['inputTokens','outputTokens','totalTokens'].some(field => run[field] !== total(requests, field))) issues.push(`Token totals mismatch: ${run.caseId}/${run.agent}`);
  }
  if (submitted.some(row => !runs.some(run => run.caseId === row.caseId && run.agent === row.agent))) issues.push('Submitted requests without a recorded run');
  const validComparison = issues.length === 0;
  const pairs = (report.tasks || []).flatMap(task => Array.from({length: report.repeat || 1}, (_, index) => {
    const caseId = `${task.taskId}-r${index + 1}`;
    const tea = runs.find(run => run.caseId === caseId && run.agent === 'tea') || null;
    const pi = runs.find(run => run.caseId === caseId && run.agent === 'pi') || null;
    const usageComplete = Boolean(tea?.usageComplete && pi?.usageComplete);
    const bothAccepted = Boolean(tea?.accepted && pi?.accepted);
    return {caseId, taskId: task.taskId, scale: task.scale, family: task.family,
      fileCount: task.fileCount, lines: task.lines, tea, pi, usageComplete, bothAccepted,
      tokenReductionPercent: validComparison && usageComplete ? delta(tea.totalTokens, pi.totalTokens) : null};
  }));
  const summary = subset => {
    const known = subset.filter(pair => pair.usageComplete);
    const successful = known.filter(pair => pair.bothAccepted);
    const sumFor = (pairs, agent) => total(pairs.map(pair => pair[agent]), 'totalTokens');
    return { expectedPairs: subset.length, measuredPairs: known.length, bothAcceptedPairs: successful.length,
      teaAccepted: subset.filter(pair => pair.tea?.accepted).length, piAccepted: subset.filter(pair => pair.pi?.accepted).length,
      teaMeasuredTokens: validComparison && known.length ? sumFor(known,'tea') : null,
      piMeasuredTokens: validComparison && known.length ? sumFor(known,'pi') : null,
      // Overall includes failures, and is withheld if any planned pair has unknown usage.
      allPairsTokenReductionPercent: validComparison && subset.length > 0 && known.length === subset.length ? delta(sumFor(known,'tea'),sumFor(known,'pi')) : null,
      bothAcceptedTeaTokens: validComparison && successful.length ? sumFor(successful,'tea') : null,
      bothAcceptedPiTokens: validComparison && successful.length ? sumFor(successful,'pi') : null,
      bothAcceptedTokenReductionPercent: validComparison && successful.length ? delta(sumFor(successful,'tea'),sumFor(successful,'pi')) : null,
    };
  };
  return {validComparison, issues: [...new Set(issues)], expectedControls, pairs, overall: summary(pairs),
    scales: [...new Set(pairs.map(pair => pair.scale))].map(scale => ({scale,...summary(pairs.filter(pair => pair.scale === scale))}))};
}

export async function writeComparisonReport(report, directory) {
  const analysis = analyzeComparison(report);
  const lines = ['# TEA / Pi token comparison', '', `Run: ${report.runId}`, '',
    `Period: ${report.startedAt} to ${report.endedAt || 'unfinished'}.`, '',
    `Model: ${report.commonProfile.model}; thinking: ${report.commonProfile.thinkingMode}/${report.commonProfile.effort}; output cap: ${report.commonProfile.maxOutputTokens} tokens.`, '',
    `Pi: ${report.pi.version}; TEA source SHA-256: ${report.teaSourceSha256}.`, '',
    report.benchmarkKind, '', 'Token totals include uncached input, cache reads, cache writes and output. Reasoning is already included in output. Unknown usage is never counted as zero.', '',
    'These are native agent configurations with different prompts and tool APIs. Cache directives are retained. Provider cache state cannot be reset through this harness; alternating order reduces a consistent order advantage.', '',
    '## Integrity', '', analysis.validComparison ? 'Recorded controls, initial snapshots and token sums agree.' : `Comparison is not eligible for ratios: ${analysis.issues.join('; ')}.`, '',
    '## Coverage and acceptance', '',
    `Measured pairs: ${analysis.overall.measuredPairs}/${analysis.overall.expectedPairs}. TEA accepted: ${analysis.overall.teaAccepted}/${analysis.overall.expectedPairs}; Pi accepted: ${analysis.overall.piAccepted}/${analysis.overall.expectedPairs}. Both accepted: ${analysis.overall.bothAcceptedPairs}.`, '',
    `All planned pairs, including failed tasks: TEA token reduction = ${percent(analysis.overall.allPairsTokenReductionPercent)}.`, '',
    `Subset where both agents passed: TEA token reduction = ${percent(analysis.overall.bothAcceptedTokenReductionPercent)} across ${analysis.overall.bothAcceptedPairs} pairs. This subset is not the whole experiment.`, '',
    `Repetitions per task: ${report.repeat}. Repeating the same three bug families at different repository sizes does not establish quality or savings on unseen production tasks. One repetition is a small exploratory sample.`, '', '## Runs', ''];
  for (const pair of analysis.pairs) {
    lines.push(`### ${pair.caseId}`, '', `${pair.fileCount} files; ${pair.lines} lines.`, '');
    for (const agent of ['tea','pi']) {
      const run = pair[agent];
      lines.push(!run ? `- ${agent}: not run.` : `- ${agent}: ${run.status}; acceptance ${run.accepted ? 'passed' : 'failed'}; ${run.usageComplete ? `${run.inputTokens} input + ${run.outputTokens} output = ${run.totalTokens} tokens` : `usage unknown (reported lower bound ${run.reportedTokenLowerBound})`}; ${run.requests} requests; ${(run.elapsedMs/1000).toFixed(1)} s.`);
      if (run?.guards?.length) lines.push(`  Guard: ${run.guards.join('; ')}.`);
    }
    lines.push('', `TEA token reduction: ${percent(pair.tokenReductionPercent)}.`, '');
  }
  await writeFile(path.join(directory,'summary.json'),JSON.stringify(analysis,null,2)+'\n');
  await writeFile(path.join(directory,'REPORT.md'),lines.join('\n')+'\n');
  return analysis;
}
