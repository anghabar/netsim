import {
  err,
  isRecord,
  ok,
  parseJsonText,
  readNumber,
  readString,
  utf8ByteLength,
  type Result,
} from '../../../utils/guards';
import type { Clock, IdSource } from '../../../utils/runtime';
import { rebuildTopology } from './topologyRebuild';
import { cleanName, toIsoDate, WORKSPACE_LIMITS, type TopologyData, type WorkspaceError } from './workspaceModel';

/** Shareable topology file: `{ format, version, name, createdAt, topology }`. */
export const TOPOLOGY_FILE_FORMAT = 'netsim-topology';
export const TOPOLOGY_FILE_VERSION = 1;
export const TOPOLOGY_FILE_EXTENSION = '.netsim.json';

const RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

export interface TopologyFileExport {
  fileName: string;
  text: string;
  /** Secret-looking fields found in the device configuration. */
  sensitiveCount: number;
  /** Where they were found ("<hostname>: <field path>"); never contains values. */
  sensitiveFields: string[];
  /** True when the file text contains those fields. */
  sensitiveIncluded: boolean;
}

export interface TopologyFileImport {
  name: string;
  topology: TopologyData;
  /** Fields of the file that the simulator does not know and left out. */
  ignoredFields: number;
  /** Devices whose model is not in the catalog. */
  unknownModels: number;
}

/** Download name restricted to [a-z0-9-] plus the fixed extension. */
export function topologyFileName(name: string): string {
  const slug = name
    .slice(0, 200)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  if (slug.length === 0) return `topology${TOPOLOGY_FILE_EXTENSION}`;
  return `${RESERVED_FILE_NAME.test(slug) ? `topology-${slug}` : slug}${TOPOLOGY_FILE_EXTENSION}`;
}

/**
 * Serialises a topology for sharing. Console output, CLI session state and
 * staged configuration are never exported; secret-looking fields are left out
 * unless `includeSensitive` is set, and are always reported.
 */
export function buildTopologyFile(
  input: { name: string; topology: unknown; includeSensitive: boolean },
  clock: Clock,
): Result<TopologyFileExport, WorkspaceError> {
  const shared = rebuildTopology(input.topology, {
    resetSession: true,
    removeSensitive: !input.includeSensitive,
  });
  if (!shared.ok) return shared;
  if (shared.value.devices.length === 0) return err('empty-topology');

  const name = cleanName(input.name) || 'Topology';
  const file = {
    format: TOPOLOGY_FILE_FORMAT,
    version: TOPOLOGY_FILE_VERSION,
    name,
    createdAt: toIsoDate(clock()),
    topology: { devices: shared.value.devices, cables: shared.value.cables },
  };
  const fits = (text: string): boolean =>
    text.length <= WORKSPACE_LIMITS.maxFileBytes && utf8ByteLength(text) <= WORKSPACE_LIMITS.maxFileBytes;
  let text = JSON.stringify(file, null, 2);
  if (!fits(text)) text = JSON.stringify(file);
  if (!fits(text)) return err('too-large');

  return ok({
    fileName: topologyFileName(name),
    text,
    sensitiveCount: shared.value.sensitiveCount,
    sensitiveFields: shared.value.sensitiveFields,
    sensitiveIncluded: input.includeSensitive && shared.value.sensitiveCount > 0,
  });
}

/**
 * Reads a topology file. The size is checked before parsing, the content is
 * validated by the shared guard, every id is regenerated, and identifiers or
 * dates found in the file are ignored.
 */
export function readTopologyFile(text: string, deps: { ids: IdSource }): Result<TopologyFileImport, WorkspaceError> {
  const json = parseJsonText(text, { maxBytes: WORKSPACE_LIMITS.maxFileBytes });
  if (!json.ok) return err(json.error === 'too-large' ? 'too-large' : 'invalid-json');
  const doc = json.value;
  if (!isRecord(doc)) return err('unsupported-format');
  const format = readString(doc, 'format', { maxLength: 64 });
  const version = readNumber(doc, 'version', { min: 0, max: 1000000, integer: true });
  if (format !== TOPOLOGY_FILE_FORMAT || version !== TOPOLOGY_FILE_VERSION) return err('unsupported-format');

  const topology: unknown = Object.prototype.hasOwnProperty.call(doc, 'topology') ? doc.topology : undefined;
  const rebuilt = rebuildTopology(topology, { ids: deps.ids, resetSession: true, removeSensitive: false });
  if (!rebuilt.ok) return rebuilt;
  if (rebuilt.value.devices.length === 0) return err('empty-topology');

  let ignoredFields = 0;
  let unknownModels = 0;
  for (const warning of rebuilt.value.warnings) {
    if (warning.code === 'unknown-model') unknownModels += 1;
    else if (warning.code === 'dropped-field') ignoredFields += 1;
  }
  return ok({
    name: cleanName(readString(doc, 'name', { maxLength: 400 }) ?? '') || 'Imported topology',
    topology: { devices: rebuilt.value.devices, cables: rebuilt.value.cables },
    ignoredFields,
    unknownModels,
  });
}
