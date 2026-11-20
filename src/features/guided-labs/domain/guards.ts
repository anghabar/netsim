import { err, isRecord, ok, readArray, readEnum, readNumber, readString, type Result } from '../../../utils/guards';
import { parseIpv4 } from '../../../utils/ipv4';
import {
  CRITERION_TYPES,
  PORT_FEATURES,
  TRUNK_MODE_CHECKS,
  LAB_FORMAT_VERSION,
  type Criterion,
  type GuidedLab,
  type LabLevel,
  type LabPortInit,
  type LabTask,
} from './types';

export const MAX_DEVICES = 12;
export const MAX_LINKS = 24;
export const MAX_TASKS = 12;
export const MAX_CRITERIA_PER_TASK = 16;
export const MAX_HINTS = 6;
export const MAX_LAB_BYTES = 40000;
export const LAB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const CIDR = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;
const NAME =/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/;
const ENDPOINT = /^([A-Za-z0-9][A-Za-z0-9_-]{0,23}):([A-Za-z0-9/]{1,24})$/;
const LEVELS: readonly LabLevel[] = ['beginner', 'intermediate', 'advanced'];

export interface LabFormatError {
  path: string;
}
const fail = (path: string): Result<never, LabFormatError> => err({ path });

const text = (rec: Record<string, unknown>, field: string, max: number): string | undefined =>
  readString(rec, field, { maxLength: max, minLength: 1 });

const textList = (
  rec: Record<string, unknown>,
  field: string,
  maxItems: number,
  maxLength: number,
): string[] | undefined => {
  const raw = readArray(rec, field, { maxItems });
  if (raw === undefined) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxLength) return undefined;
    out.push(item);
  }
  return out;
};

const vlanOf = (rec: Record<string, unknown>, field: string): number | undefined =>
  readNumber(rec, field, { min: 1, max: 4094, integer: true });

/** Rebuilds one criterion field by field; the type decides which fields are required. */
export function parseCriterion(value: unknown): Criterion | null {
  if (!isRecord(value)) return null;
  const type = readEnum(value, 'type', CRITERION_TYPES);
  const label = text(value, 'label', 120);
  if (type === undefined || label === undefined) return null;
  const device = text(value, 'device', 24);
  const port = text(value, 'port', 24);
  const vlan = vlanOf(value, 'vlan');
  const a = text(value, 'a', 24);
  const b = text(value, 'b', 24);
  switch (type) {
    case 'vlan-exists':
      return device !== undefined && vlan !== undefined ? { type, label, device, vlan } : null;
    case 'port-access-vlan':
    case 'trunk-allows':
      return device !== undefined && port !== undefined && vlan !== undefined
        ? { type, label, device, port, vlan }
        : null;
    case 'l2-reachable': {
      const expected = Object.prototype.hasOwnProperty.call(value, 'expected') ? value.expected : true;
      return a !== undefined && b !== undefined && typeof expected === 'boolean'
        ? { type, label, a, b, expected }
        : null;
    }
    case 'stp-enabled':
    case 'stp-root':
    case 'ospf-enabled':
      return device !== undefined ? { type, label, device } : null;
    case 'stp-blocked-ports': {
      const count = readNumber(value, 'count', { min: 0, max: 64, integer: true });
      return count !== undefined ? { type, label, count } : null;
    }
    case 'ospf-adjacency':
      return a !== undefined && b !== undefined ? { type, label, a, b } : null;
    case 'ospf-route': {
      const prefix = text(value, 'prefix', 18);
      return device !== undefined && prefix !== undefined && CIDR.test(prefix) ? { type, label, device, prefix } : null;
    }
    case 'static-route': {
      const prefix = text(value, 'prefix', 18);
      const nextHop = text(value, 'nextHop', 15);
      return device !== undefined && prefix !== undefined && CIDR.test(prefix) && nextHop !== undefined && parseIpv4(nextHop) !== null
        ? { type, label, device, prefix, nextHop }
        : null;
    }
    case 'ip-reachable': {
      const from = text(value, 'from', 24);
      const address = text(value, 'address', 15);
      const expected = Object.prototype.hasOwnProperty.call(value, 'expected') ? value.expected : true;
      return from !== undefined && address !== undefined && parseIpv4(address) !== null && typeof expected === 'boolean'
        ? { type, label, from, address, expected }
        : null;
    }
    case 'vlanif-address': {
      const address = text(value, 'address', 15);
      const prefix = readNumber(value, 'prefix', { min: 1, max: 32, integer: true });
      return device !== undefined && vlan !== undefined && address !== undefined && parseIpv4(address) !== null && prefix !== undefined
        ? { type, label, device, vlan, address, prefix }
        : null;
    }
    case 'eth-trunk-mode': {
      const trunk = readString(value, 'trunk', { maxLength: 4, pattern: /^\d{1,4}$/ });
      const mode = readEnum(value, 'mode', TRUNK_MODE_CHECKS);
      return device !== undefined && trunk !== undefined && mode !== undefined ? { type, label, device, trunk, mode } : null;
    }
    case 'eth-trunk-members': {
      const trunk = readString(value, 'trunk', { maxLength: 4, pattern: /^\d{1,4}$/ });
      const count = readNumber(value, 'count', { min: 1, max: 16, integer: true });
      return device !== undefined && trunk !== undefined && count !== undefined ? { type, label, device, trunk, count } : null;
    }
    case 'eth-trunk-up': {
      const trunk = readString(value, 'trunk', { maxLength: 4, pattern: /^\d{1,4}$/ });
      const count = readNumber(value, 'count', { min: 1, max: 16, integer: true });
      return a !== undefined && b !== undefined && trunk !== undefined && count !== undefined
        ? { type, label, a, b, trunk, count }
        : null;
    }
    case 'port-feature': {
      const feature = readEnum(value, 'feature', PORT_FEATURES);
      const enabled = Object.prototype.hasOwnProperty.call(value, 'enabled') ? value.enabled : true;
      if (device === undefined || port === undefined || feature === undefined || typeof enabled !== 'boolean') return null;
      if (!Object.prototype.hasOwnProperty.call(value, 'maxMacs')) return { type, label, device, port, feature, enabled };
      const maxMacs = readNumber(value, 'maxMacs', { min: 1, max: 64, integer: true });
      return maxMacs !== undefined && feature === 'port-security'
        ? { type, label, device, port, feature, enabled, maxMacs }
        : null;
    }
  }
}

function parseTask(value: unknown): LabTask | null {
  if (!isRecord(value)) return null;
  const id = readString(value, 'id', { maxLength: 48, pattern: LAB_ID_PATTERN });
  const title = text(value, 'title', 80);
  const description = text(value, 'description', 600);
  const hints = textList(value, 'hints', MAX_HINTS, 400);
  const rawCriteria = readArray(value, 'criteria', { maxItems: MAX_CRITERIA_PER_TASK });
  if (id === undefined || title === undefined || description === undefined || hints === undefined) return null;
  if (rawCriteria === undefined || rawCriteria.length === 0) return null;
  const criteria: Criterion[] = [];
  for (const raw of rawCriteria) {
    const criterion = parseCriterion(raw);
    if (criterion === null) return null;
    criteria.push(criterion);
  }
  return { id, title, description, hints, criteria };
}

function parsePortInit(value: unknown): LabPortInit | null {
  if (!isRecord(value)) return null;
  const device = text(value, 'device', 24);
  const port = text(value, 'port', 24);
  if (device === undefined || port === undefined) return null;
  const init: LabPortInit = { device, port };
  if (Object.prototype.hasOwnProperty.call(value, 'ip')) {
    const ip = text(value, 'ip', 15);
    const prefix = readNumber(value, 'prefix', { min: 1, max: 32, integer: true });
    if (ip === undefined || parseIpv4(ip) === null || prefix === undefined) return null;
    init.ip = ip;
    init.prefix = prefix;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'vlan')) {
    const vlan = vlanOf(value, 'vlan');
    if (vlan === undefined) return null;
    init.vlan = vlan;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'gateway')) {
    const gateway = text(value, 'gateway', 15);
    if (gateway === undefined || parseIpv4(gateway) === null) return null;
    init.gateway = gateway;
  }
  return init;
}

/** Validates a lab definition from untrusted data and rebuilds it field by field. */
export function parseGuidedLab(value: unknown): Result<GuidedLab, LabFormatError> {
  if (!isRecord(value)) return fail('lab');
  const version = readNumber(value, 'formatVersion', {
    min: LAB_FORMAT_VERSION,
    max: LAB_FORMAT_VERSION,
    integer: true,
  });
  if (version === undefined) return fail('formatVersion');
  const id = readString(value, 'id', { maxLength: 48, pattern: LAB_ID_PATTERN });
  const title = text(value, 'title', 80);
  const level = readEnum(value, 'level', LEVELS);
  const minutes = readNumber(value, 'minutes', { min: 1, max: 240, integer: true });
  const summary = text(value, 'summary', 400);
  const objectives = textList(value, 'objectives', 8, 200);
  if (id === undefined || title === undefined || level === undefined || minutes === undefined) return fail('header');
  if (summary === undefined || objectives === undefined || objectives.length === 0) return fail('summary');

  const setup = value.setup;
  if (!isRecord(setup)) return fail('setup');
  const rawDevices = readArray(setup, 'devices', { maxItems: MAX_DEVICES });
  const rawLinks = readArray(setup, 'links', { maxItems: MAX_LINKS });
  const rawPorts = readArray(setup, 'ports', { maxItems: 96 }) ?? [];
  if (rawDevices === undefined || rawLinks === undefined || rawDevices.length === 0) return fail('setup');

  const devices: GuidedLab['setup']['devices'] = [];
  const names = new Set<string>();
  for (const raw of rawDevices) {
    if (!isRecord(raw)) return fail('setup.devices');
    const name = readString(raw, 'name', { maxLength: 24, pattern: NAME });
    const model = text(raw, 'model', 40);
    if (name === undefined || model === undefined || names.has(name)) return fail('setup.devices');
    names.add(name);
    devices.push({ name, model });
  }
  const links: GuidedLab['setup']['links'] = [];
  for (const raw of rawLinks) {
    if (!isRecord(raw)) return fail('setup.links');
    const from = text(raw, 'from', 49);
    const to = text(raw, 'to', 49);
    if (from === undefined || to === undefined) return fail('setup.links');
    const fromMatch = ENDPOINT.exec(from);
    const toMatch = ENDPOINT.exec(to);
    if (fromMatch === null || toMatch === null || !names.has(fromMatch[1]) || !names.has(toMatch[1])) {
      return fail('setup.links');
    }
    links.push({ from, to });
  }
  const ports: LabPortInit[] = [];
  for (const raw of rawPorts) {
    const init = parsePortInit(raw);
    if (init === null || !names.has(init.device)) return fail('setup.ports');
    ports.push(init);
  }

  const rawTasks = readArray(value, 'tasks', { maxItems: MAX_TASKS });
  if (rawTasks === undefined || rawTasks.length === 0) return fail('tasks');
  const tasks: LabTask[] = [];
  const taskIds = new Set<string>();
  for (const raw of rawTasks) {
    const task = parseTask(raw);
    if (task === null || taskIds.has(task.id)) return fail('tasks');
    taskIds.add(task.id);
    tasks.push(task);
  }
  // Every criterion must point at devices that exist in the lab.
  for (const task of tasks) {
    for (const criterion of task.criteria) {
      const refs: string[] = [];
      if ('device' in criterion) refs.push(criterion.device);
      if ('a' in criterion) refs.push(criterion.a, criterion.b);
      if ('from' in criterion) refs.push(criterion.from);
      if (refs.some((name) => !names.has(name))) return fail(`tasks.${task.id}`);
    }
  }
  return ok({
    formatVersion: version,
    id,
    title,
    level,
    minutes,
    summary,
    objectives,
    setup: { devices, links, ports },
    tasks,
  });
}
