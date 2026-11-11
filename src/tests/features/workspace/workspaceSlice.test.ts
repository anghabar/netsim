import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => null,
  wasmPing: () => '',
}));

import { loadLibrary, WORKSPACE_SNAPSHOTS_SLOT } from '../../../features/workspace/domain/snapshotLibrary';
import { WORKSPACE_LIMITS } from '../../../features/workspace/domain/workspaceModel';
import { featureSlice } from '../../../features/workspace/feature.slice';
import type { LabSession } from '../../../types/NetworkTypes';
import { createMemoryStorage, type KeyValueStorage } from '../../../utils/storage/keyValueStorage';
import { createTestStore, TEST_EPOCH_MS } from '../../helpers/createTestStore';
import { pairTopology } from './fixtures';

function storeWithPair(storage?: KeyValueStorage) {
  const store = createTestStore({ storage });
  const pair = pairTopology();
  const replaced = store.getState().replaceTopology(pair.topology);
  if (!replaced.ok) throw new Error(`fixture failed: ${replaced.error}`);
  return { store, ...pair };
}

const labSession = (): LabSession => ({
  labId: 'sample-lab',
  progress: {
    labId: 'sample-lab',
    userId: 'guest-user',
    startedAt: '2026-01-01T00:00:00.000Z',
    currentStep: 0,
    completedSteps: [],
    score: 0,
    maxScore: 10,
    stars: 0,
    attempts: 1,
    timeSpent: 0,
    hintsUsed: 0,
    validationsPassed: [],
    validationsFailed: [],
  },
  topologySnapshot: { devices: [], cables: [] },
  commandHistory: [],
  validationResults: [],
});

describe('workspace slice', () => {
  it('is registered in the store with an empty list', () => {
    const store = createTestStore();
    expect(featureSlice.id).toBe('workspace');
    expect(store.getState().workspaceSnapshots).toEqual([]);
    expect(store.getState().workspaceLoaded).toBe(false);
  });

  it('saves the current topology and persists it', () => {
    const { store } = storeWithPair();
    const saved = store.getState().workspaceSaveSnapshot('Baseline');
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value).toMatchObject({ name: 'Baseline', createdAt: TEST_EPOCH_MS });
    expect(store.getState().workspaceSnapshots.map((snapshot) => snapshot.name)).toEqual(['Baseline']);
    expect(loadLibrary(store.getState().runtime.storage).snapshots.map((snapshot) => snapshot.name)).toEqual(['Baseline']);
  });

  it('re-reads storage before writing so other snapshots are not overwritten', () => {
    const storage = createMemoryStorage();
    const first = storeWithPair(storage).store;
    expect(first.getState().workspaceSaveSnapshot('One').ok).toBe(true);

    const second = storeWithPair(storage).store;
    expect(second.getState().workspaceLoaded).toBe(false);
    expect(second.getState().workspaceSaveSnapshot('Two').ok).toBe(true);
    expect(loadLibrary(storage).snapshots.map((snapshot) => snapshot.name)).toEqual(['Two', 'One']);

    first.getState().workspaceLoad();
    expect(first.getState().workspaceSnapshots.map((snapshot) => snapshot.name)).toEqual(['Two', 'One']);
  });

  it('refuses an empty topology and does not commit when the storage write fails', () => {
    const empty = createTestStore();
    expect(empty.getState().workspaceSaveSnapshot('Empty')).toEqual({ ok: false, error: 'empty-topology' });

    const { store } = storeWithPair(createMemoryStorage({ quotaBytes: 10 }));
    expect(store.getState().workspaceSaveSnapshot('Baseline')).toEqual({ ok: false, error: 'storage-failed' });
    expect(store.getState().workspaceSnapshots).toEqual([]);
  });

  it('restores only after confirmation, as fresh copies with link state rebuilt', () => {
    const { store, a, b } = storeWithPair();
    const saved = store.getState().workspaceSaveSnapshot('Baseline');
    if (!saved.ok) throw new Error(saved.error);
    const id = saved.value.id;

    store.getState().openConsole(b.id);
    store.getState().removeDevice(a.id);
    const extra = store.getState().addDevice('PC');
    store.getState().openConsole(extra.id);

    expect(store.getState().workspaceRestoreSnapshot(id)).toEqual({ ok: false, error: 'confirmation-required' });
    expect(store.getState().devices).toHaveLength(2);
    expect(store.getState().cables).toHaveLength(0);

    expect(store.getState().workspaceRestoreSnapshot(id, { replaceCurrent: true })).toEqual({
      ok: true,
      value: undefined,
    });
    const state = store.getState();
    expect(state.devices.map((device) => device.id)).toEqual([a.id, b.id]);
    expect(state.cables).toHaveLength(1);
    expect(state.devices[0].ports[0].status).toBe('up');
    expect(state.devices[1].ports[0].status).toBe('up');
    expect(state.openConsoleIds).toEqual([b.id]);

    const stored = state.workspaceSnapshots[0].topology.devices[0];
    expect(state.devices[0]).not.toBe(stored);
    store.getState().updateDevice(a.id, { hostname: 'changed-later' });
    expect(store.getState().workspaceSnapshots[0].topology.devices[0].hostname).toBe(a.hostname);
  });

  it('refuses to restore while a lab is in progress and reports unknown ids', () => {
    const { store } = storeWithPair();
    const saved = store.getState().workspaceSaveSnapshot('Baseline');
    if (!saved.ok) throw new Error(saved.error);
    store.setState({ currentLabSession: labSession() });
    expect(store.getState().workspaceRestoreSnapshot(saved.value.id, { replaceCurrent: true })).toEqual({
      ok: false,
      error: 'lab-in-progress',
    });
    expect(store.getState().workspaceRestoreSnapshot('missing', { replaceCurrent: true })).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('deletes a snapshot from state and storage', () => {
    const { store } = storeWithPair();
    const saved = store.getState().workspaceSaveSnapshot('Baseline');
    if (!saved.ok) throw new Error(saved.error);
    expect(store.getState().workspaceDeleteSnapshot('missing')).toEqual({ ok: false, error: 'not-found' });
    expect(store.getState().workspaceDeleteSnapshot(saved.value.id)).toEqual({ ok: true, value: undefined });
    expect(store.getState().workspaceSnapshots).toEqual([]);
    expect(loadLibrary(store.getState().runtime.storage).snapshots).toEqual([]);
  });

  it('exports the current topology and imports it elsewhere as a snapshot', async () => {
    const { store, a } = storeWithPair();
    const exported = store.getState().workspaceExportFile({ kind: 'current', name: 'Shared pair' });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value.fileName).toBe('shared-pair.netsim.json');
    expect(store.getState().workspaceExportFile({ kind: 'snapshot', id: 'missing' })).toEqual({
      ok: false,
      error: 'not-found',
    });

    const target = createTestStore();
    const imported = await target.getState().workspaceImportFile(new Blob([exported.value.text]));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.snapshot).toMatchObject({ name: 'Shared pair', createdAt: TEST_EPOCH_MS });
    expect(imported.value.snapshot.topology.devices.map((device) => device.id)).not.toContain(a.id);
    expect(target.getState().devices).toEqual([]);

    expect(target.getState().workspaceRestoreSnapshot(imported.value.snapshot.id).ok).toBe(true);
    expect(target.getState().devices).toHaveLength(2);
    expect(target.getState().cables).toHaveLength(1);
  });

  it('rejects oversized files without reading them and reports unreadable ones', async () => {
    const store = createTestStore();
    const text = vi.fn(async () => '');
    const huge = { size: WORKSPACE_LIMITS.maxFileBytes + 1, text };
    expect(await store.getState().workspaceImportFile(huge)).toEqual({ ok: false, error: 'too-large' });
    expect(text).not.toHaveBeenCalled();

    const unreadable = {
      size: 10,
      text: async (): Promise<string> => {
        throw new Error('denied');
      },
    };
    expect(await store.getState().workspaceImportFile(unreadable)).toEqual({ ok: false, error: 'unreadable-file' });
    expect(store.getState().workspaceImportText('{not json')).toEqual({ ok: false, error: 'invalid-json' });
    expect(store.getState().workspaceSnapshots).toEqual([]);
  });

  it('reports stored entries that fail validation', () => {
    const store = createTestStore();
    store.getState().runtime.storage.write(WORKSPACE_SNAPSHOTS_SLOT, '{broken');
    store.getState().workspaceLoad();
    expect(store.getState().workspaceLoaded).toBe(true);
    expect(store.getState().workspaceSnapshots).toEqual([]);
    expect(store.getState().workspaceSkippedEntries).toBe(1);
  });
});
