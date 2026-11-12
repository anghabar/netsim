import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => ({ success: false, output: '' }),
  wasmPing: () => '',
}));

import { isDiagnosisBlocked, isExamInProgress } from '../../../features/diagnostics/examGate';
import { featureCommands } from '../../../features/diagnostics/feature.commands';
import { featureSlice } from '../../../features/diagnostics/feature.slice';
import { listFeatureUi } from '../../../features/featureRegistry';
import { globalCommandRegistry } from '../../../store/slices/cli/commands/base/CommandRegistry';
import type { LabSession } from '../../../types/NetworkTypes';
import { createTestStore, linkedPair } from '../../helpers/createTestStore';

type TestStore = ReturnType<typeof createTestStore>;

const labSession = (isExamMode: boolean, completedAt?: string): LabSession => ({
  labId: 'sample-lab',
  isExamMode,
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

/** A store with a switch (first port shut down) cabled to a router. */
function storeWithShutLink(): { store: TestStore; switchId: string } {
  const store = createTestStore();
  const { a, b, cable } = linkedPair();
  a.ports[0].config.enabled = false;
  const replaced = store.getState().replaceTopology({ devices: [a, b], cables: [cable] });
  expect(replaced.ok).toBe(true);
  return { store, switchId: a.id };
}

const consoleOf = (store: TestStore, deviceId: string): string[] =>
  store.getState().devices.find((d) => d.id === deviceId)?.consoleLogs ?? [];

describe('diagnostics feature registration', () => {
  it('contributes a slice, a panel and one CLI command', () => {
    const store = createTestStore();
    expect(featureSlice.id).toBe('diagnostics');
    expect(store.getState().diagnosticsReport).toBeNull();
    expect(listFeatureUi().filter((entry) => entry.id === 'diagnostics')).toHaveLength(1);
    expect(featureCommands.map((command) => command.name)).toEqual(['diagnose']);
    expect(globalCommandRegistry.getAllCommands().filter((command) => command.name === 'diagnose')).toHaveLength(1);
  });
});

describe('diagnostics slice', () => {
  it('stores a report for the current topology', () => {
    const { store } = storeWithShutLink();
    store.getState().diagnosticsRun();
    const report = store.getState().diagnosticsReport;
    expect(report).toMatchObject({ deviceCount: 2, cableCount: 1, truncated: false, skipped: 0 });
    expect(report?.findings.map((f) => f.code)).toEqual(['admin-down-link']);
  });

  it('keeps the same report object while the analysed data does not change', () => {
    const { store, switchId } = storeWithShutLink();
    store.getState().diagnosticsRun();
    const first = store.getState().diagnosticsReport;
    store.getState().updateDevicePosition(switchId, { x: 50, y: 50 });
    store.getState().diagnosticsRun();
    expect(store.getState().diagnosticsReport).toBe(first);

    const portId = store.getState().devices.find((d) => d.id === switchId)?.ports[0].id ?? '';
    store.getState().updatePortConfig(switchId, portId, { enabled: true });
    store.getState().diagnosticsRun();
    expect(store.getState().diagnosticsReport).not.toBe(first);
    expect(store.getState().diagnosticsReport?.findings).toEqual([]);
  });

  it('clears the report', () => {
    const { store } = storeWithShutLink();
    store.getState().diagnosticsRun();
    store.getState().diagnosticsClear();
    expect(store.getState().diagnosticsReport).toBeNull();
  });

  it('produces no report while an exam is in progress', () => {
    const { store } = storeWithShutLink();
    store.getState().diagnosticsRun();
    store.setState({ currentLabSession: labSession(true) });
    store.getState().diagnosticsRun();
    expect(store.getState().diagnosticsReport).toBeNull();
    expect(isDiagnosisBlocked()).toBe(true);

    store.setState({ currentLabSession: labSession(true, '2026-01-01T01:00:00.000Z') });
    store.getState().diagnosticsRun();
    expect(store.getState().diagnosticsReport).not.toBeNull();
    expect(isDiagnosisBlocked()).toBe(false);
  });

  it('only treats an unfinished exam session as an exam in progress', () => {
    expect(isExamInProgress(null)).toBe(false);
    expect(isExamInProgress(undefined)).toBe(false);
    expect(isExamInProgress(labSession(false))).toBe(false);
    expect(isExamInProgress(labSession(true))).toBe(true);
    expect(isExamInProgress(labSession(true, '2026-01-01T01:00:00.000Z'))).toBe(false);
  });
});

describe('diagnose through the device console', () => {
  it('prints the report in the active console', async () => {
    const { store, switchId } = storeWithShutLink();
    store.getState().openConsole(switchId);
    store.getState().executeCommand('diagnose');

    await vi.waitFor(() => {
      expect(consoleOf(store, switchId).some((line) => line.startsWith('Topology diagnosis:'))).toBe(true);
    });
    expect(consoleOf(store, switchId).join('\n')).toContain('has a cable attached but is shut down.');
  });

  it('is refused while an exam is in progress', async () => {
    const { store, switchId } = storeWithShutLink();
    store.setState({ currentLabSession: labSession(true) });
    store.getState().openConsole(switchId);
    store.getState().executeCommand('diagnose');

    await vi.waitFor(() => {
      expect(consoleOf(store, switchId)).toContain('Error: topology diagnosis is not available during an exam');
    });
    expect(consoleOf(store, switchId).some((line) => line.startsWith('Topology diagnosis:'))).toBe(false);
  });
});
