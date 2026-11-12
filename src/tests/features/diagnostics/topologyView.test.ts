import { describe, expect, it } from 'vitest';
import { cleanLabel, DIAGNOSTICS_LIMITS, toTopologyView } from '../../../features/diagnostics/domain/topologyView';
import { cable, device, port } from './fixtures';

describe('toTopologyView', () => {
  it('returns an empty view for input that is not a list', () => {
    expect(toTopologyView('devices', { length: 3 })).toEqual({
      devices: [],
      cables: [],
      truncated: false,
      skipped: 0,
    });
    expect(toTopologyView(null, undefined).devices).toEqual([]);
  });

  it('skips malformed entries and duplicate ids, and counts them', () => {
    const devices: unknown[] = [
      null,
      42,
      { hostname: 'no-id' },
      { ...device('d1', 'SW1', []), ports: [port('p1', 'GE0/0/1'), 'not-a-port', { name: 'no-id' }] },
      device('d1', 'SW1-duplicate', []),
    ];
    const cables: unknown[] = [
      { id: 'c1' },
      cable('c2', ['d1', 'p1'], ['d1', 'p1']),
      cable('c2', ['d1', 'p1'], ['d1', 'p1']),
    ];
    const view = toTopologyView(devices, cables);
    expect(view.devices.map((d) => d.hostname)).toEqual(['SW1']);
    expect(view.devices[0].ports.map((p) => p.id)).toEqual(['p1']);
    expect(view.cables.map((c) => c.id)).toEqual(['c2']);
    expect(view.skipped).toBe(8);
    expect(view.truncated).toBe(false);
  });

  it('ignores inherited properties', () => {
    const inherited: unknown = Object.create({ id: 'ghost', hostname: 'ghost', ports: [] });
    const view = toTopologyView([inherited], []);
    expect(view.devices).toHaveLength(0);
    expect(view.skipped).toBe(1);
  });

  it('does not pollute prototypes when given hostile JSON', () => {
    const hostile: unknown = JSON.parse(
      '[{"__proto__":{"id":"x","polluted":true},"constructor":{"prototype":{"polluted":true}}}]',
    );
    const view = toTopologyView(hostile, []);
    expect(view.devices).toHaveLength(0);
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });

  it('clamps oversized collections and flags truncation', () => {
    const limits = { ...DIAGNOSTICS_LIMITS, maxDevices: 2, maxPortsPerDevice: 1, maxCables: 1 };
    const devices = [
      device('d1', 'A', [port('p1', 'x'), port('p2', 'y')]),
      device('d2', 'B', []),
      device('d3', 'C', []),
    ];
    const cables = [cable('c1', ['d1', 'p1'], ['d2', 'p1']), cable('c2', ['d1', 'p1'], ['d2', 'p1'])];
    const view = toTopologyView(devices, cables, limits);
    expect(view.devices).toHaveLength(2);
    expect(view.devices[0].ports).toHaveLength(1);
    expect(view.cables).toHaveLength(1);
    expect(view.truncated).toBe(true);
  });

  it('strips control and direction-override characters and clamps names', () => {
    const noisy = device('d1', 'R1\u001b[31m\nfake', [port('p1', 'x'.repeat(500))]);
    const view = toTopologyView([noisy], []);
    expect(view.devices[0].hostname).toBe('R1[31mfake');
    expect(view.devices[0].ports[0].name).toHaveLength(DIAGNOSTICS_LIMITS.maxLabelLength);
    expect(cleanLabel('SW\u202egnp\u200b.exe', 'unnamed', 64)).toBe('SWgnp.exe');
    expect(cleanLabel('\u0007\u0008', 'unnamed', 64)).toBe('unnamed');
    expect(cleanLabel(42, 'unnamed', 64)).toBe('unnamed');
  });

  it('rejects invalid addresses, prefixes, VLANs, modes and oversized ids', () => {
    const odd = {
      ...port('p1', 'GE0/0/1'),
      config: { enabled: true, mode: 'weird', vlan: 5000, ipAddress: '999.1.1.1', subnetMask: 40 },
    };
    const badPrefix = {
      ...port('p2', 'GE0/0/2'),
      config: { enabled: true, mode: 'routed', ipAddress: '192.0.2.1', subnetMask: 40 },
    };
    const unspecified = port('p3', 'GE0/0/3', { ip: '0.0.0.0', prefix: 0 });
    const view = toTopologyView(
      [
        { ...device('d1', 'SW1', []), ports: [odd, badPrefix, unspecified] },
        device('x'.repeat(1000), 'huge-id', []),
        device('bad\nid', 'control-id', []),
      ],
      [],
    );
    expect(view.devices).toHaveLength(1);
    const [first, second, third] = view.devices[0].ports;
    expect(first).toMatchObject({ address: null, prefixLength: null, vlan: null, mode: null });
    expect(second).toMatchObject({ address: '192.0.2.1', prefixLength: null, mode: 'routed' });
    expect(third).toMatchObject({ address: null, prefixLength: null });
    expect(view.devices[0].addresses.map((a) => a.address)).toEqual(['192.0.2.1']);
    expect(view.skipped).toBe(2);
  });

  it('accepts a prefix length or a dotted mask', () => {
    const dotted = {
      ...port('p1', 'GE0/0/1'),
      config: { enabled: true, mode: 'routed', ipAddress: '198.51.100.9', subnetMask: '255.255.255.192' },
    };
    const broken = {
      ...port('p2', 'GE0/0/2'),
      config: { enabled: true, mode: 'routed', ipAddress: '198.51.100.10', subnetMask: '255.0.255.0' },
    };
    const view = toTopologyView([{ ...device('d1', 'R1', []), ports: [dotted, broken] }], []);
    expect(view.devices[0].ports.map((p) => p.prefixLength)).toEqual([26, null]);
  });

  it('collects addresses from ports and VLAN interfaces', () => {
    const raw = {
      ...device('d1', 'SW1', [port('p1', 'GE0/0/1', { ip: '192.0.2.1', prefix: 24 })]),
      vlanifs: [{ id: 'v10', vlanId: 10, enabled: true, ipAddress: '198.51.100.1', subnetMask: 24 }, 'junk'],
    };
    const view = toTopologyView([raw], []);
    expect(view.devices[0].addresses).toEqual([
      { label: 'GE0/0/1', portId: 'p1', address: '192.0.2.1' },
      { label: 'Vlanif10', portId: null, address: '198.51.100.1' },
    ]);
    expect(view.skipped).toBe(1);
  });
});
