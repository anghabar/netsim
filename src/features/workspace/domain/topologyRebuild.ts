import type { NetworkCable } from '../../../types/NetworkTypes';
import { err, ok, toPlainJson, type JsonValue, type Result } from '../../../utils/guards';
import type { IdSource } from '../../../utils/runtime';
import { parseTopology, TOPOLOGY_LIMITS, type TopologyWarning } from '../../../utils/topology/topologyGuards';
import { WORKSPACE_LIMITS, type TopologyData } from './workspaceModel';

/**
 * Validated copies of a topology for snapshots and shareable files.
 *
 * The input goes through the shared topology guard, is copied as bounded plain
 * data, transformed on that copy, and goes through the guard again, so the
 * result is always a topology the simulator accepts. Nothing from the input is
 * spread or merged.
 */

type JsonObject = { [name: string]: JsonValue };

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Field names that suggest a secret (for example a BGP neighbour password). */
const SENSITIVE_NAME = /pass(word|wd|phrase)|secret|credential|token|psk|(private|api|auth|shared)[-_]?key/i;

/** Free-text fields: their content is never treated as a reference to an id. */
const LABEL_FIELDS: ReadonlySet<string> = new Set(['hostname', 'name', 'description', 'model', 'vendor', 'type']);

const MAX_REPORT_PATH = 200;

export interface RebuildOptions {
  /** When given, every device, port and cable id is replaced with a new one. */
  ids?: IdSource;
  /** Clears console output, CLI session state and staged configuration. */
  resetSession: boolean;
  /** Leaves out fields whose name suggests a secret. */
  removeSensitive: boolean;
}

export interface RebuiltTopology extends TopologyData {
  /** Number of secret-looking fields found (removed or kept, depending on the options). */
  sensitiveCount: number;
  /** "<hostname>: <field path>" for the first fields found; never contains values. */
  sensitiveFields: string[];
  /** Warnings of the guard for the original input. */
  warnings: TopologyWarning[];
}

const holdsSecret = (name: string, value: JsonValue): boolean => {
  if (!SENSITIVE_NAME.test(name)) return false;
  return typeof value === 'object' ? value !== null : typeof value === 'string' && value.length > 0;
};

// Both walkers only receive output of toPlainJson, which has no prototype-related names.
function filterSensitive(
  value: JsonValue,
  path: string,
  remove: boolean,
  found: (path: string) => void,
): JsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => filterSensitive(item, `${path}[${index}]`, remove, found));
  }
  const out: JsonObject = {};
  for (const name of Object.keys(value)) {
    const item = value[name];
    const itemPath = path.length > 0 ? `${path}.${name}` : name;
    if (holdsSecret(name, item)) {
      found(itemPath);
      if (!remove) out[name] = item;
    } else {
      out[name] = filterSensitive(item, itemPath, remove, found);
    }
  }
  return out;
}

function remapStrings(value: JsonValue, lookup: (text: string) => string | undefined): JsonValue {
  if (typeof value === 'string') return lookup(value) ?? value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => remapStrings(item, lookup));
  const out: JsonObject = {};
  for (const name of Object.keys(value)) {
    const item = value[name];
    out[name] = LABEL_FIELDS.has(name) && typeof item === 'string' ? item : remapStrings(item, lookup);
  }
  return out;
}

/** Validates `input` and returns a fresh topology transformed as requested. */
export function rebuildTopology(input: unknown, options: RebuildOptions): Result<RebuiltTopology, 'invalid-topology'> {
  const checked = parseTopology(input);
  if (!checked.ok) return err('invalid-topology');
  const source = checked.value;

  const plain = toPlainJson(source.devices, TOPOLOGY_LIMITS.json);
  const entries = plain.ok ? plain.value : null;
  if (!Array.isArray(entries) || entries.length !== source.devices.length) return err('invalid-topology');

  const ids = options.ids;
  const deviceIds = new Map<string, string>();
  const portIds = new Map<string, Map<string, string>>();
  if (ids) {
    for (const device of source.devices) {
      deviceIds.set(device.id, ids());
      const ports = new Map<string, string>();
      for (const port of device.ports) ports.set(port.id, ids());
      portIds.set(device.id, ports);
    }
  }

  let sensitiveCount = 0;
  const sensitiveFields: string[] = [];
  const devices: JsonValue[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const original = source.devices[i];
    const entry = entries[i];
    if (!isJsonObject(entry)) return err('invalid-topology');

    if (options.resetSession) {
      entry.consoleLogs = [];
      entry.cliState = { view: 'user-view' };
      delete entry.candidateState;
    }

    let device = filterSensitive(entry, '', options.removeSensitive, (path) => {
      sensitiveCount += 1;
      if (sensitiveFields.length < WORKSPACE_LIMITS.maxSensitiveFieldsListed) {
        sensitiveFields.push(`${original.hostname}: ${path}`.slice(0, MAX_REPORT_PATH));
      }
    });

    if (ids) {
      const nextId = deviceIds.get(original.id);
      const ownPorts = portIds.get(original.id);
      if (nextId === undefined || ownPorts === undefined) return err('invalid-topology');
      // References to this device's ports (or to any device) follow the new ids.
      device = remapStrings(device, (text) => ownPorts.get(text) ?? deviceIds.get(text));
      if (!isJsonObject(device)) return err('invalid-topology');
      const ports = device.ports;
      if (!Array.isArray(ports) || ports.length !== original.ports.length) return err('invalid-topology');
      device.id = nextId;
      for (let j = 0; j < ports.length; j += 1) {
        const port = ports[j];
        const nextPortId = ownPorts.get(original.ports[j].id);
        if (!isJsonObject(port) || nextPortId === undefined) return err('invalid-topology');
        port.id = nextPortId;
      }
    }
    devices.push(device);
  }

  let cables: NetworkCable[] = source.cables;
  if (ids) {
    cables = [];
    for (const cable of source.cables) {
      const sourceDeviceId = deviceIds.get(cable.sourceDeviceId);
      const sourcePortId = portIds.get(cable.sourceDeviceId)?.get(cable.sourcePortId);
      const targetDeviceId = deviceIds.get(cable.targetDeviceId);
      const targetPortId = portIds.get(cable.targetDeviceId)?.get(cable.targetPortId);
      if (
        sourceDeviceId === undefined ||
        sourcePortId === undefined ||
        targetDeviceId === undefined ||
        targetPortId === undefined
      ) {
        return err('invalid-topology');
      }
      const next: NetworkCable = {
        id: ids(),
        type: cable.type,
        sourceDeviceId,
        sourcePortId,
        targetDeviceId,
        targetPortId,
      };
      if (cable.trunkId !== undefined) next.trunkId = cable.trunkId;
      cables.push(next);
    }
  }

  const rebuilt = parseTopology({ devices, cables });
  if (!rebuilt.ok) return err('invalid-topology');
  return ok({
    devices: rebuilt.value.devices,
    cables: rebuilt.value.cables,
    sensitiveCount,
    sensitiveFields,
    warnings: source.warnings,
  });
}
