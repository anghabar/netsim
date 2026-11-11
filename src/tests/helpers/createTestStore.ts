import type { NetworkCable, NetworkDevice } from '../../types/NetworkTypes';
import { deviceFactory } from '../../store/slices/createTopologySlice';
import { createNetworkStore } from '../../store/useNetworkStore';
import { createMemoryStorage, type KeyValueStorage } from '../../utils/storage/keyValueStorage';

export const TEST_EPOCH_MS = Date.UTC(2026, 0, 1);

/** A fresh store with memory storage, a fixed clock, sequential ids and a seeded random source. */
export function createTestStore(options: { now?: number; storage?: KeyValueStorage } = {}) {
  let counter = 0;
  let seed = 1;
  return createNetworkStore({
    storage: options.storage ?? createMemoryStorage(),
    clock: () => options.now ?? TEST_EPOCH_MS,
    ids: () => {
      counter += 1;
      return `id-${counter}`;
    },
    random: () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    },
  });
}

/** A switch and a router joined by one copper cable, with deterministic ids. */
export function linkedPair(): { a: NetworkDevice; b: NetworkDevice; cable: NetworkCable } {
  let counter = 0;
  const deps = {
    ids: () => {
      counter += 1;
      return `fixture-${counter}`;
    },
    random: () => 0.25,
  };
  const a = deviceFactory('Huawei-S5700-28TP', { x: 0, y: 0 }, deps);
  const b = deviceFactory('Huawei-AR617', { x: 200, y: 0 }, deps);
  const cable: NetworkCable = {
    id: 'cable-fixture',
    type: 'copper',
    sourceDeviceId: a.id,
    sourcePortId: a.ports[0].id,
    targetDeviceId: b.id,
    targetPortId: b.ports[0].id,
  };
  return { a, b, cable };
}
