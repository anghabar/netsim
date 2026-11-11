import { isRecord, readBoolean, readEnum, readNumber, readString } from '../../../utils/guards';
import { formatIpv4, maskToPrefix, parseIpv4 } from '../../../utils/ipv4';
import type { AddressView, CableView, DeviceView, PortModeView, PortView, TopologyView } from './types';

/**
 * Builds the validated, size-bounded view the rules work on.
 *
 * The input is treated as untrusted: only own properties of plain objects are
 * read, every list and string is bounded, and only an allowlist of fields
 * (ids, names, mode, VLAN, address, prefix) is copied. Nothing else from the
 * device configuration can reach a report.
 */

export interface ViewLimits {
  readonly maxDevices: number;
  readonly maxPortsPerDevice: number;
  readonly maxVlanInterfacesPerDevice: number;
  readonly maxCables: number;
  readonly maxLabelLength: number;
  readonly maxIdLength: number;
}

export const DIAGNOSTICS_LIMITS: ViewLimits = Object.freeze({
  maxDevices: 500,
  maxPortsPerDevice: 128,
  maxVlanInterfacesPerDevice: 128,
  maxCables: 2000,
  maxLabelLength: 64,
  maxIdLength: 128,
});

interface Tally {
  truncated: boolean;
  skipped: number;
}

const MODES: readonly PortModeView[] = ['access', 'trunk', 'hybrid', 'routed'];
const VLAN_RANGE = { min: 1, max: 4094, integer: true };
const MAX_ADDRESS_TEXT = 15;

const ownValue = (rec: Record<string, unknown>, field: string): unknown =>
  Object.prototype.hasOwnProperty.call(rec, field) ? rec[field] : undefined;

/** Control, bidirectional-override, zero-width and unpaired surrogate code points. */
function isUnprintable(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    (code >= 0xd800 && code <= 0xdfff) ||
    code === 0xfeff
  );
}

/**
 * Makes a name safe to print in a console line or a panel: unprintable
 * characters are removed and the length is clamped, so a device name cannot
 * forge extra lines or reorder the text around it.
 */
export function cleanLabel(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  let out = '';
  // Only a bounded prefix is scanned, whatever the size of the input.
  for (const ch of value.slice(0, maxLength * 4)) {
    if (out.length + ch.length > maxLength) break;
    const code = ch.codePointAt(0) ?? 0;
    if (!isUnprintable(code)) out += ch;
  }
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function readList(value: unknown, max: number, tally: Tally): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  const items: readonly unknown[] = value;
  if (items.length <= max) return items;
  tally.truncated = true;
  return items.slice(0, max);
}

function readId(rec: Record<string, unknown>, field: string, limits: ViewLimits): string | null {
  const value = readString(rec, field, { maxLength: limits.maxIdLength, minLength: 1 });
  if (value === undefined) return null;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return null;
  }
  return value;
}

/** Canonical dotted-decimal address, or null when missing, malformed or unspecified (0.0.0.0). */
function readAddress(rec: Record<string, unknown>, field: string): string | null {
  const text = readString(rec, field, { maxLength: MAX_ADDRESS_TEXT, minLength: 7 });
  if (text === undefined) return null;
  const value = parseIpv4(text);
  return value === null || value === 0 ? null : formatIpv4(value);
}

/** Prefix length given as a number (0..32) or as a dotted mask. */
function readPrefix(rec: Record<string, unknown>, field: string): number | null {
  const asNumber = readNumber(rec, field, { min: 0, max: 32, integer: true });
  if (asNumber !== undefined) return asNumber;
  const asText = readString(rec, field, { maxLength: MAX_ADDRESS_TEXT, minLength: 7 });
  return asText === undefined ? null : maskToPrefix(asText);
}

function toPortView(raw: unknown, limits: ViewLimits): PortView | null {
  if (!isRecord(raw)) return null;
  const id = readId(raw, 'id', limits);
  if (id === null) return null;
  const rawConfig = ownValue(raw, 'config');
  const config: Record<string, unknown> = isRecord(rawConfig) ? rawConfig : {};
  const address = readAddress(config, 'ipAddress');
  return {
    id,
    name: cleanLabel(ownValue(raw, 'name'), 'unnamed-port', limits.maxLabelLength),
    enabled: readBoolean(config, 'enabled') !== false,
    mode: readEnum(config, 'mode', MODES) ?? null,
    vlan: readNumber(config, 'vlan', VLAN_RANGE) ?? null,
    address,
    prefixLength: address === null ? null : readPrefix(config, 'subnetMask'),
  };
}

function toDeviceView(raw: unknown, seen: Set<string>, limits: ViewLimits, tally: Tally): DeviceView | null {
  if (!isRecord(raw)) return null;
  const id = readId(raw, 'id', limits);
  if (id === null || seen.has(id)) return null;
  seen.add(id);

  const ports: PortView[] = [];
  const portIds = new Set<string>();
  for (const rawPort of readList(ownValue(raw, 'ports'), limits.maxPortsPerDevice, tally)) {
    const port = toPortView(rawPort, limits);
    if (port === null || portIds.has(port.id)) {
      tally.skipped += 1;
      continue;
    }
    portIds.add(port.id);
    ports.push(port);
  }

  const addresses: AddressView[] = [];
  for (const port of ports) {
    if (port.address !== null) addresses.push({ label: port.name, portId: port.id, address: port.address });
  }
  for (const rawVlanif of readList(ownValue(raw, 'vlanifs'), limits.maxVlanInterfacesPerDevice, tally)) {
    if (!isRecord(rawVlanif)) {
      tally.skipped += 1;
      continue;
    }
    const vlanId = readNumber(rawVlanif, 'vlanId', VLAN_RANGE);
    const address = readAddress(rawVlanif, 'ipAddress');
    if (vlanId !== undefined && address !== null) {
      addresses.push({ label: `Vlanif${vlanId}`, portId: null, address });
    }
  }

  const isHost =
    ownValue(raw, 'type') === 'PC' || ownValue(raw, 'vendor') === 'PC' || ownValue(raw, 'model') === 'PC';
  return {
    id,
    hostname: cleanLabel(ownValue(raw, 'hostname'), 'unnamed', limits.maxLabelLength),
    isHost,
    ports,
    addresses,
  };
}

function toCableView(raw: unknown, limits: ViewLimits): CableView | null {
  if (!isRecord(raw)) return null;
  const id = readId(raw, 'id', limits);
  const sourceDeviceId = readId(raw, 'sourceDeviceId', limits);
  const sourcePortId = readId(raw, 'sourcePortId', limits);
  const targetDeviceId = readId(raw, 'targetDeviceId', limits);
  const targetPortId = readId(raw, 'targetPortId', limits);
  if (
    id === null ||
    sourceDeviceId === null ||
    sourcePortId === null ||
    targetDeviceId === null ||
    targetPortId === null
  ) {
    return null;
  }
  return { id, sourceDeviceId, sourcePortId, targetDeviceId, targetPortId };
}

/** Never throws. Malformed and duplicate entries are counted in `skipped`; clamped lists set `truncated`. */
export function toTopologyView(
  devices: unknown,
  cables: unknown,
  limits: ViewLimits = DIAGNOSTICS_LIMITS,
): TopologyView {
  const tally: Tally = { truncated: false, skipped: 0 };

  const deviceIds = new Set<string>();
  const deviceViews: DeviceView[] = [];
  for (const raw of readList(devices, limits.maxDevices, tally)) {
    const view = toDeviceView(raw, deviceIds, limits, tally);
    if (view === null) tally.skipped += 1;
    else deviceViews.push(view);
  }

  const cableIds = new Set<string>();
  const cableViews: CableView[] = [];
  for (const raw of readList(cables, limits.maxCables, tally)) {
    const view = toCableView(raw, limits);
    if (view === null || cableIds.has(view.id)) {
      tally.skipped += 1;
      continue;
    }
    cableIds.add(view.id);
    cableViews.push(view);
  }

  return { devices: deviceViews, cables: cableViews, truncated: tally.truncated, skipped: tally.skipped };
}
