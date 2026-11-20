import { err, ok, parseJsonText, type Result } from '../../../utils/guards';
import { LAB_ID_PATTERN, MAX_LAB_BYTES, parseGuidedLab } from './guards';
import type { GuidedLab, LabLevel } from './types';

/**
 * The lab list shown in the panel. Only this short index lives in the bundle;
 * each lab is a static JSON file served from `labs/<id>.json` and fetched from
 * the same origin when the learner opens it.
 */
export interface LabListing {
  id: string;
  title: string;
  level: LabLevel;
  minutes: number;
  summary: string;
}

export const LAB_LISTINGS: readonly LabListing[] = [
  {
    id: 'vlans-and-trunks',
    title: 'VLANs and trunking',
    level: 'beginner',
    minutes: 20,
    summary: 'Split two switches into VLANs and carry them over one trunk link.',
  },
  {
    id: 'spanning-tree-root',
    title: 'Spanning tree: root bridge and blocked port',
    level: 'beginner',
    minutes: 20,
    summary: 'Break a switching loop with spanning tree and choose which switch becomes the root.',
  },
  {
    id: 'ospf-single-area',
    title: 'Single-area OSPF with three routers',
    level: 'intermediate',
    minutes: 30,
    summary: 'Bring up OSPF neighbours and learn every network on every router.',
  },
  {
    id: 'static-routes',
    title: 'Static routes between two routers',
    level: 'beginner',
    minutes: 20,
    summary: 'Make two LANs reach each other through a point-to-point link by writing static routes on both routers.',
  },
  {
    id: 'inter-vlan-routing',
    title: 'Routing between VLANs',
    level: 'beginner',
    minutes: 25,
    summary: 'Let two VLANs talk to each other through VLAN interfaces on a layer 3 switch.',
  },
  {
    id: 'edge-port-protection',
    title: 'Protecting the ports that face users',
    level: 'intermediate',
    minutes: 25,
    summary: 'Harden user-facing switch ports with fast start, BPDU guard and port security, and keep the uplink untouched.',
  },
  {
    id: 'access-list-block-host',
    title: 'Access list: block one host',
    level: 'intermediate',
    minutes: 25,
    summary: 'Stop one workstation from reaching a server network while everyone else keeps working.',
  },
  {
    id: 'link-aggregation',
    title: 'Link aggregation with LACP',
    level: 'intermediate',
    minutes: 25,
    summary: 'Bundle two parallel links between two switches into one logical link using LACP.',
  },
  {
    id: 'ospf-two-areas',
    title: 'OSPF with two areas',
    level: 'advanced',
    minutes: 35,
    summary: 'Split an OSPF network into a backbone and a second area joined by a border router, then reach one LAN from the other.',
  },
  {
    id: 'default-route',
    title: 'Default route to the internet',
    level: 'beginner',
    minutes: 20,
    summary: 'Send everything that is not local to an upstream router with one default route, and give that router a way back.',
  },
  {
    id: 'fix-the-broken-network',
    title: 'Troubleshooting: fix a broken network',
    level: 'intermediate',
    minutes: 30,
    summary: 'A workstation cannot reach a server. Find the two faults (a trunk that drops a VLAN and a wrong static route) and repair them.',
  },
  {
    id: 'acl-allow-web-only',
    title: 'Access list: allow only web traffic',
    level: 'advanced',
    minutes: 30,
    summary: 'Let a workstation reach a server on one service only, by combining a permit rule and a deny rule in the right order.',
  },
];

export type LabLoadError = 'unknown-lab' | 'fetch-failed' | 'too-large' | 'invalid-json' | 'invalid-lab';

/** The part of `fetch` the loader needs; tests pass a stub. */
export type LabFetcher = (url: string, init: { credentials: 'same-origin' }) => Promise<{
  ok: boolean;
  text: () => Promise<string>;
}>;

export const labUrl = (id: string, baseUrl: string): string => `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}labs/${id}.json`;

/**
 * Fetches one lab: a plain same-origin GET of `labs/<id>.json` with no query
 * string. The answer is untrusted: size-checked, parsed and rebuilt field by field.
 */
export async function loadGuidedLab(
  id: string,
  fetcher: LabFetcher,
  baseUrl: string,
  listings: readonly LabListing[] = LAB_LISTINGS,
): Promise<Result<GuidedLab, LabLoadError>> {
  if (!LAB_ID_PATTERN.test(id) || !listings.some((listing) => listing.id === id)) return err('unknown-lab');
  let body: string;
  try {
    const response = await fetcher(labUrl(id, baseUrl), { credentials: 'same-origin' });
    if (!response.ok) return err('fetch-failed');
    body = await response.text();
  } catch {
    return err('fetch-failed');
  }
  const json = parseJsonText(body, { maxBytes: MAX_LAB_BYTES });
  if (!json.ok) return err(json.error === 'too-large' ? 'too-large' : 'invalid-json');
  const lab = parseGuidedLab(json.value);
  if (!lab.ok || lab.value.id !== id) return err('invalid-lab');
  return ok(lab.value);
}

export function describeLoadError(error: LabLoadError): string {
  switch (error) {
    case 'unknown-lab':
      return 'This lab is not available.';
    case 'fetch-failed':
      return 'The lab could not be downloaded. Check your connection and try again.';
    case 'too-large':
    case 'invalid-json':
    case 'invalid-lab':
      return 'The lab file is not valid and was not loaded.';
  }
}
