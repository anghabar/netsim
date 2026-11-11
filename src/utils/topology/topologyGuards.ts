import { defaultDeviceCatalog } from '../../data/deviceCatalog';
import type {
  CableType,
  DeviceType,
  LinkStatus,
  NetworkCable,
  NetworkDevice,
  NetworkPort,
  PortMode,
  PortType,
  SwitchModel,
  Vendor,
} from '../../types/NetworkTypes';
import { err, isRecord, ok, toPlainJson, type PlainJsonLimits, type Result } from '../guards';

/**
 * Validation of untrusted topology data (files, storage, snapshots).
 *
 * The input is first copied as bounded plain JSON, then every device, port and
 * cable is rebuilt from an allowlist of fields. Unknown fields are dropped and
 * reported as warnings. Link fields that are derived from the cables
 * (`connectedCableId`, `linked`) are dropped silently and recomputed. Optional
 * protocol tables are checked for their kind (scalar, object, list of
 * objects), not member by member.
 */

export interface TopologyLimits {
  readonly maxDevices: number;
  readonly maxCables: number;
  readonly maxPortsPerDevice: number;
  readonly maxConsoleLines: number;
  readonly maxLabelLength: number;
  readonly json: PlainJsonLimits;
}

export const TOPOLOGY_LIMITS: TopologyLimits = {
  maxDevices: 500,
  maxCables: 2000,
  maxPortsPerDevice: 128,
  maxConsoleLines: 200,
  maxLabelLength: 128,
  json: { maxDepth: 24, maxNodes: 1000000, maxStringLength: 8192 },
};

export type TopologyParseErrorCode =
  | 'not-an-object'
  | 'unsafe-content'
  | 'too-many-devices'
  | 'too-many-cables'
  | 'invalid-device'
  | 'invalid-cable'
  | 'duplicate-id'
  | 'dangling-cable'
  | 'port-in-use';

export interface TopologyParseError {
  code: TopologyParseErrorCode;
  path: string;
}

export interface TopologyWarning {
  code: 'unknown-model' | 'dropped-field' | 'console-truncated';
  path: string;
}

export interface ParsedTopology {
  devices: NetworkDevice[];
  cables: NetworkCable[];
  warnings: TopologyWarning[];
}

const MAX_WARNINGS = 200;
const MAX_COORDINATE = 1000000;
const DEVICE_TYPES: readonly DeviceType[] = ['Switch', 'Router', 'PC', 'AP', 'Firewall', 'Wireless'];
const VENDORS: readonly Vendor[] = ['Huawei', 'Cisco', 'D-Link', 'NetSim', 'PC', 'Router', 'Aruba', 'MikroTik'];
const PORT_TYPES: readonly PortType[] = ['RJ45', 'SFP', 'Console'];
const LINK_STATES: readonly LinkStatus[] = ['up', 'down'];
const PORT_MODES: readonly PortMode[] = ['access', 'trunk', 'hybrid', 'routed'];
const CABLE_TYPES: readonly CableType[] = ['copper', 'fiber'];
const CATALOG_MODELS: ReadonlySet<string> = new Set(defaultDeviceCatalog.map((entry) => entry.model));

type Kind = 'str' | 'num' | 'bool' | 'rec' | 'recs' | 'strs' | 'nums' | 'json';
const KINDS: readonly Kind[] = ['str', 'num', 'bool', 'rec', 'recs', 'strs', 'nums', 'json'];

const every = (value: unknown, test: (item: unknown) => boolean): boolean => {
  if (!Array.isArray(value)) return false;
  const items: readonly unknown[] = value;
  return items.every(test);
};

const KIND_TESTS: Record<Kind, (value: unknown) => boolean> = {
  str: (value) => typeof value === 'string' && value.length <= 1024,
  num: (value) => typeof value === 'number',
  bool: (value) => typeof value === 'boolean',
  rec: isRecord,
  recs: (value) => every(value, isRecord),
  strs: (value) => every(value, (item) => typeof item === 'string'),
  nums: (value) => every(value, (item) => typeof item === 'number'),
  json: () => true,
};

function fieldTable(spec: Partial<Record<Kind, string>>): ReadonlyMap<string, Kind> {
  const table = new Map<string, Kind>();
  for (const kind of KINDS) {
    for (const name of (spec[kind] ?? '').split(' ')) {
      if (name) table.set(name, kind);
    }
  }
  return table;
}

const DEVICE_FIELDS = fieldTable({
  str: 'id type status vendor hostname model macAddress routerId defaultGateway stpMode',
  num: 'stpPriority lastConfigSave startupConfigVersion',
  bool: 'dhcpEnabled ospfEnabled hasInternet stpEnabled netconfEnabled restconfEnabled',
  rec: 'position cliState containerlab bgpConfig netconfConfig restconfConfig',
  recs: 'ports dhcpPools routingTable ospfNeighbors vlanifs ethTrunks lldpNeighbors natRules aclRules natSessions qosHistory vxlanVnis bridgeDomains',
  strs: 'consoleLogs dnsServers',
  nums: 'vlans',
  json: 'candidateState ospfLsdb ospfTimers ospfRole securityState',
});

const PORT_FIELDS = fieldTable({
  str: 'id name type status ethTrunkId',
  num: 'speed bpduGuardHits loopGuardHits',
  bool: 'loopDetectEnabled loopDetected bpduGuarded loopGuarded bpduFiltered poePowered',
  rec: 'config',
  json: 'sfpModule stpStatus stpRole loopLastEvent',
});

/** Link fields derived from the cables: never copied from the input and never reported. */
const DERIVED_PORT_FIELDS: ReadonlySet<string> = new Set(['connectedCableId', 'linked']);
const NO_FIELDS: ReadonlySet<string> = new Set<string>();

const CONFIG_FIELDS = fieldTable({
  str: 'mode ipAddress description ethTrunkId trunkId loopDetectAction',
  num: 'vlan subnetMask bpduGuardHits loopGuardHits bpduFilterHits',
  bool: 'enabled bpduGuard bpduFilter portFast loopGuard loopDetectEnabled bpduGuarded bpduFiltered loopDetected loopGuarded poePowered',
  rec: 'qos qosUsage',
  strs: 'helperAddresses',
  nums: 'allowedVlans',
  json: 'portSecurity loopLastEvent dhcpLease qinqTunnel',
});

const CABLE_FIELDS = fieldTable({
  str: 'id type sourceDeviceId sourcePortId targetDeviceId targetPortId trunkId',
});

interface ParseContext {
  limits: TopologyLimits;
  warn: (code: TopologyWarning['code'], path: string) => void;
}

const fail = (code: TopologyParseErrorCode, path: string): Result<never, TopologyParseError> =>
  err({ code, path });

/** Non-empty bounded string without control characters. */
function isLabel(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

const oneOf = (allowed: readonly string[], value: unknown): boolean =>
  typeof value === 'string' && allowed.includes(value);

const isCoordinate = (value: unknown): boolean =>
  typeof value === 'number' && Math.abs(value) <= MAX_COORDINATE;

const isVlanId = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4094;

/**
 * Model names are bounded labels: the simulator creates devices with models
 * outside the declared union and outside the catalog, so membership is only
 * reported as a warning by parseTopology.
 */
export function isModelLabel(value: unknown): value is SwitchModel {
  return isLabel(value, 64);
}

/** Returns a port with its link fields set; `linked` mirrors what cabling has always written. */
export function withLink(port: NetworkPort, cableId: string | null, status: LinkStatus): NetworkPort {
  const next: NetworkPort & { linked: boolean } = {
    ...port,
    connectedCableId: cableId,
    status,
    linked: cableId !== null,
  };
  return next;
}

/**
 * Copies allowlisted fields of the expected kind; everything else is dropped
 * with a warning, except the names in `derived`, which are dropped silently.
 */
function rebuild(
  source: Record<string, unknown>,
  fields: ReadonlyMap<string, Kind>,
  path: string,
  ctx: ParseContext,
  derived: ReadonlySet<string> = NO_FIELDS,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(source)) {
    if (derived.has(name)) continue;
    const value = source[name];
    const kind = fields.get(name);
    if (value === null && kind !== undefined && kind !== 'json') continue;
    if (kind === undefined || !KIND_TESTS[kind](value)) {
      ctx.warn('dropped-field', `${path}.${name.slice(0, 64)}`);
      continue;
    }
    out[name] = value;
  }
  return out;
}

function isPort(value: unknown, maxLabel: number): value is NetworkPort {
  if (!isRecord(value)) return false;
  const config = value.config;
  const sfp = value.sfpModule;
  if (!isRecord(config)) return false;
  return (
    isLabel(value.id, maxLabel) &&
    isLabel(value.name, maxLabel) &&
    oneOf(PORT_TYPES, value.type) &&
    oneOf(LINK_STATES, value.status) &&
    oneOf(PORT_MODES, config.mode) &&
    typeof config.enabled === 'boolean' &&
    (config.vlan === undefined || isVlanId(config.vlan)) &&
    (sfp === undefined || sfp === null || isRecord(sfp))
  );
}

function isDevice(value: unknown, limits: TopologyLimits): value is NetworkDevice {
  if (!isRecord(value)) return false;
  const { position, cliState } = value;
  if (!isRecord(position) || !isRecord(cliState)) return false;
  const max = limits.maxLabelLength;
  return (
    isLabel(value.id, max) &&
    isLabel(value.hostname, max) &&
    isModelLabel(value.model) &&
    oneOf(VENDORS, value.vendor) &&
    oneOf(DEVICE_TYPES, value.type) &&
    isCoordinate(position.x) &&
    isCoordinate(position.y) &&
    isLabel(cliState.view, 64) &&
    every(value.ports, (port) => isPort(port, max)) &&
    every(value.vlans, isVlanId) &&
    every(value.consoleLogs, (line) => typeof line === 'string')
  );
}

function isCable(value: unknown, maxLabel: number): value is NetworkCable {
  if (!isRecord(value)) return false;
  return (
    isLabel(value.id, maxLabel) &&
    oneOf(CABLE_TYPES, value.type) &&
    isLabel(value.sourceDeviceId, maxLabel) &&
    isLabel(value.sourcePortId, maxLabel) &&
    isLabel(value.targetDeviceId, maxLabel) &&
    isLabel(value.targetPortId, maxLabel) &&
    (value.trunkId === undefined || isLabel(value.trunkId, maxLabel))
  );
}

function parseDevice(raw: unknown, path: string, ctx: ParseContext): Result<NetworkDevice, TopologyParseError> {
  if (!isRecord(raw)) return fail('invalid-device', path);
  const rawPorts = raw.ports;
  if (!Array.isArray(rawPorts) || rawPorts.length > ctx.limits.maxPortsPerDevice) {
    return fail('invalid-device', `${path}.ports`);
  }
  const device = rebuild(raw, DEVICE_FIELDS, path, ctx);
  const portItems: readonly unknown[] = rawPorts;
  const ports: NetworkPort[] = [];
  const portIds = new Set<string>();
  for (let i = 0; i < portItems.length; i += 1) {
    const rawPort = portItems[i];
    const portPath = `${path}.ports[${i}]`;
    const rawConfig = isRecord(rawPort) ? rawPort.config : undefined;
    if (!isRecord(rawPort) || !isRecord(rawConfig)) return fail('invalid-device', portPath);
    const port = rebuild(rawPort, PORT_FIELDS, portPath, ctx, DERIVED_PORT_FIELDS);
    port.config = rebuild(rawConfig, CONFIG_FIELDS, `${portPath}.config`, ctx);
    port.connectedCableId = null;
    if (!isPort(port, ctx.limits.maxLabelLength)) return fail('invalid-device', portPath);
    if (portIds.has(port.id)) return fail('duplicate-id', portPath);
    portIds.add(port.id);
    ports.push(port);
  }
  device.ports = ports;

  const logs = device.consoleLogs;
  if (Array.isArray(logs) && logs.length > ctx.limits.maxConsoleLines) {
    const lines: readonly unknown[] = logs;
    device.consoleLogs = lines.slice(-ctx.limits.maxConsoleLines);
    ctx.warn('console-truncated', path);
  }

  if (!isDevice(device, ctx.limits)) return fail('invalid-device', path);
  if (!CATALOG_MODELS.has(device.model)) ctx.warn('unknown-model', `${path}.model`);
  return ok(device);
}

// Labels never contain control characters, so "\n" is a collision-free separator.
const portRef = (deviceId: string, portId: string): string => `${deviceId}\n${portId}`;

function plainList(value: unknown, limits: PlainJsonLimits): readonly unknown[] | null {
  const copied = toPlainJson(value, limits);
  if (!copied.ok || !Array.isArray(copied.value)) return null;
  return copied.value;
}

/**
 * Validates an untrusted value and returns a fresh topology: unique ids,
 * cables that point to existing ports, each port used by at most one cable.
 * `connectedCableId` is derived from the cables; uncabled ports are down.
 */
export function parseTopology(
  input: unknown,
  limits: TopologyLimits = TOPOLOGY_LIMITS,
): Result<ParsedTopology, TopologyParseError> {
  if (!isRecord(input)) return fail('not-an-object', '');
  const inDevices = input.devices;
  const inCables = input.cables;
  if (!Array.isArray(inDevices)) return fail('invalid-device', 'devices');
  if (!Array.isArray(inCables)) return fail('invalid-cable', 'cables');
  if (inDevices.length > limits.maxDevices) return fail('too-many-devices', 'devices');
  if (inCables.length > limits.maxCables) return fail('too-many-cables', 'cables');

  const rawDevices = plainList(inDevices, limits.json);
  if (rawDevices === null) return fail('unsafe-content', 'devices');
  const rawCables = plainList(inCables, limits.json);
  if (rawCables === null) return fail('unsafe-content', 'cables');

  const warnings: TopologyWarning[] = [];
  const ctx: ParseContext = {
    limits,
    warn: (code, path) => {
      if (warnings.length < MAX_WARNINGS) warnings.push({ code, path });
    },
  };

  const devices: NetworkDevice[] = [];
  const deviceIds = new Set<string>();
  const links = new Map<string, string | null>();
  for (let i = 0; i < rawDevices.length; i += 1) {
    const parsed = parseDevice(rawDevices[i], `devices[${i}]`, ctx);
    if (!parsed.ok) return parsed;
    const device = parsed.value;
    if (deviceIds.has(device.id)) return fail('duplicate-id', `devices[${i}]`);
    deviceIds.add(device.id);
    devices.push(device);
    for (const port of device.ports) links.set(portRef(device.id, port.id), null);
  }

  const cables: NetworkCable[] = [];
  const cableIds = new Set<string>();
  for (let i = 0; i < rawCables.length; i += 1) {
    const path = `cables[${i}]`;
    const rawCable = rawCables[i];
    if (!isRecord(rawCable)) return fail('invalid-cable', path);
    const cable = rebuild(rawCable, CABLE_FIELDS, path, ctx);
    if (!isCable(cable, limits.maxLabelLength)) return fail('invalid-cable', path);
    if (cableIds.has(cable.id)) return fail('duplicate-id', path);
    const source = portRef(cable.sourceDeviceId, cable.sourcePortId);
    const target = portRef(cable.targetDeviceId, cable.targetPortId);
    if (!links.has(source) || !links.has(target)) return fail('dangling-cable', path);
    if (source === target || links.get(source) !== null || links.get(target) !== null) {
      return fail('port-in-use', path);
    }
    links.set(source, cable.id);
    links.set(target, cable.id);
    cableIds.add(cable.id);
    cables.push(cable);
  }

  for (const device of devices) {
    device.ports = device.ports.map((port) => {
      const cableId = links.get(portRef(device.id, port.id)) ?? null;
      return withLink(port, cableId, cableId === null ? 'down' : port.status);
    });
  }
  return ok({ devices, cables, warnings });
}
