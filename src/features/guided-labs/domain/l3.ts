import type { NetworkDevice, NetworkPort, RouteEntry } from '../../../types/NetworkTypes';
import { findRuleMatch } from '../../../store/slices/cli/helpers';
import { isRecord } from '../../../utils/guards';
import { networkOf, parseIpv4 } from '../../../utils/ipv4';

/**
 * IPv4 reachability derived from interface addresses, VLAN interfaces, static
 * routes, default gateways and access lists. A packet is followed hop by hop:
 * longest-prefix match, then the next hop must be a neighbour on a shared
 * subnet. Pure: it reads the topology it is given and nothing else.
 */

export interface L3Context {
  devices: readonly NetworkDevice[];
  peerOf: ReadonlyMap<string, { device: NetworkDevice; port: NetworkPort }>;
  l2Reachable: (a: NetworkDevice, b: NetworkDevice) => boolean;
  isUp: (port: NetworkPort) => boolean;
  /** Routes the router learned through OSPF, with the neighbour address to send to. */
  ospfRoutes?: (device: NetworkDevice) => OspfRoute[];
}

export interface OspfRoute {
  net: string;
  prefix: number;
  nextHop: string;
}

/** A transport flow the access lists can match on. */
interface Flow {
  protocol?: string;
  srcPort?: number;
  dstPort?: number;
}

const CLIENT_PORT = 49152;

interface Iface {
  device: NetworkDevice;
  ip: string;
  prefix: number;
  net: string;
  port?: NetworkPort;
  vlan?: number;
}

const MAX_HOPS = 16;

const inside = (ip: string, net: string, prefix: number): boolean => {
  const mine = networkOf(ip, prefix);
  return mine !== null && mine === net;
};

export function createIpReachability(
  ctx: L3Context,
): (from: NetworkDevice, address: string, service?: { protocol: string; port: number }) => boolean {
  const ifacesOf = (device: NetworkDevice): Iface[] => {
    const out: Iface[] = [];
    if (device.type !== 'Switch') {
      for (const port of device.ports) {
        const ip = port.config.ipAddress;
        const prefix = port.config.subnetMask;
        if (!ip || typeof prefix !== 'number' || port.config.enabled === false || !ctx.isUp(port)) continue;
        const net = networkOf(ip, prefix);
        if (net !== null && parseIpv4(ip) !== null) out.push({ device, ip, prefix, net, port });
      }
    }
    for (const v of device.vlanifs ?? []) {
      if (!v.ipAddress || typeof v.subnetMask !== 'number' || v.enabled === false) continue;
      if (v.vlanId !== 1 && !device.vlans.includes(v.vlanId)) continue;
      const net = networkOf(v.ipAddress, v.subnetMask);
      if (net !== null) out.push({ device, ip: v.ipAddress, prefix: v.subnetMask, net, vlan: v.vlanId });
    }
    return out;
  };
  const cache = new Map<string, Iface[]>();
  const ifaces = (device: NetworkDevice): Iface[] => {
    const known = cache.get(device.id);
    if (known) return known;
    const made = ifacesOf(device);
    cache.set(device.id, made);
    return made;
  };

  /** Is interface j on the same segment as interface i (direct cable, switches in between, or VLAN interface)? */
  const attached = (i: Iface, j: Iface): boolean => {
    if (i.device.id === j.device.id) return false;
    if (i.port && j.port) return ctx.l2Reachable(i.device, j.device);
    const [portSide, vlanSide] = i.port ? [i, j] : [j, i];
    if (!portSide.port || vlanSide.vlan === undefined) return false;
    const peer = ctx.peerOf.get(`${portSide.device.id}/${portSide.port.id}`);
    return (
      peer !== undefined &&
      peer.device.id === vlanSide.device.id &&
      ctx.isUp(peer.port) &&
      peer.port.config.mode === 'access' &&
      (peer.port.config.vlan ?? 1) === vlanSide.vlan
    );
  };

  const neighbourWithIp = (i: Iface, ip: string): Iface | undefined => {
    for (const d of ctx.devices) {
      for (const j of ifaces(d)) {
        if (j.ip === ip && j.net === i.net && j.prefix === i.prefix && attached(i, j)) return j;
      }
    }
    return undefined;
  };

  interface Candidate {
    prefix: number;
    via: Iface | null;
    nextHop: string;
  }
  const staticRoutes = (d: NetworkDevice): RouteEntry[] =>
    (d.routingTable ?? []).filter((r) => isRecord(r) && r.proto === 'Static');

  /** One forwarding step: where the packet goes next, or null when it cannot go on. */
  const step = (d: NetworkDevice, dst: string): { from: Iface; to: Iface } | null => {
    const mine = ifaces(d);
    const found: Candidate[] = [];
    for (const i of mine) if (inside(dst, i.net, i.prefix)) found.push({ prefix: i.prefix, via: i, nextHop: dst });
    for (const r of ctx.ospfRoutes?.(d) ?? []) {
      if (inside(dst, r.net, r.prefix)) found.push({ prefix: r.prefix, via: null, nextHop: r.nextHop });
    }
    for (const r of staticRoutes(d)) {
      if (typeof r.destination !== 'string' || typeof r.nextHop !== 'string' || typeof r.mask !== 'number') continue;
      const net = networkOf(r.destination, r.mask);
      if (net !== null && inside(dst, net, r.mask)) found.push({ prefix: r.mask, via: null, nextHop: r.nextHop });
    }
    if (d.defaultGateway) found.push({ prefix: 0, via: null, nextHop: d.defaultGateway });
    found.sort((a, b) => b.prefix - a.prefix);
    const best = found[0];
    if (best === undefined) return null;
    const out = best.via ?? mine.find((i) => inside(best.nextHop, i.net, i.prefix));
    if (!out) return null;
    const next = neighbourWithIp(out, best.nextHop);
    return next ? { from: out, to: next } : null;
  };

  const owns = (d: NetworkDevice, ip: string): boolean => ifaces(d).some((i) => i.ip === ip);

  /** Follows one packet; returns the device that received it, or null when it is lost or denied. */
  const send = (from: NetworkDevice, srcIp: string, dstIp: string, flow: Flow = {}): NetworkDevice | null => {
    let here = from;
    for (let hops = 0; hops < MAX_HOPS; hops += 1) {
      if (owns(here, dstIp)) return here;
      const next = step(here, dstIp);
      if (!next) return null;
      if (next.from.port) {
        const rule = findRuleMatch(here.aclRules, next.from.port.id, 'out', srcIp, dstIp, flow.protocol, flow.srcPort, flow.dstPort);
        if (rule?.action === 'deny') return null;
      }
      if (next.to.port) {
        const rule = findRuleMatch(next.to.device.aclRules, next.to.port.id, 'in', srcIp, dstIp, flow.protocol, flow.srcPort, flow.dstPort);
        if (rule?.action === 'deny') return null;
      }
      here = next.to.device;
    }
    return null;
  };

  /** A ping succeeds when the request arrives and the reply finds its way back. */
  return (from, address, service) => {
    const own = ifaces(from)[0];
    if (!own) return false;
    const request: Flow = service ? { protocol: service.protocol, srcPort: CLIENT_PORT, dstPort: service.port } : {};
    const reply: Flow = service ? { protocol: service.protocol, srcPort: service.port, dstPort: CLIENT_PORT } : {};
    const target = send(from, own.ip, address, request);
    return target !== null && send(target, address, own.ip, reply) === from;
  };
}
