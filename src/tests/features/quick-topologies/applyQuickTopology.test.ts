import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => null,
  wasmPing: () => '',
}));

import {
  applyQuickTopology,
  describeQuickTopologyError,
} from '../../../features/quick-topologies/applyQuickTopology';
import type { QuickTopologyDefinition } from '../../../features/quick-topologies/domain/types';
import type { LabSession } from '../../../types/NetworkTypes';
import { createTestStore } from '../../helpers/createTestStore';

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

describe('applyQuickTopology', () => {
  it('loads a built-in topology through replaceTopology and rebuilds link state', () => {
    const store = createTestStore();
    const result = applyQuickTopology('routed-campus', store.getState());
    expect(result).toEqual({
      ok: true,
      value: { id: 'routed-campus', title: 'Routed campus', deviceCount: 7, cableCount: 6 },
    });

    const state = store.getState();
    expect(state.devices.map((device) => device.hostname)).toEqual(['R1', 'SW1', 'SW2', 'PC1', 'PC2', 'PC3', 'PC4']);
    expect(state.devices[0].type).toBe('Router');
    expect(state.cables).toHaveLength(6);
    for (const cable of state.cables) {
      const ends = [
        state.devices.find((d) => d.id === cable.sourceDeviceId)?.ports.find((p) => p.id === cable.sourcePortId),
        state.devices.find((d) => d.id === cable.targetDeviceId)?.ports.find((p) => p.id === cable.targetPortId),
      ];
      for (const port of ends) {
        expect(port?.status).toBe('up');
        expect(port?.connectedCableId).toBe(cable.id);
      }
    }
    const pc1 = state.devices[3];
    expect(pc1.ports[0].config).toMatchObject({ ipAddress: '192.0.2.10', subnetMask: 24 });
    expect(pc1.defaultGateway).toBe('192.0.2.1');
  });

  it('replaces the previous topology and closes consoles of removed devices', () => {
    const store = createTestStore();
    const old = store.getState().addDevice('PC');
    store.getState().openConsole(old.id);
    store.getState().onPortClick(old.id, old.ports[0].id);

    expect(applyQuickTopology('single-switch-lan', store.getState()).ok).toBe(true);

    const state = store.getState();
    expect(state.devices.some((device) => device.id === old.id)).toBe(false);
    expect(state.devices).toHaveLength(3);
    expect(state.openConsoleIds).toEqual([]);
    expect(state.activeConsoleId).toBeNull();
    expect(state.selectedPort).toBeNull();
  });

  it('refuses while a lab is in progress and leaves the topology untouched', () => {
    const store = createTestStore();
    const kept = store.getState().addDevice('PC');
    store.setState({ currentLabSession: labSession() });

    expect(applyQuickTopology('routed-campus', store.getState())).toEqual({
      ok: false,
      error: { code: 'lab-in-progress' },
    });
    expect(store.getState().devices.map((device) => device.id)).toEqual([kept.id]);

    store.setState({ currentLabSession: labSession('2026-01-01T01:00:00.000Z') });
    expect(applyQuickTopology('routed-campus', store.getState()).ok).toBe(true);
  });

  it('accepts only ids of built-in topologies', () => {
    const store = createTestStore();
    const kept = store.getState().addDevice('PC');
    for (const id of ['', 'nope', '__proto__', 'constructor', 'x'.repeat(500)]) {
      expect(applyQuickTopology(id, store.getState())).toEqual({ ok: false, error: { code: 'unknown-topology' } });
    }
    expect(store.getState().devices.map((device) => device.id)).toEqual([kept.id]);
  });

  it('reports a definition that cannot be built without touching the topology', () => {
    const broken: QuickTopologyDefinition = {
      id: 'broken',
      title: 'Broken',
      summary: 'A PC cabled twice to the same switch.',
      nodes: [
        { ref: 'SW1', model: 'Huawei-S5700-28TP', hostname: 'SW1', position: { x: 0, y: 0 } },
        { ref: 'PC1', model: 'PC', hostname: 'PC1', position: { x: 100, y: 0 } },
      ],
      links: [
        { from: 'SW1', to: 'PC1' },
        { from: 'SW1', to: 'PC1' },
      ],
    };
    const store = createTestStore();
    const kept = store.getState().addDevice('PC');
    const result = applyQuickTopology('broken', store.getState(), [broken]);
    expect(result).toMatchObject({ ok: false, error: { code: 'build-failed' } });
    expect(store.getState().devices.map((device) => device.id)).toEqual([kept.id]);
    expect(store.getState().cables).toEqual([]);
  });

  it('produces the same topology for the same injected runtime', () => {
    const first = createTestStore();
    const second = createTestStore();
    applyQuickTopology('two-sites', first.getState());
    applyQuickTopology('two-sites', second.getState());
    expect(first.getState().devices).toEqual(second.getState().devices);
    expect(first.getState().cables).toEqual(second.getState().cables);
  });

  it('describes every error in plain text', () => {
    expect(describeQuickTopologyError({ code: 'unknown-topology' })).toMatch(/not available/);
    expect(describeQuickTopologyError({ code: 'lab-in-progress' })).toMatch(/lab/);
    expect(describeQuickTopologyError({ code: 'invalid-topology' })).toMatch(/rejected/);
    expect(describeQuickTopologyError({ code: 'build-failed', detail: 'no-free-port: A -> B' })).toMatch(/no-free-port/);
  });
});
