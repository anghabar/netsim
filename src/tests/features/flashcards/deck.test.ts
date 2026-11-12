import { describe, expect, it } from 'vitest';
import { ALL_CARDS, BUILT_IN_DECKS, cardsOfDeck, findCard } from '../../../features/flashcards/data/decks';
import {
  EMPTY_STREAK,
  activeStreak,
  advanceStreak,
  applyReview,
  buildQueue,
  dayIndex,
  emptyDeck,
  summarizeProgress,
} from '../../../features/flashcards/domain/deck';
import { CARD_ID_PATTERN } from '../../../features/flashcards/domain/deckStorage';
import { DAY_MS } from '../../../features/flashcards/domain/scheduler';
import {
  applyRating,
  currentCardId,
  isFinished,
  reveal,
  skip,
  startSession,
} from '../../../features/flashcards/domain/session';
import type { CardProgress, Flashcard } from '../../../features/flashcards/domain/types';

const card = (id: string): Flashcard => ({ id, front: `front ${id}`, back: `back ${id}`, difficulty: 'easy', tags: [] });

const entry = (cardId: string, dueAt: number, intervalDays = 1): CardProgress => ({
  cardId,
  easeFactor: 2.5,
  intervalDays,
  repetitions: 1,
  dueAt,
  lastReviewedAt: 0,
  reviews: 1,
  lapses: 0,
});

const cards = [card('a'), card('b'), card('c'), card('d')];
const progress = new Map([
  ['b', entry('b', 500)],
  ['c', entry('c', 200)],
  ['d', entry('d', 5000, 30)],
]);
const noon = (day: number): number => day * DAY_MS + DAY_MS / 2;

describe('study queue', () => {
  it('puts overdue reviews first, then new cards, and leaves out cards that are not due', () => {
    expect(buildQueue(cards, progress, 1000)).toEqual(['c', 'b', 'a']);
  });

  it('applies the limit and ignores invalid limits and duplicate cards', () => {
    expect(buildQueue(cards, progress, 1000, 2)).toEqual(['c', 'b']);
    expect(buildQueue(cards, progress, 1000, Number.NaN)).toEqual(['c', 'b', 'a']);
    expect(buildQueue([...cards, card('a')], progress, 1000, 0)).toEqual(['c']);
  });

  it('summarizes progress over the whole card set', () => {
    expect(summarizeProgress(cards, progress, 1000)).toEqual({
      total: 4,
      fresh: 1,
      learning: 2,
      mastered: 1,
      due: 3,
      masteryPercent: 25,
    });
  });
});

describe('study streak', () => {
  it('maps timestamps to local days with the injected offset', () => {
    expect(dayIndex(noon(10), 0)).toBe(10);
    expect(dayIndex(10 * DAY_MS + 30 * 60000, 60)).toBe(9);
    expect(dayIndex(10 * DAY_MS - 30 * 60000, -60)).toBe(10);
    expect(dayIndex(Number.NaN, 0)).toBeNull();
    expect(dayIndex(noon(10), Number.NaN)).toBeNull();
    expect(dayIndex(noon(10), 100000)).toBeNull();
    expect(dayIndex(-5 * DAY_MS, 0)).toBeNull();
  });

  it('grows on consecutive days, restarts after a gap and ignores earlier days', () => {
    const first = advanceStreak(EMPTY_STREAK, 10);
    expect(first).toEqual({ current: 1, best: 1, lastStudyDay: 10 });
    expect(advanceStreak(first, 10)).toBe(first);
    const second = advanceStreak(first, 11);
    expect(second).toEqual({ current: 2, best: 2, lastStudyDay: 11 });
    expect(advanceStreak(second, 13)).toEqual({ current: 1, best: 2, lastStudyDay: 13 });
    expect(advanceStreak(second, 9)).toBe(second);
    expect(advanceStreak(second, null)).toBe(second);
  });

  it('counts only when the last study day is today or yesterday', () => {
    const streak = { current: 2, best: 4, lastStudyDay: 11 };
    expect(activeStreak(streak, 11)).toBe(2);
    expect(activeStreak(streak, 12)).toBe(2);
    expect(activeStreak(streak, 13)).toBe(0);
    expect(activeStreak(streak, null)).toBe(0);
    expect(activeStreak(EMPTY_STREAK, 11)).toBe(0);
  });

  it('records a review in a new deck object and leaves the input untouched', () => {
    const before = emptyDeck();
    const after = applyReview(before, 'card-a', 4, noon(10), 0);
    expect(before.progress.size).toBe(0);
    expect(after.progress.get('card-a')).toMatchObject({ repetitions: 1, lastReviewedAt: noon(10) });
    expect(after.streak).toEqual({ current: 1, best: 1, lastStudyDay: 10 });
    expect(applyReview(before, 'card-a', 4, Number.NaN, 0)).toBe(before);
  });
});

describe('study session transitions', () => {
  it('requires the answer to be shown before a rating counts', () => {
    let session = startSession(['a', 'b'], 'deck');
    expect(currentCardId(session)).toBe('a');
    expect(applyRating(session, 5)).toBe(session);
    session = applyRating(reveal(session), 4);
    expect(session).toMatchObject({ index: 1, revealed: false, studied: 1, recalled: 1 });
    session = applyRating(reveal(session), 1);
    expect(isFinished(session)).toBe(true);
    expect(currentCardId(session)).toBeNull();
    expect(session).toMatchObject({ studied: 2, recalled: 1 });
  });

  it('finishes when the last card is skipped and ignores input afterwards', () => {
    const done = skip(skip(startSession(['a', 'b'], null)));
    expect(isFinished(done)).toBe(true);
    expect(applyRating(done, 5)).toBe(done);
    expect(reveal(done)).toBe(done);
    expect(skip(done)).toBe(done);
  });
});

describe('built-in decks', () => {
  it('have unique, storable ids and non-empty content', () => {
    const ids = ALL_CARDS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(BUILT_IN_DECKS.map((deck) => deck.id)).size).toBe(BUILT_IN_DECKS.length);
    for (const item of ALL_CARDS) {
      expect(CARD_ID_PATTERN.test(item.id)).toBe(true);
      expect(item.front.trim().length).toBeGreaterThan(0);
      expect(item.back.trim().length).toBeGreaterThan(0);
      expect(findCard(item.id)).toBe(item);
    }
    expect(findCard('missing')).toBeNull();
  });

  it('resolve decks by id', () => {
    expect(cardsOfDeck(null)).toBe(ALL_CARDS);
    expect(cardsOfDeck(BUILT_IN_DECKS[0].id)).toBe(BUILT_IN_DECKS[0].cards);
    expect(cardsOfDeck('missing')).toBeNull();
  });
});
