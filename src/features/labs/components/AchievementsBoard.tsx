import { Award, CheckCircle, Star, Target, Trophy, Zap, type LucideIcon } from 'lucide-react';
import { ACHIEVEMENTS, type AchievementId } from '../domain/achievements';

const ICONS: Record<AchievementId, LucideIcon> = {
  'first-lab': Star,
  'three-stars': Trophy,
  'fast-finish': Zap,
  'five-labs': Target,
  'all-perfect': Award,
};

interface AchievementsBoardProps {
  unlockedIds: readonly AchievementId[];
  totalStars: number;
}

export function AchievementsBoard({ unlockedIds, totalStars }: AchievementsBoardProps) {
  return (
    <section aria-label="Achievements" className="space-y-4">
      <p className="text-sm text-zinc-400">
        {unlockedIds.length} of {ACHIEVEMENTS.length} unlocked · {totalStars} stars earned
      </p>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {ACHIEVEMENTS.map((achievement) => {
          const unlocked = unlockedIds.includes(achievement.id);
          const Icon = ICONS[achievement.id];
          return (
            <li
              key={achievement.id}
              className={`flex items-center gap-3 rounded-2xl border p-4 ${
                unlocked ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-800/50 bg-zinc-900/20 opacity-50'
              }`}
            >
              <Icon size={20} aria-hidden="true" className={unlocked ? 'text-amber-300' : 'text-zinc-500'} />
              <div className="min-w-0">
                <h3 className={`text-sm font-bold ${unlocked ? 'text-white' : 'text-zinc-500'}`}>
                  {achievement.title}
                </h3>
                <p className="text-xs text-zinc-500">{achievement.description}</p>
              </div>
              {unlocked && (
                <CheckCircle size={16} aria-label="Unlocked" className="ml-auto shrink-0 text-emerald-500" />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
