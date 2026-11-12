/** Types of the topology diagnosis: findings, the report and the validated view the rules work on. */

export type FindingSeverity = 'critical' | 'warning' | 'info';
export type FindingLayer = 'L1' | 'L2' | 'L3';

export type FindingCode =
  | 'dangling-cable'
  | 'admin-down-link'
  | 'port-mode-mismatch'
  | 'native-vlan-mismatch'
  | 'access-vlan-mismatch'
  | 'subnet-mismatch'
  | 'prefix-length-mismatch'
  | 'duplicate-ip';

export interface Finding {
  /** Stable identifier derived from the input, unique within a report. */
  id: string;
  code: FindingCode;
  severity: FindingSeverity;
  layer: FindingLayer;
  title: string;
  detail: string;
  recommendation: string;
  deviceIds: string[];
  portIds: string[];
}

/** The same topology always produces the same report: no timestamps, no random ids. */
export interface DiagnosticsReport {
  deviceCount: number;
  cableCount: number;
  /** True when input or output limits were hit and the result is partial. */
  truncated: boolean;
  /** Number of malformed or duplicate entries that were ignored. */
  skipped: number;
  findings: Finding[];
}

export type PortModeView = 'access' | 'trunk' | 'hybrid' | 'routed';

/** Validated, read-only projection of a port. Addresses are canonical dotted-decimal text. */
export interface PortView {
  id: string;
  name: string;
  enabled: boolean;
  mode: PortModeView | null;
  vlan: number | null;
  address: string | null;
  prefixLength: number | null;
}

export interface AddressView {
  label: string;
  portId: string | null;
  address: string;
}

export interface DeviceView {
  id: string;
  hostname: string;
  isHost: boolean;
  ports: PortView[];
  addresses: AddressView[];
}

export interface CableView {
  id: string;
  sourceDeviceId: string;
  sourcePortId: string;
  targetDeviceId: string;
  targetPortId: string;
}

export interface TopologyView {
  devices: DeviceView[];
  cables: CableView[];
  truncated: boolean;
  skipped: number;
}
