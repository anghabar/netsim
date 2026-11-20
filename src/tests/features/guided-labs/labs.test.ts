import { describe, expect, it } from 'vitest';
import { evaluateLab } from '../../../features/guided-labs/domain/criteria';
import { LAB_FILE_IDS, buildLab, readLab, solve, typeCommands } from './fixtures';

const failedTasks = (result: ReturnType<typeof evaluateLab>): string[] =>
  result.tasks.filter((t) => !t.pass).map((t) => t.taskId);

describe('lab 1: VLANs and trunking', () => {
  const lab = readLab('vlans-and-trunks');

  it('fails every task on the untouched topology', () => {
    const built = buildLab(lab);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(result.pass).toBe(false);
    expect(failedTasks(result)).toEqual(['create-vlans', 'assign-access-ports', 'configure-trunk', 'verify-isolation']);
    const isolation = result.tasks[3].results;
    expect(isolation[0].pass).toBe(false); // PC1 cannot reach PC2 across the parked link
    expect(isolation[1].pass).toBe(false); // PC2 and PC3 still share VLAN 1
  });

  it('passes every check once solved through the consoles', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('stays unsolved when one trunk end does not allow VLAN 20', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    const sw2 = built.devices.find((d) => d.hostname === 'SW2');
    const trunk = sw2?.ports.find((p) => p.name === 'GE0/0/24');
    if (trunk === undefined) throw new Error('missing port');
    trunk.config.allowedVlans = [10];
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['configure-trunk']);
    expect(result.tasks[2].results.find((r) => !r.pass)?.detail).toContain('VLAN 20');
  });

  it('reports a host in the wrong VLAN as unreachable', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'SW2', ['system-view', 'interface GE0/0/1', 'port default vlan 20']);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(result.tasks[1].pass).toBe(false);
    expect(result.tasks[3].pass).toBe(false);
  });
});

describe('lab 2: spanning tree', () => {
  const lab = readLab('spanning-tree-root');

  it('is unsolved while spanning tree is off', () => {
    const built = buildLab(lab);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['enable-stp', 'choose-root', 'find-blocked-port']);
  });

  it('passes once spanning tree runs everywhere and SW2 is the root', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual([]);
  });

  it('blocks the port of the switch with the higher bridge ID on the link away from the root', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    // SW1 has the lower MAC of SW1 and SW3, so SW3 gives way on the SW3-SW1 link.
    const { buildNetworkView } = await import('../../../features/guided-labs/domain/network');
    const view = buildNetworkView(built.devices, built.cables);
    expect(view.stpRoots).toEqual(['SW2']);
    expect(view.blockedPorts).toEqual(['SW3:GE0/0/2']);
  });

  it('loses the root when another switch ties on priority with a lower MAC address', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'SW1', ['system-view', 'stp root primary']);
    const sw1 = built.devices.find((d) => d.hostname === 'SW1');
    const sw2 = built.devices.find((d) => d.hostname === 'SW2');
    if (!sw1 || !sw2) throw new Error('missing device');
    // Equal priorities: the lower MAC address (SW1) wins.
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['choose-root']);
  });
});

describe('lab 3: single-area OSPF', () => {
  const lab = readLab('ospf-single-area');

  it('is unsolved before any OSPF configuration', () => {
    const built = buildLab(lab);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['start-ospf', 'advertise-networks', 'full-reachability']);
  });

  it('passes once every router advertises its networks in area 0', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('does not form a neighbour when router IDs clash', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'R3', ['system-view', 'ospf 1 router-id 2.2.2.2']);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(result.tasks[1].results[1].pass).toBe(false);
    expect(result.tasks[2].pass).toBe(false);
  });

  it('does not form a neighbour when the areas differ', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'R3', ['system-view', 'ospf 1 area 1 network 198.51.100.0 0.0.0.3']);
    // The old area 0 statement still matches first, so replace the entry set on R3.
    const r3 = built.devices.find((d) => d.hostname === 'R3');
    if (!r3) throw new Error('missing device');
    r3.ospfLsdb = [{ type: 'network', network: '198.51.100.0', wildcard: '0.0.0.3', area: '1' }];
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(result.tasks[1].results[1].pass).toBe(false);
  });

  it('misses the LAN route when the LAN statement is absent', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    const r1 = built.devices.find((d) => d.hostname === 'R1');
    if (!r1) throw new Error('missing device');
    r1.ospfLsdb = (r1.ospfLsdb ?? []).filter((e) => (e as { network?: string }).network !== '203.0.113.0');
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['full-reachability']);
    const missing = result.tasks[2].results.filter((r) => !r.pass).map((r) => r.criterion.label);
    expect(missing).toEqual(['R2 learns the R1 LAN 203.0.113.0/25', 'R3 learns the R1 LAN 203.0.113.0/25']);
  });
});

describe('lab files', () => {
  it('lists every lab file', () => {
    expect(LAB_FILE_IDS).toHaveLength(3);
  });
});
