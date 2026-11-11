import type { StateCreator } from 'zustand';
import type { Clock, IdSource, RandomSource } from '../utils/runtime';
import type { KeyValueStorage } from '../utils/storage/keyValueStorage';
import type { NetworkState } from './useNetworkStore';

/**
 * State contributed by feature slices. Empty here on purpose: each feature
 * augments it from its own `feature.slice.ts` with `declare module`.
 */
export interface FeatureState {}

/** Injected dependencies, available as `get().runtime` inside store actions. */
export interface StoreRuntime {
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly random: RandomSource;
  readonly storage: KeyValueStorage;
}

export type FeatureSliceDefinition = {
  id: string;
  create: StateCreator<NetworkState, [], [], object>;
};
