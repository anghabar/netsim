import type { Lab, NetworkCable, NetworkDevice, NetworkPort } from '../types/NetworkTypes';
import { deviceFactory, type DeviceFactoryDeps } from '../store/slices/createTopologySlice';
import { isRecord } from './guards';
import { cryptoIdSource, mathRandomSource } from './runtime';

const DEFAULT_DEPS: DeviceFactoryDeps = { ids: cryptoIdSource, random: mathRandomSource };
const MAX_LAB_DEVICES = 64;
const SINGLE_NAME_TYPES: readonly string[] = ['Switch', 'Router', 'Internet'];

const defaultModel = (type: string): string =>
  type === 'Router' ? 'Huawei-AR6121' : type === 'PC' ? 'PC' : 'Huawei-S5700-28TP';

/** "GigabitEthernet 0/0/1" and "GE0/0/1" name the same port. */
function canonicalPortName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^xgigabitethernet/, 'xge')
    .replace(/^gigabitethernet/, 'ge');
}

function splitEndpoint(endpoint: string): { device: string; port: string | undefined } {
  const at = endpoint.indexOf(':');
  return at === -1
    ? { device: endpoint, port: undefined }
    : { device: endpoint.slice(0, at), port: endpoint.slice(at + 1) };
}

/**
 * Builds the devices and cables of a lab. Endpoints are resolved by exact
 * (normalised) port name; when that port does not exist or is already cabled,
 * the first free port of the same medium is used, so a port never carries two
 * cables. Connections that cannot be resolved are skipped.
 */
export const buildLabTopology = (
  lab: Lab,
  deps: DeviceFactoryDeps = DEFAULT_DEPS,
): { devices: NetworkDevice[]; cables: NetworkCable[] } => {
  const devices: NetworkDevice[] = [];
  const cables: NetworkCable[] = [];
  const byName = new Map<string, NetworkDevice>();

  let x = 150;
  let y = 150;
  for (const group of lab.topology.devices) {
    const type = group.type || 'Switch';
    const config: unknown = group.config;
    const model =
      isRecord(config) && typeof config.model === 'string' && config.model.length > 0
        ? config.model
        : defaultModel(type);
    const count = Number.isInteger(group.count) ? Math.max(0, group.count) : 0;
    const single = count === 1 && SINGLE_NAME_TYPES.includes(type);

    for (let i = 0; i < count && devices.length < MAX_LAB_DEVICES; i += 1) {
      const device = deviceFactory(model, { x, y }, deps);
      device.hostname = single ? type : `${type}${i + 1}`;
      devices.push(device);
      byName.set(device.hostname, device);

      x += 250;
      if (x > 800) {
        x = 150;
        y += 200;
      }
    }
  }

  const used = new Set<NetworkPort>();
  const resolvePort = (device: NetworkDevice, name: string | undefined, fiber: boolean): NetworkPort | undefined => {
    const free = device.ports.filter((port) => !used.has(port));
    if (name !== undefined && name.length > 0) {
      const wanted = canonicalPortName(name);
      const exact = free.find((port) => canonicalPortName(port.name) === wanted);
      if (exact) return exact;
    }
    const medium = fiber ? 'SFP' : 'RJ45';
    return free.find((port) => port.type === medium) ?? free.find(() => true);
  };

  for (const connection of lab.topology.connections) {
    const from = splitEndpoint(connection.from);
    const to = splitEndpoint(connection.to);
    const source = byName.get(from.device);
    const target = byName.get(to.device);
    if (!source || !target) continue;

    const fiber = connection.type === 'fiber';
    const sourcePort = resolvePort(source, from.port, fiber);
    if (!sourcePort) continue;
    used.add(sourcePort);
    const targetPort = resolvePort(target, to.port, fiber);
    if (!targetPort) {
      used.delete(sourcePort);
      continue;
    }
    used.add(targetPort);

    const cable: NetworkCable = {
      id: deps.ids(),
      type: fiber ? 'fiber' : 'copper',
      sourceDeviceId: source.id,
      sourcePortId: sourcePort.id,
      targetDeviceId: target.id,
      targetPortId: targetPort.id,
    };
    cables.push(cable);
    sourcePort.status = 'up';
    sourcePort.connectedCableId = cable.id;
    targetPort.status = 'up';
    targetPort.connectedCableId = cable.id;
  }

  return { devices, cables };
};
