import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => null,
  wasmPing: () => '',
}));

import type { LabSession } from '../../types/NetworkTypes';
import {
  attachTopologyAutosave,
  loadTopology,
  saveTopology,
  TOPOLOGY_AUTOSAVE_SLOT,
  TOPOLOGY_CORRUPT_SLOT,
} from '../../store/topologyAutosave';
import { createTestStore, linkedPair, TEST_EPOCH_MS } from '../helpers/createTestStore';

const labSession = (completedAt?: string): LabSession => ({
  labId: 'sample-lab',
  progress: {
    labId: 'sample-lab',
    userId: 'guest-user',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt,
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

afterEach(() => {
  vi.useRealTimers();
});

describe('createNetworkStore', () => {
  it('creates independent stores with injected runtime values', () => {
    const first = createTestStore();
    const second = createTestStore();
    const device = first.getState().addDevice('PC');
    expect(device.id).toBe('id-1');
    expect(first.getState().runtime.clock()).toBe(TEST_EPOCH_MS);
    expect(first.getState().devices).toHaveLength(1);
    expect(second.getState().devices).toHaveLength(0);
  });

  it('tracks the open tool panel', () => {
    const store = createTestStore();
    store.getState().openToolPanel('diagnostics');
    expect(store.getState().activeToolPanel).toBe('diagnostics');
    store.getState().closeToolPanel();
    expect(store.getState().activeToolPanel).toBeNull();
  });
});

describe('replaceTopology', () => {
  it('refuses while a lab is in progress and allows it once the lab is completed', () => {
    const store = createTestStore();
    const { a, b, cable } = linkedPair();
    store.setState({ currentLabSession: labSession() });
    expect(store.getState().replaceTopology({ devices: [a, b], cables: [cable] })).toEqual({
      ok: false,
      error: 'lab-in-progress',
    });
    expect(store.getState().devices).toHaveLength(0);

    store.setState({ currentLabSession: labSession('2026-01-01T01:00:00.000Z') });
    expect(store.getState().replaceTopology({ devices: [a, b], cables: [cable] }).ok).toBe(true);
  });

  it('rejects an invalid topology and leaves the state untouched', () => {
    const store = createTestStore();
    const kept = store.getState().addDevice('PC');
    const { a, cable } = linkedPair();
    expect(store.getState().replaceTopology({ devices: [a], cables: [cable] })).toEqual({
      ok: false,
      error: 'invalid-topology',
    });
    expect(store.getState().devices.map((d) => d.id)).toEqual([kept.id]);
  });

  it('closes consoles of removed devices, clears selections and rebuilds link state', () => {
    const store = createTestStore();
    const { a, b, cable } = linkedPair();
    const old = store.getState().addDevice('PC');
    store.getState().openConsole(old.id);
    store.getState().openConsole(a.id);
    store.getState().onPortClick(old.id, old.ports[0].id);
    expect(store.getState().selectedPort).not.toBeNull();

    const result = store.getState().replaceTopology({ devices: [a, b], cables: [cable] });
    expect(result).toEqual({ ok: true, value: undefined });

    const state = store.getState();
    expect(state.openConsoleIds).toEqual([a.id]);
    expect(state.activeConsoleId).toBe(a.id);
    expect(state.selectedPort).toBeNull();
    expect(state.cables).toEqual([cable]);
    expect(state.devices.map((d) => d.id)).toEqual([a.id, b.id]);
    expect(state.devices[0]).not.toBe(a);
    for (const device of state.devices) {
      expect(device.ports[0].status).toBe('up');
      expect(device.ports[0].connectedCableId).toBe(cable.id);
      expect(device.ports[1].status).toBe('down');
    }
  });

  it('keeps administratively disabled ports down after re-cabling', () => {
    const store = createTestStore();
    const { a, b, cable } = linkedPair();
    a.ports[0].config.enabled = false;
    store.getState().replaceTopology({ devices: [a, b], cables: [cable] });
    const [first, second] = store.getState().devices;
    expect(first.ports[0].status).toBe('down');
    expect(first.ports[0].connectedCableId).toBe(cable.id);
    expect(second.ports[0].status).toBe('up');
  });
});

describe('removeDevice', () => {
  it('removes the cables of the device and frees the far-end port', () => {
    const store = createTestStore();
    const { a, b, cable } = linkedPair();
    store.getState().replaceTopology({ devices: [a, b], cables: [cable] });
    store.getState().removeDevice(b.id);
    const state = store.getState();
    expect(state.cables).toEqual([]);
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0].ports[0].status).toBe('down');
    expect(state.devices[0].ports[0].connectedCableId).toBeNull();
  });
});

describe('topology autosave', () => {
  it('saves after the delay, restores through initialize and stops when detached', () => {
    vi.useFakeTimers();
    const store = createTestStore();
    const storage = store.getState().runtime.storage;
    const detach = attachTopologyAutosave(store, { delayMs: 50 });

    store.getState().addDevice('PC');
    expect(loadTopology(storage)).toEqual({ ok: false, error: 'empty' });
    vi.advanceTimersByTime(50);
    const saved = loadTopology(storage);
    expect(saved.ok).toBe(true);

    const restored = createTestStore({ storage });
    restored.getState().initialize();
    expect(restored.getState().devices).toHaveLength(1);
    expect(restored.getState().devices[0].model).toBe('PC');

    detach();
    store.getState().addDevice('PC');
    vi.advanceTimersByTime(500);
    const afterDetach = loadTopology(storage);
    expect(afterDetach.ok && afterDetach.value.devices.length).toBe(1);
  });

  it('pauses while a lab is in progress', () => {
    vi.useFakeTimers();
    const store = createTestStore();
    const detach = attachTopologyAutosave(store, { delayMs: 50 });
    store.setState({ currentLabSession: labSession() });
    store.getState().addDevice('PC');
    vi.advanceTimersByTime(500);
    expect(loadTopology(store.getState().runtime.storage)).toEqual({ ok: false, error: 'empty' });
    detach();
  });

  it('ignores a corrupt autosave', () => {
    const store = createTestStore();
    const storage = store.getState().runtime.storage;
    storage.write(TOPOLOGY_AUTOSAVE_SLOT, '{"version":1,"devices":"nope"');
    store.getState().initialize();
    expect(store.getState().devices).toEqual([]);
    storage.write(TOPOLOGY_AUTOSAVE_SLOT, '{"version":1,"devices":[{"id":"x"}],"cables":[]}');
    store.getState().initialize();
    expect(store.getState().devices).toEqual([]);
  });

  it('does not save a topology that could not be loaded again', () => {
    const store = createTestStore();
    const storage = store.getState().runtime.storage;
    const { a, b, cable } = linkedPair();
    expect(saveTopology(storage, [a, b], [cable]).ok).toBe(true);
    const before = storage.read(TOPOLOGY_AUTOSAVE_SLOT);

    const tooLong = { ...a, hostname: 'h'.repeat(500) };
    expect(saveTopology(storage, [tooLong, b], [cable])).toEqual({ ok: false, error: 'invalid-topology' });
    expect(storage.read(TOPOLOGY_AUTOSAVE_SLOT)).toBe(before);
    expect(loadTopology(storage).ok).toBe(true);
  });

  it('keeps unreadable saved text in a second slot and does not overwrite it', () => {
    vi.useFakeTimers();
    const store = createTestStore();
    const storage = store.getState().runtime.storage;
    const unreadable = '{"version":1,"devices":[{"id":"x"}],"cables":[]}';
    storage.write(TOPOLOGY_AUTOSAVE_SLOT, unreadable);
    expect(storage.read(TOPOLOGY_CORRUPT_SLOT)).toBeNull();

    store.getState().initialize();
    expect(store.getState().devices).toEqual([]);
    expect(storage.read(TOPOLOGY_CORRUPT_SLOT)).toBe(unreadable);

    const detach = attachTopologyAutosave(store, { delayMs: 50 });
    store.getState().addDevice('PC');
    vi.advanceTimersByTime(50);
    detach();
    expect(storage.read(TOPOLOGY_AUTOSAVE_SLOT)).not.toBe(unreadable);
    expect(storage.read(TOPOLOGY_CORRUPT_SLOT)).toBe(unreadable);
  });

  it('round-trips a valid topology and leaves the second slot empty', () => {
    const storage = createTestStore().getState().runtime.storage;
    const { a, b, cable } = linkedPair();
    expect(saveTopology(storage, [a, b], [cable]).ok).toBe(true);
    const loaded = loadTopology(storage);
    expect(loaded.ok && loaded.value.devices.map((d) => d.id)).toEqual([a.id, b.id]);
    expect(loaded.ok && loaded.value.cables).toHaveLength(1);
    expect(storage.read(TOPOLOGY_CORRUPT_SLOT)).toBeNull();
  });
});
