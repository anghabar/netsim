import type { StoreApi } from 'zustand';
import type { LabSession, NetworkCable, NetworkDevice } from '../types/NetworkTypes';
import { err, isRecord, ok, parseJsonText, type Result } from '../utils/guards';
import type { KeyValueStorage, StorageWriteError } from '../utils/storage/keyValueStorage';
import { defineStorageSlot } from '../utils/storage/storageSlot';
import { parseTopology, TOPOLOGY_LIMITS, type ParsedTopology } from '../utils/topology/topologyGuards';
import type { NetworkState } from './useNetworkStore';

export const TOPOLOGY_AUTOSAVE_SLOT = defineStorageSlot('netsim.topology.autosave.v1', { maxBytes: 3000000 });

/** Holds the raw text of an autosave that could not be read, so a later save cannot destroy it. */
export const TOPOLOGY_CORRUPT_SLOT = defineStorageSlot('netsim.topology.autosave.corrupt.v1', {
  maxBytes: 3000000,
});

const FORMAT_VERSION = 1;

export type AutosaveError = StorageWriteError | 'not-serializable' | 'invalid-topology';

/** A lab is in progress until its session is cleared or marked as completed. */
export function isLabInProgress(session: LabSession | null): boolean {
  return session !== null && session.progress.completedAt === undefined;
}

export function saveTopology(
  storage: KeyValueStorage,
  devices: readonly NetworkDevice[],
  cables: readonly NetworkCable[],
): Result<void, AutosaveError> {
  const maxLines = TOPOLOGY_LIMITS.maxConsoleLines;
  const trimmed = devices.map((device) =>
    device.consoleLogs.length > maxLines ? { ...device, consoleLogs: device.consoleLogs.slice(-maxLines) } : device,
  );
  let text: string;
  try {
    text = JSON.stringify({ version: FORMAT_VERSION, devices: trimmed, cables });
  } catch {
    return err('not-serializable');
  }
  // Never replace a readable save with text that loadTopology would reject.
  const json = parseJsonText(text, { maxBytes: TOPOLOGY_AUTOSAVE_SLOT.maxBytes });
  if (!json.ok || !parseTopology(json.value).ok) return err('invalid-topology');
  return storage.write(TOPOLOGY_AUTOSAVE_SLOT, text);
}

export function loadTopology(storage: KeyValueStorage): Result<ParsedTopology, 'empty' | 'corrupt'> {
  const text = storage.read(TOPOLOGY_AUTOSAVE_SLOT);
  if (text === null) return err('empty');
  const json = parseJsonText(text, { maxBytes: TOPOLOGY_AUTOSAVE_SLOT.maxBytes });
  if (!json.ok || !isRecord(json.value) || json.value.version !== FORMAT_VERSION) return keepCorrupt(storage, text);
  const parsed = parseTopology(json.value);
  return parsed.ok ? ok(parsed.value) : keepCorrupt(storage, text);
}

/** Copies unreadable saved text to its own slot before the next autosave can overwrite it. */
function keepCorrupt(storage: KeyValueStorage, text: string): Result<never, 'corrupt'> {
  storage.write(TOPOLOGY_CORRUPT_SLOT, text);
  return err('corrupt');
}

/**
 * Saves devices and cables to local storage shortly after they change.
 * Paused while a lab is in progress so the lab topology does not replace the
 * user's own. Returns a function that stops the subscription and the timer.
 */
export function attachTopologyAutosave(
  store: Pick<StoreApi<NetworkState>, 'getState' | 'subscribe'>,
  options: { delayMs?: number; onError?: (error: AutosaveError) => void } = {},
): () => void {
  const delayMs = options.delayMs ?? 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    const state = store.getState();
    if (isLabInProgress(state.currentLabSession)) return;
    const saved = saveTopology(state.runtime.storage, state.devices, state.cables);
    if (!saved.ok && options.onError) options.onError(saved.error);
  };

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.devices === previous.devices && state.cables === previous.cables) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });

  return () => {
    unsubscribe();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
