import type { NetworkCable, NetworkDevice } from '../../types/NetworkTypes';
import { deviceFactory, type ReplaceTopologyError } from '../../store/slices/createTopologySlice';
import { err, ok, type Result } from '../../utils/guards';
import type { IdSource, RandomSource } from '../../utils/runtime';
import { buildQuickTopology } from './domain/buildQuickTopology';
import { findQuickTopology, QUICK_TOPOLOGIES } from './domain/catalog';
import type { QuickTopologyDefinition } from './domain/types';

/** The part of the store state this feature needs. The store state satisfies it as is. */
export interface QuickTopologyHost {
  readonly runtime: { readonly ids: IdSource; readonly random: RandomSource };
  readonly replaceTopology: (next: {
    devices: NetworkDevice[];
    cables: NetworkCable[];
  }) => Result<void, ReplaceTopologyError>;
}

export interface QuickTopologyApplied {
  id: string;
  title: string;
  deviceCount: number;
  cableCount: number;
}

export type QuickTopologyApplyError =
  | { code: 'unknown-topology' }
  | { code: 'build-failed'; detail: string }
  | { code: ReplaceTopologyError };

/**
 * Builds the built-in topology with the given id and swaps it in through
 * `replaceTopology`, which validates it again and refuses while a lab is in
 * progress. On any error the current topology is left untouched.
 */
export function applyQuickTopology(
  topologyId: string,
  host: QuickTopologyHost,
  catalog: readonly QuickTopologyDefinition[] = QUICK_TOPOLOGIES,
): Result<QuickTopologyApplied, QuickTopologyApplyError> {
  const definition = findQuickTopology(topologyId, catalog);
  if (definition === undefined) return err({ code: 'unknown-topology' });

  const { ids, random } = host.runtime;
  const built = buildQuickTopology(definition, {
    ids,
    createDevice: (model, position) => deviceFactory(model, position, { ids, random }),
  });
  if (!built.ok) return err({ code: 'build-failed', detail: `${built.error.code}: ${built.error.detail}` });

  const replaced = host.replaceTopology({ devices: built.value.devices, cables: built.value.cables });
  if (!replaced.ok) return err({ code: replaced.error });

  return ok({
    id: definition.id,
    title: definition.title,
    deviceCount: built.value.devices.length,
    cableCount: built.value.cables.length,
  });
}

export function describeQuickTopologyError(error: QuickTopologyApplyError): string {
  switch (error.code) {
    case 'unknown-topology':
      return 'This quick topology is not available.';
    case 'build-failed':
      return `The topology could not be built (${error.detail}).`;
    case 'lab-in-progress':
      return 'Finish or reset the current lab before loading a quick topology.';
    case 'invalid-topology':
      return 'The topology was rejected by validation and was not loaded.';
  }
}
