import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { executeCliCommand, initializeCommandRegistry } from '../../../store/slices/cli/CommandExecutor';
import { globalCommandRegistry } from '../../../store/slices/cli/commands/base/CommandRegistry';
import { registerFeatureCommands } from '../../../features/featureRegistry';
import { buildGuidedLabTopology } from '../../../features/guided-labs/domain/setup';
import { parseGuidedLab } from '../../../features/guided-labs/domain/guards';
import type { GuidedLab } from '../../../features/guided-labs/domain/types';
import type { NetworkCable, NetworkDevice } from '../../../types/NetworkTypes';

export const LAB_FILE_IDS = [
  'vlans-and-trunks',
  'spanning-tree-root',
  'ospf-single-area',
  'static-routes',
  'inter-vlan-routing',
  'edge-port-protection',
  'access-list-block-host',
  'link-aggregation',
  'ospf-two-areas',
  'default-route',
  'fix-the-broken-network',
  'acl-allow-web-only',
] as const;

export const labFilePath = (id: string): string =>
  fileURLToPath(new URL(`../../../../public/labs/${id}.json`, import.meta.url));

export const readLabText = (id: string): string => readFileSync(labFilePath(id), 'utf8');

export function readLab(id: string): GuidedLab {
  const parsed = parseGuidedLab(JSON.parse(readLabText(id)));
  if (!parsed.ok) throw new Error(`lab ${id} is invalid at ${parsed.error.path}`);
  return parsed.value;
}

let registryReady = false;
function ensureRegistry(): void {
  if (registryReady) return;
  registryReady = true;
  globalCommandRegistry.clear();
  initializeCommandRegistry();
  registerFeatureCommands(globalCommandRegistry);
}

export interface Built {
  devices: NetworkDevice[];
  cables: NetworkCable[];
}

/** A lab topology with deterministic ids and a distinct, increasing MAC address per device. */
export function buildLab(lab: GuidedLab): Built {
  let counter = 0;
  const built = buildGuidedLabTopology(lab, {
    ids: () => {
      counter += 1;
      return `id-${counter}`;
    },
    random: () => 0.5,
  });
  if (!built.ok) throw new Error(`setup failed: ${built.error.detail}`);
  built.value.devices.forEach((device, index) => {
    device.macAddress = `50:50:00:00:00:${String(index + 16).padStart(2, '0')}`;
  });
  return built.value;
}

/** Types commands into the console of one device, as a learner would. */
export async function typeCommands(built: Built, hostname: string, commands: readonly string[]): Promise<string[]> {
  ensureRegistry();
  const device = built.devices.find((d) => d.hostname === hostname);
  if (!device) throw new Error(`no device ${hostname}`);
  const lines: string[] = [];
  for (const command of commands) {
    const result = await executeCliCommand(
      command,
      device,
      built.devices,
      built.cables,
      (id) => built.devices.find((d) => d.id === id),
      () => undefined,
    );
    lines.push(...result.output);
  }
  return lines;
}

export const SOLUTIONS: Record<string, Array<[string, string[]]>> = {
  'vlans-and-trunks': [
    ['SW1', ['system-view', 'vlan batch 10 20', 'interface GE0/0/1', 'port link-type access', 'port default vlan 10', 'quit', 'interface GE0/0/24', 'port link-type trunk', 'port trunk allow-pass vlan 10 20', 'quit', 'return']],
    ['SW2', ['system-view', 'vlan batch 10 20', 'interface GE0/0/1', 'port link-type access', 'port default vlan 10', 'quit', 'interface GE0/0/2', 'port link-type access', 'port default vlan 20', 'quit', 'interface GE0/0/24', 'port link-type trunk', 'port trunk allow-pass vlan 10 20', 'quit', 'return']],
  ],
  'spanning-tree-root': [
    ['SW1', ['system-view', 'stp enable', 'return']],
    ['SW2', ['system-view', 'stp enable', 'stp root primary', 'return']],
    ['SW3', ['system-view', 'stp enable', 'return']],
  ],
  'static-routes': [
    ['R1', ['system-view', 'ip route-static 203.0.113.0 24 192.0.2.2', 'return']],
    ['R2', ['system-view', 'ip route-static 198.51.100.0 255.255.255.0 192.0.2.1', 'return']],
  ],
  'inter-vlan-routing': [
    ['SW1', ['system-view', 'vlan batch 10 20', 'interface GE0/0/1', 'port link-type access', 'port default vlan 10', 'quit', 'interface GE0/0/2', 'port link-type access', 'port default vlan 20', 'quit', 'interface vlanif10', 'ip address 192.0.2.1 24', 'quit', 'interface vlanif20', 'ip address 198.51.100.1 24', 'quit', 'return']],
  ],
  'edge-port-protection': [
    ['SW1', ['system-view', 'interface GE0/0/1', 'portfast enable', 'bpdu guard enable', 'port-security enable', 'port-security max-mac-num 1', 'quit', 'interface GE0/0/2', 'portfast enable', 'bpdu guard enable', 'quit', 'return']],
  ],
  'access-list-block-host': [
    ['R1', ['system-view', 'acl rule add BLOCK-PC1 deny GE0/0/1 in src=192.0.2.11/32 dst=198.51.100.0/24', 'return']],
  ],
  'link-aggregation': [
    ['SW1', ['system-view', 'interface eth-trunk 1', 'lacp mode active', 'quit', 'interface GE0/0/1', 'eth-trunk 1', 'quit', 'interface GE0/0/2', 'eth-trunk 1', 'quit', 'return']],
    ['SW2', ['system-view', 'interface eth-trunk 1', 'lacp mode passive', 'quit', 'interface GE0/0/1', 'eth-trunk 1', 'quit', 'interface GE0/0/2', 'eth-trunk 1', 'quit', 'return']],
  ],
  'ospf-two-areas': [
    ['R1', ['system-view', 'ospf 1 router-id 1.1.1.1', 'ospf 1 area 0 network 198.51.100.0 0.0.0.3', 'ospf 1 area 0 network 192.0.2.0 0.0.0.127', 'return']],
    ['R2', ['system-view', 'ospf 1 router-id 2.2.2.2', 'ospf 1 area 0 network 198.51.100.0 0.0.0.3', 'ospf 1 area 1 network 198.51.100.4 0.0.0.3', 'return']],
    ['R3', ['system-view', 'ospf 1 router-id 3.3.3.3', 'ospf 1 area 1 network 198.51.100.4 0.0.0.3', 'ospf 1 area 1 network 203.0.113.0 0.0.0.127', 'return']],
  ],
  'default-route': [
    ['R1', ['system-view', 'ip route-static 0.0.0.0 0 198.51.100.2', 'return']],
    ['ISP', ['system-view', 'ip route-static 192.0.2.0 255.255.255.0 198.51.100.1', 'return']],
  ],
  'fix-the-broken-network': [
    ['SW1', ['system-view', 'interface GE0/0/24', 'port trunk allow-pass vlan 10', 'quit', 'return']],
    ['SW2', ['system-view', 'interface GE0/0/24', 'port trunk allow-pass vlan 10', 'quit', 'return']],
    ['R1', ['system-view', 'undo ip route-static 203.0.113.0 24 198.51.100.9', 'ip route-static 203.0.113.0 24 198.51.100.2', 'return']],
  ],
  'acl-allow-web-only': [
    ['R1', ['system-view', 'acl rule add WEB-OK permit GE0/0/1 in protocol=tcp dstport=80 src=192.0.2.0/24 dst=198.51.100.10/32', 'acl rule add DENY-REST deny GE0/0/1 in src=192.0.2.0/24 dst=198.51.100.10/32', 'return']],
  ],
  'ospf-single-area': [
    ['R1', ['system-view', 'ospf 1 router-id 1.1.1.1', 'ospf 1 area 0 network 192.0.2.0 0.0.0.3', 'ospf 1 area 0 network 203.0.113.0 0.0.0.127', 'return']],
    ['R2', ['system-view', 'ospf 1 router-id 2.2.2.2', 'ospf 1 area 0 network 192.0.2.0 0.0.0.3', 'ospf 1 area 0 network 198.51.100.0 0.0.0.3', 'return']],
    ['R3', ['system-view', 'ospf 1 router-id 3.3.3.3', 'ospf 1 area 0 network 198.51.100.0 0.0.0.3', 'ospf 1 area 0 network 203.0.113.128 0.0.0.127', 'return']],
  ],
};

export async function solve(built: Built, id: string): Promise<void> {
  for (const [hostname, commands] of SOLUTIONS[id]) {
    const lines = await typeCommands(built, hostname, commands);
    const bad = lines.filter((line) => /^Error|Unrecognized|requires/.test(line));
    if (bad.length > 0) throw new Error(`${hostname}: ${bad.join(' / ')}`);
  }
}
