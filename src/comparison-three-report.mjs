import { analyzeComparison } from './comparison-report.mjs';

/** Reuse the frozen observer/accounting rules; every planned task, including failures, counts. */
export function analyzeThreeComparison(report) {
  const pairs = {};
  for (const other of ['pi', 'claude']) {
    const map = row => ({ ...row, agent: row.agent === other ? 'pi' : row.agent });
    const subset = { ...report, piSourceUnchanged: report[`${other}SourceUnchanged`],
      sourceUnchanged: report.sourceUnchanged && report.engines?.tea?.sourceUnchanged,
      runs: report.runs.filter(r => ['tea',other].includes(r.agent)).map(map),
      requests: report.requests.filter(r => ['tea',other].includes(r.agent)).map(map) };
    pairs[other] = analyzeComparison(subset);
  }
  return { teaVsPi: pairs.pi, teaVsClaude: pairs.claude };
}
