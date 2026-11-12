import { PASS_QUALITY } from './scheduler';
import type { ReviewQuality, StudySession } from './types';

export interface RatingChoice {
  readonly quality: ReviewQuality;
  readonly label: string;
  readonly hint: string;
}

export const RATING_CHOICES: readonly RatingChoice[] = [
  { quality: 1, label: 'Again', hint: 'Could not recall the answer' },
  { quality: 3, label: 'Hard', hint: 'Recalled with real effort' },
  { quality: 4, label: 'Good', hint: 'Recalled after a short pause' },
  { quality: 5, label: 'Easy', hint: 'Recalled instantly' },
];

export function startSession(queue: readonly string[], deckId: string | null): StudySession {
  return { deckId, queue: [...queue], index: 0, revealed: false, studied: 0, recalled: 0 };
}

export function isFinished(session: StudySession): boolean {
  return session.index >= session.queue.length;
}

export function currentCardId(session: StudySession): string | null {
  return isFinished(session) ? null : session.queue[session.index] ?? null;
}

export function reveal(session: StudySession): StudySession {
  return isFinished(session) || session.revealed ? session : { ...session, revealed: true };
}

/** A card can only be rated after its answer has been shown. */
export function applyRating(session: StudySession, quality: ReviewQuality): StudySession {
  if (isFinished(session) || !session.revealed) return session;
  return {
    ...session,
    index: session.index + 1,
    revealed: false,
    studied: session.studied + 1,
    recalled: session.recalled + (quality >= PASS_QUALITY ? 1 : 0),
  };
}

/** Skipping the last card finishes the session. */
export function skip(session: StudySession): StudySession {
  return isFinished(session) ? session : { ...session, index: session.index + 1, revealed: false };
}
