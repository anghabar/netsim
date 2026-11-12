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
import { findQuickTopology, QUICK_TOPOLOGIES } from '../../../features/quick-topologies/domain/catalog';
import {
  QUICK_TOPOLOGY_LIMITS,
  validateQuickTopology,
} from '../../../features/quick-topologies/domain/definitionGuard';
import { deviceFactory } from '../../../store/slices/createTopologySlice';
import { sameSubnet } from '../../../utils/ipv4';
import { parseTopology } from '../../../utils/topology/topologyGuards';

function realFactoryDeps(): QuickTopologyBuildDeps {
  let counter = 0;
  const ids = (): string => {
    counter += 1;
    return `t-${counter}`;
  };
  return { ids, createDevice: (model, position) => deviceFactory(model, position, { ids, random: () => 0.5 }) };
}

const DOCUMENTATION_NETWORKS = ['192.0.2.0', '198.51.100.0', '203.0.113.0'];
const isDocumentationAddress = (ip: string): boolean =>
  DOCUMENTATION_NETWORKS.some((network) => sameSubnet(ip, network, 24));

describe('quick topology catalog', () => {
  it('has unique ids and titles and stays small', () => {
    const ids = QUICK_TOPOLOGIES.map((definition) => definition.id);
    const titles = QUICK_TOPOLOGIES.map((definition) => definition.title);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(titles).size).toBe(titles.length);
    expect(ids.length).toBeGreaterThan(0);
    for (const definition of QUICK_TOPOLOGIES) {
      expect(definition.nodes.length).toBeLessThanOrEqual(QUICK_TOPOLOGY_LIMITS.maxNodes);
      expect(definition.links.length).toBeLessThanOrEqual(QUICK_TOPOLOGY_LIMITS.maxLinks);
    }
  });

  it('is frozen so that it cannot be altered at run time', () => {
    expect(Object.isFrozen(QUICK_TOPOLOGIES)).toBe(true);
    for (const definition of QUICK_TOPOLOGIES) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.nodes)).toBe(true);
      expect(Object.isFrozen(definition.nodes[0])).toBe(true);
      expect(Object.isFrozen(definition.links)).toBe(true);
    }
  });

  it('passes the definition guard', () => {
    for (const definition of QUICK_TOPOLOGIES) {
      expect(validateQuickTopology(definition)).toEqual({ ok: true, value: undefined });
    }
  });

  it('uses documentation addresses only', () => {
    for (const definition of QUICK_TOPOLOGIES) {
      for (const node of definition.nodes) {
        if (node.address === undefined) continue;
        expect(isDocumentationAddress(node.address.ip)).toBe(true);
        if (node.address.gateway !== undefined) expect(isDocumentationAddress(node.address.gateway)).toBe(true);
      }
    }
  });

  it('builds every entry with the real device factory into a topology the core accepts', () => {
    const failures: string[] = [];
    for (const definition of QUICK_TOPOLOGIES) {
      const built = buildQuickTopology(definition, realFactoryDeps());
      if (!built.ok) {
        failures.push(`${definition.id}: ${built.error.code} ${built.error.detail}`);
        continue;
      }
      expect(built.value.devices).toHaveLength(definition.nodes.length);
      expect(built.value.cables).toHaveLength(definition.links.length);
      const parsed = parseTopology({ devices: built.value.devices, cables: built.value.cables });
      if (!parsed.ok) {
        failures.push(`${definition.id}: ${parsed.error.code} at ${parsed.error.path}`);
        continue;
      }
      expect(parsed.value.warnings).toEqual([]);
    }
    expect(failures).toEqual([]);
  });
});

describe('findQuickTopology', () => {
  it('returns built-in entries by id', () => {
    expect(findQuickTopology('routed-campus')?.title).toBe('Routed campus');
  });

  it('returns undefined for anything that is not a built-in id', () => {
    for (const id of ['', 'nope', '__proto__', 'constructor', 'toString', 'x'.repeat(500)]) {
      expect(findQuickTopology(id)).toBeUndefined();
    }
  });
});
