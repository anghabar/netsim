import { describe, expect, it } from 'vitest';
import { evaluateLab } from '../../../features/guided-labs/domain/criteria';
import { loadActiveLab, saveActiveLab, ACTIVE_LAB_SLOT } from '../../../features/guided-labs/domain/progress';
import { createMemoryStorage } from '../../../utils/storage/keyValueStorage';
import { buildLab, readLab, readLabText, solve, typeCommands } from './fixtures';

const failedTasks = (result: ReturnType<typeof evaluateLab>): string[] =>
  result.tasks.filter((t) => !t.pass).map((t) => t.taskId);

describe('lab 4: static routes', () => {
  const lab = readLab('static-routes');

  it('is unsolved before any route is written', () => {
    const built = buildLab(lab);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([
      'route-on-r1',
      'route-on-r2',
      'verify-reachability',
    ]);
  });

  it('passes with a prefix length on R1 and a dotted mask on R2', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([]);
  });

  it('fails when only one direction has a route', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', ['system-view', 'ip route-static 203.0.113.0 24 192.0.2.2']);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['route-on-r2', 'verify-reachability']);
    const reachable = result.tasks[2].results.map((r) => r.pass);
    expect(reachable).toEqual([false, false, false]);
  });

  it('fails when the next hop is not on the link', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', ['system-view', 'ip route-static 203.0.113.0 24 192.0.2.9']);
    await typeCommands(built, 'R2', ['system-view', 'ip route-static 198.51.100.0 24 192.0.2.1']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['route-on-r1', 'verify-reachability']);
  });

  it('rejects a malformed route', async () => {
    const built = buildLab(lab);
    const lines = await typeCommands(built, 'R1', ['system-view', 'ip route-static 203.0.113.0 33 192.0.2.2', 'ip route-static x 24 192.0.2.2']);
    expect(lines.filter((l) => l.startsWith('Error'))).toHaveLength(2);
    const r1 = built.devices.find((d) => d.hostname === 'R1');
    expect(r1?.routingTable ?? []).toHaveLength(0);
  });
});

describe('lab 5: routing between VLANs', () => {
  const lab = readLab('inter-vlan-routing');

  it('is unsolved at the start', () => {
    const built = buildLab(lab);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([
      'create-vlans',
      'assign-ports',
      'vlan-interfaces',
      'verify-routing',
    ]);
  });

  it('passes once the VLAN interfaces exist', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([]);
  });

  it('fails when a VLAN interface has the wrong address', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'SW1', ['system-view', 'interface vlanif20', 'ip address 198.51.100.2 24']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['vlan-interfaces', 'verify-routing']);
  });

  it('fails when a PC sits in the other VLAN', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'SW1', ['system-view', 'interface GE0/0/2', 'port default vlan 10']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['assign-ports', 'verify-routing']);
  });
});

describe('lab 6: protecting edge ports', () => {
  const lab = readLab('edge-port-protection');

  it('is unsolved at the start', () => {
    const built = buildLab(lab);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['fast-start', 'bpdu-guard', 'limit-macs']);
  });

  it('passes when the edge ports are protected and the uplink is not', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([]);
  });

  it('fails when fast start is put on the uplink', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'SW1', ['system-view', 'interface GE0/0/24', 'portfast enable']);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['fast-start']);
    expect(result.tasks[0].results[2].detail).toContain('GE0/0/24');
  });

  it('fails when the MAC limit is not one', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'SW1', ['system-view', 'interface GE0/0/1', 'port-security max-mac-num 3']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['limit-macs']);
  });
});

describe('lab 7: access list', () => {
  const lab = readLab('access-list-block-host');

  it('is unsolved while PC1 still reaches the server', () => {
    const built = buildLab(lab);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['block-pc1']);
    expect(result.tasks[1].results.every((r) => r.pass)).toBe(true);
  });

  it('passes when only PC1 is blocked towards the server network', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([]);
  });

  it('fails the second task when the rule also blocks PC2', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', ['system-view', 'acl rule add BLOCK-ALL deny GE0/0/1 in dst=198.51.100.0/24']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['keep-the-rest']);
  });

  it('fails the second task when the rule also blocks the gateway', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', ['system-view', 'acl rule add BLOCK-PC1 deny GE0/0/1 in src=192.0.2.11/32']);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(failedTasks(result)).toEqual(['keep-the-rest']);
    expect(result.tasks[1].results[1].pass).toBe(false);
  });

  it('works the same when the rule is applied outbound towards the server', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'R1', ['system-view', 'acl rule add BLOCK-PC1 deny GE0/0/2 out src=192.0.2.11/32 dst=198.51.100.0/24']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([]);
  });

  it('can delete a rule and rejects an unknown port', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'R1', ['system-view', 'acl rule delete BLOCK-PC1']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['block-pc1']);
    const lines = await typeCommands(built, 'R1', ['acl rule add X deny GE9/9/9 in']);
    expect(lines.some((l) => l.includes('Interface not found'))).toBe(true);
  });
});

describe('lab 8: link aggregation', () => {
  const lab = readLab('link-aggregation');

  it('is unsolved at the start', () => {
    const built = buildLab(lab);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['create-group', 'add-members', 'bundle-forms']);
  });

  it('passes with one active and one passive side', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual([]);
  });

  it('does not bundle when both sides are passive', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'SW1', ['system-view', 'interface eth-trunk 1', 'lacp mode passive']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['bundle-forms']);
  });

  it('does not bundle when one side is static and the other uses LACP', async () => {
    const built = buildLab(lab);
    await solve(built, lab.id);
    await typeCommands(built, 'SW2', ['system-view', 'interface eth-trunk 1', 'lacp mode static']);
    expect(failedTasks(evaluateLab(lab, built.devices, built.cables))).toEqual(['create-group', 'bundle-forms']);
  });

  it('reports a missing member port', async () => {
    const built = buildLab(lab);
    await typeCommands(built, 'SW1', ['system-view', 'interface eth-trunk 1', 'lacp mode active', 'quit', 'interface GE0/0/1', 'eth-trunk 1']);
    const result = evaluateLab(lab, built.devices, built.cables);
    expect(result.tasks[1].results[0].detail).toContain('1 member');
  });
});

describe('resuming a lab after a reload', () => {
  it('stores the validated lab and gets it back', () => {
    const storage = createMemoryStorage();
    const lab = readLab('static-routes');
    saveActiveLab(storage, lab);
    expect(loadActiveLab(storage)).toEqual(lab);
    saveActiveLab(storage, null);
    expect(loadActiveLab(storage)).toBeNull();
  });

  it('ignores corrupt or tampered stored data', () => {
    const storage = createMemoryStorage();
    storage.write(ACTIVE_LAB_SLOT, '{broken');
    expect(loadActiveLab(storage)).toBeNull();
    const tampered = JSON.parse(readLabText('static-routes'));
    tampered.tasks[0].criteria[0].type = 'run-script';
    storage.write(ACTIVE_LAB_SLOT, JSON.stringify(tampered));
    expect(loadActiveLab(storage)).toBeNull();
  });
});
