import type { Lab, LabProgress, LabSession, LabStep, LabValidationContext } from '../../../types/NetworkTypes';
import {
  MAX_ATTEMPTS,
  MAX_EXAM_STRIKES,
  MAX_HINTS_COUNTED,
  computeStars,
  elapsedSeconds,
  evaluateExam,
  examTimeLimitSeconds,
  isoFromMs,
  scoreRatio,
} from './labRules';

const MAX_TRACKED_VALIDATIONS = 5000;

export interface StepValidationResult {
  id: string;
  passed: boolean;
  errorMessage?: string;
}

export type StepSubmission =
  | { status: 'idle' }
  | { status: 'failed'; errors: string[] }
  | { status: 'advanced' }
  | { status: 'finished' };

export interface NewSessionOptions {
  examMode: boolean;
  nowMs: number;
  userId: string;
  previousAttempts: number;
  snapshot: LabSession['topologySnapshot'];
}

/** The index keeps ids distinct when a step has two validations of the same type. */
export function validationId(stepId: string, index: number, type: string): string {
  return `${stepId}-${index}-${type}`;
}

export function createLabSession(lab: Lab, options: NewSessionOptions): LabSession {
  const { examMode, nowMs } = options;
  return {
    labId: lab.id,
    isExamMode: examMode,
    examStartTime: examMode ? nowMs : undefined,
    examTimeLimit: examMode ? examTimeLimitSeconds(lab.estimatedTime) : undefined,
    examStrikes: examMode ? 0 : undefined,
    progress: {
      labId: lab.id,
      userId: options.userId,
      startedAt: isoFromMs(nowMs),
      currentStep: 0,
      completedSteps: [],
      score: 0,
      maxScore: lab.steps.reduce((sum, step) => sum + step.points, 0),
      stars: 0,
      attempts: Math.min(MAX_ATTEMPTS, Math.max(0, options.previousAttempts) + 1),
      timeSpent: 0,
      hintsUsed: 0,
      validationsPassed: [],
      validationsFailed: [],
    },
    topologySnapshot: options.snapshot,
    commandHistory: [],
    validationResults: lab.steps.map((step) => ({
      stepId: step.id,
      validations: step.validation.map((validation, index) => ({
        id: validationId(step.id, index, validation.type),
        passed: false,
      })),
    })),
  };
}

export function isSessionClosed(session: LabSession): boolean {
  return session.progress.completedAt !== undefined;
}

/** Runs every check of a step. A check that throws counts as failed. */
export function runStepValidations(step: LabStep, context: LabValidationContext): StepValidationResult[] {
  return step.validation.map((validation, index) => {
    const id = validationId(step.id, index, validation.type);
    let passed = false;
    try {
      passed = validation.check(context) === true;
    } catch {
      passed = false;
    }
    return passed ? { id, passed } : { id, passed, errorMessage: validation.errorMessage };
  });
}

export function applyValidationResults(
  session: LabSession,
  stepId: string,
  results: StepValidationResult[],
): LabSession {
  const touched = new Set(results.map((result) => result.id));
  const untouched = (ids: readonly string[]): string[] => ids.filter((id) => !touched.has(id));
  const passed = results.filter((result) => result.passed).map((result) => result.id);
  const failed = results.filter((result) => !result.passed).map((result) => result.id);
  return {
    ...session,
    validationResults: session.validationResults.map((entry) =>
      entry.stepId === stepId ? { ...entry, validations: results } : entry,
    ),
    progress: {
      ...session.progress,
      validationsPassed: [...untouched(session.progress.validationsPassed), ...passed].slice(-MAX_TRACKED_VALIDATIONS),
      validationsFailed: [...untouched(session.progress.validationsFailed), ...failed].slice(-MAX_TRACKED_VALIDATIONS),
    },
  };
}

/** True when the latest recorded validation run of the step passed completely. */
export function isStepValidated(session: LabSession, stepId: string): boolean {
  const entry = session.validationResults.find((item) => item.stepId === stepId);
  return entry !== undefined && entry.validations.every((validation) => validation.passed);
}

/**
 * Completes the current step, and only after its validations passed.
 * Points are awarded once per step; other step ids are ignored, so a step can
 * never be skipped.
 */
export function completeStepInSession(session: LabSession, lab: Lab, stepId: string): LabSession {
  const index = lab.steps.findIndex((step) => step.id === stepId);
  const step: LabStep | undefined = lab.steps[index];
  if (step === undefined || isSessionClosed(session)) return session;
  if (index !== session.progress.currentStep || !isStepValidated(session, stepId)) return session;
  const { completedSteps, score, maxScore } = session.progress;
  const alreadyDone = completedSteps.includes(stepId);
  return {
    ...session,
    progress: {
      ...session.progress,
      completedSteps: alreadyDone ? completedSteps : [...completedSteps, stepId],
      score: alreadyDone ? score : Math.min(maxScore, score + step.points),
      currentStep: Math.min(index + 1, Math.max(0, lab.steps.length - 1)),
    },
  };
}

/** Index of the first step that is still pending (or the last step). */
export function furthestReachableStep(session: LabSession, lab: Lab): number {
  const firstPending = lab.steps.findIndex((step) => !session.progress.completedSteps.includes(step.id));
  return firstPending === -1 ? Math.max(0, lab.steps.length - 1) : firstPending;
}

export function canGoToStep(session: LabSession, lab: Lab, index: number): boolean {
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < lab.steps.length &&
    index <= furthestReachableStep(session, lab)
  );
}

export function goToStep(session: LabSession, lab: Lab, index: number): LabSession {
  if (isSessionClosed(session) || !canGoToStep(session, lab, index)) return session;
  if (index === session.progress.currentStep) return session;
  return { ...session, progress: { ...session.progress, currentStep: index } };
}

/** Validates the current step and, when it passes, completes it. */
export function submitStep(
  session: LabSession,
  lab: Lab,
  context: LabValidationContext,
): { session: LabSession; submission: StepSubmission } {
  const step: LabStep | undefined = lab.steps[session.progress.currentStep];
  if (isSessionClosed(session) || step === undefined) {
    return { session, submission: { status: 'idle' } };
  }
  const results = runStepValidations(step, context);
  const checked = applyValidationResults(session, step.id, results);
  const errors = results
    .filter((result) => !result.passed)
    .map((result) => result.errorMessage ?? 'Validation failed');
  if (errors.length > 0) {
    return { session: checked, submission: { status: 'failed', errors } };
  }
  const next = completeStepInSession(checked, lab, step.id);
  const finished = lab.steps.every((item) => next.progress.completedSteps.includes(item.id));
  return { session: next, submission: finished ? { status: 'finished' } : { status: 'advanced' } };
}

/** Hints only count in guided sessions that are still open. */
export function registerHint(session: LabSession): LabSession {
  if (isSessionClosed(session) || session.isExamMode === true) return session;
  const hintsUsed = Math.min(MAX_HINTS_COUNTED, session.progress.hintsUsed + 1);
  return { ...session, progress: { ...session.progress, hintsUsed } };
}

export function addStrike(session: LabSession): LabSession {
  if (isSessionClosed(session) || session.isExamMode !== true) return session;
  return { ...session, examStrikes: Math.min(MAX_EXAM_STRIKES, (session.examStrikes ?? 0) + 1) };
}

export function hasTooManyStrikes(session: LabSession): boolean {
  return (session.examStrikes ?? 0) >= MAX_EXAM_STRIKES;
}

/**
 * Closes an attempt: elapsed time in seconds, completion date and stars.
 * Exam attempts only earn stars when the exam is passed.
 */
export function finalizeProgress(session: LabSession, nowMs: number, timedOut = false): LabProgress {
  const exam = session.isExamMode === true;
  const limit = exam ? (session.examTimeLimit ?? 0) : 0;
  const startMs =
    exam && typeof session.examStartTime === 'number'
      ? session.examStartTime
      : Date.parse(session.progress.startedAt);
  const elapsed = elapsedSeconds(startMs, nowMs);
  const timeSpent = limit > 0 ? (timedOut ? limit : Math.min(elapsed, limit)) : elapsed;
  const closed: LabProgress = {
    ...session.progress,
    score: Math.min(session.progress.score, session.progress.maxScore),
    timeSpent,
    completedAt: isoFromMs(nowMs),
    stars: 0,
  };
  const earned = computeStars(scoreRatio(closed.score, closed.maxScore), closed.hintsUsed);
  const eligible = !exam || evaluateExam({ ...session, progress: closed }).passed;
  return eligible ? { ...closed, stars: earned } : closed;
}
