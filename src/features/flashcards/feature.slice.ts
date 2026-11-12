import type { FeatureSliceDefinition } from '../../store/featureState';
import type { StorageWriteError } from '../../utils/storage/keyValueStorage';
import { cardsOfDeck } from './data/decks';
import { applyReview, buildQueue, emptyDeck } from './domain/deck';
import { FLASHCARDS_DECK_SLOT, loadDeck, saveDeck } from './domain/deckStorage';
import { isReviewQuality } from './domain/scheduler';
import { applyRating, currentCardId, reveal, skip, startSession } from './domain/session';
import type { FlashcardsDeckData, ReviewQuality, StudySession } from './domain/types';

export interface FlashcardsSlice {
  /** Scheduling data and study streak; read from local storage on first use. */
  flashcardsDeck: FlashcardsDeckData;
  flashcardsLoaded: boolean;
  flashcardsSession: StudySession | null;
  /** Set when the last save failed; progress is then kept in memory only. */
  flashcardsSaveError: StorageWriteError | null;

  flashcardsLoad: () => void;
  /** Starts a session with the due cards of a deck (null: every deck). False when there is nothing to study. */
  flashcardsStart: (deckId: string | null) => boolean;
  flashcardsReveal: () => void;
  flashcardsRate: (quality: ReviewQuality) => void;
  flashcardsSkip: () => void;
  flashcardsEnd: () => void;
  flashcardsReset: () => void;
}

declare module '../../store/featureState' {
  interface FeatureState extends FlashcardsSlice {}
}

/** Minutes between local time and UTC at `now`; the streak counts local calendar days. */
export function localOffsetMinutes(now: number): number {
  return new Date(now).getTimezoneOffset();
}

export const featureSlice: FeatureSliceDefinition = {
  id: 'flashcards',
  create: (set, get): FlashcardsSlice => {
    const loadedDeck = (): FlashcardsDeckData => {
      const state = get();
      if (state.flashcardsLoaded) return state.flashcardsDeck;
      const deck = loadDeck(state.runtime.storage);
      set({ flashcardsDeck: deck, flashcardsLoaded: true });
      return deck;
    };

    return {
      flashcardsDeck: emptyDeck(),
      flashcardsLoaded: false,
      flashcardsSession: null,
      flashcardsSaveError: null,

      flashcardsLoad: () => {
        loadedDeck();
      },

      flashcardsStart: (deckId) => {
        const cards = cardsOfDeck(deckId);
        if (cards === null) return false;
        const deck = loadedDeck();
        const queue = buildQueue(cards, deck.progress, get().runtime.clock());
        if (queue.length === 0) return false;
        set({ flashcardsSession: startSession(queue, deckId) });
        return true;
      },

      flashcardsReveal: () => {
        const session = get().flashcardsSession;
        if (session !== null) set({ flashcardsSession: reveal(session) });
      },

      flashcardsRate: (quality) => {
        const session = get().flashcardsSession;
        if (session === null || !session.revealed || !isReviewQuality(quality)) return;
        const cardId = currentCardId(session);
        if (cardId === null) return;

        const before = loadedDeck();
        const now = get().runtime.clock();
        const deck = applyReview(before, cardId, quality, now, localOffsetMinutes(now));
        const next = applyRating(session, quality);
        if (deck === before) {
          // The review could not be scheduled (for example an unusable clock): move on without saving.
          set({ flashcardsSession: next });
          return;
        }
        const saved = saveDeck(get().runtime.storage, deck);
        set({
          flashcardsDeck: deck,
          flashcardsSession: next,
          flashcardsSaveError: saved.ok ? null : saved.error,
        });
      },

      flashcardsSkip: () => {
        const session = get().flashcardsSession;
        if (session !== null) set({ flashcardsSession: skip(session) });
      },

      flashcardsEnd: () => set({ flashcardsSession: null }),

      flashcardsReset: () => {
        get().runtime.storage.remove(FLASHCARDS_DECK_SLOT);
        set({
          flashcardsDeck: emptyDeck(),
          flashcardsLoaded: true,
          flashcardsSession: null,
          flashcardsSaveError: null,
        });
      },
    };
  },
};
