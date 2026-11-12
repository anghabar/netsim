import { describe, expect, it } from 'vitest';
import {
  LAB_HISTORY_SLOT,
  MAX_HISTORY_ENTRIES,
  MAX_VALIDATION_IDS,
  bestAttempt,
  clearStoredLabHistory,
  compactProgress,
  loadLabHistory,
  parseLabHistory,
  previousAttemptCount,
  saveLabHistory,
  summarizeHistory,
  toLabProgress,
  upsertAttempt,
} from '../../../features/labs/domain/labHistory';
import { createMemoryStorage, createWebStorage } from '../../../utils/storage/keyValueStorage';
import { T0, makeProgress } from './fixtures';

const startedAt = (index: number): string => new Date(T0 + index * 1000).toISOString();

describe('toLabProgress', () => {
  it('accepts a well-formed entry', () => {
    expect(toLabProgress(makeProgress())).toEqual(makeProgress());
  });

  it.each([
    ['null', null],
    ['a string', 'progress'],
    ['an array', []],
    ['an empty lab id', { ...makeProgress(), labId: '' }],
    ['too many stars', { ...makeProgress(), stars: 7 }],
    ['fractional stars', { ...makeProgress(), stars: 1.5 }],
    ['a negative score', { ...makeProgress(), score: -1 }],
    ['a non-finite time', { ...makeProgress(), timeSpent: Number.POSITIVE_INFINITY }],
    ['an invalid start date', { ...makeProgress(), startedAt: 'not a date' }],
    ['an invalid completion date', { ...makeProgress(), completedAt: 42 }],
    ['non-string step ids', { ...makeProgress(), completedSteps: [1, 2] }],
    ['an oversized id list', { ...makeProgress(), validationsPassed: new Array(MAX_VALIDATION_IDS + 1).fill('v') }],
  ])('rejects %s', (_label, value) => {
    expect(toLabProgress(value)).toBeNull();
  });

  it('rebuilds the entry from known fields only', () => {
    const text = `{"__proto__":{"polluted":true},"extra":1,${JSON.stringify(makeProgress()).slice(1)}`;
    const parsed: unknown = JSON.parse(text);
    const result = toLabProgress(parsed);
    expect(result).toEqual(makeProgress());
    expect(Object.keys(result ?? {})).not.toContain('extra');
    expect(Object.keys(result ?? {})).not.toContain('__proto__');
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });

  it('clamps a score above the maximum and keeps open attempts', () => {
    const open = toLabProgress({ ...makeProgress({ score: 500 }), completedAt: undefined });
    expect(open?.score).toBe(100);
    expect(open?.completedAt).toBeUndefined();
  });
});

describe('history list', () => {
  it('identifies an attempt by lab id and start date', () => {
    const first = makeProgress({ stars: 1 });
    const sameAttempt = makeProgress({ stars: 3 });
    const laterAttempt = makeProgress({ startedAt: startedAt(5), attempts: 2 });
    const history = upsertAttempt(upsertAttempt(upsertAttempt([], first), sameAttempt), laterAttempt);
    expect(history).toEqual([sameAttempt, laterAttempt]);
    expect(parseLabHistory([first, sameAttempt, { labId: 5 }, null])).toEqual([sameAttempt]);
  });

  it('stays bounded and derives the attempt number from the records, not the list length', () => {
    let history = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, index) =>
      makeProgress({ startedAt: startedAt(index), attempts: index + 1 }),
    );
    history = upsertAttempt(history, makeProgress({ labId: 'newest' }));
    expect(history).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(history[history.length - 1].labId).toBe('newest');
    expect(previousAttemptCount(history, 'lab-a')).toBe(MAX_HISTORY_ENTRIES);
    expect(previousAttemptCount(history, 'unknown')).toBe(0);
  });

  it('trims the validation lists of a stored attempt', () => {
    const ids = Array.from({ length: MAX_VALIDATION_IDS + 10 }, (_, index) => `v-${index}`);
    const entry = compactProgress(makeProgress({ validationsPassed: ids }));
    expect(entry.validationsPassed).toHaveLength(MAX_VALIDATION_IDS);
    expect(toLabProgress(entry)).toEqual(entry);
  });
});

describe('storage', () => {
  it('round-trips the history and clears it', () => {
    const storage = createMemoryStorage();
    const history = [makeProgress(), makeProgress({ labId: 'lab-b', stars: 1 })];
    expect(saveLabHistory(storage, history)).toEqual({ ok: true, value: 2 });
    expect(loadLabHistory(storage)).toEqual(history);
    clearStoredLabHistory(storage);
    expect(loadLabHistory(storage)).toEqual([]);
  });

  it('ignores corrupt, unknown-version, wrong-shape and oversized payloads', () => {
    const storage = createMemoryStorage();
    const payloads = [
      '{not json',
      JSON.stringify({ version: 99, entries: [makeProgress()] }),
      JSON.stringify([makeProgress()]),
      JSON.stringify({ version: 1, entries: 'nope' }),
      JSON.stringify({ version: 1, entries: new Array(MAX_HISTORY_ENTRIES + 1).fill(makeProgress()) }),
    ];
    for (const payload of payloads) {
      expect(storage.write(LAB_HISTORY_SLOT, payload).ok).toBe(true);
      expect(loadLabHistory(storage)).toEqual([]);
    }
    const oversized = createWebStorage({
      getItem: () => 'x'.repeat(LAB_HISTORY_SLOT.maxBytes + 1),
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(loadLabHistory(oversized)).toEqual([]);
  });

  it('drops the oldest attempts when the quota is exceeded', () => {
    const history = Array.from({ length: 40 }, (_, index) => makeProgress({ startedAt: startedAt(index) }));
    const storage = createMemoryStorage({ quotaBytes: 3000 });
    const saved = saveLabHistory(storage, history);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value).toBeGreaterThan(0);
      expect(saved.value).toBeLessThan(history.length);
      expect(loadLabHistory(storage)).toEqual(history.slice(-saved.value));
    }
  });

  it('reports a failure instead of throwing when nothing fits', () => {
    const full = createMemoryStorage({ quotaBytes: 4 });
    expect(saveLabHistory(full, [makeProgress()])).toEqual({ ok: false, error: 'quota-exceeded' });
    const broken = createWebStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(saveLabHistory(broken, [makeProgress()])).toEqual({ ok: false, error: 'unavailable' });
    expect(loadLabHistory(broken)).toEqual([]);
    expect(() => clearStoredLabHistory(broken)).not.toThrow();
  });
});

describe('aggregation', () => {
  it('picks the best attempt, preferring the most recent on ties', () => {
    const first = makeProgress({ stars: 1, score: 40, attempts: 1 });
    const second = makeProgress({ stars: 3, attempts: 2 });
    const third = makeProgress({ stars: 3, attempts: 3 });
    expect(bestAttempt([first, second, third], 'lab-a')).toBe(third);
    expect(bestAttempt([first], 'other')).toBeUndefined();
  });

  it('does not inflate totals when a lab is repeated', () => {
    const history = [
      makeProgress(),
      makeProgress({ startedAt: startedAt(9) }),
      makeProgress({ labId: 'lab-b', stars: 2, timeSpent: 100 }),
      makeProgress({ labId: 'lab-c', stars: 0, maxScore: 0, score: 0 }),
    ];
    expect(summarizeHistory(history, ['lab-a', 'lab-b', 'lab-c'])).toEqual({
      completedLabs: 2,
      perfectLabs: 1,
      totalStars: 5,
      totalTime: 1900,
      totalLabs: 3,
      catalogPerfect: false,
    });
  });
});
