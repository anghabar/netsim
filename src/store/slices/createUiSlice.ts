import type { StateCreator } from 'zustand';
import type { PacketTrace } from '../../types/NetworkTypes';
import type { NetworkState } from '../useNetworkStore';

export interface UiSlice {
  activeConsoleId: string | null;
  openConsoleIds: string[];
  activeTrafficParams: string[];
  activeGuide: Record<string, unknown> | null;
  guideStepsDone: number[];
  packetTrace: PacketTrace | null;
  viewMode: 'logical' | 'physical';
  showLabsPanel: boolean;
  showAutomationPanel: boolean;
  systemLogs: unknown[];
  /** Id of the feature panel opened from the Tools menu, if any. */
  activeToolPanel: string | null;

  openConsole: (id: string | null) => void;
  closeConsole: (id: string) => void;
  markGuideStep: (idx: number, done: boolean) => void;
  clearGuide: () => void;
  setPacketTrace: (trace: PacketTrace | null) => void;
  setViewMode: (mode: 'logical' | 'physical') => void;
  setShowLabsPanel: (show: boolean) => void;
  setShowAutomationPanel: (show: boolean) => void;
  addLog: (log: unknown) => void;
  openToolPanel: (id: string) => void;
  closeToolPanel: () => void;
  showGamificationDashboard: boolean;
  setShowGamificationDashboard: (show: boolean) => void;
  showExamSimulator: boolean;
  setShowExamSimulator: (show: boolean) => void;
  showSelfHealingConsole: boolean;
  setShowSelfHealingConsole: (show: boolean) => void;
  show3DView: boolean;
  setShow3DView: (show: boolean) => void;
}

export const createUiSlice: StateCreator<NetworkState, [], [], UiSlice> = (set) => ({
  activeConsoleId: null,
  openConsoleIds: [],
  activeTrafficParams: [],
  activeGuide: null,
  guideStepsDone: [],
  packetTrace: null,
  viewMode: 'logical',
  showLabsPanel: false,
  showAutomationPanel: false,
  showGamificationDashboard: false,
  showExamSimulator: false,
  showSelfHealingConsole: false,
  show3DView: false,
  systemLogs: [],
  activeToolPanel: null,

  openConsole: (id) =>
    set((s) => {
      if (!id) return { activeConsoleId: null };
      const nextIds = s.openConsoleIds.includes(id) ? s.openConsoleIds : [...s.openConsoleIds, id];
      return { activeConsoleId: id, openConsoleIds: nextIds };
    }),
  closeConsole: (id) =>
    set((s) => {
      const nextIds = s.openConsoleIds.filter((cid) => cid !== id);
      let nextActive = s.activeConsoleId;
      if (s.activeConsoleId === id) {
        nextActive = nextIds.length > 0 ? nextIds[nextIds.length - 1] : null;
      }
      return { activeConsoleId: nextActive, openConsoleIds: nextIds };
    }),
  markGuideStep: (idx, done) =>
    set((s) => {
      if (s.activeGuide === null) return s;
      const steps = new Set<number>(s.guideStepsDone);
      if (done) steps.add(idx);
      else steps.delete(idx);
      return { guideStepsDone: Array.from(steps).sort((a, b) => a - b) };
    }),
  clearGuide: () => set({ activeGuide: null, guideStepsDone: [] }),
  setPacketTrace: (trace) => set({ packetTrace: trace }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setShowLabsPanel: (show) => set({ showLabsPanel: show }),
  setShowAutomationPanel: (show) => set({ showAutomationPanel: show }),
  addLog: (log) => set((state) => ({ systemLogs: [log, ...state.systemLogs] })),
  openToolPanel: (id) => set({ activeToolPanel: id.length > 0 && id.length <= 64 ? id : null }),
  closeToolPanel: () => set({ activeToolPanel: null }),

  setShowGamificationDashboard: (show) => set({ showGamificationDashboard: show }),
  setShowExamSimulator: (show) => set({ showExamSimulator: show }),
  setShowSelfHealingConsole: (show) => set({ showSelfHealingConsole: show }),
  setShow3DView: (show) => set({ show3DView: show }),
});
