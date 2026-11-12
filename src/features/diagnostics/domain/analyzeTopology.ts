import { sameSubnet } from '../../../utils/ipv4';
import { DIAGNOSTICS_LIMITS, toTopologyView, type ViewLimits } from './topologyView';
import type {
  CableView,
  DeviceView,
  DiagnosticsReport,
  Finding,
  FindingSeverity,
  PortModeView,
  PortView,
  TopologyView,
} from './types';

/**
 * Pure consistency rules over a validated topology view. No clock, no random
 * values, no I/O: finding ids come from the input and the output order is
 * fixed, so the same topology always produces the same report.
 */

export const MAX_FINDINGS = 500;
const MAX_LISTED_HOLDERS = 8;
const MAX_REFERENCES = 32;

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 };

interface Endpoint {
  device: DeviceView;
  port: PortView;
}

interface Holder {
  deviceId: string;
  portId: string | null;
  text: string;
}

type LinkFindingSpec = Pick<Finding, 'code' | 'severity' | 'layer' | 'title' | 'detail' | 'recommendation'>;

/** Code-unit comparison: independent of the locale of the browser. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareHolders = (a: Holder, b: Holder): number =>
  compareText(a.text, b.text) ||
  compareText(a.deviceId, b.deviceId) ||
  compareText(a.portId ?? '', b.portId ?? '');

const compareFindings = (a: Finding, b: Finding): number =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || compareText(a.code, b.code) || compareText(a.id, b.id);

const label = (endpoint: Endpoint): string => `${endpoint.device.hostname}:${endpoint.port.name}`;

function resolveEndpoint(
  devices: ReadonlyMap<string, DeviceView>,
  deviceId: string,
  portId: string,
): Endpoint | null {
  const device = devices.get(deviceId);
  if (device === undefined) return null;
  const port = device.ports.find((candidate) => candidate.id === portId);
  return port === undefined ? null : { device, port };
}

function linkFinding(cable: CableView, a: Endpoint, b: Endpoint, spec: LinkFindingSpec): Finding {
  return {
    id: `${spec.code}:${cable.id}`,
    code: spec.code,
    severity: spec.severity,
    layer: spec.layer,
    title: spec.title,
    detail: spec.detail,
    recommendation: spec.recommendation,
    deviceIds: [...new Set([a.device.id, b.device.id])],
    portIds: [a.port.id, b.port.id],
  };
}

function checkDuplicateAddresses(view: TopologyView): Finding[] {
  const holders = new Map<string, Holder[]>();
  for (const device of view.devices) {
    for (const entry of device.addresses) {
      const list = holders.get(entry.address) ?? [];
      list.push({ deviceId: device.id, portId: entry.portId, text: `${device.hostname}:${entry.label}` });
      holders.set(entry.address, list);
    }
  }

  const findings: Finding[] = [];
  for (const [address, unsorted] of holders) {
    if (unsorted.length < 2) continue;
    const list = [...unsorted].sort(compareHolders);
    const shown = list
      .slice(0, MAX_LISTED_HOLDERS)
      .map((holder) => holder.text)
      .join(', ');
    const extra = list.length - MAX_LISTED_HOLDERS;
    const portIds: string[] = [];
    for (const holder of list) {
      if (holder.portId !== null && portIds.length < MAX_REFERENCES) portIds.push(holder.portId);
    }
    findings.push({
      id: `duplicate-ip:${address}`,
      code: 'duplicate-ip',
      severity: 'critical',
      layer: 'L3',
      title: `Duplicate IP address ${address}`,
      detail: `${address} is configured on ${shown}${extra > 0 ? ` and ${extra} more` : ''}.`,
      recommendation: 'Keep the address on one interface and renumber the others.',
      deviceIds: [...new Set(list.map((holder) => holder.deviceId))].slice(0, MAX_REFERENCES),
      portIds,
    });
  }
  return findings;
}

function danglingCable(cable: CableView, devices: ReadonlyMap<string, DeviceView>): Finding {
  return {
    id: `dangling-cable:${cable.id}`,
    code: 'dangling-cable',
    severity: 'warning',
    layer: 'L1',
    title: 'Cable with a missing endpoint',
    detail: 'A cable references a device or port that no longer exists.',
    recommendation: 'Delete the cable and connect the ports again.',
    deviceIds: [...new Set([cable.sourceDeviceId, cable.targetDeviceId])].filter((id) => devices.has(id)),
    portIds: [],
  };
}

function checkAdminState(cable: CableView, a: Endpoint, b: Endpoint): Finding[] {
  const findings: Finding[] = [];
  for (const endpoint of [a, b]) {
    if (endpoint.port.enabled) continue;
    findings.push({
      id: `admin-down-link:${cable.id}:${endpoint.port.id}`,
      code: 'admin-down-link',
      severity: 'warning',
      layer: 'L1',
      title: 'Cabled interface is administratively down',
      detail: `${label(endpoint)} has a cable attached but is shut down.`,
      recommendation:
        "Re-enable the interface ('undo shutdown' on VRP-style CLIs, 'no shutdown' on IOS-style CLIs).",
      deviceIds: [endpoint.device.id],
      portIds: [endpoint.port.id],
    });
  }
  return findings;
}

const isSwitched = (mode: PortModeView | null): mode is 'access' | 'trunk' => mode === 'access' || mode === 'trunk';

function checkLayer2(cable: CableView, a: Endpoint, b: Endpoint): Finding[] {
  if (a.device.isHost || b.device.isHost) return [];
  const modeA = a.port.mode;
  const modeB = b.port.mode;
  // Routed and hybrid ports are not compared: a router facing a switch is a normal link.
  if (!isSwitched(modeA) || !isSwitched(modeB)) return [];

  if (modeA !== modeB) {
    return [
      linkFinding(cable, a, b, {
        code: 'port-mode-mismatch',
        severity: 'warning',
        layer: 'L2',
        title: 'Access port connected to a trunk port',
        detail: `${label(a)} is ${modeA} while ${label(b)} is ${modeB}.`,
        recommendation: 'Configure both ends of the link with the same link type.',
      }),
    ];
  }

  const vlanA = a.port.vlan ?? 1;
  const vlanB = b.port.vlan ?? 1;
  if (vlanA === vlanB) return [];

  if (modeA === 'trunk') {
    return [
      linkFinding(cable, a, b, {
        code: 'native-vlan-mismatch',
        severity: 'warning',
        layer: 'L2',
        title: 'Native VLAN mismatch on a trunk',
        detail: `${label(a)} uses VLAN ${vlanA} untagged while ${label(b)} uses VLAN ${vlanB}.`,
        recommendation: 'Set the same native VLAN (PVID) on both ends of the trunk.',
      }),
    ];
  }
  return [
    linkFinding(cable, a, b, {
      code: 'access-vlan-mismatch',
      severity: 'info',
      layer: 'L2',
      title: 'Access VLAN differs across a link',
      detail: `${label(a)} is in VLAN ${vlanA} and ${label(b)} is in VLAN ${vlanB}.`,
      recommendation: 'Directly connected access ports normally belong to the same VLAN.',
    }),
  ];
}

function checkLayer3(cable: CableView, a: Endpoint, b: Endpoint): Finding[] {
  const addressA = a.port.address;
  const addressB = b.port.address;
  const prefixA = a.port.prefixLength;
  const prefixB = b.port.prefixLength;
  if (addressA === null || addressB === null || prefixA === null || prefixB === null) return [];

  const textA = `${addressA}/${prefixA}`;
  const textB = `${addressB}/${prefixB}`;
  // On-link reachability is evaluated from each end with its own prefix.
  const aSeesB = sameSubnet(addressA, addressB, prefixA);
  const bSeesA = sameSubnet(addressB, addressA, prefixB);

  if (!aSeesB || !bSeesA) {
    return [
      linkFinding(cable, a, b, {
        code: 'subnet-mismatch',
        severity: 'critical',
        layer: 'L3',
        title: 'Connected interfaces are in different subnets',
        detail: `${label(a)} (${textA}) and ${label(b)} (${textB}) cannot reach each other directly.`,
        recommendation: 'Assign addresses from the same subnet to both ends of the link.',
      }),
    ];
  }
  if (prefixA !== prefixB) {
    return [
      linkFinding(cable, a, b, {
        code: 'prefix-length-mismatch',
        severity: 'warning',
        layer: 'L3',
        title: 'Prefix length differs across a link',
        detail: `${label(a)} uses ${textA} while ${label(b)} uses ${textB}.`,
        recommendation: 'Use the same prefix length on both ends of the link.',
      }),
    ];
  }
  return [];
}

/** Runs every rule on a validated view. */
export function analyzeTopology(view: TopologyView): DiagnosticsReport {
  const devicesById = new Map<string, DeviceView>();
  for (const device of view.devices) devicesById.set(device.id, device);

  const findings: Finding[] = checkDuplicateAddresses(view);
  for (const cable of view.cables) {
    const a = resolveEndpoint(devicesById, cable.sourceDeviceId, cable.sourcePortId);
    const b = resolveEndpoint(devicesById, cable.targetDeviceId, cable.targetPortId);
    if (a === null || b === null) {
      findings.push(danglingCable(cable, devicesById));
      continue;
    }
    findings.push(...checkAdminState(cable, a, b), ...checkLayer2(cable, a, b), ...checkLayer3(cable, a, b));
  }

  const unique = new Map<string, Finding>();
  for (const finding of findings) {
    if (!unique.has(finding.id)) unique.set(finding.id, finding);
  }
  const sorted = [...unique.values()].sort(compareFindings);

  return {
    deviceCount: view.devices.length,
    cableCount: view.cables.length,
    truncated: view.truncated || sorted.length > MAX_FINDINGS,
    skipped: view.skipped,
    findings: sorted.slice(0, MAX_FINDINGS),
  };
}

/** Entry point for untrusted input: validates first, then analyzes. Never throws. */
export function diagnoseTopology(
  devices: unknown,
  cables: unknown,
  limits: ViewLimits = DIAGNOSTICS_LIMITS,
): DiagnosticsReport {
  return analyzeTopology(toTopologyView(devices, cables, limits));
}

/** Reports are plain data built in a fixed field order, so their JSON text identifies them. */
export function sameReport(a: DiagnosticsReport | null, b: DiagnosticsReport | null): boolean {
  if (a === null || b === null) return a === b;
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
