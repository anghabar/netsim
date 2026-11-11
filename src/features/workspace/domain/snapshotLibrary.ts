import {
  err,
  isRecord,
  ok,
  parseJsonText,
  readArray,
  readNumber,
  readString,
  type Result,
} from '../../../utils/guards';
import type { Clock, IdSource } from '../../../utils/runtime';
import type { KeyValueStorage } from '../../../utils/storage/keyValueStorage';
import { defineStorageSlot } from '../../../utils/storage/storageSlot';
import { parseTopology } from '../../../utils/topology/topologyGuards';
import {
  cleanName,
  datedName,
  WORKSPACE_LIMITS,
  type WorkspaceError,
  type WorkspaceSnapshot,
} from './workspaceModel';

/** The snapshot list of this browser. */
export const WORKSPACE_SNAPSHOTS_SLOT = defineStorageSlot('netsim.workspace.snapshots.v1', {
  maxBytes: WORKSPACE_LIMITS.maxLibraryBytes,
});

const DOCUMENT_VERSION = 1;
const MAX_TIMESTAMP = 8640000000000000;
const MAX_STORED_ENTRIES = 1000;
const MAX_ID_ATTEMPTS = 8;
const ID_PATTERN = /^[\x21-\x7e]+$/;

export interface SnapshotDeps {
  clock: Clock;
  ids: IdSource;
}

export interface LibraryReport {
  snapshots: WorkspaceSnapshot[];
  /** Stored entries (or whole documents) rejected by validation. */
  skipped: number;
}

function uniqueName(existing: readonly WorkspaceSnapshot[], name: string): string {
  const taken = new Set(existing.map((snapshot) => snapshot.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; n <= existing.length + 2; n += 1) {
    const suffix = ` (${n})`;
    const head = Array.from(name).slice(0, WORKSPACE_LIMITS.maxNameLength - suffix.length).join('');
    const candidate = `${head}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

/**
 * Validates `topology` and returns a snapshot holding an independent copy.
 * The list is never mutated and nothing is evicted to make room.
 */
export function createSnapshot(
  rawName: string,
  topology: unknown,
  existing: readonly WorkspaceSnapshot[],
  deps: SnapshotDeps,
): Result<WorkspaceSnapshot, WorkspaceError> {
  if (existing.length >= WORKSPACE_LIMITS.maxSnapshots) return err('limit-reached');
  const parsed = parseTopology(topology);
  if (!parsed.ok) return err('invalid-topology');
  const { devices, cables } = parsed.value;
  if (devices.length === 0) return err('empty-topology');

  // The guard returned fresh objects, so trimming them does not touch the input.
  for (const device of devices) {
    device.consoleLogs = device.consoleLogs.slice(-WORKSPACE_LIMITS.snapshotConsoleLines);
  }

  let id = deps.ids();
  const isTaken = (candidate: string): boolean => existing.some((snapshot) => snapshot.id === candidate);
  for (let attempt = 1; attempt < MAX_ID_ATTEMPTS && isTaken(id); attempt += 1) id = deps.ids();
  if (isTaken(id)) return err('storage-failed');

  const createdAt = deps.clock();
  const name = uniqueName(existing, cleanName(rawName) || datedName('Snapshot', createdAt));
  return ok({ id, name, createdAt, topology: { devices, cables } });
}

export function removeSnapshot(
  list: readonly WorkspaceSnapshot[],
  id: string,
): Result<WorkspaceSnapshot[], WorkspaceError> {
  const next = list.filter((snapshot) => snapshot.id !== id);
  return next.length === list.length ? err('not-found') : ok(next);
}

export function serializeLibrary(list: readonly WorkspaceSnapshot[]): string {
  return JSON.stringify({ version: DOCUMENT_VERSION, snapshots: list });
}

function parseStoredSnapshot(raw: unknown): WorkspaceSnapshot | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw, 'id', { maxLength: 128, minLength: 1, pattern: ID_PATTERN });
  const storedName = readString(raw, 'name', { maxLength: 400, minLength: 1 });
  const createdAt = readNumber(raw, 'createdAt', { min: 0, max: MAX_TIMESTAMP, integer: true });
  if (id === undefined || storedName === undefined || createdAt === undefined) return null;
  const name = cleanName(storedName);
  if (name.length === 0) return null;
  const stored: unknown = Object.prototype.hasOwnProperty.call(raw, 'topology') ? raw.topology : undefined;
  const topology = parseTopology(stored);
  if (!topology.ok || topology.value.devices.length === 0) return null;
  return { id, name, createdAt, topology: { devices: topology.value.devices, cables: topology.value.cables } };
}

/** Tolerant: invalid, duplicated or surplus entries are skipped and counted, never repaired. */
export function parseLibrary(text: string): LibraryReport {
  const json = parseJsonText(text, { maxBytes: WORKSPACE_SNAPSHOTS_SLOT.maxBytes });
  const doc = json.ok ? json.value : undefined;
  if (!isRecord(doc)) return { snapshots: [], skipped: 1 };
  const version = readNumber(doc, 'version', { min: 0, max: 1000000, integer: true });
  const entries = readArray(doc, 'snapshots', { maxItems: MAX_STORED_ENTRIES });
  if (version !== DOCUMENT_VERSION || entries === undefined) return { snapshots: [], skipped: 1 };

  const snapshots: WorkspaceSnapshot[] = [];
  const seen = new Set<string>();
  let skipped = Math.max(0, entries.length - WORKSPACE_LIMITS.maxSnapshots);
  for (const entry of entries.slice(0, WORKSPACE_LIMITS.maxSnapshots)) {
    const snapshot = parseStoredSnapshot(entry);
    if (snapshot === null || seen.has(snapshot.id)) {
      skipped += 1;
      continue;
    }
    seen.add(snapshot.id);
    snapshots.push(snapshot);
  }
  return { snapshots, skipped };
}

export function loadLibrary(storage: KeyValueStorage): LibraryReport {
  const text = storage.read(WORKSPACE_SNAPSHOTS_SLOT);
  return text === null ? { snapshots: [], skipped: 0 } : parseLibrary(text);
}

export function saveLibrary(
  storage: KeyValueStorage,
  list: readonly WorkspaceSnapshot[],
): Result<void, WorkspaceError> {
  let text: string;
  try {
    text = serializeLibrary(list);
  } catch {
    return err('invalid-topology');
  }
  const written = storage.write(WORKSPACE_SNAPSHOTS_SLOT, text);
  if (written.ok) return ok(undefined);
  return err(written.error === 'too-large' ? 'too-large' : 'storage-failed');
}
