import type { LabSession } from '../../types/NetworkTypes';

/**
 * Diagnosis is not offered while an exam is being taken: it would point at
 * the answer. This is a local courtesy rule, not a security boundary.
 */

/** An exam is in progress until its session is cleared or marked as completed. */
export function isExamInProgress(session: LabSession | null | undefined): boolean {
  return (
    session !== null &&
    session !== undefined &&
    session.isExamMode === true &&
    session.progress.completedAt === undefined
  );
}

type ExamProbe = () => boolean;

let boundProbe: ExamProbe | null = null;

/**
 * CLI commands receive devices and cables only, not the lab session. The
 * feature slice binds a probe here when the store is created and the
 * `diagnose` command asks through `isDiagnosisBlocked`. The most recently
 * created store wins; the application creates exactly one.
 */
export function bindExamProbe(probe: ExamProbe | null): void {
  boundProbe = probe;
}

/** False when no store has bound a probe: without a store there is no lab session. */
export function isDiagnosisBlocked(): boolean {
  return boundProbe !== null && boundProbe();
}
