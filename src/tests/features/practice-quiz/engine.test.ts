import { describe, expect, it } from 'vitest';
import {
  answerCurrent,
  expireIfNeeded,
  gradeAnswer,
  remainingMs,
  shuffle,
  startQuiz,
  summarize,
  updateAbility,
} from '../../../features/practice-quiz/domain/engine';
import type {
  DifficultyLevel,
  QuizCategory,
  QuizConfig,
  QuizQuestion,
  QuizSession,
} from '../../../features/practice-quiz/domain/types';
import type { RandomSource } from '../../../utils/runtime';

const question = (
  id: string,
  level: DifficultyLevel,
  category: QuizCategory = 'routing',
  tags: string[] = [],
): QuizQuestion => ({
  id,
  prompt: `Prompt ${id}`,
  category,
  level,
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
  ],
  correctOptionIds: ['a'],
  explanation: 'Because.',
  tags,
});

const seeded = (seed: number): RandomSource => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const config: QuizConfig = { length: 10, timeLimitMs: null, passPercent: 70, category: null };
const ladder = [question('l1', 1), question('l2', 2), question('l3', 3), question('l4', 4), question('l5', 5)];

function begin(bank: readonly QuizQuestion[], cfg: QuizConfig = config, random: RandomSource = () => 0): QuizSession {
  const session = startQuiz(bank, cfg, random, 0);
  if (!session) throw new Error('expected a session');
  return session;
}

function play(session: QuizSession, pick: (q: QuizQuestion) => string[]): QuizSession {
  let state = session;
  for (let guard = 0; guard < 200 && state.current !== null; guard += 1) {
    state = answerCurrent(state, pick(state.current), 1);
  }
  return state;
}

describe('practice quiz engine', () => {
  it('is deterministic for a given random seed', () => {
    const bank = Array.from({ length: 8 }, (_, i) => question(`q${i}`, 3));
    const first = play(begin(bank, config, seeded(7)), () => ['a']);
    const second = play(begin(bank, config, seeded(7)), () => ['a']);
    expect(first.asked.map((q) => q.id)).toEqual(second.asked.map((q) => q.id));
    expect(new Set(first.asked.map((q) => q.id)).size).toBe(8);
  });

  it('finishes when the bank is smaller than the requested length', () => {
    const session = begin(ladder.slice(0, 3));
    expect(session.total).toBe(3);
    const done = play(session, () => ['a']);
    expect(done.finishedAt).not.toBeNull();
    expect(done.current).toBeNull();
    expect(done.answers).toHaveLength(3);
    expect(summarize(done).percent).toBe(100);
  });

  it('returns null when no quiz can be built', () => {
    expect(startQuiz([], config, () => 0, 0)).toBeNull();
    expect(startQuiz(ladder, { ...config, category: 'security' }, () => 0, 0)).toBeNull();
    expect(startQuiz(ladder, { ...config, length: Number.NaN }, () => 0, 0)).toBeNull();
    expect(startQuiz(ladder, { ...config, timeLimitMs: -5 }, () => 0, 0)).toBeNull();
    expect(startQuiz(ladder, { ...config, passPercent: 500 }, () => 0, 0)).toBeNull();
    expect(startQuiz(ladder, config, () => 0, Number.NaN)).toBeNull();
  });

  it('moves to harder questions after a correct answer and easier ones after a miss', () => {
    const start = begin(ladder);
    expect(start.current?.level).toBe(3);
    expect(answerCurrent(start, ['a'], 1).current?.level).toBe(4);
    expect(answerCurrent(start, ['b'], 1).current?.level).toBe(2);
  });

  it('keeps the ability estimate bounded', () => {
    let ability = 0;
    for (let i = 0; i < 50; i += 1) ability = updateAbility(ability, 5, true, i);
    expect(ability).toBeLessThanOrEqual(3);
    for (let i = 0; i < 100; i += 1) ability = updateAbility(ability, 1, false, i);
    expect(ability).toBeGreaterThanOrEqual(-3);
  });

  it('grades by exact set match, including multi-select', () => {
    const multi: QuizQuestion = { ...question('m', 2), correctOptionIds: ['a', 'b'] };
    expect(gradeAnswer(multi, ['b', 'a'])).toBe(true);
    expect(gradeAnswer(multi, ['a'])).toBe(false);
    expect(gradeAnswer(multi, ['a', 'b', 'c'])).toBe(false);
    expect(gradeAnswer(multi, ['a', 'a', 'b'])).toBe(true);
    expect(gradeAnswer(multi, ['a', 'zzz'])).toBe(false);
  });

  it('ignores empty selections and selections that are not options of the question', () => {
    const start = begin(ladder);
    expect(answerCurrent(start, [], 1)).toBe(start);
    expect(answerCurrent(start, ['zzz'], 1)).toBe(start);
    expect(answerCurrent(start, ['a', 'zzz'], 1)).toBe(start);
  });

  it('expires at the deadline and rejects late answers', () => {
    const timed = begin(ladder, { ...config, timeLimitMs: 1000 });
    expect(remainingMs(timed, 400)).toBe(600);
    expect(expireIfNeeded(timed, 999)).toBe(timed);
    expect(expireIfNeeded(timed, Number.NaN)).toBe(timed);

    const late = answerCurrent(timed, ['a'], 5000);
    expect(late.finishedAt).toBe(1000);
    expect(late.timedOut).toBe(true);
    expect(late.answers).toHaveLength(0);
    expect(summarize(late)).toMatchObject({ percent: 0, passed: false, timedOut: true, answered: 0, total: 5 });
  });

  it('tolerates a clock that moves backwards', () => {
    const timed = begin(ladder, { ...config, timeLimitMs: 1000 });
    expect(remainingMs(timed, -500)).toBe(1000);
    expect(remainingMs(timed, Number.NaN)).toBe(1000);
    expect(remainingMs(begin(ladder), 10)).toBeNull();
    expect(answerCurrent(timed, ['a'], -50).answers[0].answeredAt).toBe(0);
  });

  it('summarizes score, categories, weak tags and missed questions', () => {
    const bank = [
      question('q1', 3, 'routing', ['ospf']),
      question('q2', 3, 'switching', ['vlan', 'stp']),
      question('q3', 3, 'switching', ['stp']),
    ];
    const result = summarize(play(begin(bank), (q) => (q.id === 'q1' ? ['a'] : ['b'])));

    expect(result).toMatchObject({ total: 3, answered: 3, correct: 1, percent: 33, passed: false });
    expect(result.byCategory).toEqual([
      { category: 'routing', correct: 1, total: 1 },
      { category: 'switching', correct: 0, total: 2 },
    ]);
    expect(result.weakTags).toEqual(['stp', 'vlan']);
    expect(result.missed.map((q) => q.id).sort()).toEqual(['q2', 'q3']);
  });

  it('shuffles safely with a misbehaving random source', () => {
    const items = [1, 2, 3, 4, 5];
    for (const random of [() => 5, () => -1, () => Number.NaN]) {
      expect([...shuffle(items, random)].sort()).toEqual(items);
    }
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});
