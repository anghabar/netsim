import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => null,
  wasmPing: () => '',
}));

import {
  buildQuickTopology,
  type QuickTopologyBuildDeps,
} from '../../../features/quick-topologies/domain/buildQuickTopology';
import { QUICK_TOPOLOGIES } from '../../../features/quick-topologies/domain/catalog';
import type {
  QuickTopologyDefinition,
  QuickTopologyNode,
} from '../../../features/quick-topologies/domain/types';
import { deviceFactory } from '../../../store/slices/createTopologySlice';
import type { NetworkDevice, SwitchModel } from '../../../types/NetworkTypes';
import { parseTopology } from '../../../utils/topology/topologyGuards';

function makeDeps(): QuickTopologyBuildDeps & { created: NetworkDevice[] } {
  let counter = 0;
  const created: NetworkDevice[] = [];
  const ids = (): string => {
    counter += 1;
    return `t-${counter}`;
  };
  return {
    ids,
    created,
    createDevice: (model, position) => {
      const device = deviceFactory(model, position, { ids, random: () => 0.5 });
      created.push(device);
      return device;
    },
  };
}

const node = (ref: string, model: SwitchModel, x = 100): QuickTopologyNode => ({
  ref,
  model,
  hostname: ref,
  position: { x, y: 100 },
});

const tiny = (patch: Partial<QuickTopologyDefinition> = {}): QuickTopologyDefinition => ({
  id: 'tiny',
  title: 'Tiny',
  summary: 'A switch with two PCs.',
  nodes: [
    node('SW1', 'Huawei-S5700-28TP'),
    { ...node('PC1', 'PC', 200), address: { ip: '192.0.2.10', prefix: 24, gateway: '192.0.2.1' } },
    { ...node('PC2', 'PC', 300), address: { ip: '192.0.2.11', prefix: 24 } },
  ],
  links: [
    { from: 'SW1', to: 'PC1' },
    { from: 'SW1', to: 'PC2' },
  ],
  ...patch,
});

describe('buildQuickTopology', () => {
  it('wires each link to the first free copper port on both sides, in link order', () => {
    const result = buildQuickTopology(tiny(), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [sw, pc1, pc2] = result.value.devices;
    expect(result.value.cables.map((cable) => [cable.type, cable.sourcePortId, cable.targetPortId])).toEqual([
      ['copper', sw.ports[0].id, pc1.ports[0].id],
      ['copper', sw.ports[1].id, pc2.ports[0].id],
    ]);
    expect(result.value.cables[0].sourceDeviceId).toBe(sw.id);
    expect(result.value.cables[0].targetDeviceId).toBe(pc1.id);
    expect(result.value.cables[0].id.startsWith('cable-')).toBe(true);
    expect(new Set(result.value.cables.map((cable) => cable.id)).size).toBe(2);
  });

  it('applies hostname, position, address and gateway', () => {
    const result = buildQuickTopology(tiny(), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [sw, pc1, pc2] = result.value.devices;
    expect(sw.hostname).toBe('SW1');
    expect(pc1.hostname).toBe('PC1');
    expect(pc1.position).toEqual({ x: 200, y: 100 });
    expect(pc1.ports[0].config).toMatchObject({ ipAddress: '192.0.2.10', subnetMask: 24 });
    expect(pc1.defaultGateway).toBe('192.0.2.1');
    expect(pc2.ports[0].config.ipAddress).toBe('192.0.2.11');
    expect(Object.prototype.hasOwnProperty.call(pc2, 'defaultGateway')).toBe(false);
    expect(sw.ports[0].config.ipAddress).toBeUndefined();
  });

  it('returns unlinked devices and never mutates what the factory returned', () => {
    const deps = makeDeps();
    const result = buildQuickTopology(tiny(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const device of result.value.devices) {
      for (const port of device.ports) {
        expect(port.status).toBe('down');
        expect(port.connectedCableId).toBeNull();
      }
    }
    const factoryPc = deps.created[1];
    expect(result.value.devices[1]).not.toBe(factoryPc);
    expect(factoryPc.hostname).not.toBe('PC1');
    expect(factoryPc.ports[0].config.ipAddress).toBeUndefined();
    expect(factoryPc.defaultGateway).toBeUndefined();
  });

  it('is deterministic for deterministic dependencies', () => {
    for (const definition of QUICK_TOPOLOGIES) {
      expect(buildQuickTopology(definition, makeDeps())).toEqual(buildQuickTopology(definition, makeDeps()));
    }
  });

  it('fails when a device runs out of compatible ports', () => {
    const doubled = tiny({
      links: [
        { from: 'SW1', to: 'PC1' },
        { from: 'SW1', to: 'PC1' },
      ],
    });
    expect(buildQuickTopology(doubled, makeDeps())).toMatchObject({ ok: false, error: { code: 'no-free-port' } });
  });

  it('matches cable media to port type', () => {
    const fiber = tiny({
      nodes: [node('SW1', 'Huawei-S5700-52X-LI'), node('SW2', 'Huawei-S5700-52X-LI', 300)],
      links: [{ from: 'SW1', to: 'SW2', media: 'fiber' }],
    });
    const built = buildQuickTopology(fiber, makeDeps());
    expect(built.ok).toBe(true);
    if (built.ok) {
      const [first, second] = built.value.devices;
      const cable = built.value.cables[0];
      expect(cable.type).toBe('fiber');
      expect(first.ports.find((port) => port.id === cable.sourcePortId)?.name).toBe('XGE0/0/1');
      expect(second.ports.find((port) => port.id === cable.targetPortId)?.type).toBe('SFP');
      expect(parseTopology({ devices: built.value.devices, cables: built.value.cables }).ok).toBe(true);
    }

    const copperToFiberOnly = tiny({
      nodes: [node('SW1', 'Aruba-CX-6300'), node('PC1', 'PC', 300)],
      links: [{ from: 'SW1', to: 'PC1' }],
    });
    expect(buildQuickTopology(copperToFiberOnly, makeDeps())).toMatchObject({
      ok: false,
      error: { code: 'no-free-port' },
    });
  });

  it('skips administratively disabled ports', () => {
    const deps = makeDeps();
    const definition = tiny({
      nodes: [node('SW1', 'Huawei-S5700-28TP'), node('SW2', 'Huawei-S5700-28TP', 300)],
      links: [{ from: 'SW1', to: 'SW2' }],
    });
    const result = buildQuickTopology(definition, {
      ids: deps.ids,
      createDevice: (model, position) => {
        const device = deps.createDevice(model, position);
        device.ports[0].config.enabled = false;
        return device;
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first, second] = result.value.devices;
    expect(result.value.cables[0].sourcePortId).toBe(first.ports[1].id);
    expect(result.value.cables[0].targetPortId).toBe(second.ports[1].id);
  });

  it('rejects an invalid definition before creating any device', () => {
    const deps = makeDeps();
    const result = buildQuickTopology(tiny({ links: [{ from: 'SW1', to: 'SW1' }] }), deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-definition' } });
    expect(deps.created).toHaveLength(0);
  });

  it('rejects a factory that repeats device ids', () => {
    const result = buildQuickTopology(tiny(), {
      ids: () => 'same',
      createDevice: (model, position) => deviceFactory(model, position, { ids: () => 'same', random: () => 0.5 }),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-device' } });
  });
});
