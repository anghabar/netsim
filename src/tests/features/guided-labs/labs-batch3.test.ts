import { describe, expect, it } from 'vitest';
import { evaluateLab } from '../../../features/guided-labs/domain/criteria';
import { parseGuidedLab } from '../../../features/guided-labs/domain/guards';
import { buildLab, readLab, readLabText, solve, typeCommands } from './fixtures';

const failedTasks = (result: ReturnType<typeof evaluateLab>): string[] =>
  result.tasks.filter((t) => !t.pass).map((t) => t.taskId);

describe('lab 9: OSPF with two areas', () => {
  const lab = readLab('ospf-two-areas');

  it('is unsolved at the start', () => {
    const built = buildLab(lab);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([
      'start-ospf',
      'backbone',
      'second-area',
      'routes-across-areas',
      'end-to-end',
    ]);
  });

  it('passes with area 0 and area 1 joined by R2, and OSPF routes carry pings', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([]);
  });

  it('fails the adjacency when the two ends of a link use different areas', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', ['system-view', 'ospf 1 router-id 1.1.1.1', 'ospf 1 area 0 network 198.51.100.0 0.0.0.3', 'ospf 1 area 0 network 192.0.2.0 0.0.0.127']);
    await typeCommands(built, 'R2', ['system-view', 'ospf 1 router-id 2.2.2.2', 'ospf 1 area 0 network 198.51.100.0 0.0.0.3', 'ospf 1 area 1 network 198.51.100.4 0.0.0.3']);
    await typeCommands(built, 'R3', ['system-view', 'ospf 1 router-id 3.3.3.3', 'ospf 1 area 0 network 198.51.100.4 0.0.0.3', 'ospf 1 area 0 network 203.0.113.0 0.0.0.127']);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['second-area', 'routes-across-areas', 'end-to-end']);
  });

  it('does not exchange routes between two areas that do not touch area 0', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', ['system-view', 'ospf 1 router-id 1.1.1.1', 'ospf 1 area 2 network 198.51.100.0 0.0.0.3', 'ospf 1 area 2 network 192.0.2.0 0.0.0.127']);
    await typeCommands(built, 'R2', ['system-view', 'ospf 1 router-id 2.2.2.2', 'ospf 1 area 2 network 198.51.100.0 0.0.0.3', 'ospf 1 area 1 network 198.51.100.4 0.0.0.3']);
    await typeCommands(built, 'R3', ['system-view', 'ospf 1 router-id 3.3.3.3', 'ospf 1 area 1 network 198.51.100.4 0.0.0.3', 'ospf 1 area 1 network 203.0.113.0 0.0.0.127']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['routes-across-areas', 'end-to-end']);
  });

  it('fails the ping when R3 does not advertise its LAN', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    const r3 = built.devices.find((d) => d.hostname === 'R3');
    if (!r3) throw new Error('no R3');
    r3.ospfLsdb = (r3.ospfLsdb ?? []).filter((e) => e.network !== '203.0.113.0');
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['routes-across-areas', 'end-to-end']);
  });
});

describe('ospf routes in ip-reachable (single area lab)', () => {
  it('lets a router ping across two hops on OSPF-learned routes only', async () => {
    const lab = readLab('ospf-single-area');
    const built = buildLab(lab);
    await solve(built, lab.id);
    const reach = evaluateLab(
      { ...lab, tasks: [{ id: 't', title: 't', description: 't', hints: [], criteria: [
        { type: 'ip-reachable', from: 'R1', address: '203.0.113.129', expected: true, label: 'x' },
      ] }] },
      built.devices,
      built.cables,
    );
    expect(reach.pass).toBe(true);
  });
});

describe('lab 10: default route', () => {
  const lab = readLab('default-route');

  it('is unsolved at the start', () => {
    const built = buildLab(lab);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['default-route', 'return-route', 'verify']);
  });

  it('passes with a default route on R1 and a return route on the ISP router', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([]);
  });

  it('fails when the default route is missing', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'ISP', ['system-view', 'ip route-static 192.0.2.0 24 198.51.100.1']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['default-route', 'verify']);
  });

  it('fails when the default route points at the wrong next hop', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', ['system-view', 'ip route-static 0.0.0.0 0.0.0.0 198.51.100.3']);
    await typeCommands(built, 'ISP', ['system-view', 'ip route-static 192.0.2.0 24 198.51.100.1']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['default-route', 'verify']);
  });

  it('fails when the ISP router has no way back', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', ['system-view', 'ip route-static 0.0.0.0 0 198.51.100.2']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['return-route', 'verify']);
  });
});

describe('lab 11: fix a broken network', () => {
  const lab = readLab('fix-the-broken-network');

  it('starts broken in both places', () => {
    const built = buildLab(lab);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['fix-trunk', 'fix-route', 'verify']);
  });

  it('is repaired by allowing VLAN 10 on both trunk ends and replacing the route', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([]);
  });

  it('keeps the route fault when the wrong route is not removed', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'SW1', ['system-view', 'interface GE0/0/24', 'port trunk allow-pass vlan 10']);
    await typeCommands(built, 'SW2', ['system-view', 'interface GE0/0/24', 'port trunk allow-pass vlan 10']);
    await typeCommands(built, 'R1', ['system-view', 'ip route-static 203.0.113.0 24 198.51.100.2']);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['fix-route', 'verify']);
    expect(result.tasks[1].results[0].pass).toBe(true);
    expect(result.tasks[1].results[1].pass).toBe(false);
  });

  it('keeps the layer 2 fault when only one trunk end is fixed', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'SW1', ['system-view', 'interface GE0/0/24', 'port trunk allow-pass vlan 10']);
    await typeCommands(built, 'R1', ['system-view', 'undo ip route-static 203.0.113.0 24 198.51.100.9', 'ip route-static 203.0.113.0 24 198.51.100.2']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['fix-trunk', 'verify']);
  });

  it('undo ip route-static reports a route that does not exist and rejects bad input', async () => {
    const built = buildLab(lab);
    const lines = await typeCommands(built, 'R1', [
      'system-view',
      'undo ip route-static 203.0.113.0 24 198.51.100.77',
      'undo ip route-static x 24',
      'undo ip route-static 203.0.113.0 255.255.255.0',
    ]);
    expect(lines.filter((l) => l.startsWith('Error'))).toHaveLength(2);
    expect(lines).toContain('Info: Succeeded.');
    const r1 = built.devices.find((d) => d.hostname === 'R1');
    expect((r1?.routingTable ?? []).filter((r) => r.proto === 'Static')).toHaveLength(0);
  });

  it('keeps the starting state in the lab file (trunks, VLANs, routes)', () => {
    const text = readLabText('fix-the-broken-network');
    const parsed = parseGuidedLab(JSON.parse(text));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.setup.routes).toHaveLength(2);
      expect(parsed.value.setup.vlans).toHaveLength(2);
    }
  });
});

describe('lab 12: allow only web traffic', () => {
  const lab = readLab('acl-allow-web-only');

  it('is unsolved while every service is open', () => {
    const built = buildLab(lab);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['block-the-rest']);
    expect(result.tasks[1].results.every((r) => r.pass)).toBe(true);
  });

  it('passes with a permit for TCP 80 followed by a deny', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([]);
  });

  it('fails the web check when the deny comes first', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', [
      'system-view',
      'acl rule add DENY-REST deny GE0/0/1 in src=192.0.2.0/24 dst=198.51.100.10/32',
      'acl rule add WEB-OK permit GE0/0/1 in protocol=tcp dstport=80 src=192.0.2.0/24 dst=198.51.100.10/32',
    ]);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['keep-web']);
  });

  it('fails the block check when there is only a permit rule', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', [
      'system-view',
      'acl rule add WEB-OK permit GE0/0/1 in protocol=tcp dstport=80 src=192.0.2.0/24 dst=198.51.100.10/32',
    ]);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['block-the-rest']);
  });

  it('fails the gateway check when the deny has no destination', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', [
      'system-view',
      'acl rule add WEB-OK permit GE0/0/1 in protocol=tcp dstport=80 src=192.0.2.0/24 dst=198.51.100.10/32',
      'acl rule add DENY-ALL deny GE0/0/1 in src=192.0.2.0/24',
    ]);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['keep-web']);
  });
});

describe('service-reachable parsing', () => {
  it('rejects a port outside the valid range and an unknown protocol', () => {
    const lab = JSON.parse(readLabText('acl-allow-web-only'));
    const bad = (patch: Record<string, unknown>): boolean => {
      const copy = JSON.parse(JSON.stringify(lab));
      Object.assign(copy.tasks[0].criteria[0], patch);
      return parseGuidedLab(copy).ok;
    };
    expect(bad({})).toBe(true);
    expect(bad({ port: 70000 })).toBe(false);
    expect(bad({ protocol: 'icmp' })).toBe(false);
  });

  it('rejects an unknown port mode in the starting state', () => {
    const lab = JSON.parse(readLabText('fix-the-broken-network'));
    lab.setup.ports[1].mode = 'hybrid';
    expect(parseGuidedLab(lab).ok).toBe(false);
  });
});
