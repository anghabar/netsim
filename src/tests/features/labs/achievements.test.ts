import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, unlockedAchievementIds } from '../../../features/labs/domain/achievements';
import { makeProgress } from './fixtures';

const CATALOG = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('achievements', () => {
  it('has unique ids', () => {
    const ids = ACHIEVEMENTS.map((achievement) => achievement.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('unlocks nothing for an empty or failed history', () => {
    expect(unlockedAchievementIds([], CATALOG)).toEqual([]);
    expect(unlockedAchievementIds([makeProgress({ stars: 0, timeSpent: 30 })], CATALOG)).toEqual([]);
  });

  it('needs a measured time under five minutes, in seconds, for the fast finish', () => {
    expect(unlockedAchievementIds([makeProgress({ timeSpent: 0 })], CATALOG)).not.toContain('fast-finish');
    expect(unlockedAchievementIds([makeProgress({ timeSpent: 600 })], CATALOG)).not.toContain('fast-finish');
    expect(unlockedAchievementIds([makeProgress({ timeSpent: 120 })], CATALOG)).toContain('fast-finish');
  });

  it('counts different labs, not repeated attempts', () => {
    const repeated = Array.from({ length: 6 }, () => makeProgress());
    expect(unlockedAchievementIds(repeated, CATALOG)).toEqual(['first-lab', 'three-stars']);

    const distinct = ['a', 'b', 'c', 'd', 'e'].map((labId) => makeProgress({ labId, stars: 2 }));
    expect(unlockedAchievementIds(distinct, CATALOG)).toContain('five-labs');
  });

  it('requires three stars in every lab of the catalog for the full sweep', () => {
    const history = [makeProgress({ labId: 'a' }), makeProgress({ labId: 'b' })];
    expect(unlockedAchievementIds(history, ['a', 'b', 'c'])).not.toContain('all-perfect');
    expect(unlockedAchievementIds(history, ['a', 'b'])).toContain('all-perfect');
    expect(unlockedAchievementIds(history, [])).not.toContain('all-perfect');
  });
});
