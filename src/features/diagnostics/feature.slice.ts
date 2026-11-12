import type { FeatureSliceDefinition } from '../../store/featureState';
import { diagnoseTopology, sameReport } from './domain/analyzeTopology';
import type { DiagnosticsReport } from './domain/types';
import { bindExamProbe, isExamInProgress } from './examGate';

export interface DiagnosticsSlice {
  /** Last report, kept in memory only. Null before the first run and during an exam. */
  diagnosticsReport: DiagnosticsReport | null;
  /** Recomputes the report from the current topology. */
  diagnosticsRun: () => void;
  diagnosticsClear: () => void;
}

declare module '../../store/featureState' {
  interface FeatureState extends DiagnosticsSlice {}
}

export const featureSlice: FeatureSliceDefinition = {
  id: 'diagnostics',
  create: (set, get): DiagnosticsSlice => {
    // Lets the `diagnose` command ask whether an exam is running (see examGate.ts).
    bindExamProbe(() => isExamInProgress(get().currentLabSession));

    return {
      diagnosticsReport: null,

      diagnosticsRun: () => {
        const state = get();
        if (isExamInProgress(state.currentLabSession)) {
          if (state.diagnosticsReport !== null) set({ diagnosticsReport: null });
          return;
        }
        const next = diagnoseTopology(state.devices, state.cables);
        // Same topology, same report: keep the previous object so subscribers do not re-render.
        if (!sameReport(state.diagnosticsReport, next)) set({ diagnosticsReport: next });
      },

      diagnosticsClear: () => {
        if (get().diagnosticsReport !== null) set({ diagnosticsReport: null });
      },
    };
  },
};
