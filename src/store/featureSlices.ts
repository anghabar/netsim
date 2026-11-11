import { isRecord } from '../utils/guards';
import type { FeatureSliceDefinition, FeatureState } from './featureState';

const discovered: Record<string, unknown> = import.meta.glob('../features/*/feature.slice.ts', { eager: true });

const FEATURE_ID = /^[a-z][a-z0-9-]{1,39}$/;

type CreatorArgs = Parameters<FeatureSliceDefinition['create']>;

function isSliceDefinition(value: unknown): value is FeatureSliceDefinition {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    FEATURE_ID.test(value.id) &&
    typeof value.create === 'function'
  );
}

/** Validates the `featureSlice` export of every discovered module and sorts the result by id. */
export function collectFeatureSlices(modules: Record<string, unknown> = discovered): FeatureSliceDefinition[] {
  const slices: FeatureSliceDefinition[] = [];
  for (const path of Object.keys(modules)) {
    const mod = modules[path];
    const candidate = isRecord(mod) ? mod.featureSlice : undefined;
    if (!isSliceDefinition(candidate)) throw new Error(`${path} must export a valid "featureSlice"`);
    if (slices.some((slice) => slice.id === candidate.id)) {
      throw new Error(`Feature slice id "${candidate.id}" is used twice`);
    }
    slices.push(candidate);
  }
  return slices.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Throws when two parts define the same state field; returns every field name. */
export function assertDistinctFields(parts: Record<string, object>): string[] {
  const owners = new Map<string, string>();
  for (const [owner, part] of Object.entries(parts)) {
    for (const name of Object.keys(part)) {
      const previous = owners.get(name);
      if (previous !== undefined) {
        throw new Error(`State field "${name}" is defined by both "${previous}" and "${owner}"`);
      }
      owners.set(name, owner);
    }
  }
  return [...owners.keys()];
}

/** Creates every feature slice; a field that collides with a core slice or another feature throws. */
export function composeFeatureSlices(
  slices: readonly FeatureSliceDefinition[],
  reservedFields: Iterable<string>,
  ...args: CreatorArgs
): FeatureState {
  const owners = new Map<string, string>();
  for (const name of reservedFields) owners.set(name, 'core');
  const state: Partial<FeatureState> = {};
  for (const slice of slices) {
    const part = slice.create(...args);
    for (const name of Object.keys(part)) {
      const owner = owners.get(name);
      if (owner !== undefined) {
        throw new Error(`State field "${name}" of feature "${slice.id}" is already defined by "${owner}"`);
      }
      owners.set(name, slice.id);
    }
    Object.assign(state, part);
  }
  return state as FeatureState;
}
