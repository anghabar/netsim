import type { FeatureSliceDefinition } from '../../store/featureState';
import { QUESTION_BANK } from './data/questionBank';
import { DEFAULT_QUIZ_CONFIG, answerCurrent, expireIfNeeded, remainingMs, startQuiz } from './domain/engine';
import { MAX_OPTIONS } from './domain/questionGuards';
import { QUIZ_CATEGORIES, type QuizCategory, type QuizSession } from './domain/types';

export interface PracticeQuizSlice {
  /** The running or finished practice quiz; never persisted. */
  quizSession: QuizSession | null;

  /** Starts a quiz, optionally limited to one category. False when no quiz can be built. */
  quizStart: (category?: QuizCategory | null) => boolean;
  quizAnswer: (selectedOptionIds: readonly string[]) => void;
  /** Ends the quiz when its time is over; returns the time left in milliseconds, or null. */
  quizTick: () => number | null;
  quizReset: () => void;
}

declare module '../../store/featureState' {
  interface FeatureState extends PracticeQuizSlice {}
}

export const featureSlice: FeatureSliceDefinition = {
  id: 'practice-quiz',
  create: (set, get): PracticeQuizSlice => ({
    quizSession: null,

    quizStart: (category) => {
      const wanted = category ?? null;
      if (wanted !== null && !QUIZ_CATEGORIES.includes(wanted)) return false;
      const { clock, random } = get().runtime;
      const session = startQuiz(
        QUESTION_BANK,
        {
          length: DEFAULT_QUIZ_CONFIG.length,
          timeLimitMs: DEFAULT_QUIZ_CONFIG.timeLimitMs,
          passPercent: DEFAULT_QUIZ_CONFIG.passPercent,
          category: wanted,
        },
        random,
        clock(),
      );
      if (session === null) return false;
      set({ quizSession: session });
      return true;
    },

    quizAnswer: (selectedOptionIds) => {
      const session = get().quizSession;
      if (session === null || selectedOptionIds.length > MAX_OPTIONS) return;
      const next = answerCurrent(session, selectedOptionIds, get().runtime.clock());
      if (next !== session) set({ quizSession: next });
    },

    quizTick: () => {
      const session = get().quizSession;
      if (session === null || session.finishedAt !== null) return null;
      const now = get().runtime.clock();
      const next = expireIfNeeded(session, now);
      if (next !== session) set({ quizSession: next });
      return remainingMs(next, now);
    },

    quizReset: () => set({ quizSession: null }),
  }),
};
