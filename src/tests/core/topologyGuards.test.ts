import { describe, expect, it, vi } from 'vitest';

vi.mock('../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => null,
  wasmPing: () => '',
}));

import { defaultDeviceCatalog } from '../../data/deviceCatalog';
import { ALL_LABS } from '../../data/labs/index';
import { deviceFactory } from '../../store/slices/createTopologySlice';
import { buildLabTopology } from '../../utils/labTopologyBuilder';
import { parseTopology, TOPOLOGY_LIMITS } from '../../utils/topology/topologyGuards';
import { linkedPair } from '../helpers/createTestStore';

describe('parseTopology', () => {
  it('accepts every catalog model created by deviceFactory', () => {
    const devices = defaultDeviceCatalog.map((entry, index) => deviceFactory(entry.model, { x: index * 10, y: 0 }));
    const result = parseTopology({ devices, cables: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.devices).toHaveLength(devices.length);
      expect(result.value.warnings).toEqual([]);
      expect(result.value.devices[0]).not.toBe(devices[0]);
    }
  });

  it('classifies routers from catalog data', () => {
    expect(deviceFactory('Huawei-AR617', { x: 0, y: 0 }).type).toBe('Router');
    expect(deviceFactory('Huawei-S5700-28TP', { x: 0, y: 0 }).type).toBe('Switch');
    expect(deviceFactory('PC', { x: 0, y: 0 }).type).toBe('PC');
  });

  it('warns about a model outside the catalog instead of rejecting it', () => {
    const result = parseTopology({ devices: [deviceFactory('NS-Switch-L3-48', { x: 0, y: 0 })], cables: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings).toEqual([{ code: 'unknown-model', path: 'devices[0].model' }]);
    }
  });

  it('derives link fields from the cables', () => {
    const { a, b, cable } = linkedPair();
    a.ports[1].status = 'up';
    const result = parseTopology({ devices: [a, b], cables: [cable] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const [first, second] = result.value.devices;
      expect(first.ports[0].connectedCableId).toBe(cable.id);
      expect(second.ports[0].connectedCableId).toBe(cable.id);
      expect(first.ports[1].connectedCableId).toBeNull();
      expect(first.ports[1].status).toBe('down');
    }
  });

  it('enforces referential integrity', () => {
    const { a, b, cable } = linkedPair();
    const dangling = parseTopology({ devices: [a], cables: [cable] });
    expect(dangling).toEqual({ ok: false, error: { code: 'dangling-cable', path: 'cables[0]' } });

    const reused = parseTopology({ devices: [a, b], cables: [cable, { ...cable, id: 'cable-second' }] });
    expect(reused).toEqual({ ok: false, error: { code: 'port-in-use', path: 'cables[1]' } });

    const sameCableTwice = parseTopology({ devices: [a, b], cables: [cable, cable] });
    expect(sameCableTwice).toEqual({ ok: false, error: { code: 'duplicate-id', path: 'cables[1]' } });

    const sameDeviceTwice = parseTopology({ devices: [a, a], cables: [] });
    expect(sameDeviceTwice).toEqual({ ok: false, error: { code: 'duplicate-id', path: 'devices[1]' } });
  });

  it('enforces count and size limits', () => {
    const { a, b } = linkedPair();
    const oneDevice = { ...TOPOLOGY_LIMITS, maxDevices: 1 };
    expect(parseTopology({ devices: [a, b], cables: [] }, oneDevice)).toEqual({
      ok: false,
      error: { code: 'too-many-devices', path: 'devices' },
    });
    const fewPorts = { ...TOPOLOGY_LIMITS, maxPortsPerDevice: 2 };
    expect(parseTopology({ devices: [a], cables: [] }, fewPorts).ok).toBe(false);
    const longName = { ...a, hostname: 'h'.repeat(TOPOLOGY_LIMITS.maxLabelLength + 1) };
    expect(parseTopology({ devices: [longName], cables: [] }).ok).toBe(false);
    const hugeText = { ...a, hostname: 'h'.repeat(TOPOLOGY_LIMITS.json.maxStringLength + 1) };
    expect(parseTopology({ devices: [hugeText], cables: [] })).toEqual({
      ok: false,
      error: { code: 'unsafe-content', path: 'devices' },
    });
  });

  it('rejects structurally invalid input', () => {
    expect(parseTopology(null).ok).toBe(false);
    expect(parseTopology([]).ok).toBe(false);
    expect(parseTopology({ devices: 'nope', cables: [] }).ok).toBe(false);
    expect(parseTopology({ devices: [{ id: 'x' }], cables: [] }).ok).toBe(false);
    const { a } = linkedPair();
    expect(parseTopology({ devices: [{ ...a, vendor: 'Unknown' }], cables: [] }).ok).toBe(false);
    expect(parseTopology({ devices: [{ ...a, position: { x: 'left', y: 0 } }], cables: [] }).ok).toBe(false);
  });

  it('drops unknown fields and prototype-related names from parsed text', () => {
    const { a } = linkedPair();
    const text = JSON.stringify({ devices: [a], cables: [] }).replace(
      '"hostname"',
      '"__proto__":{"polluted":true},"surprise":{"x":1},"hostname"',
    );
    const parsed: unknown = JSON.parse(text);
    const result = parseTopology(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const device = result.value.devices[0];
      expect(Object.prototype.hasOwnProperty.call(device, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(device, 'surprise')).toBe(false);
      expect(result.value.warnings).toContainEqual({ code: 'dropped-field', path: 'devices[0].surprise' });
    }
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });

  it('keeps only the most recent console lines', () => {
    const { a } = linkedPair();
    const lines = Array.from({ length: TOPOLOGY_LIMITS.maxConsoleLines + 5 }, (_, index) => `line ${index}`);
    const result = parseTopology({ devices: [{ ...a, consoleLogs: lines }], cables: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const logs = result.value.devices[0].consoleLogs;
      expect(logs).toHaveLength(TOPOLOGY_LIMITS.maxConsoleLines);
      expect(logs[logs.length - 1]).toBe(lines[lines.length - 1]);
    }
  });

  it('accepts the topology of every built-in lab', () => {
    const failures: string[] = [];
    for (const lab of ALL_LABS) {
      const topology = buildLabTopology(lab);
      const result = parseTopology({ devices: topology.devices, cables: topology.cables });
      if (!result.ok) failures.push(`${lab.id}: ${result.error.code} at ${result.error.path}`);
    }
    expect(failures).toEqual([]);
  });
});
