import type { SwitchModel } from '../../../types/NetworkTypes';
import type { QuickTopologyDefinition, QuickTopologyNode } from './types';

/**
 * Built-in starter topologies. Pure data: the builder turns a definition into
 * devices and cables. Only hosts are addressed; switch and router
 * configuration is left to the user.
 */

const ACCESS_SWITCH: SwitchModel = 'Huawei-S5700-28TP';
const EDGE_ROUTER: SwitchModel = 'Huawei-AR617';
const HOST: SwitchModel = 'PC';
const HOST_PREFIX = 24;

const node = (ref: string, model: SwitchModel, x: number, y: number): QuickTopologyNode => ({
  ref,
  model,
  hostname: ref,
  position: { x, y },
});

const host = (ref: string, x: number, y: number, ip: string, gateway?: string): QuickTopologyNode => ({
  ...node(ref, HOST, x, y),
  address: gateway === undefined ? { ip, prefix: HOST_PREFIX } : { ip, prefix: HOST_PREFIX, gateway },
});

function freezeDeep<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    const members: unknown[] = Object.values(value);
    for (const member of members) freezeDeep(member);
  }
  return value;
}

export const QUICK_TOPOLOGIES: readonly QuickTopologyDefinition[] = freezeDeep([
  {
    id: 'single-switch-lan',
    title: 'Single-switch LAN',
    summary: 'One access switch and two PCs in the same subnet, ready for a first ping.',
    nodes: [
      node('SW1', ACCESS_SWITCH, 400, 120),
      host('PC1', 260, 320, '192.0.2.10'),
      host('PC2', 540, 320, '192.0.2.11'),
    ],
    links: [
      { from: 'SW1', to: 'PC1' },
      { from: 'SW1', to: 'PC2' },
    ],
  },
  {
    id: 'routed-campus',
    title: 'Routed campus',
    summary:
      'One router, two access switches and four PCs in two subnets. Router interfaces are left for you to configure.',
    nodes: [
      node('R1', EDGE_ROUTER, 400, 80),
      node('SW1', ACCESS_SWITCH, 220, 240),
      node('SW2', ACCESS_SWITCH, 580, 240),
      host('PC1', 100, 420, '192.0.2.10', '192.0.2.1'),
      host('PC2', 300, 420, '192.0.2.11', '192.0.2.1'),
      host('PC3', 500, 420, '198.51.100.10', '198.51.100.1'),
      host('PC4', 700, 420, '198.51.100.11', '198.51.100.1'),
    ],
    links: [
      { from: 'R1', to: 'SW1' },
      { from: 'R1', to: 'SW2' },
      { from: 'SW1', to: 'PC1' },
      { from: 'SW1', to: 'PC2' },
      { from: 'SW2', to: 'PC3' },
      { from: 'SW2', to: 'PC4' },
    ],
  },
  {
    id: 'switch-triangle',
    title: 'Switch triangle',
    summary: 'Three switches in a loop with a PC on two of them, for spanning tree practice.',
    nodes: [
      node('SW1', ACCESS_SWITCH, 400, 100),
      node('SW2', ACCESS_SWITCH, 220, 300),
      node('SW3', ACCESS_SWITCH, 580, 300),
      host('PC1', 120, 460, '192.0.2.10'),
      host('PC2', 680, 460, '192.0.2.20'),
    ],
    links: [
      { from: 'SW1', to: 'SW2' },
      { from: 'SW2', to: 'SW3' },
      { from: 'SW3', to: 'SW1' },
      { from: 'SW2', to: 'PC1' },
      { from: 'SW3', to: 'PC2' },
    ],
  },
  {
    id: 'two-sites',
    title: 'Two routed sites',
    summary:
      'Two routers back to back, each with a switch and a PC, for static routing or OSPF practice. Router interfaces are left for you to configure.',
    nodes: [
      node('R1', EDGE_ROUTER, 280, 100),
      node('R2', EDGE_ROUTER, 520, 100),
      node('SW1', ACCESS_SWITCH, 280, 260),
      node('SW2', ACCESS_SWITCH, 520, 260),
      host('PC1', 280, 420, '192.0.2.10', '192.0.2.1'),
      host('PC2', 520, 420, '198.51.100.10', '198.51.100.1'),
    ],
    links: [
      { from: 'R1', to: 'R2' },
      { from: 'R1', to: 'SW1' },
      { from: 'R2', to: 'SW2' },
      { from: 'SW1', to: 'PC1' },
      { from: 'SW2', to: 'PC2' },
    ],
  },
]);

const MAX_ID_LENGTH = 40;

/** Looks an id up among the given definitions only; anything else is `undefined`. */
export function findQuickTopology(
  id: string,
  catalog: readonly QuickTopologyDefinition[] = QUICK_TOPOLOGIES,
): QuickTopologyDefinition | undefined {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) return undefined;
  return catalog.find((definition) => definition.id === id);
}
