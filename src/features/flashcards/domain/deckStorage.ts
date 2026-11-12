import { isRecord, parseJsonText, readArray, readNumber, readString, type Result } from '../../../utils/guards';
import type { KeyValueStorage, StorageWriteError } from '../../../utils/storage/keyValueStorage';
import { defineStorageSlot } from '../../../utils/storage/storageSlot';
import { EMPTY_STREAK, MAX_DAY_INDEX, MAX_PROGRESS_ENTRIES, MAX_STREAK_DAYS, emptyDeck } from './deck';
import { MAX_EASE, MAX_INTERVAL_DAYS, MAX_REVIEW_COUNT, MAX_TIMESTAMP, MIN_EASE } from './scheduler';
import type { CardProgress, FlashcardsDeckData, StudyStreak } from './types';

export const FLASHCARDS_DECK_SLOT = defineStorageSlot('netsim.flashcards.deck.v1', { maxBytes: 200000 });
export const DECK_FORMAT_VERSION = 1;
export const CARD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Rebuilds one stored entry field by field; anything out of range is rejected. */
export function parseCardProgress(value: unknown): CardProgress | null {
  if (!isRecord(value)) return null;
  const rec: Record<string, unknown> = value;
  const count = (field: string): number | undefined =>
    readNumber(rec, field, { min: 0, max: MAX_REVIEW_COUNT, integer: true });
  const time = (field: string): number | undefined => readNumber(rec, field, { min: 0, max: MAX_TIMESTAMP });

  const cardId = readString(rec, 'cardId', { maxLength: 64, pattern: CARD_ID_PATTERN });
  const easeFactor = readNumber(rec, 'easeFactor', { min: MIN_EASE, max: MAX_EASE });
  const intervalDays = readNumber(rec, 'intervalDays', { min: 0, max: MAX_INTERVAL_DAYS, integer: true });
  const repetitions = count('repetitions');
  const dueAt = time('dueAt');
  const lastReviewedAt = time('lastReviewedAt');
  const reviews = count('reviews');
  const lapses = count('lapses');

  if (
    cardId === undefined ||
    easeFactor === undefined ||
    intervalDays === undefined ||
    repetitions === undefined ||
    dueAt === undefined ||
    lastReviewedAt === undefined ||
    reviews === undefined ||
    lapses === undefined ||
    lapses > reviews
  ) {
    return null;
  }
  return { cardId, easeFactor, intervalDays, repetitions, dueAt, lastReviewedAt, reviews, lapses };
}

function parseStreak(value: unknown): StudyStreak {
  if (!isRecord(value)) return EMPTY_STREAK;
  const current = readNumber(value, 'current', { min: 1, max: MAX_STREAK_DAYS, integer: true });
  const best = readNumber(value, 'best', { min: 0, max: MAX_STREAK_DAYS, integer: true });
  const lastStudyDay = readNumber(value, 'lastStudyDay', { min: 0, max: MAX_DAY_INDEX, integer: true });
  if (current === undefined || best === undefined || lastStudyDay === undefined) return EMPTY_STREAK;
  return { current, best: Math.max(best, current), lastStudyDay };
}

/** Stored text is untrusted: size check, parse, then rebuild. Unreadable data yields an empty deck. */
export function parseStoredDeck(text: string | null): FlashcardsDeckData {
  if (text === null) return emptyDeck();
  const json = parseJsonText(text, { maxBytes: FLASHCARDS_DECK_SLOT.maxBytes });
  if (!json.ok || !isRecord(json.value) || json.value.version !== DECK_FORMAT_VERSION) return emptyDeck();
  const entries = readArray(json.value, 'cards', { maxItems: MAX_PROGRESS_ENTRIES });
  if (entries === undefined) return emptyDeck();

  const progress = new Map<string, CardProgress>();
  for (const entry of entries) {
    const parsed = parseCardProgress(entry);
    if (parsed !== null) progress.set(parsed.cardId, parsed);
  }
  return { progress, streak: parseStreak(json.value.streak) };
}

export function serializeDeck(deck: FlashcardsDeckData): string {
  const cards = Array.from(deck.progress.values()).slice(0, MAX_PROGRESS_ENTRIES);
  return JSON.stringify({ version: DECK_FORMAT_VERSION, cards, streak: deck.streak });
}

export function loadDeck(storage: KeyValueStorage): FlashcardsDeckData {
  return parseStoredDeck(storage.read(FLASHCARDS_DECK_SLOT));
}

export function saveDeck(storage: KeyValueStorage, deck: FlashcardsDeckData): Result<void, StorageWriteError> {
  return storage.write(FLASHCARDS_DECK_SLOT, serializeDeck(deck));
}
