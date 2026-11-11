import type { FeatureSliceDefinition } from '../../store/featureState';
import { err, ok, type Result } from '../../utils/guards';
import { createSnapshot, loadLibrary, removeSnapshot, saveLibrary } from './domain/snapshotLibrary';
import { buildTopologyFile, readTopologyFile, type TopologyFileExport } from './domain/topologyFile';
import {
  WORKSPACE_LIMITS,
  type TopologyData,
  type WorkspaceError,
  type WorkspaceSnapshot,
} from './domain/workspaceModel';

/** The part of a File or Blob the import needs. */
export type TopologyFileSource = Pick<Blob, 'size' | 'text'>;

export type WorkspaceExportSource = { kind: 'current'; name: string } | { kind: 'snapshot'; id: string };

export interface WorkspaceImportOutcome {
  snapshot: WorkspaceSnapshot;
  ignoredFields: number;
  unknownModels: number;
}

export interface WorkspaceSlice {
  /** Named local snapshots, newest first. Stored only in this browser. */
  workspaceSnapshots: WorkspaceSnapshot[];
  workspaceLoaded: boolean;
  /** Stored entries ignored by the last load because they failed validation. */
  workspaceSkippedEntries: number;

  /** Reads the snapshot list from storage. */
  workspaceLoad: () => void;
  workspaceSaveSnapshot: (name: string) => Result<WorkspaceSnapshot, WorkspaceError>;
  /** Replaces the topology; `replaceCurrent` must be set when the canvas is not empty. */
  workspaceRestoreSnapshot: (id: string, options?: { replaceCurrent?: boolean }) => Result<void, WorkspaceError>;
  workspaceDeleteSnapshot: (id: string) => Result<void, WorkspaceError>;
  /** Adds the topology of a file to the snapshot list; the canvas is not touched. */
  workspaceImportText: (text: string) => Result<WorkspaceImportOutcome, WorkspaceError>;
  workspaceImportFile: (file: TopologyFileSource) => Promise<Result<WorkspaceImportOutcome, WorkspaceError>>;
  workspaceExportFile: (
    source: WorkspaceExportSource,
    options?: { includeSensitive?: boolean },
  ) => Result<TopologyFileExport, WorkspaceError>;
}

declare module '../../store/featureState' {
  interface FeatureState extends WorkspaceSlice {}
}

export const featureSlice: FeatureSliceDefinition = {
  id: 'workspace',
  create: (set, get): WorkspaceSlice => {
    // Storage is the source of truth: every mutation re-reads it first, so
    // snapshots saved elsewhere (another tab) are not overwritten.
    const refresh = (): WorkspaceSnapshot[] => {
      const report = loadLibrary(get().runtime.storage);
      set({
        workspaceSnapshots: report.snapshots,
        workspaceLoaded: true,
        workspaceSkippedEntries: report.skipped,
      });
      return report.snapshots;
    };

    const loaded = (): WorkspaceSnapshot[] => (get().workspaceLoaded ? get().workspaceSnapshots : refresh());

    // State is committed only after the storage write succeeded.
    const commit = (next: WorkspaceSnapshot[]): Result<void, WorkspaceError> => {
      const saved = saveLibrary(get().runtime.storage, next);
      if (saved.ok) set({ workspaceSnapshots: next });
      return saved;
    };

    const add = (name: string, topology: TopologyData): Result<WorkspaceSnapshot, WorkspaceError> => {
      const existing = refresh();
      const created = createSnapshot(name, topology, existing, get().runtime);
      if (!created.ok) return created;
      const saved = commit([created.value, ...existing]);
      return saved.ok ? ok(created.value) : saved;
    };

    return {
      workspaceSnapshots: [],
      workspaceLoaded: false,
      workspaceSkippedEntries: 0,

      workspaceLoad: () => {
        refresh();
      },

      workspaceSaveSnapshot: (name) => add(name, { devices: get().devices, cables: get().cables }),

      workspaceRestoreSnapshot: (id, options) => {
        const snapshot = loaded().find((entry) => entry.id === id);
        if (!snapshot) return err('not-found');
        if (get().devices.length > 0 && options?.replaceCurrent !== true) return err('confirmation-required');
        // replaceTopology validates again and applies fresh copies, so the
        // live state never shares objects with the stored snapshot.
        return get().replaceTopology({ devices: snapshot.topology.devices, cables: snapshot.topology.cables });
      },

      workspaceDeleteSnapshot: (id) => {
        const next = removeSnapshot(refresh(), id);
        return next.ok ? commit(next.value) : next;
      },

      workspaceImportText: (text) => {
        const file = readTopologyFile(text, get().runtime);
        if (!file.ok) return file;
        const added = add(file.value.name, file.value.topology);
        if (!added.ok) return added;
        return ok({
          snapshot: added.value,
          ignoredFields: file.value.ignoredFields,
          unknownModels: file.value.unknownModels,
        });
      },

      workspaceImportFile: async (file) => {
        // The size is checked before any content is read into memory.
        if (!Number.isFinite(file.size) || file.size > WORKSPACE_LIMITS.maxFileBytes) return err('too-large');
        let text: string;
        try {
          text = await file.text();
        } catch {
          return err('unreadable-file');
        }
        return get().workspaceImportText(text);
      },

      workspaceExportFile: (source, options) => {
        let name: string;
        let topology: TopologyData;
        if (source.kind === 'snapshot') {
          const snapshot = loaded().find((entry) => entry.id === source.id);
          if (!snapshot) return err('not-found');
          name = snapshot.name;
          topology = snapshot.topology;
        } else {
          name = source.name;
          topology = { devices: get().devices, cables: get().cables };
        }
        return buildTopologyFile(
          { name, topology, includeSensitive: options?.includeSensitive === true },
          get().runtime.clock,
        );
      },
    };
  },
};
