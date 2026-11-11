import { create } from 'zustand';
import { createTopologySlice, type TopologySlice } from './slices/createTopologySlice';
import { createUiSlice, type UiSlice } from './slices/createUiSlice';
import { createCliSlice, type CliSlice } from './slices/createCliSlice';
import { createLabsSlice, type LabsSlice } from './slices/createLabsSlice';
import { registerFeatureCommands } from '../features/featureRegistry';
import { assertDistinctFields, collectFeatureSlices, composeFeatureSlices } from './featureSlices';
import type { FeatureState, StoreRuntime } from './featureState';
import { cryptoIdSource, mathRandomSource, systemClock } from '../utils/runtime';
import { createBrowserStorage, createLazyStorage } from '../utils/storage/keyValueStorage';

export interface NetworkState extends TopologySlice, UiSlice, CliSlice, LabsSlice, FeatureState {
  /** Injected clock, ids, randomness and storage. Read it inside actions, never while a slice is created. */
  runtime: StoreRuntime;
}

export type NetworkStoreOptions = Partial<StoreRuntime>;

/**
 * Builds a fresh store. It has no side effects: autosave and the engine sync
 * are attached by the application entry point, and browser storage is only
 * probed on first use.
 */
export function createNetworkStore(options: NetworkStoreOptions = {}) {
  const runtime: StoreRuntime = Object.freeze({
    clock: options.clock ?? systemClock,
    ids: options.ids ?? cryptoIdSource,
    random: options.random ?? mathRandomSource,
    storage: options.storage ?? createLazyStorage(createBrowserStorage),
  });

  return create<NetworkState>()((set, get, api) => {
    const topology = createTopologySlice(set, get, api);
    const ui = createUiSlice(set, get, api);
    const cli = createCliSlice(set, get, api);
    const labs = createLabsSlice(set, get, api);
    const reserved = assertDistinctFields({ runtime: { runtime }, topology, ui, cli, labs });
    const features = composeFeatureSlices(collectFeatureSlices(), reserved, set, get, api);
    return { runtime, ...topology, ...ui, ...cli, ...labs, ...features };
  });
}

// The CLI slice module has already initialised the core command registry at this point.
registerFeatureCommands();

export const useNetworkStore = createNetworkStore();
