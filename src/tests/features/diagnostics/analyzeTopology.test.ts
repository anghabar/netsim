import { describe, expect, it } from 'vitest';
import {
  diagnoseTopology,
  MAX_FINDINGS,
  sameReport,
} from '../../../features/diagnostics/domain/analyzeTopology';
import { formatReportLines } from '../../../features/diagnostics/domain/formatReport';
import type { DiagnosticsReport } from '../../../features/diagnostics/domain/types';
import type { NetworkDevice } from '../../../types/NetworkTypes';
import { cable, device, hasControlCharacters, port, type PortOptions } from './fixtures';

const PW = 'example-only';

/** Two devices joined by one cable, with configurable port settings on each end. */
function link(a: PortOptions, b: PortOptions, extraA: Partial<NetworkDevice> = {}): DiagnosticsReport {
  const devices = [
    device('d1', 'A', [port('a1', 'GE0/0/1', a)], extraA),
    device('d2', 'B', [port('b1', 'GE0/0/1', b)]),
  ];
  return diagnoseTopology(devices, [cable('c1', ['d1', 'a1'], ['d2', 'b1'])]);
}

const codes = (report: DiagnosticsReport): string[] => report.findings.map((finding) => finding.code);

const danglingCables = (count: number) =>
  Array.from({ length: count }, (_, index) => cable(`c${index}`, ['missing', 'x'], ['missing', 'y']));

describe('diagnoseTopology', () => {
  it('returns a clean report for a consistent trunk', () => {
    expect(link({ mode: 'trunk' }, { mode: 'trunk' })).toEqual({
      deviceCount: 2,
      cableCount: 1,
      truncated: false,
      skipped: 0,
      findings: [],
    });
  });

  it('never throws on corrupt input', () => {
    expect(diagnoseTopology('corrupted', null)).toEqual({
      deviceCount: 0,
      cableCount: 0,
      truncated: false,
      skipped: 0,
      findings: [],
    });
  });

  it('flags duplicate addresses across ports and VLAN interfaces', () => {
    const devices = [
      device('r1', 'R1', [port('p1', 'GE0/0/0', { mode: 'routed', ip: '192.0.2.1', prefix: 24 })]),
      device('s1', 'SW1', [], {
        vlanifs: [{ id: 'v10', vlanId: 10, enabled: true, ipAddress: '192.0.2.1', subnetMask: 24 }],
      }),
    ];
    const report = diagnoseTopology(devices, []);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      id: 'duplicate-ip:192.0.2.1',
      severity: 'critical',
      deviceIds: ['r1', 's1'],
      portIds: ['p1'],
    });
    expect(report.findings[0].detail).toContain('SW1:Vlanif10');
  });

  it('reports every administratively disabled end of a cabled link', () => {
    const report = link({ enabled: false }, { enabled: false });
    expect(report.findings.map((f) => f.id)).toEqual(['admin-down-link:c1:a1', 'admin-down-link:c1:b1']);
  });

  it('does not flag a routed port facing an access port', () => {
    expect(codes(link({ mode: 'routed' }, { mode: 'access' }))).toEqual([]);
  });

  it('flags an access port connected to a trunk port', () => {
    expect(codes(link({ mode: 'access' }, { mode: 'trunk' }))).toEqual(['port-mode-mismatch']);
  });

  it('flags a native VLAN mismatch as warning and an access VLAN mismatch as info', () => {
    const trunk = link({ mode: 'trunk', vlan: 1 }, { mode: 'trunk', vlan: 99 });
    expect(trunk.findings[0]).toMatchObject({ code: 'native-vlan-mismatch', severity: 'warning' });
    const access = link({ vlan: 10 }, { vlan: 20 });
    expect(access.findings[0]).toMatchObject({ code: 'access-vlan-mismatch', severity: 'info' });
  });

  it('skips layer 2 checks when one end is a host', () => {
    const report = link({ vlan: 10 }, { vlan: 20 }, { type: 'PC', vendor: 'PC', model: 'PC' });
    expect(codes(report)).toEqual([]);
  });

  it('flags different subnets as critical, also when only one side is off-link', () => {
    const apart = link({ ip: '192.0.2.1', prefix: 24 }, { ip: '198.51.100.1', prefix: 24 });
    expect(apart.findings[0]).toMatchObject({ code: 'subnet-mismatch', severity: 'critical' });
    const oneWay = link({ ip: '192.0.2.1', prefix: 24 }, { ip: '192.0.2.200', prefix: 25 });
    expect(codes(oneWay)).toEqual(['subnet-mismatch']);
  });

  it('flags a prefix length mismatch as warning when both ends still see each other', () => {
    const report = link({ ip: '192.0.2.1', prefix: 24 }, { ip: '192.0.2.2', prefix: 25 });
    expect(report.findings[0]).toMatchObject({ code: 'prefix-length-mismatch', severity: 'warning' });
  });

  it('reports cables whose endpoints do not exist', () => {
    const devices = [device('d1', 'A', [port('a1', 'GE0/0/1')])];
    const report = diagnoseTopology(devices, [cable('c1', ['d1', 'a1'], ['gone', 'x'])]);
    expect(report.findings[0]).toMatchObject({ id: 'dangling-cable:c1', deviceIds: ['d1'] });
  });

  it('orders by severity, is deterministic, ignores list order and does not mutate its input', () => {
    const devices = [
      device('d1', 'A', [
        port('a1', 'GE0/0/1', { vlan: 10 }),
        port('a2', 'GE0/0/2', { mode: 'routed', ip: '192.0.2.1', prefix: 24, enabled: false }),
      ]),
      device('d2', 'B', [
        port('b1', 'GE0/0/1', { vlan: 20 }),
        port('b2', 'GE0/0/2', { mode: 'routed', ip: '192.0.2.1', prefix: 24 }),
      ]),
    ];
    const cables = [cable('c1', ['d1', 'a1'], ['d2', 'b1']), cable('c2', ['d1', 'a2'], ['d2', 'b2'])];
    const before = JSON.stringify({ devices, cables });

    const first = diagnoseTopology(devices, cables);
    const second = diagnoseTopology(devices, cables);
    const reordered = diagnoseTopology([...devices].reverse(), [...cables].reverse());

    expect(second).toEqual(first);
    expect(reordered).toEqual(first);
    expect(sameReport(first, reordered)).toBe(true);
    expect(first.findings.map((f) => f.severity)).toEqual(['critical', 'warning', 'info']);
    expect(first.findings.map((f) => f.id)).toEqual([
      'duplicate-ip:192.0.2.1',
      'admin-down-link:c2:a2',
      'access-vlan-mismatch:c1',
    ]);
    expect(JSON.stringify({ devices, cables })).toBe(before);
  });

  it('caps the number of findings and marks the report as partial', () => {
    const report = diagnoseTopology([], danglingCables(MAX_FINDINGS + 50));
    expect(report.findings).toHaveLength(MAX_FINDINGS);
    expect(report.truncated).toBe(true);
  });

  it('never carries device configuration outside the reported fields', () => {
    const devices = [
      device('r1', 'R1', [port('p1', 'GE0/0/0', { mode: 'routed', ip: '203.0.113.1', prefix: 24 })], {
        bgpConfig: {
          asNumber: 64512,
          enabled: true,
          networks: [],
          neighbors: [{ ip: '203.0.113.2', remoteAs: 64513, state: 'Idle', password: PW }],
        },
      }),
      device('r2', 'R2', [port('p2', 'GE0/0/0', { mode: 'routed', ip: '203.0.113.1', prefix: 24 })]),
    ];
    const report = diagnoseTopology(devices, [cable('c1', ['r1', 'p1'], ['r2', 'p2'])]);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain(PW);
    expect(formatReportLines(report).join('\n')).not.toContain(PW);
  });
});

describe('sameReport', () => {
  it('compares by content and handles null', () => {
    const a = link({ enabled: false }, {});
    const b = link({ enabled: false }, {});
    expect(a).not.toBe(b);
    expect(sameReport(a, b)).toBe(true);
    expect(sameReport(a, link({}, {}))).toBe(false);
    expect(sameReport(null, null)).toBe(true);
    expect(sameReport(a, null)).toBe(false);
  });
});

describe('formatReportLines', () => {
  it('prints a summary and a clean result', () => {
    const lines = formatReportLines(link({}, {}));
    expect(lines).toEqual([
      'Topology diagnosis: 2 device(s), 1 link(s), 0 finding(s) [critical 0, warning 0, info 0]',
      'No consistency issues found.',
    ]);
  });

  it('prints three single lines per finding and notes about partial input', () => {
    const report = diagnoseTopology([null, device('d1', 'A\r\nB', [])], [cable('c1', ['d1', 'x'], ['gone', 'y'])]);
    const lines = formatReportLines(report);
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe('Note: 1 malformed or duplicate entries were ignored.');
    expect(lines[2]).toBe('[WARNING][L1] Cable with a missing endpoint');
    expect(lines.some(hasControlCharacters)).toBe(false);
  });

  it('limits the printed findings and says how many were left out', () => {
    const report = diagnoseTopology([], danglingCables(20));
    const lines = formatReportLines(report, { maxFindings: 15 });
    expect(lines).toHaveLength(1 + 15 * 3 + 1);
    expect(lines[0]).toContain('20 finding(s)');
    expect(lines[lines.length - 1]).toContain('5 more finding(s)');
  });
});
