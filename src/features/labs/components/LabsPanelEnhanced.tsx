import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Trophy, X } from 'lucide-react';
import { useNetworkStore } from '../../../store/useNetworkStore';
import { unlockedAchievementIds } from '../domain/achievements';
import { bestAttempt, summarizeHistory } from '../domain/labHistory';
import { AchievementsBoard } from './AchievementsBoard';
import { ActiveLabHud } from './ActiveLabHud';
import { ExamResultModal } from './ExamResultModal';
import { LabCard } from './LabCard';

interface LabsPanelEnhancedProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Lab catalog dialog plus the floating panel of the active attempt. */
export function LabsPanelEnhanced({ isOpen, onClose }: LabsPanelEnhancedProps) {
  const availableLabs = useNetworkStore((state) => state.availableLabs);
  const session = useNetworkStore((state) => state.currentLabSession);
  const labHistory = useNetworkStore((state) => state.labHistory);
  const deviceCount = useNetworkStore((state) => state.devices.length);
  const loadLabs = useNetworkStore((state) => state.loadLabs);
  const startLab = useNetworkStore((state) => state.startLab);
  const resetLab = useNetworkStore((state) => state.resetLab);
  const [showAchievements, setShowAchievements] = useState(false);

  useEffect(() => {
    if (isOpen && availableLabs.length === 0) loadLabs();
  }, [isOpen, availableLabs.length, loadLabs]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const catalogIds = useMemo(() => availableLabs.map((lab) => lab.id), [availableLabs]);
  const activeLab = useMemo(
    () => (session ? availableLabs.find((lab) => lab.id === session.labId) : undefined),
    [availableLabs, session],
  );
  const summary = useMemo(() => summarizeHistory(labHistory, catalogIds), [labHistory, catalogIds]);
  const unlockedIds = useMemo(() => unlockedAchievementIds(labHistory, catalogIds), [labHistory, catalogIds]);

  const examFinished =
    session !== null && session.isExamMode === true && session.progress.completedAt !== undefined;

  const handleStart = (labId: string, examMode: boolean) => {
    startLab(labId, examMode);
    onClose();
  };

  return (
    <>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="labs-panel-title"
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-zinc-800 p-6">
              <div>
                <h1 id="labs-panel-title" className="flex items-center gap-2 text-2xl font-bold text-white">
                  <GraduationCap size={24} aria-hidden="true" />
                  Labs
                </h1>
                <p className="mt-1 text-sm text-zinc-400">
                  {availableLabs.length} labs · {summary.completedLabs} completed · {summary.totalStars} stars
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAchievements((value) => !value)}
                  aria-pressed={showAchievements}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                    showAchievements
                      ? 'border-amber-400/30 bg-amber-500/10 text-amber-200'
                      : 'border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Trophy size={16} aria-hidden="true" />
                  Achievements ({unlockedIds.length})
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close labs"
                  className="rounded-full p-2 text-zinc-500 hover:bg-white/10 hover:text-white"
                >
                  <X size={22} />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6">
              {showAchievements ? (
                <AchievementsBoard unlockedIds={unlockedIds} totalStars={summary.totalStars} />
              ) : availableLabs.length === 0 ? (
                <p className="py-20 text-center text-zinc-500">No labs available.</p>
              ) : (
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {availableLabs.map((lab) => (
                    <LabCard
                      key={lab.id}
                      lab={lab}
                      best={bestAttempt(labHistory, lab.id)}
                      replacesCanvas={deviceCount > 0}
                      onStart={handleStart}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {session && activeLab && !examFinished && (
        <ActiveLabHud key={`${session.labId}:${session.progress.startedAt}`} session={session} lab={activeLab} />
      )}

      {session && examFinished && (
        <ExamResultModal session={session} onClose={resetLab} onRetry={() => startLab(session.labId, true)} />
      )}
    </>
  );
}
