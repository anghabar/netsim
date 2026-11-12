import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => null,
  wasmPing: () => '',
}));

import { ALL_CARDS, BUILT_IN_DECKS } from '../../../features/flashcards/data/decks';
import { FLASHCARDS_DECK_SLOT } from '../../../features/flashcards/domain/deckStorage';
import { DAY_MS } from '../../../features/flashcards/domain/scheduler';
import type { ReviewQuality } from '../../../features/flashcards/domain/types';
import { createMemoryStorage } from '../../../utils/storage/keyValueStorage';
import { createTestStore, TEST_EPOCH_MS } from '../../helpers/createTestStore';

const FIRST_ID = ALL_CARDS[0].id;

describe('flashcards slice', () => {
  it('starts empty and loads on demand', () => {
    const store = createTestStore();
    expect(store.getState().flashcardsLoaded).toBe(false);
    store.getState().flashcardsLoad();
    expect(store.getState().flashcardsLoaded).toBe(true);
    expect(store.getState().flashcardsDeck.progress.size).toBe(0);
    expect(store.getState().flashcardsSession).toBeNull();
  });

  it('schedules a review with the injected clock and persists it', () => {
    const storage = createMemoryStorage();
    const store = createTestStore({ storage });
    expect(store.getState().flashcardsStart(null)).toBe(true);
    expect(store.getState().flashcardsSession?.queue[0]).toBe(FIRST_ID);

    store.getState().flashcardsRate(4);
    expect(store.getState().flashcardsSession?.studied).toBe(0);
    expect(store.getState().flashcardsDeck.progress.size).toBe(0);

    store.getState().flashcardsReveal();
    store.getState().flashcardsRate(4);
    const state = store.getState();
    const entry = state.flashcardsDeck.progress.get(FIRST_ID);
    expect(entry).toMatchObject({ repetitions: 1, dueAt: TEST_EPOCH_MS + DAY_MS, lastReviewedAt: TEST_EPOCH_MS });
    expect(state.flashcardsDeck.streak.current).toBe(1);
    expect(state.flashcardsSession).toMatchObject({ index: 1, studied: 1, recalled: 1, revealed: false });
    expect(state.flashcardsSaveError).toBeNull();
    expect(storage.read(FLASHCARDS_DECK_SLOT)).not.toBeNull();

    const later = createTestStore({ storage, now: TEST_EPOCH_MS + 2 * DAY_MS });
    later.getState().flashcardsLoad();
    expect(later.getState().flashcardsDeck.progress.get(FIRST_ID)).toEqual(entry);
    expect(later.getState().flashcardsStart(null)).toBe(true);
    expect(later.getState().flashcardsSession?.queue[0]).toBe(FIRST_ID);

    const sameDay = createTestStore({ storage });
    sameDay.getState().flashcardsStart(null);
    expect(sameDay.getState().flashcardsSession?.queue).not.toContain(FIRST_ID);
  });

  it('keeps progress in memory and reports the error when storage is full', () => {
    const storage = createMemoryStorage({ quotaBytes: 8 });
    const store = createTestStore({ storage });
    store.getState().flashcardsStart(null);
    store.getState().flashcardsReveal();
    store.getState().flashcardsRate(5);
    expect(store.getState().flashcardsSaveError).toBe('quota-exceeded');
    expect(store.getState().flashcardsDeck.progress.size).toBe(1);

    const restored = createTestStore({ storage });
    restored.getState().flashcardsLoad();
    expect(restored.getState().flashcardsDeck.progress.size).toBe(0);
  });

  it('rejects unknown decks and invalid ratings', () => {
    const store = createTestStore();
    expect(store.getState().flashcardsStart('missing-deck')).toBe(false);
    expect(store.getState().flashcardsSession).toBeNull();

    store.getState().flashcardsStart(BUILT_IN_DECKS[0].id);
    store.getState().flashcardsReveal();
    store.getState().flashcardsRate(Number('9') as ReviewQuality);
    expect(store.getState().flashcardsSession).toMatchObject({ index: 0, studied: 0 });
    expect(store.getState().flashcardsDeck.progress.size).toBe(0);
  });

  it('finishes a session by skipping and clears everything on reset', () => {
    const storage = createMemoryStorage();
    const store = createTestStore({ storage });
    const deck = BUILT_IN_DECKS[0];
    store.getState().flashcardsStart(deck.id);
    store.getState().flashcardsReveal();
    store.getState().flashcardsRate(3);
    for (let i = 1; i < deck.cards.length; i += 1) store.getState().flashcardsSkip();
    const session = store.getState().flashcardsSession;
    expect(session?.index).toBe(session?.queue.length);
    store.getState().flashcardsEnd();
    expect(store.getState().flashcardsSession).toBeNull();

    store.getState().flashcardsReset();
    expect(store.getState().flashcardsDeck.progress.size).toBe(0);
    expect(storage.read(FLASHCARDS_DECK_SLOT)).toBeNull();
  });

  it('ignores corrupt stored data', () => {
    const storage = createMemoryStorage();
    storage.write(FLASHCARDS_DECK_SLOT, '{"version":1,"cards":');
    const store = createTestStore({ storage });
    store.getState().flashcardsLoad();
    expect(store.getState().flashcardsDeck.progress.size).toBe(0);
    expect(store.getState().flashcardsStart(null)).toBe(true);
  });
});
