import type { LabSession } from '../../../types/NetworkTypes';

/**
 * Scoring and exam rules.
 * Durations are always seconds; timestamps are epoch milliseconds.
 */
export const EXAM_PASS_RATIO = 0.7;
export const MAX_EXAM_STRIKES = 3;
export const MAX_STEPS_PER_LAB = 100;
export const MAX_STEP_POINTS = 10000;
export const MAX_SCORE = MAX_STEPS_PER_LAB * MAX_STEP_POINTS;
export const MAX_HINTS_COUNTED = 1000;
export const MAX_ATTEMPTS = 1000000;
export const MAX_LAB_MINUTES = 24 * 60;
export const MAX_ATTEMPT_SECONDS = 30 * 24 * 60 * 60;

const MAX_DATE_MS = 8.64e15;

export type ExamFailureReason = 'score' | 'time' | 'strikes';

export interface ExamOutcome {
  passed: boolean;
  percent: number;
  strikes: number;
  timeSpentSeconds: number;
  timeLimitSeconds: number;
  reasons: ExamFailureReason[];
}

/** Score as a ratio in 0..1; a missing or zero maximum yields 0. */
export function scoreRatio(score: number, maxScore: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return 0;
  return Math.min(1, Math.max(0, score / maxScore));
}

export function scorePercent(score: number, maxScore: number): number {
  return Math.round(scoreRatio(score, maxScore) * 100);
}

export function computeStars(ratio: number, hintsUsed: number): number {
  const safeRatio = Number.isFinite(ratio) ? ratio : 0;
  const hints = Number.isFinite(hintsUsed) ? hintsUsed : MAX_HINTS_COUNTED;
  if (safeRatio >= 0.8 && hints <= 2) return 3;
  if (safeRatio >= 0.6 && hints <= 4) return 2;
  if (safeRatio >= 0.4) return 1;
  return 0;
}

export function elapsedSeconds(startMs: number, nowMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return 0;
  return Math.min(MAX_ATTEMPT_SECONDS, Math.max(0, Math.floor((nowMs - startMs) / 1000)));
}

/** Exam time limit in seconds for a lab whose estimated time is given in minutes. */
export function examTimeLimitSeconds(estimatedMinutes: number): number {
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) return 0;
  return Math.round(Math.min(estimatedMinutes, MAX_LAB_MINUTES) * 60);
}

/** ISO date for an epoch value; out-of-range input falls back to the epoch instead of throwing. */
export function isoFromMs(ms: number): string {
  return new Date(Number.isFinite(ms) && Math.abs(ms) <= MAX_DATE_MS ? ms : 0).toISOString();
}

/** Seconds left in a timed exam, or null when the session has no time limit. */
export function examRemainingSeconds(session: LabSession, nowMs: number): number | null {
  const { isExamMode, examTimeLimit, examStartTime } = session;
  if (isExamMode !== true || typeof examTimeLimit !== 'number' || typeof examStartTime !== 'number') return null;
  if (!Number.isFinite(examTimeLimit) || examTimeLimit <= 0) return null;
  return Math.max(0, examTimeLimit - elapsedSeconds(examStartTime, nowMs));
}

export function evaluateExam(session: LabSession): ExamOutcome {
  const { score, maxScore, timeSpent } = session.progress;
  const strikes = session.examStrikes ?? 0;
  const timeLimitSeconds = session.examTimeLimit ?? 0;
  const reasons: ExamFailureReason[] = [];
  if (scoreRatio(score, maxScore) < EXAM_PASS_RATIO) reasons.push('score');
  if (timeLimitSeconds > 0 && timeSpent >= timeLimitSeconds) reasons.push('time');
  if (strikes >= MAX_EXAM_STRIKES) reasons.push('strikes');
  return {
    passed: reasons.length === 0,
    percent: scorePercent(score, maxScore),
    strikes,
    timeSpentSeconds: timeSpent,
    timeLimitSeconds,
    reasons,
  };
}

function wholeSeconds(totalSeconds: number): number {
  return Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = wholeSeconds(totalSeconds);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatClock(totalSeconds: number): string {
  const seconds = wholeSeconds(totalSeconds);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
