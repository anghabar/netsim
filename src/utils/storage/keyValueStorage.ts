import { err, ok, utf8ByteLength, type Result } from '../guards';
import { defineStorageSlot, type StorageSlot } from './storageSlot';

export type StorageWriteError = 'too-large' | 'quota-exceeded' | 'unavailable';

/** Storage seam used by every feature. No method ever throws. */
export interface KeyValueStorage {
  read(slot: StorageSlot): string | null;
  write(slot: StorageSlot, value: string): Result<void, StorageWriteError>;
  remove(slot: StorageSlot): void;
}

/** The part of the Web Storage API this module relies on. */
export interface WebStorageLike {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
}

const PROBE_SLOT = defineStorageSlot('netsim.storage.probe.v1', { maxBytes: 16 });

const fits = (slot: StorageSlot, text: string): boolean =>
  text.length <= slot.maxBytes && utf8ByteLength(text) <= slot.maxBytes;

const isQuotaError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');

/** In-memory storage; `quotaBytes` simulates a full store in tests. */
export function createMemoryStorage(options: { quotaBytes?: number } = {}): KeyValueStorage {
  const entries = new Map<string, string>();
  return {
    read: (slot) => entries.get(slot.name) ?? null,
    write: (slot, value) => {
      if (!fits(slot, value)) return err('too-large');
      if (options.quotaBytes !== undefined) {
        let used = utf8ByteLength(value);
        entries.forEach((stored, name) => {
          if (name !== slot.name) used += utf8ByteLength(stored);
        });
        if (used > options.quotaBytes) return err('quota-exceeded');
      }
      entries.set(slot.name, value);
      return ok(undefined);
    },
    remove: (slot) => {
      entries.delete(slot.name);
    },
  };
}

export function createWebStorage(backend: WebStorageLike): KeyValueStorage {
  return {
    read: (slot) => {
      try {
        const text = backend.getItem(slot.name);
        return text !== null && fits(slot, text) ? text : null;
      } catch {
        return null;
      }
    },
    write: (slot, value) => {
      if (!fits(slot, value)) return err('too-large');
      try {
        backend.setItem(slot.name, value);
        return ok(undefined);
      } catch (error) {
        return err(isQuotaError(error) ? 'quota-exceeded' : 'unavailable');
      }
    },
    remove: (slot) => {
      try {
        backend.removeItem(slot.name);
      } catch {
        // Nothing to remove when storage is unavailable.
      }
    },
  };
}

const globalBackend = (): WebStorageLike | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

/** Probes local storage once; disabled storage or private mode falls back to memory. */
export function createBrowserStorage(resolve: () => WebStorageLike | undefined = globalBackend): KeyValueStorage {
  try {
    const backend = resolve();
    if (!backend) return createMemoryStorage();
    backend.setItem(PROBE_SLOT.name, '1');
    backend.removeItem(PROBE_SLOT.name);
    return createWebStorage(backend);
  } catch {
    return createMemoryStorage();
  }
}

/** Defers the creation of a storage until first use, so importing a module never touches the browser. */
export function createLazyStorage(factory: () => KeyValueStorage): KeyValueStorage {
  let resolved: KeyValueStorage | null = null;
  const get = (): KeyValueStorage => {
    if (resolved === null) resolved = factory();
    return resolved;
  };
  return {
    read: (slot) => get().read(slot),
    write: (slot, value) => get().write(slot, value),
    remove: (slot) => get().remove(slot),
  };
}
