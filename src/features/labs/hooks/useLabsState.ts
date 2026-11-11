import { useCallback, useMemo } from 'react';
import { useNetworkStore } from '../../../store/useNetworkStore';
import { unlockedAchievementIds } from '../domain/achievements';
import { bestAttempt, isSuccessfulAttempt, summarizeHistory } from '../domain/labHistory';

/** Read model and actions for labs, derived from the store. */
export function useLabsState() {
  const availableLabs = useNetworkStore((state) => state.availableLabs);
  const currentLabSession = useNetworkStore((state) => state.currentLabSession);
  const labHistory = useNetworkStore((state) => state.labHistory);
  const showLabsPanel = useNetworkStore((state) => state.showLabsPanel);
  const setShowLabsPanel = useNetworkStore((state) => state.setShowLabsPanel);
  const loadLabs = useNetworkStore((state) => state.loadLabs);
  const startLab = useNetworkStore((state) => state.startLab);
  const resetLab = useNetworkStore((state) => state.resetLab);
  const submitCurrentStep = useNetworkStore((state) => state.submitCurrentStep);
  const getStarsForLab = useNetworkStore((state) => state.getStarsForLab);

  const catalogIds = useMemo(() => availableLabs.map((lab) => lab.id), [availableLabs]);
  const stats = useMemo(() => summarizeHistory(labHistory, catalogIds), [labHistory, catalogIds]);
  const unlockedAchievements = useMemo(
    () => unlockedAchievementIds(labHistory, catalogIds),
    [labHistory, catalogIds],
  );

  const getLabById = useCallback(
    (labId: string) => availableLabs.find((lab) => lab.id === labId),
    [availableLabs],
  );
  const getLabProgress = useCallback((labId: string) => bestAttempt(labHistory, labId), [labHistory]);
  const isLabCompleted = useCallback(
    (labId: string) => {
      const best = bestAttempt(labHistory, labId);
      return best !== undefined && isSuccessfulAttempt(best);
    },
    [labHistory],
  );
  const handleStartLab = useCallback(
    (labId: string, examMode = false) => {
      startLab(labId, examMode);
      setShowLabsPanel(false);
    },
    [startLab, setShowLabsPanel],
  );
  const handleCompleteStep = useCallback(() => {
    const result = submitCurrentStep();
    return result.status === 'advanced' || result.status === 'finished';
  }, [submitCurrentStep]);

  return {
    availableLabs,
    currentLabSession,
    labHistory,
    showLabsPanel,
    stats,
    unlockedAchievements,
    setShowLabsPanel,
    loadLabs,
    resetLab,
    getLabById,
    getLabProgress,
    isLabCompleted,
    getStarsForLab,
    handleStartLab,
    handleCompleteStep,
  };
}
