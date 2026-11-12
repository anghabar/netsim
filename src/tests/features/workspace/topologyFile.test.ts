import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => null,
  wasmPing: () => '',
}));

import {
  buildTopologyFile,
  readTopologyFile,
  topologyFileName,
  TOPOLOGY_FILE_FORMAT,
} from '../../../features/workspace/domain/topologyFile';
import { WORKSPACE_LIMITS, type TopologyData } from '../../../features/workspace/domain/workspaceModel';
import { isRecord } from '../../../utils/guards';
import { FIXED_NOW, pairTopology, sequentialIds } from './fixtures';

const PW = 'example-only';
const clock = () => FIXED_NOW;

function exportText(topology: TopologyData, includeSensitive = false): string {
  const built = buildTopologyFile({ name: 'Shared pair', topology, includeSensitive }, clock);
  if (!built.ok) throw new Error(`fixture failed: ${built.error}`);
  return built.value.text;
}

function exportDoc(topology: TopologyData): Record<string, unknown> {
  const doc: unknown = JSON.parse(exportText(topology));
  if (!isRecord(doc)) throw new Error('fixture failed: not an object');
  return doc;
}

describe('buildTopologyFile', () => {
  it('writes the documented envelope with a date from the injected clock', () => {
    const doc = exportDoc(pairTopology().topology);
    expect(Object.keys(doc)).toEqual(['format', 'version', 'name', 'createdAt', 'topology']);
    expect(doc).toMatchObject({
      format: TOPOLOGY_FILE_FORMAT,
      version: 1,
      name: 'Shared pair',
      createdAt: new Date(FIXED_NOW).toISOString(),
    });
  });

  it('leaves out console output and CLI session state', () => {
    const { a, topology } = pairTopology();
    a.consoleLogs = ['private console line'];
    a.cliState = { view: 'system-view' };
    const text = exportText(topology);
    expect(text).not.toContain('private console line');
    expect(text).not.toContain('system-view');
  });

  it('leaves secrets out by default and reports them without their values', () => {
    const { a, topology } = pairTopology();
    a.bgpConfig = {
      asNumber: 65001,
      enabled: true,
      networks: [],
      neighbors: [{ ip: '192.0.2.2', remoteAs: 65002, state: 'Idle', password: PW }],
    };
    const redacted = buildTopologyFile({ name: 'Pair', topology, includeSensitive: false }, clock);
    expect(redacted.ok).toBe(true);
    if (!redacted.ok) return;
    expect(redacted.value.text).not.toContain(PW);
    expect(redacted.value.text).toContain('192.0.2.2');
    expect(redacted.value.sensitiveCount).toBe(1);
    expect(redacted.value.sensitiveIncluded).toBe(false);
    expect(redacted.value.sensitiveFields).toEqual([`${a.hostname}: bgpConfig.neighbors[0].password`]);

    const full = buildTopologyFile({ name: 'Pair', topology, includeSensitive: true }, clock);
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.value.text).toContain(PW);
    expect(full.value.sensitiveIncluded).toBe(true);
    expect(full.value.sensitiveCount).toBe(1);
  });

  it('refuses empty and invalid topologies', () => {
    const { a, cable } = pairTopology();
    expect(buildTopologyFile({ name: 'x', topology: { devices: [], cables: [] }, includeSensitive: false }, clock)).toEqual({
      ok: false,
      error: 'empty-topology',
    });
    expect(
      buildTopologyFile({ name: 'x', topology: { devices: [a], cables: [cable] }, includeSensitive: false }, clock),
    ).toEqual({ ok: false, error: 'invalid-topology' });
  });

  it('derives a safe download name', () => {
    expect(topologyFileName('../../Etc Passwd!')).toBe('etc-passwd.netsim.json');
    expect(topologyFileName('Café Núcleo')).toBe('cafe-nucleo.netsim.json');
    expect(topologyFileName('***')).toBe('topology.netsim.json');
    expect(topologyFileName('CON')).toBe('topology-con.netsim.json');
    expect(topologyFileName('x'.repeat(300))).toBe(`${'x'.repeat(48)}.netsim.json`);
  });
});

describe('readTopologyFile', () => {
  it('round-trips a file with regenerated ids and consistent references', () => {
    const { a, b, cable, topology } = pairTopology();
    a.aclRules = [
      { id: 'acl-1', action: 'permit', protocol: 'ip', source: 'any', destination: 'any', interfaceId: a.ports[1].id },
    ];
    const imported = readTopologyFile(exportText(topology), { ids: sequentialIds('new') });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const { devices, cables } = imported.value.topology;
    expect(imported.value.name).toBe('Shared pair');
    expect(devices.map((device) => device.hostname)).toEqual([a.hostname, b.hostname]);

    const text = JSON.stringify(imported.value.topology);
    for (const oldId of [a.id, b.id, cable.id, a.ports[0].id, b.ports[0].id]) expect(text).not.toContain(oldId);
    expect(devices[0].id.startsWith('new-')).toBe(true);

    expect(cables).toHaveLength(1);
    expect(cables[0].sourceDeviceId).toBe(devices[0].id);
    expect(cables[0].sourcePortId).toBe(devices[0].ports[0].id);
    expect(cables[0].targetPortId).toBe(devices[1].ports[0].id);
    expect(devices[0].ports[0].connectedCableId).toBe(cables[0].id);
    expect(devices[0].aclRules?.[0]?.interfaceId).toBe(devices[0].ports[1].id);
    expect(devices[0].consoleLogs).toEqual([]);
    expect(devices[0].cliState).toEqual({ view: 'user-view' });
  });

  it('ignores identifiers and dates found in the file and cleans the name', () => {
    const doc = exportDoc(pairTopology().topology);
    doc.id = 'foreign-id';
    doc.createdAt = '1999-01-01T00:00:00.000Z';
    doc.name = '  Shared\u202e lab \n';
    const imported = readTopologyFile(JSON.stringify(doc), { ids: sequentialIds('new') });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.name).toBe('Shared lab');
    expect(Object.keys(imported.value).sort()).toEqual(['ignoredFields', 'name', 'topology', 'unknownModels']);
  });

  it('counts fields it does not know', () => {
    const text = exportText(pairTopology().topology).replace('"hostname"', '"surprise":{"x":1},"hostname"');
    const imported = readTopologyFile(text, { ids: sequentialIds('new') });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.ignoredFields).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(imported.value.topology.devices[0], 'surprise')).toBe(false);
  });

  it.each([
    [' '.repeat(WORKSPACE_LIMITS.maxFileBytes + 1), 'too-large'],
    ['{not json', 'invalid-json'],
    ['[]', 'unsupported-format'],
    [JSON.stringify({ format: 'other', version: 1, topology: {} }), 'unsupported-format'],
    [JSON.stringify({ format: TOPOLOGY_FILE_FORMAT, version: 2, topology: {} }), 'unsupported-format'],
    [JSON.stringify({ format: TOPOLOGY_FILE_FORMAT, version: 1 }), 'invalid-topology'],
    [JSON.stringify({ format: TOPOLOGY_FILE_FORMAT, version: 1, topology: { devices: [], cables: [] } }), 'empty-topology'],
    [
      JSON.stringify({ format: TOPOLOGY_FILE_FORMAT, version: 1, topology: { devices: [{ id: 'x' }], cables: [] } }),
      'invalid-topology',
    ],
  ])('rejects bad input (%#)', (text, code) => {
    expect(readTopologyFile(text, { ids: sequentialIds('new') })).toEqual({ ok: false, error: code });
  });

  it('rejects a cable that points to a missing device', () => {
    const { a, cable, topology } = pairTopology();
    const doc = exportDoc(topology);
    doc.topology = { devices: [a], cables: [cable] };
    expect(readTopologyFile(JSON.stringify(doc), { ids: sequentialIds('new') })).toEqual({
      ok: false,
      error: 'invalid-topology',
    });
  });

  it('never copies prototype-related names from the file', () => {
    const text = exportText(pairTopology().topology)
      .replace('"format"', '"__proto__":{"polluted":true},"format"')
      .replace('"hostname"', '"__proto__":{"polluted":true},"hostname"');
    const imported = readTopologyFile(text, { ids: sequentialIds('new') });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(Object.prototype.hasOwnProperty.call(imported.value.topology.devices[0], '__proto__')).toBe(false);
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });
});
