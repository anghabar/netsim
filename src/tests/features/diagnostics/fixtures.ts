import type { NetworkCable, NetworkDevice, NetworkPort, PortMode } from '../../../types/NetworkTypes';

export interface PortOptions {
  enabled?: boolean;
  mode?: PortMode;
  vlan?: number;
  ip?: string;
  prefix?: number;
}

export function port(id: string, name: string, options: PortOptions = {}): NetworkPort {
  return {
    id,
    name,
    type: 'RJ45',
    status: 'up',
    config: {
      enabled: options.enabled ?? true,
      mode: options.mode ?? 'access',
      vlan: options.vlan ?? 1,
      ipAddress: options.ip,
      subnetMask: options.prefix,
    },
  };
}

export function device(
  id: string,
  hostname: string,
  ports: NetworkPort[],
  extra: Partial<NetworkDevice> = {},
): NetworkDevice {
  return {
    id,
    type: 'Switch',
    vendor: 'Huawei',
    hostname,
    model: 'Huawei-S5700-28TP',
    ports,
    position: { x: 0, y: 0 },
    vlans: [1],
    consoleLogs: [],
    cliState: { view: 'user-view' },
    ...extra,
  };
}

export function cable(
  id: string,
  source: readonly [deviceId: string, portId: string],
  target: readonly [deviceId: string, portId: string],
): NetworkCable {
  return {
    id,
    type: 'copper',
    sourceDeviceId: source[0],
    sourcePortId: source[1],
    targetDeviceId: target[0],
    targetPortId: target[1],
  };
}

/** True when the text contains a C0 control character or DEL. */
export function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
