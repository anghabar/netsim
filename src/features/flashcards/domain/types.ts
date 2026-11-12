export type CardDifficulty = 'easy' | 'medium' | 'hard';

export interface Flashcard {
  readonly id: string;
  readonly front: string;
  readonly back: string;
  readonly hint?: string;
  readonly difficulty: CardDifficulty;
  readonly tags: readonly string[];
}

export interface FlashcardDeck {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly cards: readonly Flashcard[];
}

/** SM-2 recall quality: 0-2 means the answer was not recalled, 3-5 means it was. */
export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

export interface CardProgress {
  readonly cardId: string;
  readonly easeFactor: number;
  readonly intervalDays: number;
  readonly repetitions: number;
  /** Epoch milliseconds. */
  readonly dueAt: number;
  readonly lastReviewedAt: number;
  readonly reviews: number;
  readonly lapses: number;
}

export type ProgressMap = ReadonlyMap<string, CardProgress>;

/** Consecutive study days; `lastStudyDay` is a local day index (days since the epoch). */
export interface StudyStreak {
  readonly current: number;
  readonly best: number;
  readonly lastStudyDay: number | null;
}

/** Everything the feature persists: per-card scheduling data and the study streak. */
export interface FlashcardsDeckData {
  readonly progress: ProgressMap;
  readonly streak: StudyStreak;
}

export interface StudySession {
  readonly deckId: string | null;
  readonly queue: readonly string[];
  readonly index: number;
  readonly revealed: boolean;
  readonly studied: number;
  readonly recalled: number;
}
