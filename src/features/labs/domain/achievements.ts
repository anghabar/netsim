import type { LabProgress } from '../../../types/NetworkTypes';
import { isSuccessfulAttempt, summarizeHistory, type HistorySummary } from './labHistory';

/** Achievements are derived from the attempt history; nothing else stores them. */
export type AchievementId = 'first-lab' | 'three-stars' | 'fast-finish' | 'five-labs' | 'all-perfect';

export interface AchievementDefinition {
  id: AchievementId;
  title: string;
  description: string;
  isUnlocked: (history: readonly LabProgress[], summary: HistorySummary) => boolean;
}

export const FAST_FINISH_SECONDS = 300;

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    id: 'first-lab',
    title: 'First lab',
    description: 'Finish any lab successfully.',
    isUnlocked: (_history, summary) => summary.completedLabs >= 1,
  },
  {
    id: 'three-stars',
    title: 'Flawless run',
    description: 'Earn three stars in a lab.',
    isUnlocked: (_history, summary) => summary.perfectLabs >= 1,
  },
  {
    id: 'fast-finish',
    title: 'Quick hands',
    description: 'Finish a lab in under five minutes.',
    isUnlocked: (history) =>
      history.some(
        (entry) => isSuccessfulAttempt(entry) && entry.timeSpent > 0 && entry.timeSpent < FAST_FINISH_SECONDS,
      ),
  },
  {
    id: 'five-labs',
    title: 'Regular',
    description: 'Finish five different labs.',
    isUnlocked: (_history, summary) => summary.completedLabs >= 5,
  },
  {
    id: 'all-perfect',
    title: 'Full sweep',
    description: 'Earn three stars in every lab of the catalog.',
    isUnlocked: (_history, summary) => summary.catalogPerfect,
  },
];

export function unlockedAchievementIds(
  history: readonly LabProgress[],
  catalogLabIds: readonly string[],
): AchievementId[] {
  const summary = summarizeHistory(history, catalogLabIds);
  return ACHIEVEMENTS.filter((achievement) => achievement.isUnlocked(history, summary)).map(
    (achievement) => achievement.id,
  );
}
