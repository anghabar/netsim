import { lazy } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => null,
  wasmPing: () => '',
}));

import { collectFeatureUi, registerFeatureCommands } from '../../features/featureRegistry';
import { assertDistinctFields, collectFeatureSlices, composeFeatureSlices } from '../../store/featureSlices';
import type { FeatureSliceDefinition } from '../../store/featureState';
import type { ICommand } from '../../store/slices/cli/commands/base/Command';
import { CommandRegistry } from '../../store/slices/cli/commands/base/CommandRegistry';
import { createTestStore } from '../helpers/createTestStore';

const slice = (id: string, fields: Record<string, unknown>): FeatureSliceDefinition => ({
  id,
  create: () => ({ ...fields }),
});

const command = (name: string, aliases: string[] = []): ICommand => ({
  name,
  description: `${name} command`,
  vendor: null,
  aliases,
  canHandle: (context) => context.normalizedCommand.toLowerCase().startsWith(name),
  validate: () => ({ valid: true }),
  execute: () => ({ output: [] }),
});

describe('feature slices', () => {
  it('collects valid slices sorted by id', () => {
    const slices = collectFeatureSlices({
      '../features/zeta/feature.slice.ts': { featureSlice: slice('zeta', {}) },
      '../features/alpha/feature.slice.ts': { featureSlice: slice('alpha', {}) },
    });
    expect(slices.map((s) => s.id)).toEqual(['alpha', 'zeta']);
  });

  it('rejects modules with a missing or malformed export and duplicate ids', () => {
    expect(() => collectFeatureSlices({ 'a.ts': {} })).toThrow(/featureSlice/);
    expect(() => collectFeatureSlices({ 'a.ts': { featureSlice: { id: 'Bad Id', create: () => ({}) } } })).toThrow();
    expect(() => collectFeatureSlices({ 'a.ts': { featureSlice: { id: 'alpha' } } })).toThrow();
    expect(() =>
      collectFeatureSlices({ 'a.ts': { featureSlice: slice('alpha', {}) }, 'b.ts': { featureSlice: slice('alpha', {}) } }),
    ).toThrow(/twice/);
  });

  it('composes slices and throws on duplicate state fields', () => {
    const store = createTestStore();
    const args = [store.setState, store.getState, store] as const;

    const composed = composeFeatureSlices([slice('alpha', { alphaCount: 1 }), slice('beta', { betaFlag: true })], ['devices'], ...args);
    expect(composed).toEqual({ alphaCount: 1, betaFlag: true });

    expect(() =>
      composeFeatureSlices([slice('alpha', { sharedField: 1 }), slice('beta', { sharedField: 2 })], [], ...args),
    ).toThrow(/sharedField/);
    expect(() => composeFeatureSlices([slice('alpha', { devices: [] })], ['devices'], ...args)).toThrow(/core/);
  });

  it('detects duplicate fields between core parts', () => {
    expect(assertDistinctFields({ one: { a: 1 }, two: { b: 2 } })).toEqual(['a', 'b']);
    expect(() => assertDistinctFields({ one: { a: 1 }, two: { a: 2 } })).toThrow(/"a"/);
  });
});

describe('feature commands', () => {
  it('registers commands contributed by features', () => {
    const registry = new CommandRegistry();
    registry.register(command('display'));
    const added = registerFeatureCommands(registry, {
      './diagnostics/feature.commands.ts': { featureCommands: [command('diagnose', ['diag'])] },
    });
    expect(added).toBe(1);
    expect(registry.getAllCommands().map((c) => c.name)).toEqual(['display', 'diagnose']);
    expect(registerFeatureCommands(registry, {})).toBe(0);
  });

  it('throws on a clash with a core command and registers nothing', () => {
    const registry = new CommandRegistry();
    registry.register(command('display', ['show']));
    const modules = {
      './one/feature.commands.ts': { featureCommands: [command('inspect')] },
      './two/feature.commands.ts': { featureCommands: [command('report', ['SHOW'])] },
    };
    expect(() => registerFeatureCommands(registry, modules)).toThrow(/show/);
    expect(registry.getAllCommands()).toHaveLength(1);
  });

  it('throws on a clash between two features and on invalid exports', () => {
    expect(() =>
      registerFeatureCommands(new CommandRegistry(), {
        './one/feature.commands.ts': { featureCommands: [command('inspect')] },
        './two/feature.commands.ts': { featureCommands: [command('inspect')] },
      }),
    ).toThrow(/inspect/);
    expect(() => registerFeatureCommands(new CommandRegistry(), { './x/feature.commands.ts': {} })).toThrow();
    expect(() =>
      registerFeatureCommands(new CommandRegistry(), { './x/feature.commands.ts': { featureCommands: [{ name: 'x' }] } }),
    ).toThrow(/invalid command/);
  });
});

describe('feature panels', () => {
  const Panel = lazy(async () => ({ default: () => null }));

  it('sorts by order and rejects duplicates or malformed definitions', () => {
    const list = collectFeatureUi({
      './b/feature.ui.tsx': { featureUi: { id: 'beta', title: 'Beta', order: 20, Panel } },
      './a/feature.ui.tsx': { featureUi: { id: 'alpha', title: 'Alpha', order: 10, Panel } },
    });
    expect(list.map((entry) => entry.id)).toEqual(['alpha', 'beta']);
    expect(() =>
      collectFeatureUi({
        './a/feature.ui.tsx': { featureUi: { id: 'alpha', title: 'Alpha', order: 10, Panel } },
        './b/feature.ui.tsx': { featureUi: { id: 'alpha', title: 'Again', order: 20, Panel } },
      }),
    ).toThrow(/twice/);
    expect(() => collectFeatureUi({ './a/feature.ui.tsx': { featureUi: { id: 'alpha', title: 'Alpha' } } })).toThrow();
  });
});
