import { describe, expect, it } from 'vitest';
import {
  createBrowserStorage,
  createLazyStorage,
  createMemoryStorage,
  createWebStorage,
  type WebStorageLike,
} from '../../utils/storage/keyValueStorage';
import { defineStorageSlot } from '../../utils/storage/storageSlot';

function fakeBackend(failure?: Error): WebStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => {
      if (failure) throw failure;
      data.set(name, value);
    },
    removeItem: (name) => {
      data.delete(name);
    },
  };
}

const quotaError = (): Error => {
  const error = new Error('storage is full');
  error.name = 'QuotaExceededError';
  return error;
};

describe('defineStorageSlot', () => {
  it('accepts readable dotted names and freezes the slot', () => {
    const slot = defineStorageSlot('netsim.test.alpha.v1', { maxBytes: 10 });
    expect(slot).toEqual({ name: 'netsim.test.alpha.v1', maxBytes: 10 });
    expect(Object.isFrozen(slot)).toBe(true);
  });

  it('rejects names outside the convention and invalid sizes', () => {
    expect(() => defineStorageSlot('netsim-achievements', { maxBytes: 10 })).toThrow();
    expect(() => defineStorageSlot('netsim.Feature.thing.v1', { maxBytes: 10 })).toThrow();
    expect(() => defineStorageSlot('netsim.feature.thing', { maxBytes: 10 })).toThrow();
    expect(() => defineStorageSlot('netsim.test.size.v1', { maxBytes: 0 })).toThrow();
  });

  it('throws when a name is defined twice', () => {
    defineStorageSlot('netsim.test.twice.v1', { maxBytes: 10 });
    expect(() => defineStorageSlot('netsim.test.twice.v1', { maxBytes: 10 })).toThrow(/twice/);
  });
});

describe('memory storage', () => {
  const slot = defineStorageSlot('netsim.test.memory.v1', { maxBytes: 10 });

  it('writes, reads and removes', () => {
    const storage = createMemoryStorage();
    expect(storage.read(slot)).toBeNull();
    expect(storage.write(slot, 'hello')).toEqual({ ok: true, value: undefined });
    expect(storage.read(slot)).toBe('hello');
    storage.remove(slot);
    expect(storage.read(slot)).toBeNull();
  });

  it('refuses values above maxBytes, measured in bytes', () => {
    const storage = createMemoryStorage();
    expect(storage.write(slot, 'x'.repeat(11))).toEqual({ ok: false, error: 'too-large' });
    expect(storage.write(slot, 'é'.repeat(6))).toEqual({ ok: false, error: 'too-large' });
    expect(storage.read(slot)).toBeNull();
  });

  it('can simulate an exhausted quota', () => {
    const storage = createMemoryStorage({ quotaBytes: 4 });
    expect(storage.write(slot, 'hello')).toEqual({ ok: false, error: 'quota-exceeded' });
    expect(storage.write(slot, 'hey')).toEqual({ ok: true, value: undefined });
  });
});

describe('web storage wrapper', () => {
  const slot = defineStorageSlot('netsim.test.web.v1', { maxBytes: 10 });

  it('maps a quota failure to a result error', () => {
    const storage = createWebStorage(fakeBackend(quotaError()));
    expect(storage.write(slot, 'hello')).toEqual({ ok: false, error: 'quota-exceeded' });
  });

  it('maps any other failure to "unavailable" and never throws', () => {
    const broken: WebStorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const storage = createWebStorage(broken);
    expect(storage.write(slot, 'hello')).toEqual({ ok: false, error: 'unavailable' });
    expect(storage.read(slot)).toBeNull();
    expect(() => storage.remove(slot)).not.toThrow();
  });

  it('ignores stored values larger than the slot allows', () => {
    const backend = fakeBackend();
    backend.data.set(slot.name, 'x'.repeat(50));
    expect(createWebStorage(backend).read(slot)).toBeNull();
  });
});

describe('createBrowserStorage', () => {
  const slot = defineStorageSlot('netsim.test.browser.v1', { maxBytes: 10 });

  it('uses the backend when the probe succeeds', () => {
    const backend = fakeBackend();
    const storage = createBrowserStorage(() => backend);
    expect(storage.write(slot, 'kept').ok).toBe(true);
    expect(backend.data.get(slot.name)).toBe('kept');
    expect(backend.data.size).toBe(1);
  });

  it('falls back to memory when storage is disabled or missing', () => {
    const candidates = [
      createBrowserStorage(() => fakeBackend(new Error('disabled'))),
      createBrowserStorage(() => undefined),
      createBrowserStorage(() => {
        throw new Error('access denied');
      }),
    ];
    for (const storage of candidates) {
      expect(storage.write(slot, 'memory').ok).toBe(true);
      expect(storage.read(slot)).toBe('memory');
    }
  });

  it('is only created on first use when wrapped lazily', () => {
    let created = 0;
    const storage = createLazyStorage(() => {
      created += 1;
      return createMemoryStorage();
    });
    expect(created).toBe(0);
    storage.write(slot, 'a');
    storage.read(slot);
    expect(created).toBe(1);
  });
});
