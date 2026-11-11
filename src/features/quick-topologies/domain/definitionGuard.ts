import { defaultDeviceCatalog } from '../../../data/deviceCatalog';
import { err, ok, type Result } from '../../../utils/guards';
import { parseIpv4, sameSubnet } from '../../../utils/ipv4';
import type { QuickTopologyAddress, QuickTopologyDefinition } from './types';

/** Bounds for a quick topology definition. Starter topologies are small on purpose. */
export const QUICK_TOPOLOGY_LIMITS = Object.freeze({
  maxNodes: 24,
  maxLinks: 48,
  maxTitleLength: 48,
  maxSummaryLength: 200,
  maxCoordinate: 4000,
  minPrefix: 8,
  maxPrefix: 30,
});

export type QuickTopologyDefinitionErrorCode =
  | 'invalid-id'
  | 'invalid-text'
  | 'invalid-size'
  | 'invalid-node'
  | 'duplicate-node'
  | 'unknown-model'
  | 'invalid-position'
  | 'invalid-address'
  | 'duplicate-address'
  | 'invalid-link';

export interface QuickTopologyDefinitionError {
  code: QuickTopologyDefinitionErrorCode;
  path: string;
}

const TOPOLOGY_ID = /^[a-z][a-z0-9-]{1,39}$/;
const NODE_REF = /^[A-Za-z][A-Za-z0-9-]{0,15}$/;
const HOSTNAME = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;
const MEDIA: readonly string[] = ['copper', 'fiber'];

const CATALOG_MODELS: ReadonlySet<string> = new Set(defaultDeviceCatalog.map((entry) => entry.model));

const fail = (
  code: QuickTopologyDefinitionErrorCode,
  path: string,
): Result<never, QuickTopologyDefinitionError> => err({ code, path });

function isPlainText(value: unknown, maxLength: number): boolean {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

const isCoordinate = (value: unknown): boolean =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= QUICK_TOPOLOGY_LIMITS.maxCoordinate;

/** A usable host address: valid IPv4 that is neither the network nor the broadcast address. */
function isHostAddress(ip: unknown, prefix: number): boolean {
  if (typeof ip !== 'string') return false;
  const value = parseIpv4(ip);
  if (value === null) return false;
  const block = 2 ** (32 - prefix);
  const hostPart = value % block;
  return hostPart !== 0 && hostPart !== block - 1;
}

function isAddress(address: QuickTopologyAddress): boolean {
  const { minPrefix, maxPrefix } = QUICK_TOPOLOGY_LIMITS;
  const { ip, prefix, gateway } = address;
  if (typeof prefix !== 'number' || !Number.isInteger(prefix) || prefix < minPrefix || prefix > maxPrefix) {
    return false;
  }
  if (!isHostAddress(ip, prefix)) return false;
  if (gateway === undefined) return true;
  return gateway !== ip && isHostAddress(gateway, prefix) && sameSubnet(ip, gateway, prefix);
}

/**
 * Checks a definition before anything is built from it: bounded sizes, safe
 * identifiers and labels, models that exist in the device catalog, valid and
 * unique host addresses, and links that join two different known nodes.
 */
export function validateQuickTopology(
  definition: QuickTopologyDefinition,
  knownModels: ReadonlySet<string> = CATALOG_MODELS,
): Result<void, QuickTopologyDefinitionError> {
  const limits = QUICK_TOPOLOGY_LIMITS;
  if (typeof definition.id !== 'string' || !TOPOLOGY_ID.test(definition.id)) return fail('invalid-id', 'id');
  if (!isPlainText(definition.title, limits.maxTitleLength)) return fail('invalid-text', 'title');
  if (!isPlainText(definition.summary, limits.maxSummaryLength)) return fail('invalid-text', 'summary');

  const { nodes, links } = definition;
  if (nodes.length === 0 || nodes.length > limits.maxNodes) return fail('invalid-size', 'nodes');
  if (links.length > limits.maxLinks) return fail('invalid-size', 'links');

  const refs = new Set<string>();
  const hostnames = new Set<string>();
  const addresses = new Set<string>();
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const path = `nodes[${i}]`;
    if (typeof node.ref !== 'string' || !NODE_REF.test(node.ref)) return fail('invalid-node', `${path}.ref`);
    if (typeof node.hostname !== 'string' || !HOSTNAME.test(node.hostname)) {
      return fail('invalid-node', `${path}.hostname`);
    }
    const hostname = node.hostname.toLowerCase();
    if (refs.has(node.ref) || hostnames.has(hostname)) return fail('duplicate-node', path);
    refs.add(node.ref);
    hostnames.add(hostname);
    if (!knownModels.has(node.model)) return fail('unknown-model', `${path}.model`);
    if (!isCoordinate(node.position.x) || !isCoordinate(node.position.y)) {
      return fail('invalid-position', `${path}.position`);
    }
    if (node.address !== undefined) {
      if (!isAddress(node.address)) return fail('invalid-address', `${path}.address`);
      if (addresses.has(node.address.ip)) return fail('duplicate-address', `${path}.address`);
      addresses.add(node.address.ip);
    }
  }

  for (let i = 0; i < links.length; i += 1) {
    const link = links[i];
    const path = `links[${i}]`;
    if (!refs.has(link.from) || !refs.has(link.to) || link.from === link.to) return fail('invalid-link', path);
    if (link.media !== undefined && !MEDIA.includes(link.media)) return fail('invalid-link', `${path}.media`);
  }
  return ok(undefined);
}
