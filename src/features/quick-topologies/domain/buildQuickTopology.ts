import type {
  CableType,
  NetworkCable,
  NetworkDevice,
  NetworkPort,
  PortType,
  SwitchModel,
} from '../../../types/NetworkTypes';
import { err, ok, type Result } from '../../../utils/guards';
import type { IdSource } from '../../../utils/runtime';
import { validateQuickTopology } from './definitionGuard';
import type { QuickTopologyDefinition, QuickTopologyNode } from './types';

export interface QuickTopologyBuildDeps {
  /** Creates an unconnected device of the given model (the store's device factory in production). */
  createDevice: (model: SwitchModel, position: { x: number; y: number }) => NetworkDevice;
  /** Source of cable ids. */
  ids: IdSource;
  /** Models a definition may use; defaults to the device catalog. */
  knownModels?: ReadonlySet<string>;
}

export type QuickTopologyBuildError =
  | { code: 'invalid-definition'; detail: string }
  | { code: 'invalid-device'; detail: string }
  | { code: 'no-free-port'; detail: string };

export interface BuiltQuickTopology {
  devices: NetworkDevice[];
  cables: NetworkCable[];
}

const PORT_TYPE_FOR_MEDIA: Record<CableType, PortType> = { copper: 'RJ45', fiber: 'SFP' };

// Port and device ids never contain a line break, so it is a collision-free separator.
const portRef = (deviceId: string, portId: string): string => `${deviceId}\n${portId}`;

/** Copies the device, names it and addresses its first port. The input is never mutated. */
function configureDevice(
  device: NetworkDevice,
  node: QuickTopologyNode,
): Result<NetworkDevice, QuickTopologyBuildError> {
  const ports = device.ports.map(
    (port): NetworkPort => ({ ...port, status: 'down', connectedCableId: null, config: { ...port.config } }),
  );
  if (node.address !== undefined) {
    if (ports.length === 0) return err({ code: 'invalid-device', detail: `${node.ref} has no port to address` });
    ports[0].config.ipAddress = node.address.ip;
    ports[0].config.subnetMask = node.address.prefix;
  }
  const next: NetworkDevice = {
    ...device,
    hostname: node.hostname,
    position: { x: node.position.x, y: node.position.y },
    ports,
  };
  if (node.address?.gateway !== undefined) next.defaultGateway = node.address.gateway;
  return ok(next);
}

/** First enabled port of the type the cable needs that no earlier link has taken. */
function firstFreePort(
  device: NetworkDevice,
  media: CableType,
  taken: ReadonlySet<string>,
): NetworkPort | undefined {
  const wanted = PORT_TYPE_FOR_MEDIA[media];
  return device.ports.find(
    (port) => port.type === wanted && port.config.enabled && !taken.has(portRef(device.id, port.id)),
  );
}

/**
 * Turns a definition into devices and cables. Each link takes the first free
 * compatible port on both sides, in link order, so the result does not depend
 * on port naming. Devices are returned unlinked: link state is rebuilt from
 * the cables when the topology is applied.
 */
export function buildQuickTopology(
  definition: QuickTopologyDefinition,
  deps: QuickTopologyBuildDeps,
): Result<BuiltQuickTopology, QuickTopologyBuildError> {
  const checked = validateQuickTopology(definition, deps.knownModels);
  if (!checked.ok) {
    return err({ code: 'invalid-definition', detail: `${checked.error.code} at ${checked.error.path}` });
  }

  const devices: NetworkDevice[] = [];
  const byRef = new Map<string, NetworkDevice>();
  const deviceIds = new Set<string>();
  for (const node of definition.nodes) {
    const created = deps.createDevice(node.model, { x: node.position.x, y: node.position.y });
    if (deviceIds.has(created.id)) {
      return err({ code: 'invalid-device', detail: `duplicate device id for ${node.ref}` });
    }
    const configured = configureDevice(created, node);
    if (!configured.ok) return configured;
    deviceIds.add(created.id);
    byRef.set(node.ref, configured.value);
    devices.push(configured.value);
  }

  const cables: NetworkCable[] = [];
  const cableIds = new Set<string>();
  const taken = new Set<string>();
  for (const link of definition.links) {
    const label = `${link.from} -> ${link.to}`;
    const source = byRef.get(link.from);
    const target = byRef.get(link.to);
    if (source === undefined || target === undefined) {
      return err({ code: 'invalid-definition', detail: `unknown node in ${label}` });
    }
    const media: CableType = link.media ?? 'copper';
    const sourcePort = firstFreePort(source, media, taken);
    const targetPort = firstFreePort(target, media, taken);
    if (sourcePort === undefined || targetPort === undefined) {
      return err({ code: 'no-free-port', detail: `${label} (${media})` });
    }
    const id = `cable-${deps.ids()}`;
    if (cableIds.has(id)) return err({ code: 'invalid-device', detail: `duplicate cable id for ${label}` });
    cableIds.add(id);
    taken.add(portRef(source.id, sourcePort.id));
    taken.add(portRef(target.id, targetPort.id));
    cables.push({
      id,
      type: media,
      sourceDeviceId: source.id,
      sourcePortId: sourcePort.id,
      targetDeviceId: target.id,
      targetPortId: targetPort.id,
    });
  }

  return ok({ devices, cables });
}
