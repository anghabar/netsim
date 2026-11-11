import type { NetworkCable, NetworkDevice } from '../../../types/NetworkTypes';

/** Devices and cables, as the store holds them. */
export interface TopologyData {
  devices: NetworkDevice[];
  cables: NetworkCable[];
}

/** A named copy of a topology kept in this browser. */
export interface WorkspaceSnapshot {
  id: string;
  name: string;
  /** Epoch milliseconds from the local clock. */
  createdAt: number;
  topology: TopologyData;
}

/** Hard bounds for everything the workspace stores, imports or exports. */
export const WORKSPACE_LIMITS = {
  maxSnapshots: 20,
  maxNameLength: 60,
  /** Console lines kept per device inside a snapshot. */
  snapshotConsoleLines: 20,
  /** Size of the stored snapshot list. */
  maxLibraryBytes: 3000000,
  /** Size of a topology file, checked before it is read or parsed. */
  maxFileBytes: 2000000,
  /** Secret-looking fields listed by name in an export report. */
  maxSensitiveFieldsListed: 20,
} as const;

export type WorkspaceError =
  | 'empty-topology'
  | 'invalid-topology'
  | 'too-large'
  | 'limit-reached'
  | 'not-found'
  | 'storage-failed'
  | 'lab-in-progress'
  | 'confirmation-required'
  | 'invalid-json'
  | 'unsupported-format'
  | 'unreadable-file';

const MESSAGES: Record<WorkspaceError, string> = {
  'empty-topology': 'Add at least one device first.',
  'invalid-topology': 'The topology is not valid and was not used.',
  'too-large': 'The data is too large.',
  'limit-reached': `The snapshot list is full (${WORKSPACE_LIMITS.maxSnapshots}). Delete one first.`,
  'not-found': 'That snapshot no longer exists.',
  'storage-failed': 'Browser storage is full or unavailable.',
  'lab-in-progress': 'Finish or reset the running lab before replacing the topology.',
  'confirmation-required': 'Confirm to replace the current topology.',
  'invalid-json': 'The file is not valid JSON.',
  'unsupported-format': 'The file is not a NetSim topology file (version 1).',
  'unreadable-file': 'The file could not be read.',
};

export function describeWorkspaceError(error: WorkspaceError): string {
  return MESSAGES[error];
}

const MAX_TIMESTAMP = 8640000000000000;

/** Control characters, lone surrogates and bidirectional overrides never reach a stored name. */
const isUnsafeCodePoint = (code: number): boolean =>
  code < 32 ||
  (code >= 127 && code <= 159) ||
  (code >= 0xd800 && code <= 0xdfff) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);

/** Single-line, bounded, printable name; an empty string means "no usable name". */
export function cleanName(raw: string): string {
  const kept: string[] = [];
  for (const char of raw.slice(0, 1000).replace(/\s+/g, ' ')) {
    if (!isUnsafeCodePoint(char.codePointAt(0) ?? 0)) kept.push(char);
  }
  const text = kept.join('').trim();
  return Array.from(text).slice(0, WORKSPACE_LIMITS.maxNameLength).join('').trim();
}

/** ISO 8601 text for a timestamp; out-of-range values fall back to the epoch. */
export function toIsoDate(timestamp: number): string {
  const safe = Number.isFinite(timestamp) && Math.abs(timestamp) <= MAX_TIMESTAMP ? timestamp : 0;
  return new Date(safe).toISOString();
}

/** Default name such as "Snapshot 2026-01-05 10:30" (UTC). */
export function datedName(prefix: string, timestamp: number): string {
  return `${prefix} ${toIsoDate(timestamp).slice(0, 16).replace('T', ' ')}`;
}
