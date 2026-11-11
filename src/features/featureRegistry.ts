import type { ComponentType, LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ICommand } from '../store/slices/cli/commands/base/Command';
import { CommandRegistry, globalCommandRegistry } from '../store/slices/cli/commands/base/CommandRegistry';
import { isRecord } from '../utils/guards';

/**
 * Discovery of what features contribute to the shell: a panel in the Tools
 * menu (`feature.ui.tsx`) and CLI commands (`feature.commands.ts`). These
 * files must not import the store at module load.
 */

export interface FeaturePanelProps {
  onClose: () => void;
}

export type FeatureUiDefinition = {
  id: string;
  title: string;
  order: number;
  Icon?: LucideIcon;
  Panel: LazyExoticComponent<ComponentType<FeaturePanelProps>>;
};

const uiModules: Record<string, unknown> = import.meta.glob('./*/feature.ui.tsx', { eager: true });
const commandModules: Record<string, unknown> = import.meta.glob('./*/feature.commands.ts', { eager: true });

const FEATURE_ID = /^[a-z][a-z0-9-]{1,39}$/;

function isUiDefinition(value: unknown): value is FeatureUiDefinition {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    FEATURE_ID.test(value.id) &&
    typeof value.title === 'string' &&
    value.title.length > 0 &&
    value.title.length <= 40 &&
    typeof value.order === 'number' &&
    Number.isFinite(value.order) &&
    typeof value.Panel === 'object' &&
    value.Panel !== null
  );
}

/** Validates the `featureUi` export of every module; sorted by order, then id. */
export function collectFeatureUi(modules: Record<string, unknown> = uiModules): FeatureUiDefinition[] {
  const found: FeatureUiDefinition[] = [];
  for (const path of Object.keys(modules)) {
    const mod = modules[path];
    const candidate = isRecord(mod) ? mod.featureUi : undefined;
    if (!isUiDefinition(candidate)) throw new Error(`${path} must export a valid "featureUi"`);
    if (found.some((entry) => entry.id === candidate.id)) {
      throw new Error(`Feature panel id "${candidate.id}" is used twice`);
    }
    found.push(candidate);
  }
  return found.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

let cachedUi: FeatureUiDefinition[] | null = null;

export function listFeatureUi(): readonly FeatureUiDefinition[] {
  if (cachedUi === null) cachedUi = collectFeatureUi();
  return cachedUi;
}

function isCommand(value: unknown): value is ICommand {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    'canHandle' in value &&
    typeof value.canHandle === 'function' &&
    'validate' in value &&
    typeof value.validate === 'function' &&
    'execute' in value &&
    typeof value.execute === 'function'
  );
}

/** Validates the `featureCommands` export of every module, in a stable order. */
export function collectFeatureCommands(modules: Record<string, unknown> = commandModules): ICommand[] {
  const commands: ICommand[] = [];
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path];
    const exported = isRecord(mod) ? mod.featureCommands : undefined;
    if (!Array.isArray(exported)) throw new Error(`${path} must export a "featureCommands" array`);
    const items: readonly unknown[] = exported;
    for (const item of items) {
      if (!isCommand(item)) throw new Error(`${path} exports an invalid command`);
      commands.push(item);
    }
  }
  return commands;
}

const labelsOf = (command: ICommand): string[] =>
  [command.name, ...(command.aliases ?? [])].map((label) => label.trim().toLowerCase());

const registeredRegistries = new WeakSet<CommandRegistry>();

/**
 * Registers the commands contributed by features. A name or alias that is
 * already registered throws before anything is added. Calling it again for
 * the same registry does nothing.
 */
export function registerFeatureCommands(
  registry: CommandRegistry = globalCommandRegistry,
  modules: Record<string, unknown> = commandModules,
): number {
  if (registeredRegistries.has(registry)) return 0;
  const commands = collectFeatureCommands(modules);
  const taken = new Set<string>();
  for (const existing of registry.getAllCommands()) {
    for (const label of labelsOf(existing)) taken.add(label);
  }
  for (const command of commands) {
    const labels = labelsOf(command);
    for (const label of labels) {
      if (taken.has(label)) throw new Error(`CLI command "${label}" is already registered`);
    }
    for (const label of labels) taken.add(label);
  }
  registry.registerMany(commands);
  registeredRegistries.add(registry);
  return commands.length;
}
