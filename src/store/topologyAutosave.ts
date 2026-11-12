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
  const written = storage.write(TOPOLOGY_AUTOSAVE_SLOT, text);
  // The unreadable copy is only needed until a valid topology has been saved again.
  if (written.ok) storage.remove(TOPOLOGY_CORRUPT_SLOT);
  return written;
}

export function loadTopology(
  storage: KeyValueStorage,
  onError?: (error: AutosaveError) => void,
): Result<ParsedTopology, 'empty' | 'corrupt'> {
  const text = storage.read(TOPOLOGY_AUTOSAVE_SLOT);
  if (text === null) return err('empty');
  const json = parseJsonText(text, { maxBytes: TOPOLOGY_AUTOSAVE_SLOT.maxBytes });
  if (!json.ok || !isRecord(json.value) || json.value.version !== FORMAT_VERSION) return keepCorrupt(storage, text, onError);
  const parsed = parseTopology(json.value);
  return parsed.ok ? ok(parsed.value) : keepCorrupt(storage, text, onError);
}

/** Copies unreadable saved text to its own slot before the next autosave can overwrite it. */
function keepCorrupt(
  storage: KeyValueStorage,
  text: string,
  onError?: (error: AutosaveError) => void,
): Result<never, 'corrupt'> {
  const kept = storage.write(TOPOLOGY_CORRUPT_SLOT, text);
  if (!kept.ok && onError) onError(kept.error);
  return err('corrupt');
}

/**
 * Saves devices and cables to local storage shortly after they change.
 * Never writes while a lab topology is in the store: it is suspended when a lab
 * starts and resumes only when leaving the lab put the user's own topology
 * back. Each error is reported once until a save succeeds again. Returns a
 * function that stops the subscription and the timer.
 */
export function attachTopologyAutosave(
  store: Pick<StoreApi<NetworkState>, 'getState' | 'subscribe'>,
  options: { delayMs?: number; onError?: (error: AutosaveError) => void } = {},
): () => void {
  const delayMs = options.delayMs ?? 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let suspended = store.getState().currentLabSession !== null;
  let lastError: AutosaveError | null = null;

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const flush = (): void => {
    timer = null;
    const state = store.getState();
    if (suspended || state.currentLabSession !== null) return;
    const saved = saveTopology(state.runtime.storage, state.devices, state.cables);
    if (saved.ok) {
      lastError = null;
    } else if (saved.error !== lastError) {
      lastError = saved.error;
      if (options.onError) options.onError(saved.error);
    }
  };

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.currentLabSession !== null) {
      suspended = true;
      cancel();
      return;
    }
    const changed = state.devices !== previous.devices || state.cables !== previous.cables;
    if (previous.currentLabSession !== null) {
      // Leaving a lab restores the user's topology in the same update; that restore is not an edit.
      if (changed) {
        suspended = false;
        lastError = null;
      }
      cancel();
      return;
    }
    if (!changed || suspended) return;
    cancel();
    timer = setTimeout(flush, delayMs);
  });

  return () => {
    unsubscribe();
    cancel();
  };
}
