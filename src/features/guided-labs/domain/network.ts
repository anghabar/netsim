import type { NetworkCable, NetworkDevice, NetworkPort } from '../../../types/NetworkTypes';
import { isRecord } from '../../../utils/guards';
import { networkOf, parseIpv4 } from '../../../utils/ipv4';
import { createIpReachability } from './l3';

/**
 * Derives protocol state (spanning tree, VLAN reachability, OSPF adjacencies and
 * routes) from the configuration held in the store. The simulator keeps the
 * configuration; it does not run the protocols, so the lab checker computes what
 * a real network would converge to. Pure: no store, clock or randomness.
 */

export type StpRole = 'root' | 'designated' | 'alternate';
export interface PortStp {
  role: StpRole;
  blocked: boolean;
}

export interface NetworkView {
  deviceByName: (name: string) => NetworkDevice | undefined;
  portByName: (device: NetworkDevice, name: string) => NetworkPort | undefined;
  /** Host names of the elected root bridges (one per connected group of STP switches). */
  stpRoots: readonly string[];
  stpPort: (device: NetworkDevice, port: NetworkPort) => PortStp | undefined;
  /** "<device>:<port>" of every port blocked by spanning tree. */
  blockedPorts: readonly string[];
  l2Reachable: (a: NetworkDevice, b: NetworkDevice) => boolean;
  ospfAdjacent: (a: NetworkDevice, b: NetworkDevice) => boolean;
  /** Prefixes ("198.51.100.0/24") a router learns from other routers, not its own. */
  ospfLearned: (device: NetworkDevice) => ReadonlySet<string>;
  /** A ping from the device to the address succeeds, request and reply, honouring routes and access lists. */
  ipReachable: (from: NetworkDevice, address: string) => boolean;
  /** Number of links of an Eth-Trunk on `device` that are bundled with a compatible Eth-Trunk on `peer`. */
  trunkLinks: (device: NetworkDevice, trunkId: string, peer: NetworkDevice) => number;
}

const DEFAULT_STP_PRIORITY = 32768;
const DEFAULT_HELLO = 10;
const DEFAULT_DEAD = 40;

/** "GigabitEthernet 0/0/1" and "GE0/0/1" name the same port. */
export function canonicalPortName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^xgigabitethernet/, 'xge')
    .replace(/^gigabitethernet/, 'ge');
}

const isUp = (port: NetworkPort): boolean => port.status === 'up' && port.config.enabled !== false;
const nativeVlan = (port: NetworkPort): number => port.config.vlan ?? 1;
const isSwitch = (device: NetworkDevice): boolean => device.type === 'Switch';

function carries(device: NetworkDevice, port: NetworkPort, vlan: number): boolean {
  if (!isUp(port)) return false;
  if (vlan !== 1 && !device.vlans.includes(vlan)) return false;
  if (port.config.mode === 'access') return nativeVlan(port) === vlan;
  if (port.config.mode === 'trunk' || port.config.mode === 'hybrid') {
    return nativeVlan(port) === vlan || (port.config.allowedVlans ?? []).includes(vlan);
  }
  return false;
}

interface Link {
  x: NetworkDevice;
  px: NetworkPort;
  y: NetworkDevice;
  py: NetworkPort;
}

export function buildNetworkView(devices: readonly NetworkDevice[], cables: readonly NetworkCable[]): NetworkView {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const byName = new Map(devices.map((d) => [d.hostname, d]));

  const links: Link[] = [];
  const peerOf = new Map<string, { device: NetworkDevice; port: NetworkPort }>();
  for (const cable of cables) {
    const x = byId.get(cable.sourceDeviceId);
    const y = byId.get(cable.targetDeviceId);
    const px = x?.ports.find((p) => p.id === cable.sourcePortId);
    const py = y?.ports.find((p) => p.id === cable.targetPortId);
    if (!x || !y || !px || !py) continue;
    links.push({ x, px, y, py });
    peerOf.set(`${x.id}/${px.id}`, { device: y, port: py });
    peerOf.set(`${y.id}/${py.id}`, { device: x, port: px });
  }
  const key = (d: NetworkDevice, p: NetworkPort): string => `${d.id}/${p.id}`;

  // ---- Spanning tree -------------------------------------------------------
  const stpSwitches = devices.filter((d) => isSwitch(d) && d.stpEnabled === true);
  const stpIds = new Set(stpSwitches.map((d) => d.id));
  const stpLinks = links.filter((l) => stpIds.has(l.x.id) && stpIds.has(l.y.id) && isUp(l.px) && isUp(l.py));
  const bridgeCompare = (a: NetworkDevice, b: NetworkDevice): number => {
    const pa = a.stpPriority ?? DEFAULT_STP_PRIORITY;
    const pb = b.stpPriority ?? DEFAULT_STP_PRIORITY;
    if (pa !== pb) return pa - pb;
    const ma = a.macAddress ?? '';
    const mb = b.macAddress ?? '';
    return ma < mb ? -1 : ma > mb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const linkCost = (p: NetworkPort): number => ((p.speed ?? 1000) >= 10000 ? 2000 : 20000);

  const stpPorts = new Map<string, PortStp>();
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const start of stpSwitches) {
    if (seen.has(start.id)) continue;
    // Connected group of switches.
    const group: NetworkDevice[] = [];
    const queue = [start];
    seen.add(start.id);
    while (queue.length > 0) {
      const current = queue.shift() as NetworkDevice;
      group.push(current);
      for (const l of stpLinks) {
        const other = l.x.id === current.id ? l.y : l.y.id === current.id ? l.x : null;
        if (other && !seen.has(other.id)) {
          seen.add(other.id);
          queue.push(other);
        }
      }
    }
    const root = group.reduce((best, d) => (bridgeCompare(d, best) < 0 ? d : best), group[0]);
    roots.push(root.hostname);
    const dist = new Map<string, number>(group.map((d) => [d.id, d.id === root.id ? 0 : Infinity]));
    for (let round = 0; round < group.length; round += 1) {
      for (const l of stpLinks) {
        if (!dist.has(l.x.id) || !dist.has(l.y.id)) continue;
        const dx = dist.get(l.x.id) as number;
        const dy = dist.get(l.y.id) as number;
        if (dx + linkCost(l.px) < dy) dist.set(l.y.id, dx + linkCost(l.px));
        if (dy + linkCost(l.py) < dx) dist.set(l.x.id, dy + linkCost(l.py));
      }
    }
    // Root port of every non-root switch: cheapest path, then lowest neighbour bridge, then port name.
    const rootPort = new Map<string, NetworkPort>();
    for (const d of group) {
      if (d.id === root.id) continue;
      let best: { total: number; neighbour: NetworkDevice; port: NetworkPort } | null = null;
      for (const l of stpLinks) {
        const mine = l.x.id === d.id ? { p: l.px, n: l.y } : l.y.id === d.id ? { p: l.py, n: l.x } : null;
        if (!mine || !dist.has(mine.n.id)) continue;
        const total = (dist.get(mine.n.id) as number) + linkCost(mine.p);
        const better =
          best === null ||
          total < best.total ||
          (total === best.total &&
            (bridgeCompare(mine.n, best.neighbour) < 0 ||
              (bridgeCompare(mine.n, best.neighbour) === 0 && mine.p.name < best.port.name)));
        if (better) best = { total, neighbour: mine.n, port: mine.p };
      }
      if (best) rootPort.set(d.id, best.port);
    }
    const groupIds = new Set(group.map((d) => d.id));
    for (const l of stpLinks) {
      if (!groupIds.has(l.x.id)) continue;
      const rx = [dist.get(l.x.id) as number, l.x, l.px] as const;
      const ry = [dist.get(l.y.id) as number, l.y, l.py] as const;
      const xWins =
        rx[0] !== ry[0]
          ? rx[0] < ry[0]
          : bridgeCompare(l.x, l.y) !== 0
            ? bridgeCompare(l.x, l.y) < 0
            : l.px.name <= l.py.name;
      const [win, lose] = xWins ? [rx, ry] : [ry, rx];
      stpPorts.set(key(win[1], win[2]), { role: 'designated', blocked: false });
      const isRoot = rootPort.get(lose[1].id)?.id === lose[2].id;
      stpPorts.set(key(lose[1], lose[2]), isRoot ? { role: 'root', blocked: false } : { role: 'alternate', blocked: true });
    }
  }
  const blockedPorts: string[] = [];
  for (const d of stpSwitches) {
    for (const p of d.ports) {
      if (stpPorts.get(key(d, p))?.blocked === true) blockedPorts.push(`${d.hostname}:${p.name}`);
    }
  }
  const isBlocked = (d: NetworkDevice, p: NetworkPort): boolean => stpPorts.get(key(d, p))?.blocked === true;

  // ---- VLAN reachability ---------------------------------------------------
  const l2Reachable = (a: NetworkDevice, b: NetworkDevice): boolean => {
    if (a.id === b.id) return true;
    const visited = new Set<string>();
    const queue: Array<{ sw: NetworkDevice; vlan: number }> = [];
    const enter = (sw: NetworkDevice, vlan: number): void => {
      const id = `${sw.id}/${vlan}`;
      if (visited.has(id)) return;
      visited.add(id);
      queue.push({ sw, vlan });
    };
    for (const port of a.ports) {
      const peer = peerOf.get(key(a, port));
      if (!peer || !isUp(port) || !isUp(peer.port)) continue;
      if (peer.device.id === b.id) return true;
      if (isSwitch(peer.device) && peer.port.config.mode === 'access' && !isBlocked(peer.device, peer.port)) {
        if (carries(peer.device, peer.port, nativeVlan(peer.port))) enter(peer.device, nativeVlan(peer.port));
      }
    }
    while (queue.length > 0) {
      const { sw, vlan } = queue.shift() as { sw: NetworkDevice; vlan: number };
      for (const port of sw.ports) {
        if (!carries(sw, port, vlan) || isBlocked(sw, port)) continue;
        const peer = peerOf.get(key(sw, port));
        if (!peer || !isUp(peer.port)) continue;
        if (isSwitch(peer.device)) {
          if (carries(peer.device, peer.port, vlan) && !isBlocked(peer.device, peer.port)) enter(peer.device, vlan);
        } else if (peer.device.id === b.id && port.config.mode === 'access') {
          return true;
        }
      }
    }
    return false;
  };

  // ---- OSPF ----------------------------------------------------------------
  interface Statement {
    network: number;
    wildcard: number;
    area: string;
  }
  const statementsOf = (d: NetworkDevice): Statement[] => {
    const out: Statement[] = [];
    for (const entry of d.ospfLsdb ?? []) {
      if (!isRecord(entry) || entry.type !== 'network' || typeof entry.network !== 'string') continue;
      const network = parseIpv4(entry.network);
      if (network === null) continue;
      let wildcard: number | null = null;
      if (typeof entry.wildcard === 'string') wildcard = parseIpv4(entry.wildcard);
      else if (typeof entry.mask === 'number' && entry.mask >= 0 && entry.mask <= 32) {
        wildcard = entry.mask === 32 ? 0 : 2 ** (32 - entry.mask) - 1;
      }
      const area = typeof entry.area === 'string' || typeof entry.area === 'number' ? String(entry.area) : null;
      if (wildcard !== null && area !== null) out.push({ network, wildcard, area });
    }
    return out;
  };
  interface Participating {
    port: NetworkPort;
    area: string;
    prefix: string;
    cidr: string;
  }
  const participating = (d: NetworkDevice): Participating[] => {
    if (d.ospfEnabled !== true) return [];
    const statements = statementsOf(d);
    const out: Participating[] = [];
    for (const port of d.ports) {
      const ip = port.config.ipAddress;
      const len = port.config.subnetMask;
      if (!ip || typeof len !== 'number' || !isUp(port)) continue;
      const addr = parseIpv4(ip);
      const net = networkOf(ip, len);
      if (addr === null || net === null) continue;
      const hit = statements.find((s) => (((addr ^ s.network) & ~s.wildcard) >>> 0) === 0);
      if (hit) out.push({ port, area: hit.area, prefix: net, cidr: `${net}/${len}` });
    }
    return out;
  };
  const routers = devices.filter((d) => d.type === 'Router');
  const partsOf = new Map(routers.map((d) => [d.id, participating(d)]));
  const timer = (d: NetworkDevice, field: 'hello' | 'dead', fallback: number): number => {
    const t: unknown = d.ospfTimers;
    return isRecord(t) && typeof t[field] === 'number' ? t[field] : fallback;
  };
  const adjacency = new Map<string, Set<string>>(routers.map((d) => [d.id, new Set<string>()]));
  for (const l of links) {
    const pa = partsOf.get(l.x.id)?.find((p) => p.port.id === l.px.id);
    const pb = partsOf.get(l.y.id)?.find((p) => p.port.id === l.py.id);
    if (!pa || !pb || pa.cidr !== pb.cidr || pa.area !== pb.area) continue;
    if (!l.x.routerId || !l.y.routerId || l.x.routerId === l.y.routerId) continue;
    if (timer(l.x, 'hello', DEFAULT_HELLO) !== timer(l.y, 'hello', DEFAULT_HELLO)) continue;
    if (timer(l.x, 'dead', DEFAULT_DEAD) !== timer(l.y, 'dead', DEFAULT_DEAD)) continue;
    adjacency.get(l.x.id)?.add(l.y.id);
    adjacency.get(l.y.id)?.add(l.x.id);
  }
  const componentOf = (d: NetworkDevice): Set<string> => {
    const found = new Set<string>([d.id]);
    const queue = [d.id];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      for (const next of adjacency.get(id) ?? []) {
        if (!found.has(next)) {
          found.add(next);
          queue.push(next);
        }
      }
    }
    return found;
  };
  const ospfLearned = (d: NetworkDevice): ReadonlySet<string> => {
    const own = new Set((partsOf.get(d.id) ?? []).map((p) => p.cidr));
    const learned = new Set<string>();
    for (const id of componentOf(d)) {
      if (id === d.id) continue;
      for (const p of partsOf.get(id) ?? []) if (!own.has(p.cidr)) learned.add(p.cidr);
    }
    return learned;
  };

  // ---- Link aggregation ----------------------------------------------------
  const modesCompatible = (a: string, b: string): boolean => {
    if (a === 'static' || b === 'static') return a === b;
    return a === 'active' || b === 'active';
  };
  const trunkLinks = (device: NetworkDevice, trunkId: string, peer: NetworkDevice): number => {
    const mine = (device.ethTrunks ?? []).find((t) => t.id === trunkId);
    if (!mine) return 0;
    const counts = new Map<string, number>();
    for (const memberId of mine.members) {
      const port = device.ports.find((p) => p.id === memberId);
      const other = peerOf.get(`${device.id}/${memberId}`);
      if (!port || !other || other.device.id !== peer.id || !isUp(port) || !isUp(other.port)) continue;
      const theirs = (peer.ethTrunks ?? []).find(
        (t) => t.id === other.port.ethTrunkId && t.members.includes(other.port.id),
      );
      if (!theirs || !modesCompatible(mine.mode, theirs.mode)) continue;
      counts.set(theirs.id, (counts.get(theirs.id) ?? 0) + 1);
    }
    return Math.max(0, ...counts.values());
  };

  return {
    ipReachable: createIpReachability({ devices, peerOf, l2Reachable, isUp }),
    trunkLinks,
    deviceByName: (name) => byName.get(name),
    portByName: (device, name) => {
      const wanted = canonicalPortName(name);
      return device.ports.find((p) => canonicalPortName(p.name) === wanted);
    },
    stpRoots: roots,
    stpPort: (d, p) => stpPorts.get(key(d, p)),
    blockedPorts,
    l2Reachable,
    ospfAdjacent: (a, b) => adjacency.get(a.id)?.has(b.id) === true,
    ospfLearned,
  };
}
