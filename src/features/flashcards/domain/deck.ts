import { DAY_MS, isDue, isMastered, newProgress, review } from './scheduler';
import type {
  CardProgress,
  Flashcard,
  FlashcardsDeckData,
  ProgressMap,
  ReviewQuality,
  StudyStreak,
} from './types';

export const DEFAULT_SESSION_LIMIT = 20;
export const MAX_SESSION_LIMIT = 100;
export const MAX_PROGRESS_ENTRIES = 500;
export const MAX_STREAK_DAYS = 100000;
export const MAX_DAY_INDEX = 100000000;
const MAX_OFFSET_MINUTES = 24 * 60;

export const EMPTY_STREAK: StudyStreak = Object.freeze({ current: 0, best: 0, lastStudyDay: null });

export function emptyDeck(): FlashcardsDeckData {
  return { progress: new Map<string, CardProgress>(), streak: EMPTY_STREAK };
}

/**
 * Cards to study now: overdue reviews first (most overdue first), then cards
 * never seen, in deck order. Cards that are not due are never included.
 */
export function buildQueue(
  cards: readonly Flashcard[],
  progress: ProgressMap,
  now: number,
  limit: number = DEFAULT_SESSION_LIMIT,
): string[] {
  const wanted = Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_SESSION_LIMIT;
  const size = Math.min(MAX_SESSION_LIMIT, Math.max(1, wanted));
  const due: { id: string; dueAt: number }[] = [];
  const fresh: string[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    const entry = progress.get(card.id);
    if (entry === undefined) fresh.push(card.id);
    else if (isDue(entry, now)) due.push({ id: card.id, dueAt: entry.dueAt });
  }

  due.sort((a, b) => a.dueAt - b.dueAt);
  return [...due.map((item) => item.id), ...fresh].slice(0, size);
}

export interface ProgressSummary {
  readonly total: number;
  readonly fresh: number;
  readonly learning: number;
  readonly mastered: number;
  readonly due: number;
  readonly masteryPercent: number;
}

export function summarizeProgress(
  cards: readonly Flashcard[],
  progress: ProgressMap,
  now: number,
): ProgressSummary {
  let fresh = 0;
  let learning = 0;
  let mastered = 0;
  let due = 0;

  for (const card of cards) {
    const entry = progress.get(card.id);
    if (entry === undefined) {
      fresh += 1;
      due += 1;
      continue;
    }
    if (isMastered(entry)) mastered += 1;
    else learning += 1;
    if (isDue(entry, now)) due += 1;
  }

  const total = cards.length;
  const masteryPercent = total === 0 ? 0 : Math.round((mastered / total) * 100);
  return { total, fresh, learning, mastered, due, masteryPercent };
}

/**
 * Local day number of a timestamp. The offset follows the convention of
 * Date#getTimezoneOffset (minutes to add to local time to get UTC).
 * Returns null for values that cannot be mapped to a day.
 */
export function dayIndex(timestamp: number, timezoneOffsetMinutes: number): number | null {
  if (!Number.isFinite(timestamp) || !Number.isFinite(timezoneOffsetMinutes)) return null;
  if (Math.abs(timezoneOffsetMinutes) > MAX_OFFSET_MINUTES) return null;
  const day = Math.floor((timestamp - timezoneOffsetMinutes * 60000) / DAY_MS);
  return day >= 0 && day <= MAX_DAY_INDEX ? day : null;
}

/** Records a study day. A day that is not later than the last one changes nothing. */
export function advanceStreak(streak: StudyStreak, day: number | null): StudyStreak {
  if (day === null) return streak;
  const last = streak.lastStudyDay;
  if (last !== null && day <= last) return streak;
  const current = last !== null && day === last + 1 ? Math.min(MAX_STREAK_DAYS, streak.current + 1) : 1;
  return { current, best: Math.max(streak.best, current), lastStudyDay: day };
}

/** The streak still counts when the last study day is today or yesterday. */
export function activeStreak(streak: StudyStreak, today: number | null): number {
  if (today === null || streak.lastStudyDay === null) return 0;
  return today - streak.lastStudyDay <= 1 ? streak.current : 0;
}

/** Applies one review to the deck data. Returns the same object when nothing can be recorded. */
export function applyReview(
  deck: FlashcardsDeckData,
  cardId: string,
  quality: ReviewQuality,
  now: number,
  timezoneOffsetMinutes: number,
): FlashcardsDeckData {
  const existing = deck.progress.get(cardId);
  if (existing === undefined && deck.progress.size >= MAX_PROGRESS_ENTRIES) return deck;
  const before = existing ?? newProgress(cardId);
  const after = review(before, quality, now);
  if (after === before) return deck;
  const progress = new Map<string, CardProgress>(deck.progress);
  progress.set(cardId, after);
  return { progress, streak: advanceStreak(deck.streak, dayIndex(now, timezoneOffsetMinutes)) };
}
