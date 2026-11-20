import type { NetworkCable, NetworkDevice, NetworkPort } from '../../../types/NetworkTypes';
import { deviceFactory } from '../../../store/slices/createTopologySlice';
import { err, ok, type Result } from '../../../utils/guards';
import type { IdSource, RandomSource } from '../../../utils/runtime';
import { canonicalPortName } from './network';
import type { GuidedLab } from './types';

export interface SetupDeps {
  ids: IdSource;
  random: RandomSource;
}

export type SetupError = { code: 'unknown-endpoint' | 'port-in-use'; detail: string };

const splitEndpoint = (endpoint: string): { device: string; port: string } => {
  const at = endpoint.indexOf(':');
  return { device: endpoint.slice(0, at), port: endpoint.slice(at + 1) };
};

/** Builds the starting devices and cables of a lab, with its initial port settings applied. */
export function buildGuidedLabTopology(
  lab: GuidedLab,
  deps: SetupDeps,
): Result<{ devices: NetworkDevice[]; cables: NetworkCable[] }, SetupError> {
  const devices: NetworkDevice[] = [];
  const byName = new Map<string, NetworkDevice>();
  lab.setup.devices.forEach((spec, index) => {
    const device = deviceFactory(spec.model, { x: 150 + (index % 3) * 250, y: 150 + Math.floor(index / 3) * 200 }, deps);
    device.hostname = spec.name;
    devices.push(device);
    byName.set(spec.name, device);
  });

  const findPort = (endpoint: string): { device: NetworkDevice; port: NetworkPort } | null => {
    const { device: name, port: portName } = splitEndpoint(endpoint);
    const device = byName.get(name);
    const port = device?.ports.find((p) => canonicalPortName(p.name) === canonicalPortName(portName));
    return device && port ? { device, port } : null;
  };

  const cables: NetworkCable[] = [];
  for (const link of lab.setup.links) {
    const from = findPort(link.from);
    const to = findPort(link.to);
    if (!from || !to) return err({ code: 'unknown-endpoint', detail: `${link.from} - ${link.to}` });
    if (from.port.connectedCableId || to.port.connectedCableId) {
      return err({ code: 'port-in-use', detail: `${link.from} - ${link.to}` });
    }
    const cable: NetworkCable = {
      id: deps.ids(),
      type: 'copper',
      sourceDeviceId: from.device.id,
      sourcePortId: from.port.id,
      targetDeviceId: to.device.id,
      targetPortId: to.port.id,
    };
    cables.push(cable);
    from.port.status = 'up';
    from.port.connectedCableId = cable.id;
    to.port.status = 'up';
    to.port.connectedCableId = cable.id;
  }

  for (const init of lab.setup.ports) {
    const found = findPort(`${init.device}:${init.port}`);
    if (!found) return err({ code: 'unknown-endpoint', detail: `${init.device}:${init.port}` });
    if (init.ip !== undefined && init.prefix !== undefined) {
      found.port.config.ipAddress = init.ip;
      found.port.config.subnetMask = init.prefix;
    }
    if (init.vlan !== undefined) found.port.config.vlan = init.vlan;
    if (init.gateway !== undefined) found.device.defaultGateway = init.gateway;
    if (init.mode !== undefined) found.port.config.mode = init.mode;
    if (init.allowedVlans !== undefined) found.port.config.allowedVlans = [...init.allowedVlans];
  }
  for (const init of lab.setup.vlans ?? []) {
    const device = byName.get(init.device);
    if (!device) return err({ code: 'unknown-endpoint', detail: init.device });
    device.vlans = [...new Set([...device.vlans, ...init.vlans])];
  }
  for (const init of lab.setup.routes ?? []) {
    const device = byName.get(init.device);
    if (!device) return err({ code: 'unknown-endpoint', detail: init.device });
    const [destination, length] = init.prefix.split('/');
    device.routingTable = [
      ...(device.routingTable ?? []),
      { destination, mask: Number(length), proto: 'Static', pre: 60, cost: 0, nextHop: init.nextHop, interface: '' },
    ];
  }
  return ok({ devices, cables });
}
