import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => null,
  wasmPing: () => '',
}));

import { QUESTION_BANK } from '../../../features/practice-quiz/data/questionBank';
import { DEFAULT_QUIZ_CONFIG, summarize } from '../../../features/practice-quiz/domain/engine';
import type { QuizCategory } from '../../../features/practice-quiz/domain/types';
import { createNetworkStore } from '../../../store/useNetworkStore';
import { createMemoryStorage } from '../../../utils/storage/keyValueStorage';
import { createTestStore, TEST_EPOCH_MS } from '../../helpers/createTestStore';

const TIME_LIMIT = DEFAULT_QUIZ_CONFIG.timeLimitMs ?? 0;

describe('practice quiz slice', () => {
  it('starts a quiz with the injected clock and random source', () => {
    const store = createTestStore();
    expect(store.getState().quizSession).toBeNull();
    expect(store.getState().quizTick()).toBeNull();
    expect(store.getState().quizStart()).toBe(true);

    const session = store.getState().quizSession;
    expect(session).toMatchObject({ startedAt: TEST_EPOCH_MS, total: DEFAULT_QUIZ_CONFIG.length, finishedAt: null });
    expect(session?.current).not.toBeNull();
    expect(store.getState().quizTick()).toBe(TIME_LIMIT);

    const again = createTestStore();
    again.getState().quizStart();
    expect(again.getState().quizSession?.current?.id).toBe(session?.current?.id);
  });

  it('plays a full quiz to the result', () => {
    const store = createTestStore();
    store.getState().quizStart();
    for (let guard = 0; guard < 50; guard += 1) {
      const current = store.getState().quizSession?.current;
      if (!current) break;
      store.getState().quizAnswer(current.correctOptionIds);
    }
    const session = store.getState().quizSession;
    expect(session?.finishedAt).toBe(TEST_EPOCH_MS);
    expect(session?.answers).toHaveLength(DEFAULT_QUIZ_CONFIG.length);
    if (!session) throw new Error('expected a session');
    expect(summarize(session)).toMatchObject({ percent: 100, passed: true, timedOut: false });
    expect(store.getState().quizTick()).toBeNull();
  });

  it('ignores selections that cannot be an answer', () => {
    const store = createTestStore();
    store.getState().quizStart();
    const before = store.getState().quizSession;
    store.getState().quizAnswer([]);
    store.getState().quizAnswer(['not-an-option']);
    store.getState().quizAnswer(Array.from({ length: 50 }, (_, i) => `option-${i}`));
    expect(store.getState().quizSession).toBe(before);
  });

  it('limits a quiz to one category and rejects unknown categories', () => {
    const store = createTestStore();
    const expected = QUESTION_BANK.filter((q) => q.category === 'security').length;
    expect(store.getState().quizStart('security')).toBe(true);
    const session = store.getState().quizSession;
    expect(session?.total).toBe(Math.min(expected, DEFAULT_QUIZ_CONFIG.length));
    expect(session?.current?.category).toBe('security');

    store.getState().quizReset();
    expect(store.getState().quizSession).toBeNull();
    expect(store.getState().quizStart(String('cooking') as QuizCategory)).toBe(false);
    expect(store.getState().quizSession).toBeNull();
  });

  it('ends the quiz when the time is over and rejects late answers', () => {
    const time = { now: TEST_EPOCH_MS };
    const store = createNetworkStore({
      storage: createMemoryStorage(),
      clock: () => time.now,
      ids: () => 'id-fixed',
      random: () => 0.5,
    });
    store.getState().quizStart();
    time.now += 60000;
    expect(store.getState().quizTick()).toBe(TIME_LIMIT - 60000);
    expect(store.getState().quizSession?.finishedAt).toBeNull();

    time.now = TEST_EPOCH_MS + TIME_LIMIT + 5000;
    const current = store.getState().quizSession?.current;
    store.getState().quizAnswer(current ? current.correctOptionIds : []);
    const session = store.getState().quizSession;
    expect(session).toMatchObject({ timedOut: true, finishedAt: TEST_EPOCH_MS + TIME_LIMIT, current: null });
    expect(session?.answers).toHaveLength(0);
    expect(store.getState().quizTick()).toBeNull();
  });
});
