import { describe, expect, it } from 'vitest';
import { MAX_PROGRESS_ENTRIES, emptyDeck } from '../../../features/flashcards/domain/deck';
import {
  FLASHCARDS_DECK_SLOT,
  loadDeck,
  parseCardProgress,
  parseStoredDeck,
  saveDeck,
} from '../../../features/flashcards/domain/deckStorage';
import type { CardProgress, FlashcardsDeckData } from '../../../features/flashcards/domain/types';
import { createMemoryStorage } from '../../../utils/storage/keyValueStorage';

const valid: CardProgress = {
  cardId: 'card-a',
  easeFactor: 2.5,
  intervalDays: 6,
  repetitions: 2,
  dueAt: 2000,
  lastReviewedAt: 1000,
  reviews: 2,
  lapses: 0,
};

const stored = (cards: unknown[], streak: unknown = null): string => JSON.stringify({ version: 1, cards, streak });

describe('flashcard deck storage', () => {
  it('round-trips progress and streak', () => {
    const storage = createMemoryStorage();
    const deck: FlashcardsDeckData = {
      progress: new Map([['card-a', valid]]),
      streak: { current: 2, best: 3, lastStudyDay: 20000 },
    };
    expect(saveDeck(storage, deck)).toEqual({ ok: true, value: undefined });
    expect(loadDeck(storage)).toEqual(deck);
  });

  it('returns an empty deck for missing, corrupt, oversized or unexpected content', () => {
    expect(loadDeck(createMemoryStorage())).toEqual(emptyDeck());
    expect(parseStoredDeck('{"version":1,"cards":')).toEqual(emptyDeck());
    expect(parseStoredDeck('x'.repeat(FLASHCARDS_DECK_SLOT.maxBytes + 1))).toEqual(emptyDeck());
    expect(parseStoredDeck(JSON.stringify({ version: 99, cards: [valid] }))).toEqual(emptyDeck());
    expect(parseStoredDeck(JSON.stringify([valid]))).toEqual(emptyDeck());
    expect(parseStoredDeck(JSON.stringify({ version: 1, cards: 'nope' }))).toEqual(emptyDeck());
    const tooMany = Array.from({ length: MAX_PROGRESS_ENTRIES + 1 }, (_, i) => ({ ...valid, cardId: `c${i}` }));
    expect(parseStoredDeck(stored(tooMany))).toEqual(emptyDeck());
  });

  it('drops invalid entries one by one', () => {
    const deck = parseStoredDeck(
      stored([
        valid,
        { ...valid, cardId: 'card-b', easeFactor: 99 },
        { ...valid, cardId: 'card-c', dueAt: -1 },
        { ...valid, cardId: 'card-d', repetitions: 1.5 },
        { ...valid, cardId: 'card-e', intervalDays: '6' },
        { ...valid, cardId: 'card-f', lapses: 5 },
        { ...valid, cardId: 'Not A Valid Id' },
        { ...valid, cardId: '' },
        'nope',
        null,
      ]),
    );
    expect(Array.from(deck.progress.keys())).toEqual(['card-a']);
  });

  it('copies known fields only and never touches Object.prototype', () => {
    const crafted = JSON.stringify(valid).replace(/^\{/, '{"__proto__":{"polluted":true},"extra":1,');
    const text = `{"version":1,"__proto__":{"polluted":true},"cards":[${crafted}],"streak":null}`;
    const loaded = parseStoredDeck(text).progress.get('card-a');
    expect(loaded).toEqual(valid);
    expect(Object.keys(loaded ?? {})).toHaveLength(8);
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
    expect(parseCardProgress([valid])).toBeNull();
  });

  it('validates the stored streak', () => {
    const streakOf = (streak: unknown) => parseStoredDeck(stored([], streak)).streak;
    expect(streakOf({ current: 2, best: 5, lastStudyDay: 20000 })).toEqual({ current: 2, best: 5, lastStudyDay: 20000 });
    expect(streakOf({ current: 4, best: 1, lastStudyDay: 20000 })).toEqual({ current: 4, best: 4, lastStudyDay: 20000 });
    for (const bad of [
      null,
      'streak',
      { current: -1, best: 1, lastStudyDay: 3 },
      { current: 1.5, best: 2, lastStudyDay: 3 },
      { current: 2, best: 2, lastStudyDay: null },
      { current: 2, best: 2, lastStudyDay: 1e12 },
    ]) {
      expect(streakOf(bad)).toEqual({ current: 0, best: 0, lastStudyDay: null });
    }
  });

  it('reports a full store as a result error instead of throwing', () => {
    const storage = createMemoryStorage({ quotaBytes: 8 });
    const deck: FlashcardsDeckData = { progress: new Map([['card-a', valid]]), streak: emptyDeck().streak };
    expect(saveDeck(storage, deck)).toEqual({ ok: false, error: 'quota-exceeded' });
    expect(loadDeck(storage)).toEqual(emptyDeck());
  });
});
