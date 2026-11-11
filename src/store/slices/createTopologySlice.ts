import type { StateCreator } from 'zustand';
import type {
  DeviceType,
  NetworkCable,
  NetworkDevice,
  NetworkPort,
  PortConfig,
  PortMode,
  SfpModule,
  SwitchModel,
} from '../../types/NetworkTypes';
import { defaultDeviceCatalog } from '../../data/deviceCatalog';
import { wasmSetTopology } from '../../wasm/wasmBridge';
import { err, isRecord, ok, type Result } from '../../utils/guards';
import { cryptoIdSource, mathRandomSource, type IdSource, type RandomSource } from '../../utils/runtime';
import { isModelLabel, parseTopology, withLink } from '../../utils/topology/topologyGuards';
import { isLabInProgress, loadTopology } from '../topologyAutosave';
import type { NetworkState } from '../useNetworkStore';

// Placeholders kept for the CLI layer; the routing engine recomputes these.
export const recomputeOspf = <T>(devices: T[], _cables: readonly unknown[]) => ({ devices });
export const cleanDhcpLeases = <T>(devices: T[]): T[] => devices;

export type ReplaceTopologyError = 'lab-in-progress' | 'invalid-topology';

export interface TopologySlice {
  devices: NetworkDevice[];
  cables: NetworkCable[];
  /** Model name of the SFP module waiting to be inserted, if any. */
  pendingSfpModule: string | null;
  selectedPort: { deviceId: string; portId: string } | null;

  /** Restores the locally autosaved topology, if a valid one exists. */
  initialize: () => void;
  addDevice: (model: SwitchModel, position?: { x: number; y: number }) => NetworkDevice;
  /** Removes a device together with its cables. */
  removeDevice: (id: string) => void;
  addCable: (cable: NetworkCable) => void;
  removeCable: (id: string) => void;
  updateDevicePosition: (id: string, pos: { x: number; y: number }) => void;
  updateDevice: (id: string, updates: Partial<NetworkDevice>) => void;
  updatePortConfig: (deviceId: string, portId: string, config: Partial<PortConfig>) => void;
  onPortClick: (deviceId: string, portId: string) => { success: boolean; message?: string };
  insertSfp: (deviceId: string, portId: string, model: string) => void;
  selectSfpModule: (model: unknown) => void;

  // Local-only placeholders kept for compatibility with existing components.
  loadSession: (user: string, isDemo: boolean, altId?: string | null) => Promise<{ ok: boolean; source: 'local' }>;
  saveRemote: () => Promise<boolean>;
  collaborationLock: { owner: string | null; busy: boolean };
  presenceEntries: readonly string[];
  workspaceSecurity: { roles: Record<string, string> };

  setTopology: (devices: NetworkDevice[], cables: NetworkCable[]) => void;
  /**
   * The only way a feature swaps the whole topology: validates the input,
   * refuses while a lab is in progress, closes consoles of devices that
   * disappear, clears selections and rebuilds link state from the cables.
   */
  replaceTopology: (next: {
    devices: NetworkDevice[];
    cables: NetworkCable[];
  }) => Result<void, ReplaceTopologyError>;
}

export const createPort = (id: string, name: string, type: 'RJ45' | 'SFP', mode: PortMode): NetworkPort => ({
  id,
  name,
  type,
  status: 'down',
  config: {
    enabled: true,
    vlan: 1,
    mode,
  },
  sfpModule: type === 'SFP' ? null : undefined,
  connectedCableId: null,
  speed: type === 'SFP' ? 10000 : 1000,
});

export interface DeviceFactoryDeps {
  ids: IdSource;
  random: RandomSource;
}

const DEFAULT_FACTORY_DEPS: DeviceFactoryDeps = { ids: cryptoIdSource, random: mathRandomSource };

const generateMac = (random: RandomSource): string => {
  const hex = '0123456789ABCDEF';
  const digit = (): string => hex[Math.min(15, Math.floor(random() * 16))];
  let mac = '50:50:00'; // Fictitious local prefix
  for (let i = 0; i < 3; i += 1) mac += `:${digit()}${digit()}`;
  return mac;
};

const generatePorts = (model: string, ids: IdSource): NetworkPort[] => {
  const ports: NetworkPort[] = [];
  const entry = defaultDeviceCatalog.find((m) => m.model === model);

  if (!entry) {
    const isSwitch = model.toLowerCase().includes('switch');
    const count = isSwitch ? 24 : 4;
    for (let i = 1; i <= count; i += 1) {
      ports.push(createPort(ids(), `GE0/0/${i}`, 'RJ45', isSwitch ? 'access' : 'routed'));
    }
    return ports;
  }

  const geCount = entry.ports.ge || 0;
  const xgeCount = entry.ports.xge || 0;
  const isRouter = entry.category === 'Router';
  const isHost = entry.category === 'Host';
  const portMode: PortMode = isRouter || isHost ? 'routed' : 'access';

  for (let i = 1; i <= geCount; i += 1) {
    const name = isRouter ? `GE0/0/${i - 1}` : isHost ? `eth${i - 1}` : `GE0/0/${i}`;
    ports.push(createPort(ids(), name, 'RJ45', portMode));
  }
  for (let i = 1; i <= xgeCount; i += 1) {
    ports.push(createPort(ids(), `XGE0/0/${i}`, 'SFP', isRouter ? 'routed' : 'trunk'));
  }
  return ports;
};

export const deviceFactory = (
  model: SwitchModel | string,
  position: { x: number; y: number },
  deps: DeviceFactoryDeps = DEFAULT_FACTORY_DEPS,
): NetworkDevice => {
  const id = deps.ids();
  const safeModel: SwitchModel = isModelLabel(model) ? model : 'NS-Switch-L3-24';
  const entry = defaultDeviceCatalog.find((m) => m.model === safeModel);
  // Routers are classified by catalog data; the name is only a fallback for models outside the catalog.
  const isRouter = entry ? entry.category === 'Router' : safeModel.includes('Router');
  const type: DeviceType = isRouter ? 'Router' : safeModel.includes('PC') ? 'PC' : 'Switch';

  return {
    id,
    type,
    status: 'on',
    vendor: entry?.vendor || 'Huawei',
    hostname: `${safeModel}-${id.slice(0, 4)}`,
    macAddress: generateMac(deps.random),
    model: safeModel,
    position: {
      x: position?.x ?? 100,
      y: position?.y ?? 100,
    },
    ports: generatePorts(safeModel, deps.ids),
    vlans: [1],
    consoleLogs: ['System ready.'],
    cliState: { view: 'user-view' },
  };
};

const releasePorts = (device: NetworkDevice, cableIds: ReadonlySet<string>): NetworkDevice => {
  const held = (port: NetworkPort): boolean =>
    typeof port.connectedCableId === 'string' && cableIds.has(port.connectedCableId);
  if (!device.ports.some(held)) return device;
  return { ...device, ports: device.ports.map((port) => (held(port) ? withLink(port, null, 'down') : port)) };
};

const isShutWhileUp = (port: NetworkPort): boolean => !port.config.enabled && port.status === 'up';
const shut = (port: NetworkPort): NetworkPort => ({ ...port, status: 'down' });

const sfpModelName = (value: unknown): string | null => {
  const name = typeof value === 'string' ? value : isRecord(value) && typeof value.model === 'string' ? value.model : '';
  return name.length > 0 && name.length <= 64 ? name : null;
};

export const createTopologySlice: StateCreator<NetworkState, [], [], TopologySlice> = (set, get) => ({
  devices: [],
  cables: [],
  pendingSfpModule: null,
  selectedPort: null,
  collaborationLock: { owner: null, busy: false },
  presenceEntries: [],
  workspaceSecurity: { roles: {} },

  initialize: () => {
    const saved = loadTopology(get().runtime.storage);
    if (!saved.ok) return;
    set({ devices: saved.value.devices, cables: saved.value.cables });
  },

  addDevice: (model, position = { x: 100, y: 100 }) => {
    const newDev = deviceFactory(model, position, get().runtime);
    set((state) => ({ devices: [...state.devices, newDev] }));
    return newDev;
  },

  removeDevice: (id) =>
    set((state) => {
      const gone = new Set(
        state.cables.filter((c) => c.sourceDeviceId === id || c.targetDeviceId === id).map((c) => c.id),
      );
      return {
        cables: state.cables.filter((c) => !gone.has(c.id)),
        devices: state.devices.filter((d) => d.id !== id).map((d) => releasePorts(d, gone)),
        selectedPort: state.selectedPort?.deviceId === id ? null : state.selectedPort,
      };
    }),

  addCable: (cable) =>
    set((state) => ({
      cables: [...state.cables, cable],
      devices: state.devices.map((d) => {
        if (d.id !== cable.sourceDeviceId && d.id !== cable.targetDeviceId) return d;
        return {
          ...d,
          ports: d.ports.map((p) => {
            const isEnd =
              (d.id === cable.sourceDeviceId && p.id === cable.sourcePortId) ||
              (d.id === cable.targetDeviceId && p.id === cable.targetPortId);
            return isEnd ? withLink(p, cable.id, 'up') : p;
          }),
        };
      }),
    })),

  removeCable: (id) =>
    set((state) => {
      const gone = new Set([id]);
      return {
        cables: state.cables.filter((c) => c.id !== id),
        devices: state.devices.map((d) => releasePorts(d, gone)),
      };
    }),

  updateDevicePosition: (id, pos) =>
    set((state) => ({
      devices: state.devices.map((d) => (d.id === id ? { ...d, position: pos } : d)),
    })),

  updateDevice: (id, updates) =>
    set((state) => ({
      devices: state.devices.map((d) => (d.id === id ? { ...d, ...updates } : d)),
    })),

  updatePortConfig: (deviceId, portId, config) =>
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          ports: d.ports.map((p) => (p.id === portId ? { ...p, config: { ...p.config, ...config } } : p)),
        };
      }),
    })),

  onPortClick: (deviceId, portId) => {
    const state = get();
    const findPort = (dId: string, pId: string): NetworkPort | undefined =>
      state.devices.find((d) => d.id === dId)?.ports.find((p) => p.id === pId);

    // 1. SFP insertion
    if (state.pendingSfpModule !== null) {
      const port = findPort(deviceId, portId);
      if (port && port.type === 'SFP') {
        state.insertSfp(deviceId, portId, state.pendingSfpModule);
        set({ pendingSfpModule: null, selectedPort: null });
        return { success: true, message: 'Module inserted' };
      }
    }

    // 2. Click-to-connect
    const selected = state.selectedPort;
    if (selected && (selected.deviceId !== deviceId || selected.portId !== portId)) {
      const sourcePort = findPort(selected.deviceId, selected.portId);
      const targetPort = findPort(deviceId, portId);
      if (sourcePort && targetPort && !sourcePort.connectedCableId && !targetPort.connectedCableId) {
        state.addCable({
          id: `cable-${state.runtime.ids()}`,
          sourceDeviceId: selected.deviceId,
          sourcePortId: selected.portId,
          targetDeviceId: deviceId,
          targetPortId: portId,
          type: sourcePort.type === 'SFP' ? 'fiber' : 'copper',
        });
        set({ selectedPort: null });
        return { success: true, message: 'Connected' };
      }
    }

    // Default: select the port
    set({ selectedPort: { deviceId, portId } });
    return { success: true };
  },

  insertSfp: (deviceId, portId, model) => {
    const longReach = model === '10G-LR';
    const sfpModule: SfpModule = {
      id: get().runtime.ids(),
      model: longReach ? '10G-LR' : '10G-SR',
      speed: 10000,
      distance: longReach ? 10000 : 300,
    };
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return { ...d, ports: d.ports.map((p) => (p.id === portId ? { ...p, sfpModule } : p)) };
      }),
    }));
  },

  selectSfpModule: (model) => set({ pendingSfpModule: sfpModelName(model) }),

  loadSession: async () => ({ ok: true, source: 'local' }),
  saveRemote: async () => true,

  setTopology: (devices, cables) => {
    set({ devices, cables });
    try {
      wasmSetTopology(devices, cables);
    } catch {
      // The engine is not ready yet; the entry point pushes the topology once it is.
    }
  },

  replaceTopology: (next) => {
    if (isLabInProgress(get().currentLabSession)) return err('lab-in-progress');
    const parsed = parseTopology(next);
    if (!parsed.ok) return err('invalid-topology');
    const { devices, cables } = parsed.value;

    const kept = new Set(devices.map((d) => d.id));
    for (const consoleId of [...get().openConsoleIds]) {
      if (!kept.has(consoleId)) get().closeConsole(consoleId);
    }
    set({ selectedPort: null, pendingSfpModule: null, activeTrafficParams: [], packetTrace: null });

    const unlinked = devices.map((d) => ({ ...d, ports: d.ports.map((p) => withLink(p, null, 'down')) }));
    get().setTopology(unlinked, []);
    for (const cable of cables) get().addCable(cable);

    // Administratively disabled ports stay down even when cabled.
    if (get().devices.some((d) => d.ports.some(isShutWhileUp))) {
      set((state) => ({
        devices: state.devices.map((d) =>
          d.ports.some(isShutWhileUp) ? { ...d, ports: d.ports.map((p) => (isShutWhileUp(p) ? shut(p) : p)) } : d,
        ),
      }));
    }
    return ok(undefined);
  },
});
