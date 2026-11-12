/**
 * Labs slice: catalog, active attempt and bounded attempt history.
 * The rules live in src/features/labs/domain (pure, clock injected).
 */

import type { StateCreator } from 'zustand';
import { loadTopology, saveTopology } from '../topologyAutosave';
import type { Lab, LabProgress, LabSession, LabValidationContext } from '../../types/NetworkTypes';
import { ALL_LABS } from '../../data/labs/index';
import { isLabDefinition, sanitizeCatalog } from '../../features/labs/domain/labCatalog';
import {
  bestAttempt,
  clearStoredLabHistory,
  compactProgress,
  loadLabHistory,
  previousAttemptCount,
  saveLabHistory,
  upsertAttempt,
} from '../../features/labs/domain/labHistory';
import {
  addStrike,
  applyValidationResults,
  completeStepInSession,
  createLabSession,
  finalizeProgress,
  goToStep,
  hasTooManyStrikes,
  isSessionClosed,
  registerHint,
  runStepValidations,
  submitStep,
  type StepSubmission,
} from '../../features/labs/domain/labSession';
import { buildLabTopology } from '../../utils/labTopologyBuilder';
import { parseTopology } from '../../utils/topology/topologyGuards';
import type { NetworkState } from '../useNetworkStore';

export interface LabsSlice {
  // State
  availableLabs: Lab[];
  /** The active attempt. It stays here, closed, after the lab is finished so the result can be reviewed. */
  currentLabSession: LabSession | null;
  /** Finished attempts, newest last, bounded and persisted locally. */
  labHistory: LabProgress[];
  /** Kept for compatibility; held in memory only and never persisted. */
  externalIntegration: {
    apiKey?: string;
    apiSecret?: string;
    externalUserId?: string;
    isExternal: boolean;
  } | null;

  // Actions
  /** Loads the built-in catalog and the locally stored attempt history. */
  loadLabs: () => void;
  addLab: (lab: Lab) => void;
  startLab: (labId: string, isExamMode?: boolean) => void;
  /** Completes the current step; ignored unless its validations passed. */
  completeStep: (stepId: string) => void;
  /** Moves to a step that is completed or is the first pending one. */
  goToLabStep: (stepIndex: number) => void;
  validateCurrentStep: () => boolean;
  /** Validates the current step, completes it when it passes and finishes the lab after the last one. */
  submitCurrentStep: () => StepSubmission;
  recordHintUsed: () => void;
  finishLab: () => void;
  forceEndExam: () => void;
  resetLab: () => void;
  clearLabHistory: () => void;
  /** Best recorded attempt of a lab. */
  getLabProgress: (labId: string) => LabProgress | undefined;
  getStarsForLab: (labId: string) => number;
  setExternalIntegration: (integration: LabsSlice['externalIntegration']) => void;
  addExamStrike: () => void;
}

type ExternalIntegration = LabsSlice['externalIntegration'];

const GUEST_USER_ID = 'guest-user';

const shortText = (value: string | undefined): string | undefined =>
  typeof value === 'string' ? value.slice(0, 256) : undefined;

function copyIntegration(input: ExternalIntegration): ExternalIntegration {
  if (input === null || typeof input !== 'object') return null;
  return {
    isExternal: input.isExternal === true,
    externalUserId: shortText(input.externalUserId),
    apiKey: shortText(input.apiKey),
    apiSecret: shortText(input.apiSecret),
  };
}

function buildValidationContext(state: NetworkState, session: LabSession): LabValidationContext {
  const { devices, cables, sessionHistory } = state;
  const typed = devices.flatMap((device) =>
    Object.prototype.hasOwnProperty.call(sessionHistory, device.id) ? sessionHistory[device.id] : [],
  );
  return {
    devices,
    cables,
    commands: [...session.commandHistory, ...typed],
    topology: { devices, cables },
  };
}

export const createLabsSlice: StateCreator<NetworkState, [], [], LabsSlice> = (set, get) => {
  // The store runtime is not available while the slice is created, so the
  // stored history is merged in on first use and always before the first write.
  let historyLoaded = false;
  const hydrateHistory = (): LabProgress[] => {
    if (!historyLoaded) {
      historyLoaded = true;
      let merged = loadLabHistory(get().runtime.storage);
      for (const entry of get().labHistory) merged = upsertAttempt(merged, entry);
      if (merged.length > 0) set({ labHistory: merged });
    }
    return get().labHistory;
  };

  const activeLab = (session: LabSession | null): Lab | undefined =>
    session ? get().availableLabs.find((lab) => lab.id === session.labId) : undefined;

  const commitAttempt = (session: LabSession, progress: LabProgress): void => {
    const labHistory = upsertAttempt(hydrateHistory(), compactProgress(progress));
    // When storage is full or disabled the history still works for this visit.
    saveLabHistory(get().runtime.storage, labHistory);
    set({ currentLabSession: { ...session, progress }, labHistory });
  };

  return {
    availableLabs: [],
    currentLabSession: null,
    labHistory: [],
    externalIntegration: null,

    loadLabs: () => {
      set({ availableLabs: sanitizeCatalog(ALL_LABS) });
      hydrateHistory();
    },

    addLab: (lab) => {
      if (!isLabDefinition(lab)) return;
      set((state) => ({
        availableLabs: [lab, ...state.availableLabs.filter((item) => item.id !== lab.id)],
      }));
    },

    startLab: (labId, isExamMode = false) => {
      const lab = get().availableLabs.find((item) => item.id === labId);
      if (!lab) return;
      const history = hydrateHistory();

      const built = buildLabTopology(lab, get().runtime);
      const snapshot = parseTopology(built);
      if (!snapshot.ok) return;

      // An attempt that is still open is abandoned; it is restored if the swap fails.
      const previous = get().currentLabSession;
      // Edits still waiting for the autosave delay belong to the user's topology: save them
      // before the lab replaces it. Skipped when the store already holds a lab topology.
      if (previous === null) {
        const { devices, cables, runtime } = get();
        const hasSave = loadTopology(runtime.storage).ok;
        if (hasSave || devices.length > 0 || cables.length > 0) saveTopology(runtime.storage, devices, cables);
      }
      if (previous !== null) set({ currentLabSession: null });
      const replaced = get().replaceTopology(built);
      if (!replaced.ok) {
        set({ currentLabSession: previous });
        return;
      }

      set({
        currentLabSession: createLabSession(lab, {
          examMode: isExamMode === true,
          nowMs: get().runtime.clock(),
          userId: GUEST_USER_ID,
          previousAttempts: previousAttemptCount(history, labId),
          snapshot: { devices: snapshot.value.devices, cables: snapshot.value.cables },
        }),
      });
    },

    completeStep: (stepId) => {
      const session = get().currentLabSession;
      const lab = activeLab(session);
      if (!session || !lab) return;
      const next = completeStepInSession(session, lab, stepId);
      if (next !== session) set({ currentLabSession: next });
    },

    goToLabStep: (stepIndex) => {
      const session = get().currentLabSession;
      const lab = activeLab(session);
      if (!session || !lab) return;
      const next = goToStep(session, lab, stepIndex);
      if (next !== session) set({ currentLabSession: next });
    },

    validateCurrentStep: () => {
      const session = get().currentLabSession;
      const lab = activeLab(session);
      if (!session || !lab || isSessionClosed(session)) return false;
      const step = lab.steps.find((_item, index) => index === session.progress.currentStep);
      if (!step) return false;
      const results = runStepValidations(step, buildValidationContext(get(), session));
      set({ currentLabSession: applyValidationResults(session, step.id, results) });
      return results.every((result) => result.passed);
    },

    submitCurrentStep: () => {
      const session = get().currentLabSession;
      const lab = activeLab(session);
      if (!session || !lab) return { status: 'idle' };
      const outcome = submitStep(session, lab, buildValidationContext(get(), session));
      if (outcome.session !== session) set({ currentLabSession: outcome.session });
      if (outcome.submission.status === 'finished') get().finishLab();
      return outcome.submission;
    },

    recordHintUsed: () => {
      const session = get().currentLabSession;
      if (!session) return;
      const next = registerHint(session);
      if (next !== session) set({ currentLabSession: next });
    },

    finishLab: () => {
      const session = get().currentLabSession;
      if (!session || isSessionClosed(session)) return;
      commitAttempt(session, finalizeProgress(session, get().runtime.clock()));
    },

    forceEndExam: () => {
      const session = get().currentLabSession;
      if (!session || session.isExamMode !== true || isSessionClosed(session)) return;
      commitAttempt(session, finalizeProgress(session, get().runtime.clock(), true));
    },

    resetLab: () => {
      if (get().currentLabSession === null) return;
      // The lab topology must not stay behind: put the user's own topology back
      // (or an empty one when nothing was saved) in the same update that ends the session.
      const saved = loadTopology(get().runtime.storage);
      const devices = saved.ok ? saved.value.devices : [];
      const cables = saved.ok ? saved.value.cables : [];
      const kept = new Set(devices.map((device) => device.id));
      for (const consoleId of [...get().openConsoleIds]) {
        if (!kept.has(consoleId)) get().closeConsole(consoleId);
      }
      set({
        currentLabSession: null,
        devices,
        cables,
        selectedPort: null,
        pendingSfpModule: null,
        activeTrafficParams: [],
        packetTrace: null,
      });
    },

    clearLabHistory: () => {
      historyLoaded = true;
      clearStoredLabHistory(get().runtime.storage);
      set({ labHistory: [] });
    },

    getLabProgress: (labId) => bestAttempt(get().labHistory, labId),

    getStarsForLab: (labId) => bestAttempt(get().labHistory, labId)?.stars ?? 0,

    setExternalIntegration: (integration) => {
      set({ externalIntegration: copyIntegration(integration) });
    },

    addExamStrike: () => {
      const session = get().currentLabSession;
      if (!session) return;
      const next = addStrike(session);
      if (next === session) return;
      set({ currentLabSession: next });
      if (hasTooManyStrikes(next)) get().finishLab();
    },
  };
};
