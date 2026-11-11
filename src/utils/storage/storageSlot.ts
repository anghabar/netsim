/** A named, size-bounded place in local storage. Each feature defines its own slots. */
export interface StorageSlot {
  readonly name: string;
  readonly maxBytes: number;
}

const SLOT_NAME = /^netsim\.[a-z0-9-]+(\.[a-z0-9-]+)*\.v[0-9]+$/;
const definedNames = new Set<string>();

// Hot module replacement re-evaluates modules in the dev server; everywhere else a duplicate is a bug.
const tolerateRedefinition = import.meta.env.DEV === true && import.meta.env.MODE !== 'test';

export function defineStorageSlot(name: string, options: { maxBytes: number }): StorageSlot {
  if (!SLOT_NAME.test(name)) {
    throw new Error(`Invalid storage slot name "${name}": expected netsim.<feature>.<thing>.v<n>`);
  }
  if (!Number.isInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new Error(`Storage slot "${name}" needs a positive integer maxBytes`);
  }
  if (definedNames.has(name) && !tolerateRedefinition) {
    throw new Error(`Storage slot "${name}" is defined twice`);
  }
  definedNames.add(name);
  return Object.freeze({ name, maxBytes: options.maxBytes });
}
