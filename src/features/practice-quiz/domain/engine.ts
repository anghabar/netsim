import type { RandomSource } from '../../../utils/runtime';
import type {
  DifficultyLevel,
  QuizAnswer,
  QuizCategory,
  QuizConfig,
  QuizQuestion,
  QuizResult,
  QuizSession,
} from './types';

export const MAX_QUIZ_LENGTH = 50;
export const DEFAULT_QUIZ_CONFIG: QuizConfig = Object.freeze({
  length: 10,
  timeLimitMs: 15 * 60000,
  passPercent: 70,
  category: null,
});

const ABILITY_LIMIT = 3;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Fisher-Yates shuffle driven by the injected random source; out-of-range values are clamped. */
export function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const roll = random();
    const unit = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.999999) : 0;
    const j = Math.floor(unit * (i + 1));
    const held = result[i];
    result[i] = result[j];
    result[j] = held;
  }
  return result;
}

export function levelToLogit(level: DifficultyLevel): number {
  return level - 3;
}

/**
 * Logistic running estimate with a shrinking step. It only decides which
 * question comes next; it is not a calibrated measurement.
 */
export function updateAbility(
  ability: number,
  level: DifficultyLevel,
  correct: boolean,
  answeredBefore: number,
): number {
  const expected = 1 / (1 + Math.exp(levelToLogit(level) - ability));
  const step = Math.max(0.4, 1.2 / (1 + Math.max(0, answeredBefore)));
  const next = ability + step * ((correct ? 1 : 0) - expected);
  return Math.min(ABILITY_LIMIT, Math.max(-ABILITY_LIMIT, next));
}

function drawNext(session: QuizSession): QuizSession {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  session.remaining.forEach((question, index) => {
    const distance = Math.abs(levelToLogit(question.level) - session.ability);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  const next = bestIndex >= 0 ? session.remaining[bestIndex] : undefined;
  if (next === undefined) return { ...session, current: null };
  return {
    ...session,
    current: next,
    asked: [...session.asked, next],
    remaining: session.remaining.filter((_, index) => index !== bestIndex),
  };
}

function isValidConfig(config: QuizConfig): boolean {
  const limit = config.timeLimitMs;
  return (
    Number.isFinite(config.length) &&
    Number.isFinite(config.passPercent) &&
    config.passPercent >= 0 &&
    config.passPercent <= 100 &&
    (limit === null || (Number.isFinite(limit) && limit > 0))
  );
}

/** Returns null when the configuration or the time is unusable, or when no question matches. */
export function startQuiz(
  bank: readonly QuizQuestion[],
  config: QuizConfig,
  random: RandomSource,
  now: number,
): QuizSession | null {
  if (!isValidConfig(config) || !Number.isFinite(now)) return null;
  const eligible = config.category === null ? bank : bank.filter((q) => q.category === config.category);
  const pool = shuffle(eligible, random);
  const total = Math.min(pool.length, Math.max(0, Math.min(MAX_QUIZ_LENGTH, Math.floor(config.length))));
  if (total === 0) return null;

  return drawNext({
    config: {
      length: config.length,
      timeLimitMs: config.timeLimitMs,
      passPercent: config.passPercent,
      category: config.category,
    },
    startedAt: now,
    total,
    remaining: pool,
    asked: [],
    current: null,
    answers: [],
    ability: 0,
    finishedAt: null,
    timedOut: false,
  });
}

/** Exact set match: every correct option and nothing else. */
export function gradeAnswer(question: QuizQuestion, selectedOptionIds: readonly string[]): boolean {
  const chosen = new Set(selectedOptionIds);
  if (chosen.size !== question.correctOptionIds.length) return false;
  return question.correctOptionIds.every((id) => chosen.has(id));
}

export function deadlineOf(session: QuizSession): number | null {
  return session.config.timeLimitMs === null ? null : session.startedAt + session.config.timeLimitMs;
}

/** Time left, clamped to the configured limit so a clock that moves backwards cannot extend it. */
export function remainingMs(session: QuizSession, now: number): number | null {
  const limit = session.config.timeLimitMs;
  const deadline = deadlineOf(session);
  if (limit === null || deadline === null) return null;
  if (!Number.isFinite(now)) return limit;
  return Math.min(limit, Math.max(0, deadline - now));
}

export function expireIfNeeded(session: QuizSession, now: number): QuizSession {
  const deadline = deadlineOf(session);
  if (session.finishedAt !== null || deadline === null || !(now >= deadline)) return session;
  return { ...session, current: null, finishedAt: deadline, timedOut: true };
}

/**
 * Records an answer to the current question. An empty selection, or one that
 * names something that is not an option of the question, is ignored.
 */
export function answerCurrent(
  session: QuizSession,
  selectedOptionIds: readonly string[],
  now: number,
): QuizSession {
  const live = expireIfNeeded(session, now);
  const question = live.current;
  if (live.finishedAt !== null || question === null) return live;

  const chosen = [...new Set(selectedOptionIds)];
  const known = chosen.every((id) => question.options.some((option) => option.id === id));
  if (chosen.length === 0 || chosen.length > question.options.length || !known) return live;

  const at = Number.isFinite(now) ? Math.max(now, live.startedAt) : live.startedAt;
  const correct = gradeAnswer(question, chosen);
  const answer: QuizAnswer = { questionId: question.id, selectedOptionIds: chosen, correct, answeredAt: at };
  const answers = [...live.answers, answer];
  const ability = updateAbility(live.ability, question.level, correct, live.answers.length);
  const progressed: QuizSession = { ...live, answers, ability, current: null };

  if (answers.length >= live.total) return { ...progressed, finishedAt: at };
  const next = drawNext(progressed);
  return next.current === null ? { ...next, finishedAt: at } : next;
}

/** Plain percentage over the planned length; unanswered questions count as wrong. */
export function summarize(session: QuizSession): QuizResult {
  const questions = new Map(session.asked.map((q): [string, QuizQuestion] => [q.id, q]));
  const categories = new Map<QuizCategory, { correct: number; total: number }>();
  const tagMisses = new Map<string, number>();
  const missed: QuizQuestion[] = [];
  let correct = 0;

  for (const answer of session.answers) {
    const question = questions.get(answer.questionId);
    if (question === undefined) continue;
    const bucket = categories.get(question.category) ?? { correct: 0, total: 0 };
    categories.set(question.category, {
      correct: bucket.correct + (answer.correct ? 1 : 0),
      total: bucket.total + 1,
    });
    if (answer.correct) {
      correct += 1;
      continue;
    }
    missed.push(question);
    for (const tag of question.tags) tagMisses.set(tag, (tagMisses.get(tag) ?? 0) + 1);
  }

  const percent = session.total === 0 ? 0 : Math.round((correct / session.total) * 100);
  const weakTags = Array.from(tagMisses.entries())
    .sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))
    .slice(0, 3)
    .map(([tag]) => tag);
  const byCategory = Array.from(categories.entries())
    .map(([category, score]) => ({ category, correct: score.correct, total: score.total }))
    .sort((a, b) => byText(a.category, b.category));

  return {
    total: session.total,
    answered: session.answers.length,
    correct,
    percent,
    passed: percent >= session.config.passPercent,
    timedOut: session.timedOut,
    byCategory,
    weakTags,
    missed,
  };
}
