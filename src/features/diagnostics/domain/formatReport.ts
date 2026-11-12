import type { DiagnosticsReport, Finding, FindingSeverity } from './types';

export const REPORT_HEADING = 'Topology diagnosis:';

export function countBySeverity(findings: readonly Finding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/**
 * Plain-text rendering of a report, one console line per entry. Names inside
 * a report are already free of control characters, so every entry is a single
 * line. `maxFindings` limits how many findings are printed.
 */
export function formatReportLines(report: DiagnosticsReport, options: { maxFindings?: number } = {}): string[] {
  const counts = countBySeverity(report.findings);
  const total = report.findings.length;
  const limit = Math.max(0, Math.floor(options.maxFindings ?? total));
  const shown = report.findings.slice(0, limit);

  const lines: string[] = [
    `${REPORT_HEADING} ${report.deviceCount} device(s), ${report.cableCount} link(s), ${total} finding(s) ` +
      `[critical ${counts.critical}, warning ${counts.warning}, info ${counts.info}]`,
  ];
  if (report.truncated) lines.push('Note: the topology exceeds the analysis limits; results are partial.');
  if (report.skipped > 0) lines.push(`Note: ${report.skipped} malformed or duplicate entries were ignored.`);
  if (total === 0) lines.push('No consistency issues found.');

  for (const finding of shown) {
    lines.push(
      `[${finding.severity.toUpperCase()}][${finding.layer}] ${finding.title}`,
      `  ${finding.detail}`,
      `  Fix: ${finding.recommendation}`,
    );
  }
  if (total > shown.length) {
    lines.push(`... ${total - shown.length} more finding(s). Open Tools > Topology diagnosis for the full report.`);
  }
  return lines;
}
