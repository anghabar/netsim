import { describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPT_SECONDS,
  computeStars,
  elapsedSeconds,
  evaluateExam,
  examRemainingSeconds,
  examTimeLimitSeconds,
  formatClock,
  formatDuration,
  isoFromMs,
  scorePercent,
  scoreRatio,
} from '../../../features/labs/domain/labRules';
import { createLabSession } from '../../../features/labs/domain/labSession';
import { T0, makeLab } from './fixtures';

const snapshot = { devices: [], cables: [] };
const session = (examMode: boolean, estimatedTime = 30) =>
  createLabSession(makeLab(undefined, { estimatedTime }), {
    examMode,
    nowMs: T0,
    userId: 'guest-user',
    previousAttempts: 0,
    snapshot,
  });

describe('scoring', () => {
  it('never divides by zero or leaves the 0..1 range', () => {
    expect(scoreRatio(10, 0)).toBe(0);
    expect(scoreRatio(0, 0)).toBe(0);
    expect(scoreRatio(Number.NaN, 100)).toBe(0);
    expect(scoreRatio(150, 100)).toBe(1);
    expect(scoreRatio(-5, 100)).toBe(0);
    expect(scorePercent(45, 60)).toBe(75);
    expect(scorePercent(5, 0)).toBe(0);
  });

  it('awards stars from score ratio and hints', () => {
    expect(computeStars(1, 0)).toBe(3);
    expect(computeStars(0.8, 3)).toBe(2);
    expect(computeStars(0.6, 5)).toBe(1);
    expect(computeStars(0.39, 0)).toBe(0);
    expect(computeStars(Number.NaN, 0)).toBe(0);
    expect(computeStars(1, Number.NaN)).toBe(1);
  });
});

describe('time', () => {
  it('keeps limits in seconds and timestamps in milliseconds', () => {
    const exam = session(true, 30);
    expect(exam.examTimeLimit).toBe(1800);
    expect(examRemainingSeconds(exam, T0)).toBe(1800);
    expect(examRemainingSeconds(exam, T0 + 60_000)).toBe(1740);
    expect(examRemainingSeconds(exam, T0 + 9_999_999)).toBe(0);
    expect(examRemainingSeconds(session(true, 180), T0 + 11_000)).toBe(10_800 - 11);
  });

  it('has no countdown for guided sessions or labs without an estimated time', () => {
    expect(examRemainingSeconds(session(false), T0 + 5_000)).toBeNull();
    expect(examRemainingSeconds(session(true, 0), T0 + 5_000)).toBeNull();
    expect(examTimeLimitSeconds(Number.NaN)).toBe(0);
    expect(examTimeLimitSeconds(-3)).toBe(0);
  });

  it('bounds elapsed time and tolerates invalid clocks', () => {
    expect(elapsedSeconds(T0, T0 - 5000)).toBe(0);
    expect(elapsedSeconds(Number.NaN, T0)).toBe(0);
    expect(elapsedSeconds(0, Number.MAX_SAFE_INTEGER)).toBe(MAX_ATTEMPT_SECONDS);
    expect(isoFromMs(T0)).toBe('2026-01-01T00:00:00.000Z');
    expect(isoFromMs(Number.POSITIVE_INFINITY)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('formats durations defensively', () => {
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(-3)).toBe('0m 0s');
    expect(formatDuration(Number.NaN)).toBe('0m 0s');
    expect(formatClock(65.9)).toBe('01:05');
  });
});

describe('exam outcome', () => {
  it('passes with enough score, time left and few strikes', () => {
    const exam = session(true);
    const outcome = evaluateExam({ ...exam, progress: { ...exam.progress, score: 70, timeSpent: 100 } });
    expect(outcome).toMatchObject({ passed: true, reasons: [], percent: 70 });
  });

  it('reports every failure reason', () => {
    const exam = session(true);
    const outcome = evaluateExam({
      ...exam,
      examStrikes: 3,
      progress: { ...exam.progress, score: 10, timeSpent: 1800 },
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.reasons).toEqual(['score', 'time', 'strikes']);
  });
});
