import { describe, expect, it } from 'vitest';
import type { Lab } from '../../../types/NetworkTypes';
import {
  addStrike,
  applyValidationResults,
  canGoToStep,
  completeStepInSession,
  createLabSession,
  finalizeProgress,
  goToStep,
  hasTooManyStrikes,
  registerHint,
  runStepValidations,
  submitStep,
} from '../../../features/labs/domain/labSession';
import { T0, emptyContext, makeLab, makeStep } from './fixtures';

const snapshot = { devices: [], cables: [] };
const start = (lab: Lab, examMode = false, previousAttempts = 0) =>
  createLabSession(lab, { examMode, nowMs: T0, userId: 'guest-user', previousAttempts, snapshot });
const passAll = (lab: Lab, examMode = false) =>
  submitStep(submitStep(start(lab, examMode), lab, emptyContext).session, lab, emptyContext).session;

describe('createLabSession', () => {
  it('builds a guided session with the lab totals', () => {
    const session = start(makeLab(), false, 2);
    expect(session.progress).toMatchObject({ maxScore: 100, attempts: 3, startedAt: '2026-01-01T00:00:00.000Z' });
    expect(session.examTimeLimit).toBeUndefined();
    expect(session.validationResults.map((entry) => entry.stepId)).toEqual(['s1', 's2']);
  });

  it('sets the exam limit in seconds', () => {
    const session = start(makeLab(), true);
    expect(session).toMatchObject({ examTimeLimit: 1800, examStartTime: T0, examStrikes: 0 });
  });
});

describe('runStepValidations', () => {
  it('treats a throwing check as failed', () => {
    const step = makeStep('boom', 10, () => {
      throw new Error('unexpected device shape');
    });
    expect(runStepValidations(step, emptyContext)).toEqual([
      { id: 'boom-0-config', passed: false, errorMessage: 'boom failed' },
    ]);
  });

  it('gives each validation a distinct id', () => {
    const step = makeStep('s1', 10);
    step.validation.push({ ...step.validation[0] });
    const ids = runStepValidations(step, emptyContext).map((result) => result.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('validate then advance', () => {
  it('keeps the step and the score when validation fails', () => {
    const lab = makeLab([makeStep('s1', 40, () => false), makeStep('s2', 60)]);
    const { session, submission } = submitStep(start(lab), lab, emptyContext);
    expect(submission).toEqual({ status: 'failed', errors: ['s1 failed'] });
    expect(session.progress).toMatchObject({ currentStep: 0, score: 0, validationsFailed: ['s1-0-config'] });
  });

  it('advances and then finishes on the last step', () => {
    const lab = makeLab();
    const first = submitStep(start(lab), lab, emptyContext);
    expect(first.submission.status).toBe('advanced');
    expect(first.session.progress).toMatchObject({ currentStep: 1, score: 40 });
    const second = submitStep(first.session, lab, emptyContext);
    expect(second.submission.status).toBe('finished');
    expect(second.session.progress.score).toBe(100);
  });

  it('does not complete a step that was not validated or is not the current one', () => {
    const lab = makeLab();
    const fresh = start(lab);
    expect(completeStepInSession(fresh, lab, 's1')).toBe(fresh);
    expect(completeStepInSession(fresh, lab, 'missing')).toBe(fresh);

    const validated = applyValidationResults(fresh, 's1', runStepValidations(lab.steps[0], emptyContext));
    expect(completeStepInSession(validated, lab, 's2')).toBe(validated);
    expect(completeStepInSession(validated, lab, 's1').progress).toMatchObject({ currentStep: 1, score: 40 });
  });

  it('awards the points of a step only once', () => {
    const lab = makeLab();
    const advanced = submitStep(start(lab), lab, emptyContext).session;
    const again = submitStep(goToStep(advanced, lab, 0), lab, emptyContext).session;
    expect(again.progress).toMatchObject({ score: 40, completedSteps: ['s1'], currentStep: 1 });
  });

  it('only allows navigation up to the first pending step', () => {
    const lab = makeLab([makeStep('s1', 10), makeStep('s2', 10), makeStep('s3', 10)]);
    const fresh = start(lab);
    expect(canGoToStep(fresh, lab, 1)).toBe(false);
    expect(goToStep(fresh, lab, 2)).toBe(fresh);

    const advanced = submitStep(fresh, lab, emptyContext).session;
    expect(goToStep(advanced, lab, 0).progress.currentStep).toBe(0);
    expect(canGoToStep(advanced, lab, 1)).toBe(true);
    expect(canGoToStep(advanced, lab, 2)).toBe(false);
    expect(canGoToStep(advanced, lab, -1)).toBe(false);
    expect(canGoToStep(advanced, lab, 0.5)).toBe(false);
  });

  it('is idle once the attempt is closed', () => {
    const lab = makeLab();
    const session = start(lab);
    const closed = { ...session, progress: finalizeProgress(session, T0 + 1000) };
    expect(submitStep(closed, lab, emptyContext).submission.status).toBe('idle');
    expect(goToStep(closed, lab, 0)).toBe(closed);
  });
});

describe('hints and strikes', () => {
  it('counts hints only in open guided sessions', () => {
    const lab = makeLab();
    expect(registerHint(start(lab)).progress.hintsUsed).toBe(1);
    const exam = start(lab, true);
    expect(registerHint(exam)).toBe(exam);
  });

  it('counts strikes only in exams', () => {
    const lab = makeLab();
    const guided = start(lab);
    expect(addStrike(guided)).toBe(guided);
    const struck = addStrike(addStrike(addStrike(start(lab, true))));
    expect(struck.examStrikes).toBe(3);
    expect(hasTooManyStrikes(struck)).toBe(true);
  });
});

describe('finalizeProgress', () => {
  it('records elapsed seconds, completion date and stars', () => {
    const progress = finalizeProgress(passAll(makeLab()), T0 + 90_000);
    expect(progress).toMatchObject({ timeSpent: 90, completedAt: '2026-01-01T00:01:30.000Z', stars: 3 });
  });

  it('lowers the stars when many hints were used', () => {
    const session = registerHint(registerHint(registerHint(start(makeLab()))));
    const lab = makeLab();
    const done = submitStep(submitStep(session, lab, emptyContext).session, lab, emptyContext).session;
    expect(finalizeProgress(done, T0 + 1000).stars).toBe(2);
  });

  it('gives no stars when the maximum score is zero', () => {
    const lab = makeLab([makeStep('s1', 0)]);
    const done = submitStep(start(lab), lab, emptyContext).session;
    expect(finalizeProgress(done, T0 + 1000)).toMatchObject({ stars: 0, score: 0, maxScore: 0 });
  });

  it('marks a timed-out exam as failed on time with no stars', () => {
    const progress = finalizeProgress(passAll(makeLab(), true), T0 + 5_000_000, true);
    expect(progress).toMatchObject({ timeSpent: 1800, stars: 0 });
  });

  it('gives stars in exam mode only when the exam is passed', () => {
    const passed = passAll(makeLab(), true);
    expect(finalizeProgress(passed, T0 + 600_000).stars).toBe(3);
    expect(finalizeProgress({ ...passed, examStrikes: 3 }, T0 + 600_000).stars).toBe(0);
    expect(finalizeProgress(passed, T0 + 1_800_000).stars).toBe(0);
  });
});
