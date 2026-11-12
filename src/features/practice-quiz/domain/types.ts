export const QUIZ_CATEGORIES = ['addressing', 'switching', 'routing', 'services', 'security'] as const;
export type QuizCategory = (typeof QUIZ_CATEGORIES)[number];

/** 1 = introductory, 5 = expert. */
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export interface QuizOption {
  readonly id: string;
  readonly text: string;
}

export interface QuizQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly category: QuizCategory;
  readonly level: DifficultyLevel;
  readonly options: readonly QuizOption[];
  readonly correctOptionIds: readonly string[];
  readonly explanation: string;
  readonly tags: readonly string[];
}

export interface QuizConfig {
  readonly length: number;
  readonly timeLimitMs: number | null;
  readonly passPercent: number;
  readonly category: QuizCategory | null;
}

export interface QuizAnswer {
  readonly questionId: string;
  readonly selectedOptionIds: readonly string[];
  readonly correct: boolean;
  readonly answeredAt: number;
}

export interface QuizSession {
  readonly config: QuizConfig;
  readonly startedAt: number;
  readonly total: number;
  readonly remaining: readonly QuizQuestion[];
  readonly asked: readonly QuizQuestion[];
  readonly current: QuizQuestion | null;
  readonly answers: readonly QuizAnswer[];
  /** Running estimate used only to order questions; never shown as a score. */
  readonly ability: number;
  readonly finishedAt: number | null;
  readonly timedOut: boolean;
}

export interface CategoryScore {
  readonly category: QuizCategory;
  readonly correct: number;
  readonly total: number;
}

export interface QuizResult {
  readonly total: number;
  readonly answered: number;
  readonly correct: number;
  readonly percent: number;
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly byCategory: readonly CategoryScore[];
  readonly weakTags: readonly string[];
  readonly missed: readonly QuizQuestion[];
}
