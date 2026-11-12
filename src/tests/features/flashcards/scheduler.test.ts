import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  MAX_EASE,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  isDue,
  isMastered,
  isReviewQuality,
  newProgress,
  review,
} from '../../../features/flashcards/domain/scheduler';
import type { ReviewQuality } from '../../../features/flashcards/domain/types';

const NOW = 1700000000000;

describe('flashcard scheduler', () => {
  it('makes a new card due immediately', () => {
    const fresh = newProgress('card');
    expect(isDue(fresh, NOW)).toBe(true);
    expect(fresh.easeFactor).toBe(2.5);
  });

  it('follows the 1 day, 6 days, interval x ease sequence on successful recalls', () => {
    const first = review(newProgress('card'), 4, NOW);
    expect(first).toMatchObject({ repetitions: 1, intervalDays: 1, easeFactor: 2.5, dueAt: NOW + DAY_MS });

    const second = review(first, 4, NOW + DAY_MS);
    expect(second).toMatchObject({ repetitions: 2, intervalDays: 6 });

    const third = review(second, 5, NOW + 7 * DAY_MS);
    expect(third).toMatchObject({ repetitions: 3, intervalDays: 16, easeFactor: 2.6, reviews: 3, lapses: 0 });
    expect(isDue(third, NOW + 7 * DAY_MS)).toBe(false);
    expect(isDue(third, NOW + 23 * DAY_MS)).toBe(true);
  });

  it('restarts the sequence and lowers the ease on a failed recall', () => {
    const learned = review(review(newProgress('card'), 4, NOW), 4, NOW);
    const failed = review(learned, 1, NOW);
    expect(failed).toMatchObject({ repetitions: 0, intervalDays: 1, easeFactor: 1.96, lapses: 1 });
  });

  it('keeps the ease factor and the interval inside their bounds', () => {
    let hard = newProgress('hard');
    let easy = newProgress('easy');
    for (let i = 0; i < 12; i += 1) {
      hard = review(hard, 0, NOW);
      easy = review(easy, 5, NOW);
    }
    expect(hard.easeFactor).toBe(MIN_EASE);
    expect(easy.easeFactor).toBe(MAX_EASE);
    expect(easy.intervalDays).toBe(MAX_INTERVAL_DAYS);
    expect(isMastered(easy)).toBe(true);
    expect(isMastered(hard)).toBe(false);
  });

  it('is pure: same input, same output, input untouched', () => {
    const start = Object.freeze(newProgress('card'));
    expect(review(start, 3, NOW)).toEqual(review(start, 3, NOW));
    expect(start.reviews).toBe(0);
  });

  it('returns the input unchanged for an unusable time or quality', () => {
    const start = newProgress('card');
    expect(review(start, 4, Number.NaN)).toBe(start);
    expect(review(start, 4, Number.POSITIVE_INFINITY)).toBe(start);
    expect(review(start, 4, -1)).toBe(start);
    expect(review(start, Number('9') as ReviewQuality, NOW)).toBe(start);
  });

  it('validates review qualities', () => {
    expect(isReviewQuality(0)).toBe(true);
    expect(isReviewQuality(5)).toBe(true);
    expect(isReviewQuality(6)).toBe(false);
    expect(isReviewQuality(2.5)).toBe(false);
    expect(isReviewQuality('3')).toBe(false);
  });
});
