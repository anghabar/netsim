import type { CardProgress, ReviewQuality } from './types';

export const DAY_MS = 86400000;
export const INITIAL_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3;
export const MAX_INTERVAL_DAYS = 365;
export const PASS_QUALITY = 3;
export const MASTERED_INTERVAL_DAYS = 21;
export const MAX_TIMESTAMP = 8.64e15;
export const MAX_REVIEW_COUNT = 1000000;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const bump = (count: number): number => Math.min(MAX_REVIEW_COUNT, count + 1);

export function isReviewQuality(value: unknown): value is ReviewQuality {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5;
}

/** A card that has never been reviewed is due immediately. */
export function newProgress(cardId: string): CardProgress {
  return {
    cardId,
    easeFactor: INITIAL_EASE,
    intervalDays: 0,
    repetitions: 0,
    dueAt: 0,
    lastReviewedAt: 0,
    reviews: 0,
    lapses: 0,
  };
}

/**
 * One SM-2 step. The ease factor is updated first and the new value drives the
 * interval; a failed recall restarts the repetition sequence. An invalid
 * quality or time returns the input unchanged.
 */
export function review(progress: CardProgress, quality: ReviewQuality, now: number): CardProgress {
  if (!isReviewQuality(quality) || !Number.isFinite(now) || now < 0 || now > MAX_TIMESTAMP) return progress;

  const penalty = 5 - quality;
  const rawEase = progress.easeFactor + 0.1 - penalty * (0.08 + penalty * 0.02);
  const easeFactor = Math.min(MAX_EASE, Math.max(MIN_EASE, round2(rawEase)));
  const passed = quality >= PASS_QUALITY;

  let intervalDays = 1;
  if (passed && progress.repetitions === 1) {
    intervalDays = 6;
  } else if (passed && progress.repetitions > 1) {
    const grown = Math.round(progress.intervalDays * easeFactor);
    intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.max(1, grown));
  }

  return {
    cardId: progress.cardId,
    easeFactor,
    intervalDays,
    repetitions: passed ? bump(progress.repetitions) : 0,
    dueAt: Math.min(MAX_TIMESTAMP, now + intervalDays * DAY_MS),
    lastReviewedAt: now,
    reviews: bump(progress.reviews),
    lapses: passed ? progress.lapses : bump(progress.lapses),
  };
}

export function isDue(progress: CardProgress, now: number): boolean {
  return now >= progress.dueAt;
}

export function isMastered(progress: CardProgress): boolean {
  return progress.intervalDays >= MASTERED_INTERVAL_DAYS;
}
